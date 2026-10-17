"""Early-warning clinical risk and silent-patient detection. Self-contained: own tables, own routes.

Rules for everything in this package:
  1. Risk and escalation logic is deterministic Python. No LLM call decides or suppresses anything.
  2. Outputs are flags for clinician review, not diagnoses.
  3. Every score lists the signals that contributed to it.
  4. All data is synthetic (`syn-*` patients) and the UI labels it as such.
  5. A failure here never blocks or delays the core alert path; `start` logs and returns None instead.
"""
import asyncio
import logging

from ..catalog import get_catalog
from ..config import settings
from .routes import router
from .silence_monitor import start_silence

__all__ = ["router", "start", "start_silence"]

log = logging.getLogger(__name__)


async def start(store):
    """Create the module's tables, seed the synthetic cohort and score it if missing. Never raises."""
    try:
        from .store import make_risk_store
        from .synthetic import generate
        risk_store = make_risk_store(store)
        await risk_store.init()
        if settings.seed_demo_data and not await risk_store.is_seeded():
            cohort = await asyncio.to_thread(generate, get_catalog())
            await risk_store.replace_cohort(cohort)
            log.info("risk: seeded synthetic cohort (%d patients, %d events, %d chart events)",
                     len(cohort.patients), len(cohort.events), len(cohort.chart_events))
        await backfill(risk_store)
        return risk_store
    except Exception:
        log.exception("risk module failed to start; the core app continues without it")
        return None


async def backfill(risk_store, force: bool = False):
    """Score every cohort patient hour by hour, unless scores from the current config already exist."""
    from .config import DEFAULT
    from .engine import score_patient, scoring_times
    from .signals import PatientSignals

    ids = [p["id"] for p in await risk_store.list_cohort()]
    if not ids or (not force and await risk_store.has_scores(ids, DEFAULT.version())):
        return
    rows = []
    for pid in ids:
        events, chart = await risk_store.patient_rows(pid)
        sig = await asyncio.to_thread(PatientSignals, events, chart)
        out, _ = await asyncio.to_thread(score_patient, pid, sig, scoring_times(sig, DEFAULT), DEFAULT)
        rows.extend(out)
    await risk_store.replace_scores(ids, rows)
    log.info("risk: scored %d patients (%d rows, config %s)", len(ids), len(rows), DEFAULT.version())
