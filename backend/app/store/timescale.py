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

CONFIRMATION_COLS = ("time", "patient_id", "session_id", "predicted_need", "confirmed_need", "confirmed_group",
                     "risk", "correct", "escalated", "taps", "questions", "resolve_seconds",
                     "mean_tap_interval", "mode", "origin")

DECISION_ACTION_COLS = ("time", "patient_id", "session_id", "decision_cycle", "kind", "action_id", "label",
                        "eig", "fatigue_cost", "delay_cost", "other_costs", "value", "score", "selected",
                        "rank", "origin")


def _statements(sql: str) -> list[str]:
    body = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    return [s.strip() for s in body.split(";") if s.strip()]


# (hypertable, segment-by column, compress-after). Segmented by whichever column each
# table is most commonly filtered on, so a compressed chunk can still be scanned without
# decompressing unrelated patients'/sessions' rows. 3 days keeps recent, still-growing
# chunks writable; only settled history gets compressed.
COMPRESSION_TARGETS = (
    ("events", "patient_id", "3 days"),
    ("confirmations", "patient_id", "3 days"),
    ("belief_snapshots", "session_id", "3 days"),
    ("decision_actions", "session_id", "3 days"),
)
RETENTION_DAYS = "365 days"  # generous: far beyond the ~8 day seed window and this prototype's lifetime


