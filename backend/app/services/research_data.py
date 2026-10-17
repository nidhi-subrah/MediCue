"""How research hypotheses meet the data.

* A hypothesis carries a `test` spec. `evaluate` turns new confirmed-need episodes into supporting /
  contradicting counts plus the two probabilities the decision engine needs:
  p0 = P(episode looks supporting | H false, i.e. chance), p1 = P(... | H true).
* The fixed-rule detectors from the first version now only *propose* hypotheses. They look at the
  "discover" half of episodes; the agent tests system hypotheses on the held-out "confirm" half, so a
  pattern is never confirmed with the same data that suggested it. Clinician observations come from
  outside the data and are tested on all of it.
* `parse_observation` turns a clinician's free text into a test spec with keyword rules
  (Gemini may do this first; its output is validated against the same vocabulary).
"""
import hashlib
import re
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..catalog import Catalog
from ..config import settings
from ..engine.research_decision import p1_from_ratio

WAKING_HOURS_PER_DAY = 16
TEST_TYPES = ("after_event", "time_window", "rate_change", "trend")
# Effect size each test type claims (rate in the window vs baseline) and how much one unit of data counts.
# Individual episodes from one patient are correlated, so they count for less than daily aggregates.
DEFAULT_RATIO = {"after_event": 8.0, "time_window": 2.5, "rate_change": 2.5}
EVIDENCE_WEIGHT = {"after_event": 0.25, "time_window": 0.25, "rate_change": 0.25, "trend": 0.6}


def evidence_weight(test: dict) -> float:
    return EVIDENCE_WEIGHT.get(test["type"], 0.25)


def local_hour(t: datetime) -> int:
    return t.astimezone(settings.unit_tz).hour


def split_of(row: dict) -> str:
    return "discover" if int(hashlib.sha1(row["session_id"].encode()).hexdigest()[:8], 16) % 2 == 0 else "confirm"


def in_split(row: dict, split: str) -> bool:
    return split == "all" or split_of(row) == split


def _clamp(p: float) -> float:
    return min(max(p, 0.03), 0.9)


def _fid(*parts: str) -> str:
    return "h-" + hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


@dataclass
class TestResult:
    n: int
    k: int
    p0: float
    p1: float
    summary: str
    episodes: list[dict] = field(default_factory=list)


def _visits(events: list[dict], pid: str) -> list[tuple[datetime, datetime]]:
    return [(e["time"], datetime.fromisoformat(e["payload"]["end"]))
            for e in events if e["event_type"] == "family_visit" and e["patient_id"] == pid]


def _need_phrase(cat: Catalog, need_ids: list[str]) -> str:
    labels = [cat.by_id[n]["label"] for n in need_ids]
    return f"'{labels[0]}'" if len(labels) == 1 else f"{cat.by_id[need_ids[0]]['group']}"


