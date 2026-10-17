"""Decision engine: after every belief update, score Ask / Look up / Consult / Escalate / Send and pick one.

    score(a) = E[Δ expected loss | a] + μ·κ(b)·EIG(a) − λ_F·fatigue(a) − λ_D·delay(a)·risk(b)

* Expected loss L(b) of stopping now and acting on the top need m:  Σ_n b(n)·C(n, m),
  where C is asymmetric (missing chest pain costs far more than confusing thirst with cold).
* One-step expected loss is myopic: it gives a confirming question ("Do you want a drink?") almost no
  value, because after a "no" the engine still doesn't know the need. The information-gain term,
  priced at κ(b) = Σ_n b(n)·miss_cost(n) per bit, stands in for the follow-up questions that a "no"
  makes possible. That is the "risk-weighted value of information".
* risk(b) = Σ_n b(n)·urgency(n), so delay is expensive exactly when a high-risk need is plausible.
* Escalate removes the misinterpretation loss (a nurse assesses in person) at a false-alarm cost
  proportional to P(no high-risk need):  score = L(b) − FA·(1 − P_high).
* Send (finalise and notify the nurse with the current belief) is the baseline, score 0.

Safety floor: if P(any high-risk need) ≥ threshold, escalate regardless of scores. The check uses the
larger of the full belief and a belief built from the patient's (and consulted people's) signals only,
so chart context can raise urgency but never talk the engine out of a patient-signalled emergency.
This rule is deterministic and never depends on Gemini or any network call.
"""
from dataclasses import dataclass, field

from ..catalog import Catalog
from ..config import EngineConfig
from .belief import (argmax, bayes_update, consult_likelihood, entropy, p_high_risk, yes_prob)


@dataclass
class Consultant:
    id: str
    name: str
    relation: str
    reliability: float
    available: bool = True       # False outside the hours a profile says they can be reached
    cost_factor: float = 1.0     # < 1 for a profile-preferred interpreter


@dataclass
class DecisionInput:
    belief: list[float]
    reliability: float                      # patient's signal reliability
    fatigue: float                          # ≥ 1, grows with questions asked and slowing taps
    questions_asked: int = 0
    asked: set[str] = field(default_factory=set)
    used_lookups: set[str] = field(default_factory=set)
    available_lookups: set[str] | None = None   # None = all catalog lookups
    consultants: list[Consultant] = field(default_factory=list)
    consulted: set[str] = field(default_factory=set)
    dialogue_open: bool = True              # False while the patient is still in the tap phase
    signal_p_high: float = 0.0              # P(high-risk) from patient/person signals only, no chart
    patient_can_answer: bool = True         # False after too many inconsistent answers: stop asking


@dataclass
class Action:
    kind: str
    id: str
    label: str
    score: float
    value: float
    costs: dict[str, float]
    eig: float = 0.0

    def public(self) -> dict:
        return {"kind": self.kind, "id": self.id, "label": self.label, "score": round(self.score, 3),
                "value": round(self.value, 3), "costs": {k: round(v, 3) for k, v in self.costs.items()},
                "eig": round(self.eig, 3)}


@dataclass
class Decision:
    chosen: Action
    ranked: list[Action]
    reason: str

    def public(self, k: int = 6) -> dict:
        return {"chosen": self.chosen.public(), "ranked": [a.public() for a in self.ranked[:k]],
                "reason": self.reason}


def expected_loss(cat: Catalog, b: list[float]) -> float:
    m = argmax(b)
    return sum(b[n] * cat.cost[n][m] for n in range(cat.n))


def _outcome_value(cat: Catalog, b: list[float], outcome_liks: list[list[float]]) -> tuple[float, float]:
    """Expected loss reduction and information gain from an action with discrete outcomes.

    outcome_liks[k][n] = P(outcome k | need n).
    """
    l0, h0 = expected_loss(cat, b), entropy(b)
    el, eh = 0.0, 0.0
    for lik in outcome_liks:
        pk = sum(bi * li for bi, li in zip(b, lik))
        if pk < 1e-12:
            continue
        post = bayes_update(b, lik)
        el += pk * expected_loss(cat, post)
        eh += pk * entropy(post)
    return max(l0 - el, 0.0), max(h0 - eh, 0.0)