class TimescaleStore:
    def __init__(self, dsn: str):
        self.pool = AsyncConnectionPool(dsn, min_size=1, max_size=8, open=False,
                                        kwargs={"autocommit": True, "row_factory": dict_row})

    async def init(self):
        await self.pool.open()
        async with self.pool.connection() as conn:
            for stmt in _statements(SCHEMA.read_text()):
                await conn.execute(stmt)
        log.info("Timescale schema ready")
        await self._apply_compression_and_retention()

    async def _apply_compression_and_retention(self):
        """Best-effort: compression/retention are performance/cost policies, not core
        functionality, so a failure here (e.g. an older Timescale version, or settings
        already applied in a way this check doesn't recognise) must never block startup
        or patient communication. ALTER ... SET compression is not reliably idempotent
        across versions, hence the per-statement try/except instead of relying on SQL
        alone (schema.sql's statements all run as one batch, with no such tolerance)."""
        async with self.pool.connection() as conn:
            for table, segmentby, compress_after in COMPRESSION_TARGETS:
                try:
                    await conn.execute(
                        f"ALTER TABLE {table} SET (timescaledb.compress, "
                        f"timescaledb.compress_segmentby = '{segmentby}', "
                        f"timescaledb.compress_orderby = 'time DESC')")
                except Exception as e:
                    log.info("compression already configured on %s (%s)", table, e)
                try:
                    await conn.execute(
                        f"SELECT add_compression_policy('{table}', INTERVAL '{compress_after}', if_not_exists => TRUE)")
                    await conn.execute(
                        f"SELECT add_retention_policy('{table}', INTERVAL '{RETENTION_DAYS}', if_not_exists => TRUE)")
                except Exception:
                    log.exception("could not add compression/retention policy for %s", table)
        log.info("Tiger Data compression/retention policies applied")

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
                    "INSERT INTO events (time, patient_id, session_id, event_type, payload, origin) "
                    "VALUES (%s,%s,%s,%s,%s,%s)",
                    [(e["time"], e["patient_id"], e["session_id"], e["event_type"], json.dumps(e["payload"]),
                      e.get("origin", "live_demo")) for e in events])
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
        row = {**row, "origin": row.get("origin", "live_demo")}
        async with self.pool.connection() as conn:
            await conn.execute(
                f"INSERT INTO confirmations ({', '.join(CONFIRMATION_COLS)}) "
                f"VALUES ({', '.join(['%s'] * len(CONFIRMATION_COLS))})",
                tuple(row[c] for c in CONFIRMATION_COLS))

    async def log_decision_actions(self, rows: list[dict]):
        if not rows:
            return
        rows = [{**r, "origin": r.get("origin", "live_demo")} for r in rows]
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(
                    f"INSERT INTO decision_actions ({', '.join(DECISION_ACTION_COLS)}) "
                    f"VALUES ({', '.join(['%s'] * len(DECISION_ACTION_COLS))})",
                    [tuple(json.dumps(r[c]) if c == "other_costs" else r[c] for c in DECISION_ACTION_COLS)
                     for r in rows])

    async def decision_action_history(self, session_id: str) -> list[dict]:
        rows = await self._all(
            f"SELECT {', '.join(DECISION_ACTION_COLS)} FROM decision_actions "
            "WHERE session_id = %s ORDER BY time, rank", (session_id,))
        for r in rows:
            if isinstance(r.get("other_costs"), str):
                r["other_costs"] = json.loads(r["other_costs"])
        return rows

    async def belief_evolution(self, session_id: str) -> list[dict]:
        return await self._all(
            "SELECT time, step, need_id, prob FROM belief_snapshots "
            "WHERE session_id = %s ORDER BY time, need_id", (session_id,))

    async def daily_confirmed_needs(self, patient_id: str, days: int) -> list[dict]:
        return await self._all(
            "SELECT bucket, confirmed_need, confirmed_group, n::int AS n FROM patient_daily_needs "
            "WHERE patient_id = %s AND bucket > now() - make_interval(days => %s) ORDER BY bucket",
            (patient_id, days))

    async def last_activity(self, patient_id: str) -> dict | None:
        rows = await self._all(
            "SELECT time, event_type AS kind FROM events WHERE patient_id = %s "
            "UNION ALL "
            "SELECT time, 'confirmation' AS kind FROM confirmations WHERE patient_id = %s "
            "ORDER BY time DESC LIMIT 1", (patient_id, patient_id))
        return rows[0] if rows else None

    async def interaction_baseline(self, patient_id: str, days: int) -> dict:
        rows = await self._all(
            "SELECT avg(mean_tap_interval) AS avg_tap_interval, stddev_pop(mean_tap_interval) AS stddev_tap_interval, "
            "avg(taps)::float AS avg_taps, count(*)::int AS n FROM confirmations "
            "WHERE patient_id = %s AND time > now() - make_interval(days => %s)", (patient_id, days))
        return rows[0] if rows else {"avg_tap_interval": None, "stddev_tap_interval": None, "avg_taps": None, "n": 0}

    async def tigerdata_counts(self) -> dict:
        async with self.pool.connection() as conn:
            out = {}
            for table in ("events", "confirmations", "belief_snapshots", "decision_actions"):
                cur = await conn.execute(f"SELECT count(*)::bigint AS n FROM {table}")
                out[table] = (await cur.fetchone())["n"]
            cur = await conn.execute("SELECT max(time) AS t FROM events")
            row = await cur.fetchone()
            out["latest_event_time"] = row["t"].isoformat() if row and row["t"] else None
            return out

    async def tigerdata_hypertable_stats(self) -> list[dict]:
        return await self._all(
            "SELECT h.hypertable_name, count(c.chunk_name)::int AS chunk_count "
            "FROM timescaledb_information.hypertables h "
            "LEFT JOIN timescaledb_information.chunks c USING (hypertable_name) "
            "GROUP BY h.hypertable_name ORDER BY h.hypertable_name")

    async def tigerdata_compression_stats(self) -> list[dict]:
        out = []
        async with self.pool.connection() as conn:
            for table in ("events", "confirmations", "belief_snapshots", "decision_actions"):
                try:
                    cur = await conn.execute(
                        "SELECT total_chunks, number_compressed_chunks, "
                        "before_compression_total_bytes, after_compression_total_bytes "
                        "FROM hypertable_compression_stats(%s::regclass)", (table,))
                    row = await cur.fetchone()
                except Exception:
                    row = None
                if not row or not row.get("number_compressed_chunks"):
                    out.append({"table": table, "available": False})
                    continue
                before, after = row["before_compression_total_bytes"], row["after_compression_total_bytes"]
                out.append({
                    "table": table, "available": True,
                    "total_chunks": row["total_chunks"], "compressed_chunks": row["number_compressed_chunks"],
                    "before_bytes": before, "after_bytes": after,
                    "compression_ratio": round(before / after, 2) if before and after else None,
                })
        return out

    async def recent_sessions(self, patient_id: str, limit: int = 10) -> list[dict]:
        return await self._all(
            "SELECT session_id, max(time) AS time FROM decision_actions "
            "WHERE patient_id = %s GROUP BY session_id ORDER BY time DESC LIMIT %s",
            (patient_id, limit))

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