def evaluate(cat: Catalog, test: dict, rows: list[dict], events: list[dict], since: datetime, until: datetime,
             split: str) -> TestResult | None:
    pid, kind = test["patient_id"], test["type"]
    mine = [r for r in rows if r["patient_id"] == pid]
    if not mine:
        return None
    needs = set(test.get("need_ids", []))
    new = [r for r in mine if since < r["time"] <= until and in_split(r, split)]
    others = [r for r in mine if r["confirmed_need"] not in needs]
    what = _need_phrase(cat, test.get("need_ids", [])) if needs else ""

    if kind == "after_event":
        visits = _visits(events, pid)
        window = timedelta(hours=test.get("window_h", 2.0))
        if not visits:
            return None
        span_days = max((max(r["time"] for r in mine) - min(r["time"] for r in mine)).total_seconds() / 86400, 1)
        p0 = _clamp(len(visits) * window.total_seconds() / 3600 / (span_days * WAKING_HOURS_PER_DAY))
        eps = [r for r in new if r["confirmed_need"] in needs]
        support = [any(end <= r["time"] <= end + window for _, end in visits) for r in eps]
        where = f"within {window.total_seconds() / 3600:g} h after a family visit ended"
    elif kind == "time_window":
        hours = set(test["hours"])
        p0 = _clamp(sum(local_hour(r["time"]) in hours for r in others) / max(len(others), 1))
        eps = [r for r in new if r["confirmed_need"] in needs]
        support = [local_hour(r["time"]) in hours for r in eps]
        where = f"between {min(hours):02d}:00 and {max(hours) + 1:02d}:00"
    elif kind == "rate_change":
        t0 = datetime.fromisoformat(test["event_time"])
        start = t0 - timedelta(days=5)
        span = [r for r in others if start <= r["time"] <= until]
        p0 = _clamp(sum(r["time"] >= t0 for r in span) / max(len(span), 1))
        eps = [r for r in new if r["confirmed_need"] in needs and r["time"] >= start]
        support = [r["time"] >= t0 for r in eps]
        where = f"after: {test.get('event_label', 'the event')}"
    elif kind == "trend":
        by_day: dict = {}
        for r in new:
            by_day.setdefault(r["time"].astimezone(settings.unit_tz).date(), []).append(r)
        eps, support = [], []
        for day, rs in sorted(by_day.items()):
            prior = [r["mean_tap_interval"] for r in mine if r["time"].astimezone(settings.unit_tz).date() < day]
            if len(prior) < 3:
                continue
            eps.append(rs[0])
            support.append(statistics.mean(r["mean_tap_interval"] for r in rs) > statistics.mean(prior))
        n, k = len(eps), sum(support)
        return TestResult(n, k, 0.5, 0.75, f"{k}/{n} day(s) were slower per tap than all earlier days",
                          [{"time": e["time"].isoformat(), "supports": s, "label": "daily seconds per tap"}
                           for e, s in zip(eps, support)])
    else:
        return None

    n, k = len(eps), sum(support)
    p1 = p1_from_ratio(p0, test.get("ratio", DEFAULT_RATIO[kind]))
    summary = (f"{k}/{n} {what} requests fell {where} "
               f"(expected {p0:.0%} by chance, {p1:.0%} if the hypothesis holds)")
    episodes = [{"time": r["time"].isoformat(), "supports": s, "label": cat.by_id[r["confirmed_need"]]["label"]}
                for r, s in zip(eps, support)]
    return TestResult(n, k, p0, p1, summary, episodes[-20:])


def expected_per_day(test: dict, rows: list[dict], split: str, now: datetime) -> float:
    if test["type"] == "trend":
        return 1.0
    needs = set(test.get("need_ids", []))
    week = [r for r in rows if r["patient_id"] == test["patient_id"] and r["confirmed_need"] in needs
            and now - timedelta(days=7) <= r["time"] <= now and in_split(r, split)]
    return len(week) / 7


# ---- claims (human-readable hypothesis statements) ------------------------------------------------

def build_claim(cat: Catalog, patient: dict | None, need_ids: list[str], test: dict | None) -> str:
    who = patient["name"] if patient else "Patients on the unit"
    if test and test["type"] == "trend":
        return f"{who} is taking longer per tap each day"
    groups = {cat.by_id[n]["group"] for n in need_ids}
    if need_ids == ["anxious"]:
        what = "becomes more anxious"
    elif len(need_ids) == 1:
        what = f"makes more '{cat.by_id[need_ids[0]]['label']}' requests"
    elif groups == {"pain"}:
        what = "reports more pain"
    elif groups == {"toileting"}:
        what = "asks for the washroom more"
    elif len(groups) == 1:
        what = f"makes more {cat.groups[next(iter(groups))]['label'].lower()} requests"
    elif need_ids:
        what = "makes more " + " / ".join(cat.by_id[n]["label"].lower() for n in need_ids[:3]) + " requests"
    else:
        what = "has a changing pattern of needs"
    if not test:
        return f"{who} {what}"
    when = {
        "after_event": "after family visits end",
        "time_window": f"between {min(test.get('hours', [0])):02d}:00 and {max(test.get('hours', [0])) + 1:02d}:00",
        "rate_change": f"since {test.get('event_label', 'a recent change')}",
    }.get(test["type"], "")
    return f"{who} {what} {when}".strip()


