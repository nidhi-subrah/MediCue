"""14 days of interaction and chart history for the 6 unit patients, so every nurse view reads one population.

Why this exists
---------------
The demo patients (p-chen, p-alvarez, ...) were seeded with confirmed requests only (`data/seed.py`), while
the early-warning cohort (`syn-*`, `risk/synthetic.py`) has taps, fatigue, chart events and risk scores.
Unit insights and Care forecast show the 6 unit patients, so this module fills in what they were missing,
in Tiger Data (or the in-memory store), without touching either existing generator's output:

  events        session_started, tap (latency_ms, mistap), fatigue, notified / escalated, nurse_confirmed,
                one session per existing `confirmations` row: same time, same need, same seconds per tap;
                communication_mode_changed wherever the real adaptive-communication policy
                (engine/communication) would have simplified that session's screen, judged against the
                patient's own earlier sessions, so the "simpler screens" trend is computed, not placed
  chart_events  meals, fluids, medication rounds, vitals (Mai's chart model), plus each patient's own chart
                events from `data/patients.py` (e.g. "Gabapentin reduced 300 → 100 mg")
  risk_scores   the 6 patients scored hour by hour by the unchanged risk engine (`risk/engine.py`)

Every generated row carries ``payload.source = "unit_history"``. Regenerating deletes only those rows, never
live events, the synthetic cohort or the seeded confirmations. The patients are not added to `risk_cohort`:
the early-warning page and its backtest keep exactly their 22 synthetic residents.

Storylines (`risk/synthetic.py` effects) are under way *now* with their outcome still ahead, so recent days
drift and the forecast has something to project; unlike the cohort, no outcome is ever written:
  p-chen      fall drift, from his gabapentin reduction    p-alvarez   dehydration drift
  p-kowalski  delirium/infection drift                      p-haddad    stable, one bad night
  p-okoye     stable, 2 days since admission (post-op)      p-patel     stable, 4 days since admission

The history ends at the moment it's generated, so it's regenerated when it's more than STALE old.
All data is synthetic.
"""
import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from ..catalog import Catalog
from ..config import settings
from ..risk.signals import NIGHT_HOURS
from ..engine.communication import policy as cp
from ..engine.communication.signals import CORRECTION, RESPONSE, Interaction, PersonalBaseline, detect
from ..risk.synthetic import DAYS, Spec, _clip, _pick, _Sim
from .patients import PATIENT_BY_ID

log = logging.getLogger(__name__)

SOURCE = "unit_history"
NURSE = "rn-unit"
SEED = 20261017
STALE = timedelta(hours=6)
MED_WORDS = ("mg", "started", "reduced", "stopped", "dose", "increased")


@dataclass(frozen=True)
class Story:
    storyline: str = "control"           # control | fall | dehydration | delirium
    confounder: str | None = None
    onset_days_ago: float = 3.0
    outcome_days_ahead: float = 2.0
    history_days: int = DAYS             # shorter for recent admissions


STORIES = {
    "p-chen": Story("fall", outcome_days_ahead=1.0),   # onset: his gabapentin reduction (data/patients.py)
    "p-alvarez": Story("dehydration", onset_days_ago=3.5),
    "p-kowalski": Story("delirium", onset_days_ago=4.0, outcome_days_ahead=1.5),
    "p-haddad": Story("control", "bad_night"),
    "p-okoye": Story(history_days=2),
    "p-patel": Story(history_days=4),
}


def _chart_kind(label: str) -> str:
    return "med_change" if any(w in label.lower() for w in MED_WORDS) else "care_event"


