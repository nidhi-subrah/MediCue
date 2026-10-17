"""Storage for the risk module: its own tables (schema.sql) plus synthetic rows in the shared `events` hypertable.

Two backends mirror the core store: Timescale when the app runs on Tiger Data, in-process otherwise.
Replacing the cohort deletes only `syn-*` patients' rows, so live and demo data are never touched.
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .synthetic import COHORT, Cohort

SCHEMA = Path(__file__).with_name("schema.sql")
COHORT_COLS = ("patient_id", "name", "room", "age", "storyline", "split", "confounder", "profile", "seed",
               "synthetic")
SCORE_COLS = ("time", "patient_id", "risk", "score", "raw_level", "level", "flag", "enough_data", "contributors",
              "missing", "reason", "state", "config_version")
SCORE_JSON = ("contributors", "missing", "state")
AUDIT_COLS = ("time", "patient_id", "ladder_id", "mode", "event", "step", "role", "actor", "detail")
TREND_BUCKET = timedelta(hours=6)
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def make_risk_store(main_store):
    from ..store.memory import MemoryStore
    if isinstance(main_store, MemoryStore):
        return MemoryRiskStore(main_store)
    return TimescaleRiskStore(main_store.pool)


def _ids(cohort: Cohort) -> list[str]:
    return sorted({p["id"] for p in cohort.patients} | {s.id for s in COHORT})


def _bucket(t: datetime) -> datetime:
    return EPOCH + (t - EPOCH) // TREND_BUCKET * TREND_BUCKET


def trend_rows(scores: list[dict]) -> list[dict]:
    """In-process mirror of the risk_scores_6h continuous aggregate."""
    groups = defaultdict(list)
    for r in scores:
        groups[(_bucket(r["time"]), r["patient_id"], r["risk"])].append(r)
    return [{"bucket": b, "patient_id": pid, "risk": risk,
             "mean_score": sum(r["score"] for r in rs) / len(rs), "max_score": max(r["score"] for r in rs),
             "watch_hours": sum(r["level"] == "watch" for r in rs),
             "elevated_hours": sum(r["level"] == "elevated" for r in rs),
             "flags": sum(r["flag"] is not None for r in rs), "n": len(rs)}
            for (b, pid, risk), rs in sorted(groups.items())]


class MemoryRiskStore:
    def __init__(self, main_store):
        self.main = main_store
        self.cohort: list[dict] = []
        self.chart: list[dict] = []
        self.outcomes: list[dict] = []
        self.scores: list[dict] = []
        self.audit: list[dict] = []

    async def init(self): ...

    async def is_seeded(self) -> bool:
        return bool(self.cohort)

    async def replace_cohort(self, cohort: Cohort):
        ids = set(_ids(cohort))
        self.main.events[:] = [e for e in self.main.events if e["patient_id"] not in ids]
        self.main.events.extend(cohort.events)
        self.cohort, self.chart, self.outcomes = list(cohort.patients), list(cohort.chart_events), list(cohort.outcomes)
        self.scores = [r for r in self.scores if r["patient_id"] not in ids]

    async def list_cohort(self) -> list[dict]:
        return self.cohort

    async def chart_events(self, patient_id: str, since: datetime | None = None) -> list[dict]:
        return [c for c in self.chart if c["patient_id"] == patient_id and (since is None or c["time"] >= since)]

    async def outcome_events(self) -> list[dict]:
        return self.outcomes

    async def patient_rows(self, patient_id: str) -> tuple[list[dict], list[dict]]:
        return [e for e in self.main.events if e["patient_id"] == patient_id], await self.chart_events(patient_id)

    # ---- risk scores -----------------------------------------------------------------------------

    async def has_scores(self, patient_ids: list[str], config_version: str) -> bool:
        ids = set(patient_ids)
        return any(r["patient_id"] in ids and r["config_version"] == config_version for r in self.scores)

    async def replace_scores(self, patient_ids: list[str], rows: list[dict]):
        ids = set(patient_ids)
        self.scores = [r for r in self.scores if r["patient_id"] not in ids] + [
            {k: r[k] for k in SCORE_COLS} for r in rows]

    async def latest_scores(self, patient_id: str | None = None) -> list[dict]:
        latest = {}
        for r in self.scores:
            if patient_id is None or r["patient_id"] == patient_id:
                key = (r["patient_id"], r["risk"])
                if key not in latest or r["time"] > latest[key]["time"]:
                    latest[key] = r
        return [latest[k] for k in sorted(latest)]

    async def score_history(self, patient_id: str, since: datetime) -> list[dict]:
        return sorted((r for r in self.scores if r["patient_id"] == patient_id and r["time"] >= since),
                      key=lambda r: (r["time"], r["risk"]))

    async def flags(self, patient_id: str) -> list[dict]:
        return [r for r in await self.score_history(patient_id, EPOCH) if r["flag"]]

    async def trend(self, patient_id: str) -> list[dict]:
        return trend_rows([r for r in self.scores if r["patient_id"] == patient_id])

    async def trend_all(self) -> list[dict]:
        return trend_rows(self.scores)

    # ---- silence detection -----------------------------------------------------------------------

    async def recent_latencies(self, patient_id: str, n: int) -> list[float]:
        taps = [e for e in self.main.events if e["patient_id"] == patient_id and e["event_type"] == "tap"
                and (e["payload"] or {}).get("latency_ms")]
        return [e["payload"]["latency_ms"] for e in sorted(taps, key=lambda e: e["time"])[-n:]]

    async def interactions(self, patient_id: str, since: datetime, kinds: tuple[str, ...]) -> list[datetime]:
        return sorted(e["time"] for e in self.main.events
                      if e["patient_id"] == patient_id and e["event_type"] in kinds and e["time"] >= since)

    async def log_silence(self, row: dict):
        self.audit.append({k: row[k] for k in AUDIT_COLS})

    async def silence_audit(self, patient_id: str | None = None, ladder_id: str | None = None) -> list[dict]:
        return [r for r in self.audit
                if (patient_id is None or r["patient_id"] == patient_id) and (ladder_id is None or r["ladder_id"] == ladder_id)]


class TimescaleRiskStore:
    def __init__(self, pool):
        self.pool = pool

    async def _all(self, sql: str, params=()) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(sql, params)
            return await cur.fetchall()

    async def init(self):
        from ..store.timescale import _statements
        async with self.pool.connection() as conn:
            for stmt in _statements(SCHEMA.read_text()):
                await conn.execute(stmt)

    async def is_seeded(self) -> bool:
        return bool(await self._all("SELECT 1 FROM risk_cohort LIMIT 1"))

    async def replace_cohort(self, cohort: Cohort):
        ids = _ids(cohort)
        async with self.pool.connection() as conn:
            async with conn.transaction():
                for table in ("events", "chart_events", "outcome_events", "risk_cohort", "risk_scores"):
                    await conn.execute(f"DELETE FROM {table} WHERE patient_id = ANY(%s)", (ids,))
                async with conn.cursor() as cur:
                    await cur.executemany(
                        "INSERT INTO events (time, patient_id, session_id, event_type, payload) VALUES (%s,%s,%s,%s,%s)",
                        [(e["time"], e["patient_id"], e["session_id"], e["event_type"], json.dumps(e["payload"]))
                         for e in cohort.events])
                    await cur.executemany(
                        "INSERT INTO chart_events (time, patient_id, kind, value, payload) VALUES (%s,%s,%s,%s,%s)",
                        [(c["time"], c["patient_id"], c["kind"], c["value"], json.dumps(c["payload"]))
                         for c in cohort.chart_events])
                    await cur.executemany(
                        "INSERT INTO outcome_events (id, time, patient_id, outcome, onset, description, synthetic) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        [(o["id"], o["time"], o["patient_id"], o["outcome"], o["onset"], o["description"],
                          o["synthetic"]) for o in cohort.outcomes])
                    await cur.executemany(
                        f"INSERT INTO risk_cohort ({', '.join(COHORT_COLS)}) "
                        f"VALUES ({', '.join(['%s'] * len(COHORT_COLS))})",
                        [(p["id"], p["name"], p["room"], p["age"], p["storyline"], p["split"], p["confounder"],
                          json.dumps(p["profile"]), p["seed"], p["synthetic"]) for p in cohort.patients])
            # Old rows landed in already-materialised buckets; refresh so hourly counts include them.
            await conn.execute("CALL refresh_continuous_aggregate('communication_hourly', NULL, NULL)")

    async def list_cohort(self) -> list[dict]:
        rows = await self._all(f"SELECT {', '.join(COHORT_COLS)} FROM risk_cohort ORDER BY patient_id")
        return [{"id": r.pop("patient_id"), **r} for r in rows]

    async def chart_events(self, patient_id: str, since: datetime | None = None) -> list[dict]:
        sql = "SELECT time, patient_id, kind, value, payload FROM chart_events WHERE patient_id = %s"
        params: tuple = (patient_id,)
        if since:
            sql += " AND time >= %s"
            params += (since,)
        return await self._all(sql + " ORDER BY time", params)

    async def outcome_events(self) -> list[dict]:
        return await self._all("SELECT id, time, patient_id, outcome, onset, description, synthetic "
                               "FROM outcome_events ORDER BY time")

    async def patient_rows(self, patient_id: str) -> tuple[list[dict], list[dict]]:
        events = await self._all("SELECT time, patient_id, session_id, event_type, payload FROM events "
                                 "WHERE patient_id = %s ORDER BY time", (patient_id,))
        return events, await self.chart_events(patient_id)

    # ---- risk scores -----------------------------------------------------------------------------

    async def has_scores(self, patient_ids: list[str], config_version: str) -> bool:
        return bool(await self._all("SELECT 1 FROM risk_scores WHERE patient_id = ANY(%s) AND config_version = %s "
                                    "LIMIT 1", (patient_ids, config_version)))

    async def replace_scores(self, patient_ids: list[str], rows: list[dict]):
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM risk_scores WHERE patient_id = ANY(%s)", (patient_ids,))
                async with conn.cursor() as cur:
                    await cur.executemany(
                        f"INSERT INTO risk_scores ({', '.join(SCORE_COLS)}) "
                        f"VALUES ({', '.join(['%s'] * len(SCORE_COLS))})",
                        [tuple(json.dumps(r[c], default=str) if c in SCORE_JSON else r[c] for c in SCORE_COLS)
                         for r in rows])
            await conn.execute("CALL refresh_continuous_aggregate('risk_scores_6h', NULL, NULL)")

    async def latest_scores(self, patient_id: str | None = None) -> list[dict]:
        sql = f"SELECT DISTINCT ON (patient_id, risk) {', '.join(SCORE_COLS)} FROM risk_scores"
        params: tuple = ()
        if patient_id:
            sql += " WHERE patient_id = %s"
            params = (patient_id,)
        return await self._all(sql + " ORDER BY patient_id, risk, time DESC", params)

    async def score_history(self, patient_id: str, since: datetime) -> list[dict]:
        return await self._all(f"SELECT {', '.join(SCORE_COLS)} FROM risk_scores WHERE patient_id = %s "
                               "AND time >= %s ORDER BY time, risk", (patient_id, since))

    async def flags(self, patient_id: str) -> list[dict]:
        return await self._all(f"SELECT {', '.join(SCORE_COLS)} FROM risk_scores WHERE patient_id = %s "
                               "AND flag IS NOT NULL ORDER BY time", (patient_id,))

    async def trend(self, patient_id: str) -> list[dict]:
        return await self._all("SELECT bucket, patient_id, risk, mean_score, max_score, watch_hours, "
                               "elevated_hours, flags, n FROM risk_scores_6h WHERE patient_id = %s "
                               "ORDER BY bucket, risk", (patient_id,))

    async def trend_all(self) -> list[dict]:
        return await self._all("SELECT bucket, patient_id, risk, mean_score, max_score FROM risk_scores_6h "
                               "ORDER BY patient_id, risk, bucket")

    # ---- silence detection -----------------------------------------------------------------------

    async def recent_latencies(self, patient_id: str, n: int) -> list[float]:
        rows = await self._all("SELECT (payload->>'latency_ms')::float AS ms FROM events WHERE patient_id = %s "
                               "AND event_type = 'tap' AND payload->>'latency_ms' IS NOT NULL "
                               "ORDER BY time DESC LIMIT %s", (patient_id, n))
        return [r["ms"] for r in reversed(rows)]

    async def interactions(self, patient_id: str, since: datetime, kinds: tuple[str, ...]) -> list[datetime]:
        rows = await self._all("SELECT time FROM events WHERE patient_id = %s AND event_type = ANY(%s) "
                               "AND time >= %s ORDER BY time", (patient_id, list(kinds), since))
        return [r["time"] for r in rows]

    async def log_silence(self, row: dict):
        async with self.pool.connection() as conn:
            await conn.execute(
                f"INSERT INTO silence_audit ({', '.join(AUDIT_COLS)}) VALUES ({', '.join(['%s'] * len(AUDIT_COLS))})",
                tuple(json.dumps(row[c], default=str) if c == "detail" else row[c] for c in AUDIT_COLS))

    async def silence_audit(self, patient_id: str | None = None, ladder_id: str | None = None) -> list[dict]:
        where, params = [], []
        if patient_id:
            where.append("patient_id = %s")
            params.append(patient_id)
        if ladder_id:
            where.append("ladder_id = %s")
            params.append(ladder_id)
        sql = f"SELECT {', '.join(AUDIT_COLS)} FROM silence_audit"
        if where:
            sql += " WHERE " + " AND ".join(where)
        return await self._all(sql + " ORDER BY time", tuple(params))
