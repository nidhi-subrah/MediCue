"""Research decision engine: for one hypothesis, choose CHECK_DATA, ASK_CLINICIAN or WAIT.

The hypothesis H has a confidence c = P(H). Each action is scored by its expected information gain
(bits of entropy removed from c) minus its cost:

    CHECK_DATA     EIG over the binomial outcome of the n unprocessed episodes      − compute cost
    ASK_CLINICIAN  EIG over agree / disagree / unsure, given the clinician's
                   learned reliability                         − delay − burden (− unchecked-data, if a
                                                                 worthwhile free data check is still pending)
    WAIT           EIG of the episodes expected over the next 24 h, discounted for the delay

Evidence is tempered: data by a per-test-type `data_weight` because episodes from one patient are correlated (treating
them as independent makes a handful of episodes look conclusive), clinician answers by `clinician_weight`
because an impression is not a measurement, so no single source can settle a hypothesis on its own. This is deterministic arithmetic, not an
LLM: the same inputs always give the same scores.
"""
import math
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ResearchConfig:
    clinician_weight: float = 0.7       # tempering of clinician answers (an impression, not a measurement)
    check_cost: float = 0.02
    ask_delay_cost: float = 0.03
    ask_burden_per_pending: float = 0.03
    ask_before_data_cost: float = 0.1   # using a person's time while a worthwhile free data check is pending
    unsure_rate: float = 0.2            # P(clinician answers "unsure"), carries no information
    originator_discount: float = 0.5    # shrink the observer's reliability toward 0.5 on their own idea
    wait_discount: float = 0.3
    support_threshold: float = 0.90
    reject_threshold: float = 0.10
    min_score: float = 0.01             # below this nothing is worth doing → inconclusive, keep watching
    max_actions_per_cycle: int = 4


def h2(p: float) -> float:
    """Binary entropy in bits."""
    if p <= 0 or p >= 1:
        return 0.0
    return -(p * math.log2(p) + (1 - p) * math.log2(1 - p))


def update(c: float, log_lr: float) -> float:
    odds = c / (1 - c) * math.exp(log_lr)
    return min(max(odds / (1 + odds), 0.01), 0.99)


def p1_from_ratio(p0: float, ratio: float) -> float:
    """P(episode is 'supporting' | H) when H says the rate in the window is `ratio` × baseline."""
    return ratio * p0 / (ratio * p0 + 1 - p0)


def data_log_lr(k: int, n: int, p1: float, p0: float, w: float) -> float:
    return w * (k * math.log(p1 / p0) + (n - k) * math.log((1 - p1) / (1 - p0)))


def _binom(n: int, k: int, p: float) -> float:
    return math.comb(n, k) * p ** k * (1 - p) ** (n - k)


def eig_data(c: float, n: int, p1: float, p0: float, w: float) -> float:
    if n <= 0:
        return 0.0
    expected = 0.0
    for k in range(n + 1):
        pk = c * _binom(n, k, p1) + (1 - c) * _binom(n, k, p0)
        expected += pk * h2(update(c, data_log_lr(k, n, p1, p0, w)))
    return max(h2(c) - expected, 0.0)


def clinician_log_lr(response: str, reliability: float, w: float) -> float:
    if response == "agree":
        return w * math.log(reliability / (1 - reliability))
    if response == "disagree":
        return w * math.log((1 - reliability) / reliability)
    return 0.0


def eig_clinician(c: float, r: float, u: float, w: float) -> float:
    expected = u * h2(c)
    for resp in ("agree", "disagree"):
        p_resp = (1 - u) * (c * r + (1 - c) * (1 - r) if resp == "agree" else c * (1 - r) + (1 - c) * r)
        expected += p_resp * h2(update(c, clinician_log_lr(resp, r, w)))
    return max(h2(c) - expected, 0.0)


@dataclass
class Clinician:
    id: str
    name: str
    role: str
    reliability: float      # learned, already adjusted for familiarity with the patient
    pending: int = 0        # open inquiries already waiting on this clinician
    originator: bool = False


@dataclass
class ActionScore:
    kind: str               # CHECK_DATA | ASK_CLINICIAN | WAIT
    label: str
    eig: float
    costs: dict[str, float]
    score: float
    target: str | None = None
    detail: dict = field(default_factory=dict)

    def public(self) -> dict:
        return {"kind": self.kind, "label": self.label, "target": self.target, "eig": round(self.eig, 3),
                "costs": {k: round(v, 3) for k, v in self.costs.items()}, "score": round(self.score, 3),
                "detail": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in self.detail.items()}}


def score_actions(c: float, *, n_new: int, p1: float | None, p0: float | None, data_weight: float,
                  expected_new_24h: float, clinicians: list[Clinician], asked: set[str],
                  cfg: ResearchConfig) -> list[ActionScore]:
    out: list[ActionScore] = []
    testable = p1 is not None and p0 is not None

    if testable and n_new > 0:
        eig = eig_data(c, n_new, p1, p0, data_weight)
        out.append(ActionScore("CHECK_DATA", f"Check {n_new} new episode(s) in the event store", eig,
                               {"compute": cfg.check_cost}, eig - cfg.check_cost,
                               detail={"new_episodes": n_new, "p_support_if_true": p1, "p_support_if_false": p0}))

    data_first = any(a.kind == "CHECK_DATA" and a.score > cfg.min_score for a in out)
    for cl in clinicians:
        if cl.id in asked:
            continue
        r = 0.5 + (cl.reliability - 0.5) * (cfg.originator_discount if cl.originator else 1.0)
        eig = eig_clinician(c, r, cfg.unsure_rate, cfg.clinician_weight)
        costs = {"delay": cfg.ask_delay_cost}
        if cl.pending:
            costs["burden"] = cfg.ask_burden_per_pending * cl.pending
        if data_first:
            costs["unchecked_data"] = cfg.ask_before_data_cost
        detail = {"clinician_reliability": r}
        if cl.originator:
            detail["note"] = "made this observation; reliability discounted"
        out.append(ActionScore("ASK_CLINICIAN", f"Ask {cl.name} ({cl.role})", eig, costs,
                               eig - sum(costs.values()), target=cl.id, detail=detail))

    n_wait = round(expected_new_24h)
    eig_wait = cfg.wait_discount * eig_data(c, n_wait, p1, p0, data_weight) if testable else 0.0
    out.append(ActionScore("WAIT", "Wait for new episodes (re-check next cycle)", eig_wait, {}, eig_wait,
                           detail={"expected_new_episodes_24h": round(expected_new_24h, 1)}))
    out.sort(key=lambda a: -a.score)
    return out