# ---- detectors: propose system hypotheses from the discovery half ---------------------------------

EVENING = list(range(15, 23))


def detect(cat: Catalog, rows: list[dict], patients: dict, now: datetime) -> list[dict]:
    disc = [r for r in rows if in_split(r, "discover")]
    by_patient: dict[str, list[dict]] = {}
    for r in disc:
        by_patient.setdefault(r["patient_id"], []).append(r)
    out = []

    for pid, rs in by_patient.items():
        p = patients[pid]
        overall = sum(local_hour(r["time"]) in EVENING for r in rs) / len(rs)
        counts: dict[str, int] = {}
        for r in rs:
            counts[r["confirmed_need"]] = counts.get(r["confirmed_need"], 0) + 1
        for need, n in counts.items():
            if n < 5:
                continue
            frac = sum(local_hour(r["time"]) in EVENING for r in rs if r["confirmed_need"] == need) / n
            if frac >= 0.7 and frac >= 1.4 * overall:
                test = {"type": "time_window", "patient_id": pid, "need_ids": [need], "hours": EVENING}
                out.append({
                    "id": _fid("evening", pid, need), "patient_id": pid, "origin_detail": "time-of-day detector",
                    "claim": build_claim(cat, p, [need], test), "test": test,
                    "discovery": f"Discovery half: {frac:.0%} of {n} '{cat.by_id[need]['label']}' requests fell in "
                                 f"15:00–23:00 vs {overall:.0%} of all this patient's requests.",
                    "prior_effect": {"patient_id": pid, "need_ids": [need], "multiplier": 1.6, "hours": EVENING},
                })

        first_seen = min(r["time"] for r in rows if r["patient_id"] == pid)
        for ev in p.get("chart_events", []):
            t0 = datetime.fromisoformat(ev["time"])
            if now - t0 > timedelta(days=4) or t0 - first_seen < timedelta(days=3):
                continue  # too old, or no baseline before it (e.g. the admission surgery itself)
            before = [r for r in rs if t0 - timedelta(days=5) <= r["time"] < t0]
            after = [r for r in rs if r["time"] >= t0]
            days_after = max((now - t0).total_seconds() / 86400, 0.5)
            for group in cat.groups:
                b = sum(r["confirmed_group"] == group for r in before) / 5
                a = sum(r["confirmed_group"] == group for r in after) / days_after
                if a >= 1.5 and a >= 2.5 * max(b, 0.3):
                    needs = [n for n in cat.need_ids if cat.by_id[n]["group"] == group]
                    test = {"type": "rate_change", "patient_id": pid, "need_ids": needs, "event_time": ev["time"],
                            "event_label": ev["label"]}
                    out.append({
                        "id": _fid("post_event", pid, group, ev["label"]), "patient_id": pid,
                        "origin_detail": "chart-event detector", "claim": build_claim(cat, p, needs, test), "test": test,
                        "discovery": f"Discovery half: {a:.1f}/day {group} requests since the change vs {b:.1f}/day "
                                     "in the 5 days before.",
                        "prior_effect": {"patient_id": pid, "need_ids": needs, "multiplier": 1.5},
                    })

        if len(rs) >= 10:
            xs = [(r["time"] - now).total_seconds() / 86400 for r in rs]
            slope = statistics.linear_regression(xs, [r["mean_tap_interval"] for r in rs]).slope
            if slope >= 0.3:
                test = {"type": "trend", "patient_id": pid, "metric": "mean_tap_interval"}
                out.append({
                    "id": _fid("slowdown", pid), "patient_id": pid, "origin_detail": "communication-slowdown detector",
                    "claim": build_claim(cat, p, [], test), "test": test,
                    "discovery": f"Discovery half: seconds per tap rising {slope:.2f} s/day across {len(rs)} requests.",
                    "prior_effect": None,
                })
    return out


