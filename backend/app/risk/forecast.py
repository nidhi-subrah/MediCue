"""Early-warning forecast: the risk engine's scores turned into what a nurse needs to know.

For each patient and risk this answers, in plain words:

* **Where is it now?** The engine's level (Low / Watch / High) and score, unchanged.
* **Where is it heading?** A least-squares line through the last 48 h of the 6-hourly mean score
  (the ``risk_scores_6h`` continuous aggregate in Tiger Data). "Rising" / "steady" / "easing", and,
  when rising, roughly how many hours until the next level if the trend continues (shown only up to
  72 h). This is a projection of the engine's own score, not a new model: it never changes the level.
* **What changed?** The signals pushing the score up, as "Bathroom trips at night: 4 in the last day,
  usually about 1".
* **What could I check?** Fixed, non-clinical prompts per signal (offer drinks, check the call bell
  is in reach). Never a diagnosis or a medicine change.

Gemini (``services/gemini.py``) may reword the summary sentence from these facts only; the numbers,
level and timing always come from here. Pure: no I/O.
"""
from __future__ import annotations

from datetime import datetime

from .config import SIGNALS, RiskModel

LEVEL_WORD = {"low": "Low", "watch": "Watch", "elevated": "High"}
RISK_WORD = {"fall": "Fall", "dehydration": "Dehydration", "delirium": "Confusion (delirium/infection)"}
NEXT = {"low": "watch", "watch": "elevated"}

TREND_HOURS = 48          # fit the line through this much recent history
MIN_POINTS = 3
SLOPE_PER_DAY = 0.05      # a change smaller than 5 points a day is "steady"
MAX_ETA_H = 72            # don't project further than three days
CONTRIBUTION_MIN = 0.05   # same cut as the engine's "top" contributors

# What each signal means to a nurse: (what changed, what you could check).
PLAIN: dict[str, tuple[str, dict[str, str]]] = {
    "night_toilet": ("Bathroom trips at night", {
        "fall": "Offer a bathroom trip before sleep; keep the call bell and walking aid in reach.",
        "dehydration": "Note night-time urine; check fluid balance."}),
    "night_requests": ("Calls for help at night", {
        "delirium": "Check orientation (name, place, time) this shift and compare with family's view.",
        "fall": "Check bed height, lighting and the bed alarm overnight."}),
    "tap_latency": ("Slower to answer on the tablet", {
        "fall": "Watch how steady they are when getting up; assist with transfers.",
        "delirium": "Check alertness and attention compared with yesterday."}),
    "tap_variability": ("Less steady, more uneven tapping", {
        "fall": "Watch how steady they are when getting up; assist with transfers.",
        "delirium": "Check attention: can they follow a short instruction?"}),
    "tap_inconsistency": ("More mis-taps and corrections", {
        "delirium": "Check whether they seem more confused than usual; ask family if this is new."}),
    "fatigue": ("More tired than usual", {
        "fall": "Assist with getting up while they're tired.",
        "dehydration": "Look for dry mouth and less urine; offer drinks.",
        "delirium": "Note drowsiness and when it started."}),
    "fluid_intake": ("Drinking less", {
        "dehydration": "Offer drinks regularly, keep water in reach and record intake."}),
    "missed_meals": ("Missing meals", {
        "dehydration": "Ask about appetite; offer help or snacks at meal times."}),
    "discomfort": ("More pain or discomfort", {
        "dehydration": "Ask about the discomfort; assess pain this shift."}),
    "new_discomfort": ("New kinds of discomfort", {
        "delirium": "Ask about and assess the new discomfort this shift."}),
}


RATIO_ONLY = {"fatigue", "tap_variability"}   # scores with no everyday unit: say "1.5× usual" instead


def _fmt(key: str, v: float | None) -> str:
    return "–" if v is None else SIGNALS[key].fmt.format(v)


def _detail(key: str, value: float | None, baseline: float | None) -> str:
    if key in RATIO_ONLY:
        if value is None or not baseline:
            return "higher than usual"
        return f"about {value / baseline:.1f}× their usual over the last day"
    return f"{_fmt(key, value)} in the last day, usually about {_fmt(key, baseline)}"


def short_name(name: str) -> str:
    """First name for real patients; the whole label for synthetic ones ("Synthetic resident 02")."""
    return name if name.lower().startswith("synthetic") else name.split()[0]


def changes(risk: str, contributors: list[dict]) -> list[dict]:
    """The signals pushing this risk up, worded for a nurse, biggest first."""
    out = []
    for c in contributors:
        if c["contribution"] < CONTRIBUTION_MIN or c["signal"] not in PLAIN:
            continue
        what, checks = PLAIN[c["signal"]]
        out.append({"signal": c["signal"], "what": what,
                    "detail": _detail(c["signal"], c["value"], c["baseline"]),
                    "check": checks.get(risk)})
    return out[:3]


def trend(points: list[tuple[datetime, float]], now: datetime) -> dict:
    """Least-squares slope (score per hour) through the last TREND_HOURS of (time, score) points."""
    recent = [(t, s) for t, s in points if (now - t).total_seconds() <= TREND_HOURS * 3600]
    if len(recent) < MIN_POINTS:
        return {"direction": "unknown", "per_day": None}
    xs = [(t - now).total_seconds() / 3600 for t, _ in recent]
    ys = [s for _, s in recent]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    var = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var if var else 0.0
    per_day = slope * 24
    direction = "rising" if per_day > SLOPE_PER_DAY else "easing" if per_day < -SLOPE_PER_DAY else "steady"
    return {"direction": direction, "per_day": round(per_day, 3), "slope_h": slope}


def outlook(level: str, score: float, model: RiskModel, tr: dict) -> dict:
    """Next level and roughly when, if the trend continues; projected score 24 h out."""
    nxt = NEXT.get(level)
    slope = tr.get("slope_h") or 0.0
    eta = None
    if nxt and tr["direction"] == "rising" and slope > 0:
        target = model.watch if nxt == "watch" else model.elevated
        hours = (target - score) / slope
        if 0 < hours <= MAX_ETA_H:
            eta = round(hours)
    projected = min(max(score + slope * 24, 0.0), 1.0) if tr["direction"] != "unknown" else None
    return {"next_level": nxt, "next_word": LEVEL_WORD.get(nxt or "", None), "eta_hours": eta,
            "projected_24h": round(projected, 3) if projected is not None else None}


def when(hours: int) -> str:
    if hours < 12:
        return "in the next few hours"
    if hours < 30:
        return "within about a day"
    return f"within about {round(hours / 24)} days"


def summary(name: str, risk: str, level: str, tr: dict, out: dict, ch: list[dict]) -> str:
    """Template sentence; Gemini may reword it from the same facts."""
    head = f"{short_name(name)}: {RISK_WORD[risk].lower()} risk is {LEVEL_WORD[level]}"
    if out["eta_hours"] is not None:
        head += f" and rising; likely {out['next_word']} {when(out['eta_hours'])} if this continues"
    elif tr["direction"] == "rising":
        head += " and rising"
    elif tr["direction"] == "easing":
        head += " but easing"
    if ch:
        head += ". " + "; ".join(c["what"].lower() for c in ch).capitalize()
    return head + "."


def needs_check(level: str, tr: dict, out: dict) -> bool:
    """Shown under "Needs a check": on Watch or High, or heading to the next level within a day."""
    return level != "low" or (out["eta_hours"] is not None and out["eta_hours"] <= 24)


def priority(level: str, out: dict) -> tuple:
    rank = {"elevated": 2, "watch": 1, "low": 0}[level]
    return (-rank, out["eta_hours"] if out["eta_hours"] is not None else 999)
