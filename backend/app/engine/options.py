"""Tailored second-step options: after "Where is it?", show choices that make sense for that body area.

Overview
========
Each area in ``shared/catalog.json → area_options`` has its own prompt ("What's wrong with your head?")
and a short list of options. Every option sends one of the engine's existing feeling taps, so the belief
engine, the safety floor and learned gestures (engine/personal.py) are unchanged.

What the patient sees
---------------------
* ``predicted``: the most likely 3 options (4 when the area has more than 4), most likely first.
* every ``high_risk`` option for the area, even if it didn't rank (chest "Hard to breathe", mouth
  "Choking"): a prediction can reorder what's shown but can never hide a high-risk choice.
* ``more``: "Something else" opens the area's remaining options plus "None of these" (the not-sure tap).

Who ranks them
--------------
1. **Gemini** (services/predictions.py), once per patient per session start, for every area in one
   request. It reads the chart, notes, profile, recent confirmed needs, learned gestures and time of day,
   and returns each area's options in order with a short reason. The result is cached per patient.
2. **The belief engine**, whenever Gemini's ranking isn't ready or available: each option scores the
   probability of its feeling tap under the current belief, P(tap) = Σₙ b(n)·P(tap | n), using the
   patient's learned tap meanings when they have any. That belief already includes the area tap, the
   time-of-day / history / profile prior and validated research findings.

Gemini can only reorder the area's own options: unknown ids are dropped, missing ones are appended in
the engine's order, and the high-risk pin above is applied afterwards.

Options are chosen once, when the patient reaches the second step, and kept for that step, so a ranking
that arrives a moment later never reshuffles buttons under the patient's finger.

Sending straight away
---------------------
``send_now`` (the Washroom area, and each "Need pain medicine" / belly "Need the washroom" option) sends
the request to the nurse at once with no follow-up question, unless the safety floor escalates it.
"""
from collections.abc import Callable

from ..catalog import Catalog

NONE_OF_THESE = "not_sure"


def area_spec(cat: Catalog, area: str) -> dict | None:
    return cat.raw.get("area_options", {}).get(area)


def area_sends_now(cat: Catalog, area: str) -> bool:
    return any(a["id"] == area and a.get("send_now") for a in cat.raw["areas"])


def option_by_id(cat: Catalog, area: str, option_id: str) -> dict | None:
    spec = area_spec(cat, area)
    return next((o for o in spec["options"] if o["id"] == option_id), None) if spec else None


def predicted_count(n_options: int) -> int:
    return 3 if n_options <= 4 else 4


def engine_order(options: list[dict], belief: list[float], feeling_likelihood: Callable[[str], list[float]]) -> list[str]:
    """Options ordered by the predictive probability of their feeling tap under the current belief."""
    def score(o: dict) -> float:
        return sum(b * l for b, l in zip(belief, feeling_likelihood(o["feeling"])))
    return [o["id"] for o in sorted(options, key=score, reverse=True)]


def merge_order(options: list[dict], ranked: list[str], fallback: list[str]) -> list[str]:
    """A model's ranking restricted to this area's options, with anything it missed in fallback order."""
    known = {o["id"] for o in options}
    out = list(dict.fromkeys(i for i in ranked if i in known))
    return out + [i for i in fallback if i not in out]


def choose(cat: Catalog, area: str, order: list[str], source: str, reasons: dict[str, str] | None = None) -> dict:
    """Split the ordered options into what's shown first and what's behind "Something else"."""
    spec = area_spec(cat, area)
    by_id = {o["id"]: o for o in spec["options"]}
    k = predicted_count(len(order))
    shown = order[:k] + [i for i in order[k:] if by_id[i].get("high_risk")]

    def public(i: str) -> dict:
        o = by_id[i]
        return {"id": i, "label": o["label"], "feeling": o["feeling"], "high_risk": bool(o.get("high_risk")),
                "send_now": bool(o.get("send_now")), "reason": (reasons or {}).get(i)}

    more = [public(i) for i in order if i not in shown]
    more.append({"id": f"{area}.none", "label": "None of these", "feeling": NONE_OF_THESE, "high_risk": False,
                 "send_now": False, "reason": None})
    return {"area": area, "area_label": cat.area_labels[area], "prompt": spec["prompt"],
            "predicted": [public(i) for i in shown], "more": more, "source": source}


def likely_taps(lik: dict[str, list[float]], belief: list[float], high_risk: list[bool], k: int = 4) -> list[str]:
    """The k taps the patient most likely means next, P(tap) = Σ_n b(n)·P(tap | n), plus, always, the tap
    that best signals each high-risk need, so simplifying can never hide a way to report an emergency."""
    score = {t: sum(b * l for b, l in zip(belief, row)) for t, row in lik.items()}
    keep = sorted(score, key=lambda t: -score[t])[:k]
    for n, high in enumerate(high_risk):
        if high:
            best = max(lik, key=lambda t: lik[t][n])
            if best not in keep:
                keep.append(best)
    order = list(lik)
    return sorted(keep, key=order.index)   # catalog order, so options don't jump around between steps
