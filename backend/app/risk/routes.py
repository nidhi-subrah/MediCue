"""Risk and silence-detection API. Risk responses carry the synthetic-data and not-a-diagnosis notice."""
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..data.patients import PATIENT_BY_ID
from .config import DEFAULT, LEVELS, SIGNALS
from .silence_monitor import utcnow

router = APIRouter(prefix="/api/risk", tags=["risk"])

NOTICE = "Synthetic data. Risk flags are prompts for clinician review, not diagnoses."
RANK = {level: i for i, level in enumerate(LEVELS)}
SPARK_DAYS = 7
OUTCOME_WORDS = {"fall": "fall", "dehydration": "dehydration", "delirium_infection_concern": "delirium/infection"}


def _store(request: Request):
    store = request.app.state.risk
    if store is None:
        raise HTTPException(503, "risk module unavailable")
    return store


def public(row: dict) -> dict:
    """One risk at one time: score, level, top contributing signals and the reason."""
    return {
        "time": row["time"], "risk": row["risk"], "label": DEFAULT.models[row["risk"]].label,
        "score": row["score"], "level": row["level"], "raw_level": row["raw_level"], "flag": row["flag"],
        "enough_data": row["enough_data"], "reason": row["reason"],
        "top": [c for c in row["contributors"] if c["contribution"] >= 0.05][:3],
        "contributors": row["contributors"], "config_version": row["config_version"],
        "missing": [{"signal": k, "label": SIGNALS[k].label} for k in row["missing"]],
        "thresholds": {"watch": DEFAULT.models[row["risk"]].watch, "elevated": DEFAULT.models[row["risk"]].elevated},
    }


async def _people(store) -> dict[str, dict]:
    people = {pid: {"name": p["name"], "room": p["room"], "synthetic": False} for pid, p in PATIENT_BY_ID.items()}
    for p in await store.list_cohort():
        people[p["id"]] = {"name": p["name"], "room": p["room"], "synthetic": True}
    return people


@router.get("/patients")
async def patients(request: Request):
    """Latest score per patient and risk, most concerning patients first."""
    store = _store(request)
    people = await _people(store)
    by_patient: dict[str, dict] = {}
    for row in await store.latest_scores():
        pid = row["patient_id"]
        entry = by_patient.setdefault(pid, {"patient_id": pid, **people.get(pid, {"name": pid, "room": "",
                                                                                   "synthetic": True}),
                                            "risks": {}})
        entry["risks"][row["risk"]] = public(row)
    sparks: dict[tuple[str, str], list] = {}
    for t in await store.trend_all():
        sparks.setdefault((t["patient_id"], t["risk"]), []).append((t["bucket"], t["max_score"]))
    for pid, entry in by_patient.items():
        last = max(r["time"] for r in entry["risks"].values())
        for risk, r in entry["risks"].items():   # 6-hourly max score over the patient's last 7 days of data
            r["spark"] = [round(v, 3) for b, v in sparks.get((pid, risk), []) if b > last - timedelta(days=SPARK_DAYS)]
    items = sorted(by_patient.values(),
                   key=lambda p: (-max(RANK[r["level"]] for r in p["risks"].values()),
                                  -max(r["score"] for r in p["risks"].values()), p["room"]))
    return {"notice": NOTICE, "config_version": DEFAULT.version(), "patients": items}


@router.get("/patients/{pid}")
async def patient(pid: str, request: Request, hours: int = 72):
    """Latest per risk, hourly history for the last `hours` of data, 6-hourly trend and every fired flag."""
    store = _store(request)
    latest = await store.latest_scores(pid)
    if not latest:
        raise HTTPException(404, "no risk scores for this patient")
    people = await _people(store)
    last = max(r["time"] for r in latest)
    history = await store.score_history(pid, last - timedelta(hours=hours))
    return {
        "notice": NOTICE, "patient_id": pid, **people.get(pid, {"name": pid, "room": "", "synthetic": True}),
        "risks": {r["risk"]: public(r) for r in latest},
        "history": [{"time": r["time"], "risk": r["risk"], "score": r["score"], "level": r["level"]} for r in history],
        "trend": await store.trend(pid),
        "flags": [{"time": r["time"], "risk": r["risk"], "level": r["flag"], "reason": r["reason"]}
                  for r in await store.flags(pid)],
    }


# ---- silence detection ----------------------------------------------------------------------------

class AckBody(BaseModel):
    step: str                  # tablet | contact | nurse
    role: str                  # patient | contact | nurse
    actor: str                 # person id or nurse name
    outcome: str = "ok"        # ok | concern (concern: contact asks for the nurse now)
    note: str | None = None


def _silence(request: Request):
    monitor = request.app.state.silence
    if monitor is None:
        raise HTTPException(503, "silence monitor unavailable")
    return monitor


async def _ack(monitor, lid: str, *args):
    try:
        return await monitor.acknowledge(lid, *args)
    except KeyError as e:
        raise HTTPException(404, "unknown check") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e


@router.get("/silence/ladders")
async def silence_ladders(request: Request, patient_id: str | None = None, person_id: str | None = None,
                          active: bool | None = None):
    return _silence(request).ladders_view(patient_id, person_id, active)


class StartCheckBody(BaseModel):
    patient_id: str


