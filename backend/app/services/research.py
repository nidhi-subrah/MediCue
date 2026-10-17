"""Human-in-the-loop research loop (autoresearch).

1. Statistical detectors scan confirmed needs for recurring patterns.
2. Gemini words each candidate as a cautious, testable hypothesis.
3. A clinician marks it validated, rejected or needs-more-data; their note is kept.
4. Validated findings feed back into the belief engine as prior multipliers; rejected findings are
   never re-proposed. Each finding carries a stable id so re-running keeps the human feedback.
"""
import hashlib
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from ..catalog import Catalog
from ..config import settings
from .gemini import Gemini

EVENING = range(15, 23)


def _local_hour(t: datetime) -> int:
    return t.astimezone(settings.unit_tz).hour


def _fid(*parts: str) -> str:
    return "f-" + hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


def _evening_clusters(cat: Catalog, rows: list[dict], patients: dict) -> list[dict]:
    out = []
    by_patient = defaultdict(list)
    for r in rows:
        by_patient[r["patient_id"]].append(r)
    for pid, rs in by_patient.items():
        overall = sum(_local_hour(r["time"]) in EVENING for r in rs) / len(rs)
        for need, n in Counter(r["confirmed_need"] for r in rs).items():
            if n < 6:
                continue
            frac = sum(_local_hour(r["time"]) in EVENING for r in rs if r["confirmed_need"] == need) / n
            if frac >= 0.7 and frac >= 1.4 * overall:
                label = cat.by_id[need]["label"]
                name = patients[pid]["name"]
                out.append({
                    "id": _fid("evening", pid, need), "patient_id": pid, "kind": "time_of_day",
                    "title": f"{label} requests from {name} cluster between 15:00 and 23:00",
                    "evidence": f"{frac:.0%} of {n} confirmed '{label}' requests fell in 15:00–23:00, "
                                f"vs {overall:.0%} of all this patient's requests (last 14 days).",
                    "template_hypothesis": f"{name}'s '{label}' needs may follow a daily rhythm. "
                                           "Check whether evening routines or staffing changes coincide.",
                    "prior_effect": {"patient_id": pid, "need_ids": [need], "multiplier": 1.6,
                                     "hours": list(EVENING)},
                })
    return out


def _post_event_changes(cat: Catalog, rows: list[dict], patients: dict) -> list[dict]:
    out = []
    now = datetime.now(timezone.utc)
    for pid, p in patients.items():
        for ev in p.get("chart_events", []):
            t = datetime.fromisoformat(ev["time"])
            if now - t > timedelta(days=4):
                continue
            rs = [r for r in rows if r["patient_id"] == pid]
            before = [r for r in rs if t - timedelta(days=5) <= r["time"] < t]
            after = [r for r in rs if r["time"] >= t]
            days_after = max((now - t).total_seconds() / 86400, 0.5)
            for group in cat.groups:
                b = sum(r["confirmed_group"] == group for r in before) / 5
                a = sum(r["confirmed_group"] == group for r in after) / days_after
                if a >= 2 and a >= 2.5 * max(b, 0.3):
                    glabel = cat.groups[group]["label"].lower()
                    needs = [n for n in cat.need_ids if cat.by_id[n]["group"] == group]
                    out.append({
                        "id": _fid("post_event", pid, group, ev["label"]), "patient_id": pid,
                        "kind": "post_chart_event",
                        "title": f"{glabel.capitalize()} requests from {p['name']} rose after: {ev['label']}",
                        "evidence": f"{a:.1f}/day since the change vs {b:.1f}/day in the 5 days before "
                                    f"({len(after)} vs {len(before)} confirmed requests).",
                        "template_hypothesis": f"The change '{ev['label']}' may be linked to more {glabel} "
                                               "requests. Review with the prescriber; this is an association only.",
                        "prior_effect": {"patient_id": pid, "need_ids": needs, "multiplier": 1.5},
                    })
    return out


def _slowdowns(cat: Catalog, rows: list[dict], patients: dict) -> list[dict]:
    out = []
    now = datetime.now(timezone.utc)
    by_patient = defaultdict(list)
    for r in rows:
        by_patient[r["patient_id"]].append(r)
    for pid, rs in by_patient.items():
        if len(rs) < 12:
            continue
        xs = [(r["time"] - now).total_seconds() / 86400 for r in rs]
        ys = [r["mean_tap_interval"] for r in rs]
        slope = statistics.linear_regression(xs, ys).slope
        if slope >= 0.3:
            name = patients[pid]["name"]
            out.append({
                "id": _fid("slowdown", pid), "patient_id": pid, "kind": "communication_slowdown",
                "title": f"{name} is taking longer per tap each day",
                "evidence": f"Seconds per tap rising by {slope:.2f} s/day across {len(rs)} confirmed requests.",
                "template_hypothesis": f"{name}'s motor control or energy may be declining. Consider an access "
                                       "review (larger tiles or switch scanning) and fewer questions.",
                "prior_effect": None,
            })
    return out


DETECTORS = (_evening_clusters, _post_event_changes, _slowdowns)


async def run_research(cat: Catalog, store, gemini: Gemini, patients: dict) -> list[dict]:
    rows = await store.confirmations(datetime.now(timezone.utc) - timedelta(days=14))
    existing = {f["id"]: f for f in await store.list_findings()}
    new = []
    for detect in DETECTORS:
        for cand in detect(cat, rows, patients):
            prev = existing.get(cand["id"])
            if prev and prev["status"] in ("rejected", "validated"):
                continue  # keep the clinician's decision; never re-propose a rejected finding
            hypothesis, source = await gemini.hypothesis(cand)
            finding = {
                **{k: v for k, v in cand.items() if k != "template_hypothesis"},
                "created_at": (prev or {}).get("created_at") or datetime.now(timezone.utc).isoformat(),
                "hypothesis": hypothesis, "hypothesis_source": source,
                "status": (prev or {}).get("status", "proposed"),
                "reviewer": (prev or {}).get("reviewer"), "note": (prev or {}).get("note"),
            }
            await store.upsert_finding(finding)
            new.append(finding)
    return new


async def prior_multipliers(store, patient_id: str, hour: int) -> dict[str, float]:
    """Validated findings for this patient, active at this hour, as need → prior multiplier."""
    mult: dict[str, float] = {}
    for f in await store.list_findings():
        eff = f.get("prior_effect")
        if f["status"] != "validated" or not eff or eff["patient_id"] != patient_id:
            continue
        if eff.get("hours") and hour not in eff["hours"]:
            continue
        for nid in eff["need_ids"]:
            mult[nid] = mult.get(nid, 1.0) * eff["multiplier"]
    return mult
