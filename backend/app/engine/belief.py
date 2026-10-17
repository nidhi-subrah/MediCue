"""Bayesian belief model over patient needs.

The belief is a plain list of probabilities indexed like `Catalog.need_ids`.
Every piece of evidence (tap, yes/no answer, chart lookup, consulted person's answer) is a likelihood
vector over needs, and the update is Bayes' rule: posterior ∝ prior x likelihood.
"""
import math
from dataclasses import dataclass, field

from ..catalog import Catalog


def normalize(v: list[float]) -> list[float]:
    s = sum(v)
    if s <= 0:
        return [1.0 / len(v)] * len(v)
    return [x / s for x in v]


def bayes_update(belief: list[float], likelihood: list[float]) -> list[float]:
    return normalize([b * l for b, l in zip(belief, likelihood)])


def entropy(belief: list[float]) -> float:
    return -sum(p * math.log2(p) for p in belief if p > 0)


def argmax(v: list[float]) -> int:
    return max(range(len(v)), key=v.__getitem__)


def p_high_risk(cat: Catalog, belief: list[float]) -> float:
    return sum(p for p, high in zip(belief, cat.high_risk) if high)


# ---- likelihoods ---------------------------------------------------------------------------------

def mix_reliability(p: list[float], reliability: float, floor: float) -> list[float]:
    """A signal from a source with reliability r is the true signal with prob r, noise otherwise."""
    return [reliability * x + (1 - reliability) * floor for x in p]


def tap_likelihood(cat: Catalog, kind: str, tap_id: str, reliability: float) -> list[float]:
    table = cat.area_lik if kind == "area" else cat.feeling_lik
    return mix_reliability(table[tap_id], reliability, 1.0 / len(table))


def yes_prob(p_yes: list[float], reliability: float) -> list[float]:
    return mix_reliability(p_yes, reliability, 0.5)


def answer_likelihood(p_yes: list[float], answer: str, reliability: float) -> list[float]:
    p = yes_prob(p_yes, reliability)
    if answer == "yes":
        return p
    if answer == "no":
        return [1 - x for x in p]
    return [1.0] * len(p)  # "unsure" carries no information


def consult_likelihood(cat: Catalog, options: list[str], answer: str | None, reliability: float) -> list[float]:
    """P(person picks `answer` | need). `answer=None` means they picked 'something else'."""
    k = len(options) + 1  # options + "something else"
    lik = []
    for nid in cat.need_ids:
        correct = nid if nid in options else None
        lik.append(reliability if answer == correct else (1 - reliability) / (k - 1))
    return lik


# ---- prior from context --------------------------------------------------------------------------

@dataclass
class PriorContext:
    hour: int
    days_since_surgery: int | None = None
    chart_flags: dict[str, bool] = field(default_factory=dict)
    history_counts: dict[str, int] = field(default_factory=dict)
    multipliers: dict[str, float] = field(default_factory=dict)   # from clinician-validated findings


def context_prior(cat: Catalog, ctx: PriorContext) -> tuple[list[float], list[str]]:
    """Base prior shaped by time of day, surgery recency, the patient's own history and validated findings.

    Returns the prior and a list of human-readable reasons (shown to nurses).
    """
    p = list(cat.base_prior)
    reasons = []

    def scale(need_ids, factor):
        for nid in need_ids:
            if nid in cat.index:
                p[cat.index[nid]] *= factor

    night = ctx.hour >= 22 or ctx.hour < 6
    if night:
        scale(["anxious", "too_cold", "urinate"], 1.4)
        scale(["hungry", "want_family"], 0.7)
        reasons.append("night time")
    if ctx.hour in (7, 8, 12, 13, 17, 18):
        scale(["hungry", "thirsty"], 1.3)
        reasons.append("around a meal time")
    if ctx.days_since_surgery is not None and ctx.days_since_surgery <= 3:
        scale(["pain_surgical"], 3.0)
        reasons.append(f"day {ctx.days_since_surgery} after surgery")

    total_hist = sum(ctx.history_counts.values())
    if total_hist:
        # Dirichlet-style blend: the patient's confirmed history, with the base prior as pseudo-counts.
        # The ratio is clamped so a long history shapes the prior without drowning out today's taps.
        pseudo = 30.0
        hist = [(pseudo * b + ctx.history_counts.get(nid, 0)) / (pseudo + total_hist)
                for nid, b in zip(cat.need_ids, cat.base_prior)]
        # Safety: a patient who has never had chest pain can still have it. History may raise a
        # high-risk need's prior but never lower it.
        ratio = [min(max(h / b, 0.5), 2.5) for h, b in zip(hist, cat.base_prior)]
        p = [a * (max(r, 1.0) if high else r) for a, r, high in zip(p, ratio, cat.high_risk)]
        reasons.append(f"{total_hist} confirmed past needs")

    for nid, m in ctx.multipliers.items():
        scale([nid], m)
    if ctx.multipliers:
        reasons.append("clinician-validated patterns")

    return normalize(p), reasons


def top_items(cat: Catalog, belief: list[float], k: int = 6) -> list[dict]:
    order = sorted(range(cat.n), key=lambda i: -belief[i])[:k]
    return [{"need": cat.need_ids[i], "label": cat.needs[i]["label"], "p": round(belief[i], 4),
             "risk": cat.risk[i], "group": cat.group[i]} for i in order]