class _UnitSim(_Sim):
    """Mai's per-patient simulator, with three differences: the storyline is still unfolding at `now`
    (onset in the past, outcome ahead, nothing after now), sessions come from the patient's real seeded
    requests instead of being drawn at random, and rows start at the patient's admission."""

    def __init__(self, cat: Catalog, pid: str, story: Story, requests: list[dict], now: datetime):
        first_day = now.astimezone(settings.unit_tz).date() - timedelta(days=DAYS - 1)
        super().__init__(cat, Spec(pid, story.storyline, "unit", story.confounder), SEED, first_day, now)
        self.patient_row = PATIENT_BY_ID[pid]
        self.profile["age"] = self.patient_row["age"]
        self.requests = requests
        self.start = now - timedelta(days=story.history_days)
        self.cutoff = now
        self.past_s: list[float] = []   # seconds per tap in earlier sessions: the personal baseline
        if story.storyline != "control":
            onset = now - timedelta(days=story.onset_days_ago)
            if pid == "p-chen":   # his drift starts at the medication change on his chart
                onset = min((datetime.fromisoformat(e["time"]) for e in self.patient_row["chart_events"]),
                            default=onset)
            self.onset, self.outcome_time = onset, now + timedelta(days=story.outcome_days_ahead)

    def _event(self, t, session_id, event_type, payload):
        if self.start <= t < self.cutoff:
            self.events.append({"time": t, "patient_id": self.spec.id, "session_id": session_id,
                                "event_type": event_type, "payload": payload | {"source": SOURCE}})

    def _chart(self, t, kind, value, payload):
        if self.start <= t < self.cutoff:
            self.chart.append({"time": t, "patient_id": self.spec.id, "kind": kind, "value": value,
                               "payload": payload | {"source": SOURCE}})

    def request(self, row: dict):
        """One seeded request as the session that produced it: taps at its own seconds per tap, then the alert
        and the nurse's confirmation at the row's time."""
        rng, p = self.rng, self.profile
        confirmed_at, need = row["time"], row["confirmed_need"]
        e = self.effects(confirmed_at)
        night = confirmed_at.astimezone(settings.unit_tz).hour in NIGHT_HOURS
        self.sessions += 1
        sid = f"{self.spec.id}-h{self.sessions:04d}"
        start = confirmed_at - timedelta(seconds=row["resolve_seconds"] + rng.uniform(60, 420))
        self._event(start, sid, "session_started", {"mode": row["mode"], "language": "en"})
        clock, mistaps = start, 0
        # The request's own seconds per tap, slowed by the storyline the way Mai's simulator slows it.
        median_ms = max(row["mean_tap_interval"], 0.5) * 1000 * (e["latency_night"] * 1.15 if night else e["latency"])
        circadian = 0.3 if night else 0.15 if confirmed_at.astimezone(settings.unit_tz).hour >= 18 else 0.0
        log: list[Interaction] = []
        taps_ms: list[float] = []
        for kind, vocab in (("area", self.areas), ("feeling", self.feelings)):
            right = _pick(rng, {k: v for k, v in self.cat.by_id[need][kind + "s"].items() if k in vocab})
            if rng.random() < min(p["mistap_rate"] * e["mistap"] * (1.3 if night else 1.0), 0.6):
                clock = self._timed_tap(clock, sid, kind, rng.choice([x for x in vocab if x != right]), median_ms, e, True)
                taps_ms.append(self._last_ms)
                log += [Interaction(RESPONSE, 0, self._last_ms / 1000), Interaction(CORRECTION, 0)]
                mistaps += 1
            clock = self._timed_tap(clock, sid, kind, right, median_ms, e, False)
            taps_ms.append(self._last_ms)
            log.append(Interaction(RESPONSE, 0, self._last_ms / 1000))
        fatigue = _clip(p["fatigue"] + circadian + e["fatigue"] + 0.2 * mistaps + rng.gauss(0, 0.12), 1.0, 3.5)
        self._adapt(clock, sid, log, fatigue)
        self.past_s += [ms / 1000 for ms in taps_ms]
        self._event(clock, sid, "fatigue", {"score": round(fatigue, 2)})
        self._event(clock + timedelta(seconds=1), sid, "escalated" if row["escalated"] else "notified",
                    {"need": row["predicted_need"]})
        self._event(confirmed_at, sid, "nurse_confirmed",
                    {"alert_id": None, "need": need, "predicted": row["predicted_need"], "nurse": NURSE})

    def _adapt(self, clock, sid, log: list[Interaction], fatigue: float):
        """What the live policy would have done in this session, step by step, with the patient's history so far."""
        past = sorted(self.past_s)
        personal = PersonalBaseline(past[len(past) // 2], len(past) // 2) if past else None
        state, since = cp.CommunicationState(), 0
        for i in range(1, len(log) + 1):
            sig = detect(log[:i], since, personal, fatigue)
            d = cp.decide(sig, state)
            if not d.should_adapt or d.requires_patient_confirmation:
                continue
            before, state, since = state, cp.apply(state, d), i
            if state.mode != before.mode:
                self._event(clock, sid, "communication_mode_changed", {
                    "from": int(before.mode), "to": int(state.mode), "from_mode": before.mode.name,
                    "to_mode": state.mode.name, "from_label": cp.LABEL[before.mode], "to_label": cp.LABEL[state.mode],
                    "reason": d.reason, "explanation": d.explanation, "source": "auto",
                    "slowdown_ratio": round(sig.slowdown_ratio, 2) if sig.slowdown_ratio else None})

    def _timed_tap(self, clock, sid, kind, tap, median_ms, e, mistap):
        ms = min(median_ms * self.rng.lognormvariate(0, self.profile["latency_sigma"] + e["sigma"]), 60000)
        self._last_ms = ms
        clock += timedelta(milliseconds=ms)
        self._event(clock, sid, "tap", {"kind": kind, "tap": tap, "latency_ms": round(ms), "mistap": mistap})
        return clock

    def run(self) -> "_UnitSim":
        for day in range(DAYS):
            self._chart_day(day)
        for row in sorted(self.requests, key=lambda r: r["time"]):
            if row["confirmed_need"] in self.cat.by_id:
                self.request(row)
        for ev in self.patient_row["chart_events"]:
            self._chart(datetime.fromisoformat(ev["time"]), _chart_kind(ev["label"]), None, {"label": ev["label"]})
        return self


def generate(cat: Catalog, requests_by_patient: dict[str, list[dict]], now: datetime | None = None
             ) -> tuple[list[dict], list[dict]]:
    now = now or datetime.now(timezone.utc)
    sims = [_UnitSim(cat, pid, story, requests_by_patient.get(pid, []), now).run() for pid, story in STORIES.items()]
    order = lambda r: (r["time"], r["patient_id"])   # noqa: E731
    return (sorted((e for s in sims for e in s.events), key=order),
            sorted((c for s in sims for c in s.chart), key=order))


# ---- storage ---------------------------------------------------------------------------------------

async def _newest(risk_store, ids: list[str]) -> datetime | None:
    if hasattr(risk_store, "pool"):
        rows = await risk_store._all("SELECT max(time) AS t FROM events WHERE patient_id = ANY(%s) "
                                     "AND payload->>'source' = %s", (ids, SOURCE))
        return rows[0]["t"] if rows else None
    times = [e["time"] for e in risk_store.main.events
             if e["patient_id"] in ids and (e.get("payload") or {}).get("source") == SOURCE]
    return max(times, default=None)


async def _replace(risk_store, ids: list[str], events: list[dict], chart: list[dict]):
    """Swap this module's rows for these patients, leaving every other row alone."""
    if not hasattr(risk_store, "pool"):
        mine = lambda r: r["patient_id"] in ids and (r.get("payload") or {}).get("source") == SOURCE   # noqa: E731
        risk_store.main.events[:] = [e for e in risk_store.main.events if not mine(e)] + events
        risk_store.chart[:] = [c for c in risk_store.chart if not mine(c)] + chart
        return
    async with risk_store.pool.connection() as conn:
        async with conn.transaction():
            for table in ("events", "chart_events"):
                await conn.execute(f"DELETE FROM {table} WHERE patient_id = ANY(%s) AND payload->>'source' = %s",
                                   (ids, SOURCE))
            async with conn.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO events (time, patient_id, session_id, event_type, payload, origin) "
                    "VALUES (%s,%s,%s,%s,%s,'synthetic_history')",
                    [(e["time"], e["patient_id"], e["session_id"], e["event_type"], json.dumps(e["payload"]))
                     for e in events])
                await cur.executemany(
                    "INSERT INTO chart_events (time, patient_id, kind, value, payload) VALUES (%s,%s,%s,%s,%s)",
                    [(c["time"], c["patient_id"], c["kind"], c["value"], json.dumps(c["payload"])) for c in chart])
        for view in ("communication_hourly",):
            await conn.execute(f"CALL refresh_continuous_aggregate('{view}', NULL, NULL)")


async def _score(risk_store, ids: list[str]):
    from ..risk.config import DEFAULT
    from ..risk.engine import score_patient, scoring_times
    from ..risk.signals import PatientSignals
    rows = []
    for pid in ids:
        events, chart = await risk_store.patient_rows(pid)
        sig = await asyncio.to_thread(PatientSignals, events, chart)
        out, _ = await asyncio.to_thread(score_patient, pid, sig, scoring_times(sig, DEFAULT), DEFAULT)
        rows.extend(out)
    await risk_store.replace_scores(ids, rows)
    return len(rows)


async def ensure_unit_history(store, risk_store, cat: Catalog, force: bool = False) -> bool:
    """Generate (or refresh, when older than STALE) the unit patients' history, then score it. Never raises."""
    if risk_store is None:
        return False
    try:
        ids = list(STORIES)
        now = datetime.now(timezone.utc)
        newest = await _newest(risk_store, ids)
        if newest and now - newest < STALE and not force:
            return False
        since = now - timedelta(days=DAYS)
        requests = {pid: await store.confirmations(since, pid) for pid in ids}
        events, chart = await asyncio.to_thread(generate, cat, requests, now)
        await _replace(risk_store, ids, events, chart)
        n = await _score(risk_store, ids)
        log.info("unit history: %d events, %d chart events, %d risk scores for %d patients",
                 len(events), len(chart), n, len(ids))
        return True
    except Exception:
        log.exception("unit history failed; the app continues without it")
        return False
