"""Tiger Data (TimescaleDB) store: hypertables for the event stream, continuous aggregates for trends."""
import json
import logging
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

log = logging.getLogger(__name__)
SCHEMA = Path(__file__).with_name("schema.sql")

# 24 h windows aligned to now, re-aggregated from the hourly continuous aggregate.
WINDOW_SQL = """
SELECT patient_id,
       floor(extract(epoch FROM (now() - bucket)) / 86400)::int          AS days_ago,
       sum(needs)::float                                                AS needs,
       sum(pain_needs)::float                                           AS pain_needs,
       sum(high_risk)::float                                            AS high_risk,
       sum(escalations)::float                                          AS escalations,
       sum(taps_sum)::float      / nullif(sum(needs), 0)                AS avg_taps,
       sum(interval_sum)::float  / nullif(sum(needs), 0)                AS avg_tap_interval,
       sum(correct_count)::float / nullif(sum(needs), 0)                AS accuracy,
       sum(scan_count)::float    / nullif(sum(needs), 0)                AS scan_share
FROM patient_hourly_signals
WHERE bucket > now() - make_interval(days => %s)
GROUP BY patient_id, days_ago
ORDER BY patient_id, days_ago
"""

MODE_CHANGES_SQL = """
SELECT patient_id, sum(n)::int AS n
FROM communication_hourly
WHERE event_type = 'mode_changed' AND bucket > now() - make_interval(hours => %s)
GROUP BY patient_id
"""

# The patient's usual seconds between inputs: median over recent confirmations in the hypertable.
TAP_BASELINE_SQL = """
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mean_tap_interval) AS median, count(*)::int AS n
FROM confirmations
WHERE patient_id = %s AND time > now() - make_interval(days => %s) AND mean_tap_interval > 0
"""
MIN_BASELINE_ROWS = 5

CONFIRMATION_COLS = ("time", "patient_id", "session_id", "predicted_need", "confirmed_need", "confirmed_group",
                     "risk", "correct", "escalated", "taps", "questions", "resolve_seconds",
                     "mean_tap_interval", "mode")


def _statements(sql: str) -> list[str]:
    body = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    return [s.strip() for s in body.split(";") if s.strip()]