@router.post("/silence/ladders")
async def silence_start(body: StartCheckBody, request: Request):
    """Start an inactivity check now, from the nurse station (also how the demo shows the ladder)."""
    monitor = _silence(request)
    if body.patient_id not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")
    if any(lad.active and lad.patient_id == body.patient_id for lad in monitor.ladders.values()):
        raise HTTPException(409, "a check is already running for this patient")
    lad = await monitor.start_ladder(body.patient_id, utcnow(), "Started manually from the nurse station.")
    return monitor.public(lad)


@router.post("/silence/ladders/{lid}/patient_ok")
async def silence_patient_ok(lid: str, request: Request):
    """The patient tapped "I'm okay" on the tablet check."""
    monitor = _silence(request)
    lad = monitor.ladders.get(lid)
    if not lad:
        raise HTTPException(404, "unknown check")
    return await _ack(monitor, lid, "tablet", "patient", lad.patient_id)


@router.post("/silence/ladders/{lid}/ack")
async def silence_ack(lid: str, body: AckBody, request: Request):
    return await _ack(_silence(request), lid, body.step, body.role, body.actor, body.outcome, body.note)


@router.get("/silence/audit")
async def silence_audit(request: Request, patient_id: str | None = None, ladder_id: str | None = None):
    monitor = _silence(request)
    try:
        return await monitor.store.silence_audit(patient_id, ladder_id)
    except Exception:
        return [r for r in monitor.audit if (patient_id is None or r["patient_id"] == patient_id)
                and (ladder_id is None or r["ladder_id"] == ladder_id)]


@router.get("/silence/status")
async def silence_status(request: Request):
    """Per live patient: time since last interaction, the limit for this time of day, and why."""
    return {"notice": "Detects missing interaction only; it cannot tell why.", "patients": _silence(request).status()}


# ---- lead-time timeline (demo) --------------------------------------------------------------------

def _first_flag(flags: list[dict], outcome: dict) -> dict | None:
    """The first flag on the patient's own risk after the storyline began: the early warning."""
    return next((f for f in flags if outcome["onset"] <= f["time"] < outcome["time"]), None)


def _headline(first: dict | None, outcome: dict) -> tuple[str, float | None]:
    word = OUTCOME_WORDS.get(outcome["outcome"], outcome["outcome"])
    if not first:
        return f"No flag fired before the synthetic {word} event", None
    days = (outcome["time"] - first["time"]).total_seconds() / 86400
    return f"Flag fired {days:.1f} days before the synthetic {word} event", round(days, 2)


async def _case(store, cohort: dict, outcome: dict) -> dict:
    p = cohort[outcome["patient_id"]]
    risk = p["storyline"]
    flags = [r for r in await store.flags(p["id"]) if r["risk"] == risk]
    first = _first_flag(flags, outcome)
    headline, lead = _headline(first, outcome)
    return {"patient_id": p["id"], "name": p["name"], "room": p["room"], "storyline": p["storyline"],
            "split": p["split"], "risk": risk, "label": DEFAULT.models[risk].label, "outcome": outcome,
            "headline": headline, "lead_days": lead, "first_flag": first, "flags": flags}


@router.get("/timeline")
async def timeline_cases(request: Request):
    """Every synthetic storyline with how early its own risk flag fired."""
    store = _store(request)
    cohort = {p["id"]: p for p in await store.list_cohort()}
    cases = [await _case(store, cohort, o) for o in await store.outcome_events() if o["patient_id"] in cohort]
    order = {"fall": 0, "dehydration": 1, "delirium": 2}
    cases.sort(key=lambda c: (order.get(c["risk"], 9), -(c["lead_days"] or -1)))
    return {"notice": NOTICE, "cases": [
        {k: c[k] for k in ("patient_id", "name", "room", "storyline", "split", "risk", "label", "headline",
                           "lead_days")} | {"flag_level": c["first_flag"]["flag"] if c["first_flag"] else None}
        for c in cases]}


@router.get("/timeline/{pid}")
async def timeline(pid: str, request: Request, days: int = 7):
    """Hourly score and signal drift (z in the risky direction) for the week before the outcome."""
    store = _store(request)
    cohort = {p["id"]: p for p in await store.list_cohort()}
    outcome = next((o for o in await store.outcome_events() if o["patient_id"] == pid), None)
    if pid not in cohort or not outcome:
        raise HTTPException(404, "no synthetic outcome for this patient")
    c = await _case(store, cohort, outcome)
    model = DEFAULT.models[c["risk"]]
    start = outcome["time"] - timedelta(days=days)
    rows = [r for r in await store.score_history(pid, start) if r["risk"] == c["risk"]]
    series = []
    for r in rows:
        z = {x["signal"]: round(SIGNALS[x["signal"]].direction * x["z"], 2) for x in r["contributors"]}
        series.append({"time": r["time"], "score": r["score"], "level": r["level"],
                       "z": {k: z.get(k) for k in model.weights}})
    first = c["first_flag"]
    return {
        "notice": NOTICE, **{k: c[k] for k in ("patient_id", "name", "room", "storyline", "split", "risk", "label",
                                               "headline", "lead_days")},
        "outcome": {k: outcome[k] for k in ("time", "onset", "outcome", "description")},
        "flag": {"time": first["time"], "level": first["flag"], "reason": first["reason"]} if first else None,
        "flags_before_onset": sum(f["time"] < outcome["onset"] for f in c["flags"]),
        "thresholds": {"watch": model.watch, "elevated": model.elevated},
        "signals": [{"key": k, "label": SIGNALS[k].label, "risky": "rise" if SIGNALS[k].direction > 0 else "fall"}
                    for k in model.weights],
        "series": series,
    }