def consult_options(cat: Catalog, b: list[float], k: int = 4) -> list[str]:
    order = sorted(range(cat.n), key=lambda i: -b[i])[:k]
    return [cat.need_ids[i] for i in order]


def decide(cat: Catalog, cfg: EngineConfig, x: DecisionInput) -> Decision:
    b = x.belief
    l0 = expected_loss(cat, b)
    risk = sum(p * u for p, u in zip(b, cat.urgency))
    p_high = p_high_risk(cat, b)
    kappa = cfg.info_weight * sum(p * c for p, c in zip(b, cat.miss_cost))
    actions: list[Action] = []

    def info_value(liks):
        dl, eig = _outcome_value(cat, b, liks)
        return dl + kappa * eig, eig

    for lk in cat.lookups:
        if lk.id in x.used_lookups or (x.available_lookups is not None and lk.id not in x.available_lookups):
            continue
        value, eig = info_value([lk.p_true, [1 - p for p in lk.p_true]])
        delay = cfg.lambda_delay * cfg.delay_lookup * risk
        actions.append(Action("lookup", lk.id, f"Look up: {lk.label}", value - delay, value, {"delay": delay}, eig))

    if x.dialogue_open and x.questions_asked < cfg.max_questions and x.patient_can_answer:
        for q in cat.questions:
            if q.id in x.asked:
                continue
            p = yes_prob(q.p_yes, x.reliability)
            value, eig = info_value([p, [1 - v for v in p]])
            fatigue = cfg.lambda_fatigue * x.fatigue
            delay = cfg.lambda_delay * cfg.delay_ask * risk
            actions.append(Action("ask", q.id, f"Ask: {q.text}", value - fatigue - delay, value,
                                  {"fatigue": fatigue, "delay": delay}, eig))

    if x.dialogue_open:
        options = consult_options(cat, b)
        for person in x.consultants:
            if person.id in x.consulted or not person.available:
                continue
            liks = [consult_likelihood(cat, options, ans, person.reliability) for ans in options + [None]]
            value, eig = info_value(liks)
            delay = cfg.lambda_delay * cfg.delay_consult * risk
            their = cfg.lambda_their_time * person.cost_factor
            actions.append(Action("consult", person.id, f"Consult {person.name} ({person.relation})",
                                  value - delay - their, value, {"delay": delay, "their_time": their}, eig))

    fa = cfg.false_alarm_cost * (1 - p_high)
    escalate = Action("escalate", "escalate", "Escalate: nurse to bedside now", l0 - fa, l0, {"false_alarm": fa})
    actions.append(escalate)
    if x.dialogue_open:
        actions.append(Action("send", "send", "Send message to nurse", 0.0, 0.0, {}))
    else:
        actions.append(Action("tap", "tap", "Continue: next tap", 0.0, 0.0, {}))

    actions.sort(key=lambda a: -a.score)

    p_safety = max(p_high, x.signal_p_high)
    if p_safety >= cfg.escalate_threshold:
        return Decision(escalate, actions,
                        f"Safety floor: P(high-risk need) = {p_safety:.0%} ≥ {cfg.escalate_threshold:.0%}. "
                        "Escalating without further questions.")

    best = actions[0]
    if not x.dialogue_open and best.kind in ("escalate",):
        # During the two-tap phase only the safety floor may escalate; the next tap is a better question.
        best = next(a for a in actions if a.kind in ("lookup", "tap"))
    if best.kind == "escalate":
        reason = (f"Remaining uncertainty is costly (expected loss {l0:.1f}) and no question resolves it "
                  f"cheaply enough; a bedside check beats more questions.")
    elif best.kind == "send":
        reason = "No action is worth its cost any more; sending the current belief to the nurse."
    elif best.kind == "tap":
        reason = "Waiting for the next tap."
    else:
        reason = (f"Best value for cost: expected loss falls by {best.value:.2f} "
                  f"(info gain {best.eig:.2f} bits) at cost {sum(best.costs.values()):.2f}.")
    return Decision(best, actions, reason)