# ---- clinician observations → test spec ---------------------------------------------------------

NEED_KEYWORDS = [
    (r"anxi|scared|worried|agitat|upset|distress|restless|fearful", ["anxious"]),
    (r"pain|hurt|sore|grimac|ache", "group:pain"),
    (r"breath|short of air|wheez|choking|secretion", "group:breathing"),
    (r"toilet|washroom|bathroom|pee|urinat|void|bowel|commode|incontin", "group:toileting"),
    (r"thirst|drink|water", ["thirsty"]),
    (r"hungry|eat|food|meal", ["hungry"]),
    (r"nause|vomit|sick to", ["nausea"]),
    (r"lonely|asks for (his|her|their) family|wants (his|her|their) family", ["want_family"]),
]
WINDOWS = [
    (r"evening|sundown", list(range(17, 23))),
    (r"afternoon", list(range(12, 17))),
    (r"\bnight|overnight", [22, 23, 0, 1, 2, 3, 4, 5]),
    (r"morning", list(range(6, 12))),
]


def parse_observation(cat: Catalog, text: str, patients: dict, patient_id: str | None) -> dict:
    t = text.lower()
    if not patient_id:
        for pid, p in patients.items():
            if any(part.lower() in t for part in p["name"].split() if len(part) > 2):
                patient_id = pid
                break
    patient = patients.get(patient_id) if patient_id else None

    need_ids: list[str] = []
    for pattern, needs in NEED_KEYWORDS:
        if re.search(pattern, t):
            need_ids += ([n for n in cat.need_ids if cat.by_id[n]["group"] == needs[6:]]
                         if isinstance(needs, str) else needs)
    need_ids = list(dict.fromkeys(need_ids))

    test = None
    if patient_id:
        if re.search(r"slower|taking longer|tires? (more|quickly)|harder to (tap|communicate)", t):
            test = {"type": "trend", "patient_id": patient_id, "metric": "mean_tap_interval"}
        elif need_ids and re.search(r"(leaves|left|goes home|go home|visit(s|ors)? (end|leave)|after .*visit)", t):
            test = {"type": "after_event", "patient_id": patient_id, "need_ids": need_ids, "event": "family_visit",
                    "window_h": 2.0}
        elif need_ids and re.search(r"(medication|med |dose|since .*(change|reduc|start|stop))", t) and patient["chart_events"]:
            ev = patient["chart_events"][-1]
            test = {"type": "rate_change", "patient_id": patient_id, "need_ids": need_ids,
                    "event_time": ev["time"], "event_label": ev["label"]}
        elif need_ids:
            for pattern, hours in WINDOWS:
                if re.search(pattern, t):
                    test = {"type": "time_window", "patient_id": patient_id, "need_ids": need_ids, "hours": hours}
                    break
    return {"patient_id": patient_id, "need_ids": need_ids, "test": test,
            "claim": build_claim(cat, patient, need_ids, test)}


def validate_test(cat: Catalog, test: dict | None, patients: dict) -> dict | None:
    """Accept a (possibly Gemini-produced) spec only if every field is in our vocabulary."""
    if not test or test.get("type") not in TEST_TYPES or test.get("patient_id") not in patients:
        return None
    if test["type"] != "trend" and (not test.get("need_ids") or any(n not in cat.index for n in test["need_ids"])):
        return None
    if test["type"] == "time_window" and not all(isinstance(h, int) and 0 <= h <= 23 for h in test.get("hours", [None])):
        return None
    if test["type"] == "rate_change":
        try:
            datetime.fromisoformat(test["event_time"])
        except (KeyError, ValueError):
            return None
    return test
