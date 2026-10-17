"""Tiger Data Event Intelligence & Decision Analytics (Feature #4): the query-service layer
other features and the dashboard call, on top of the Store protocol's primitives
(`backend/app/store/base.py`) — same split as `trends.py`'s `build_trends`.

CHECK_DATA note for Feature #1 (research agent): `research.py._data()` / `research_data.evaluate()`
already read live rows straight from the `confirmations`/`events` hypertables through this same
Store protocol — CHECK_DATA is already genuinely Tiger-Data-backed, not mocked. Nothing here
replaces or wraps that path; it stays untouched (the agent's discovery/confirm split and effect-size
math are reasoning, not data access, and the spec asks that it not be rewritten). This module is the
parallel, documented interface for Features #2/#3 and the dashboard below.

Only ever reports what was actually measured: a metric with nothing recorded comes back as
`None`/`unavailable`, never a fabricated number.
"""
import time
from datetime import datetime, timezone

from ..catalog import Catalog


async def get_patient_response_trends(store, patient_id: str, days: int = 8) -> list[dict]:
    """Reuses the existing `window_signals` continuous-aggregate query (same one `trends.py`
    builds "Catch It Early" from) rather than adding a parallel response-time query."""
    rows = await store.window_signals(days)
    mine = sorted((r for r in rows if r["patient_id"] == patient_id), key=lambda r: -r["days_ago"])
    return [{"days_ago": r["days_ago"], "avg_tap_interval": r["avg_tap_interval"], "needs": r["needs"]} for r in mine]


async def get_confirmed_need_trends(store, patient_id: str, days: int = 14) -> list[dict]:
    rows = await store.daily_confirmed_needs(patient_id, days)
    return [{"date": r["bucket"].isoformat() if hasattr(r["bucket"], "isoformat") else str(r["bucket"]),
             "need": r["confirmed_need"], "group": r["confirmed_group"], "count": r["n"]} for r in rows]


def get_speech_interaction_trends(patient_id: str, days: int = 8) -> dict:
    """No speech-input feature exists anywhere in this codebase (the patient interface is
    tap/yes-no only — see `frontend/components/talk/*` and the session API). Returning an
    honest unsupported marker, per the spec's own rule against reporting unmeasured signals."""
    return {"supported": False, "reason": "No speech-input interaction is implemented in this app yet."}


async def get_last_patient_activity(store, patient_id: str) -> dict | None:
    return await store.last_activity(patient_id)


async def get_decision_action_history(store, session_id: str) -> list[dict]:
    return await store.decision_action_history(session_id)


async def get_belief_evolution(store, cat: Catalog, session_id: str) -> list[dict]:
    rows = await store.belief_evolution(session_id)
    for r in rows:
        r["label"] = cat.by_id.get(r["need_id"], {}).get("label", r["need_id"])
    return rows


async def get_interaction_baseline(store, patient_id: str, days: int = 8) -> dict:
    return await store.interaction_baseline(patient_id, days)


async def tigerdata_overview(store, patient_id: str | None = None, days: int = 8) -> dict:
    """Backs GET /api/analytics/tigerdata. Every number is a real measurement against the
    current store (Tiger Data, or MemoryStore's honest 'unavailable' when there's no database
    configured) — see the per-field notes below for what's reported when something can't be
    measured rather than guessed.

    Access note: this app has no authentication/session system anywhere (every existing
    endpoint — /api/patients/{pid}, /api/trends, etc. — takes a bare id with no token check),
    so patient-scoped analytics here follow that same existing posture rather than inventing
    access control that doesn't exist elsewhere in the app.
    """
    t0 = time.perf_counter()
    counts = await store.tigerdata_counts()
    query_latency_ms = round((time.perf_counter() - t0) * 1000, 2)

    hypertables = await store.tigerdata_hypertable_stats()
    compression = await store.tigerdata_compression_stats()

    out = {
        "counts": {
            "events": counts["events"], "confirmations": counts["confirmations"],
            "belief_snapshots": counts["belief_snapshots"], "decision_candidates": counts["decision_actions"],
        },
        "latest_event_time": counts["latest_event_time"],
        "hypertable_count": len(hypertables),
        "chunk_count": sum(h["chunk_count"] for h in hypertables) if hypertables else None,
        "hypertables": hypertables,
        "compression": compression,
        "query_latency_ms": query_latency_ms,
        "measured_at": datetime.now(timezone.utc).isoformat(),
    }
    if patient_id:
        out["patient"] = {
            "patient_id": patient_id,
            "response_trends": await get_patient_response_trends(store, patient_id, days),
            "confirmed_need_trends": await get_confirmed_need_trends(store, patient_id, days),
            "speech_interaction_trends": get_speech_interaction_trends(patient_id, days),
            "last_activity": await get_last_patient_activity(store, patient_id),
            "interaction_baseline": await get_interaction_baseline(store, patient_id, days),
            "recent_sessions": await store.recent_sessions(patient_id),
        }
    return out