class TimescaleStore:
    def __init__(self, dsn: str):
        self.pool = AsyncConnectionPool(dsn, min_size=1, max_size=8, open=False,
                                        kwargs={"autocommit": True, "row_factory": dict_row})

    async def init(self):
        await self.pool.open()
        async with self.pool.connection() as conn:
            for stmt in _statements(SCHEMA.read_text(encoding="utf-8")):
                await conn.execute(stmt)
        log.info("Timescale schema ready")

    async def close(self):
        await self.pool.close()

    async def _all(self, sql: str, params=()) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(sql, params)
            return await cur.fetchall()

    async def is_empty(self) -> bool:
        rows = await self._all("SELECT 1 FROM confirmations LIMIT 1")
        return not rows

    async def bulk_seed(self, confirmations, events):
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(
                    f"INSERT INTO confirmations ({', '.join(CONFIRMATION_COLS)}) "
                    f"VALUES ({', '.join(['%s'] * len(CONFIRMATION_COLS))})",
                    [tuple(r[c] for c in CONFIRMATION_COLS) for r in confirmations])
                await cur.executemany(
                    "INSERT INTO events (time, patient_id, session_id, event_type, payload) VALUES (%s,%s,%s,%s,%s)",
                    [(e["time"], e["patient_id"], e["session_id"], e["event_type"], json.dumps(e["payload"]))
                     for e in events])
            for view in ("patient_hourly_signals", "communication_hourly"):
                await conn.execute(f"CALL refresh_continuous_aggregate('{view}', NULL, NULL)")

    async def log_event(self, time, patient_id, session_id, event_type, payload):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO events (time, patient_id, session_id, event_type, payload) VALUES (%s,%s,%s,%s,%s)",
                (time, patient_id, session_id, event_type, json.dumps(payload, default=str)))

    async def log_belief(self, time, patient_id, session_id, step, belief):
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO belief_snapshots (time, patient_id, session_id, step, need_id, prob) "
                    "VALUES (%s,%s,%s,%s,%s,%s)",
                    [(time, patient_id, session_id, step, nid, p) for nid, p in belief.items()])

    async def log_confirmation(self, row):
        async with self.pool.connection() as conn:
            await conn.execute(
                f"INSERT INTO confirmations ({', '.join(CONFIRMATION_COLS)}) "
                f"VALUES ({', '.join(['%s'] * len(CONFIRMATION_COLS))})",
                tuple(row[c] for c in CONFIRMATION_COLS))

    async def window_signals(self, days=8):
        return await self._all(WINDOW_SQL, (days,))

    async def mode_changes(self, hours=24):
        return {r["patient_id"]: r["n"] for r in await self._all(MODE_CHANGES_SQL, (hours,))}

    async def confirmations(self, since, patient_id=None):
        sql = f"SELECT {', '.join(CONFIRMATION_COLS)} FROM confirmations WHERE time >= %s"
        params: tuple = (since,)
        if patient_id:
            sql += " AND patient_id = %s"
            params += (patient_id,)
        return await self._all(sql + " ORDER BY time", params)

    async def history_counts(self, patient_id):
        rows = await self._all(
            "SELECT confirmed_need, count(*)::int AS n FROM confirmations "
            "WHERE patient_id = %s AND time > now() - interval '30 days' GROUP BY confirmed_need", (patient_id,))
        return {r["confirmed_need"]: r["n"] for r in rows}

    async def get_reliability(self, key):
        rows = await self._all("SELECT a, b FROM source_reliability WHERE key = %s", (key,))
        return (rows[0]["a"], rows[0]["b"]) if rows else None

    async def set_reliability(self, key, a, b):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO source_reliability (key, a, b) VALUES (%s,%s,%s) "
                "ON CONFLICT (key) DO UPDATE SET a = EXCLUDED.a, b = EXCLUDED.b, updated_at = now()", (key, a, b))

    async def events_of_type(self, event_type, since, patient_id=None):
        sql = "SELECT time, patient_id, session_id, event_type, payload FROM events WHERE event_type = %s AND time >= %s"
        params: tuple = (event_type, since)
        if patient_id:
            sql += " AND patient_id = %s"
            params += (patient_id,)
        return await self._all(sql + " ORDER BY time", params)

    async def list_hypotheses(self):
        rows = await self._all("SELECT body FROM research_hypotheses ORDER BY created_at DESC")
        return [r["body"] for r in rows]

    async def tap_baseline(self, patient_id, days=14):
        rows = await self._all(TAP_BASELINE_SQL, (patient_id, days))
        r = rows[0] if rows else None
        return float(r["median"]) if r and r["n"] >= MIN_BASELINE_ROWS and r["median"] is not None else None

    async def get_profile(self, patient_id):
        rows = await self._all("SELECT body FROM patient_profiles WHERE patient_id = %s", (patient_id,))
        return rows[0]["body"] if rows else None

    async def put_profile(self, profile):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO patient_profiles (patient_id, body) VALUES (%s,%s) "
                "ON CONFLICT (patient_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()",
                (profile["patient_id"], json.dumps(profile, default=str)))

    async def list_suggestions(self):
        rows = await self._all("SELECT body FROM profile_suggestions ORDER BY created_at DESC")
        return [r["body"] for r in rows]

    async def upsert_suggestion(self, suggestion):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO profile_suggestions (id, created_at, patient_id, status, body) VALUES (%s,%s,%s,%s,%s) "
                "ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body",
                (suggestion["id"], suggestion["created_at"], suggestion["patient_id"], suggestion["status"],
                 json.dumps(suggestion, default=str)))

    async def upsert_hypothesis(self, hypothesis):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO research_hypotheses (id, created_at, updated_at, status, body) VALUES (%s,%s,%s,%s,%s) "
                "ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, status = EXCLUDED.status, "
                "body = EXCLUDED.body",
                (hypothesis["id"], hypothesis["created_at"], hypothesis["updated_at"], hypothesis["status"],
                 json.dumps(hypothesis, default=str)))

    async def list_inquiries(self):
        rows = await self._all("SELECT body FROM research_inquiries ORDER BY created_at DESC")
        return [r["body"] for r in rows]

    async def upsert_inquiry(self, inquiry):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO research_inquiries (id, created_at, status, body) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body",
                (inquiry["id"], inquiry["created_at"], inquiry["status"], json.dumps(inquiry, default=str)))
