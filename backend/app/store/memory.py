"""In-process store. Mirrors the Timescale queries in Python so the app runs with no database."""
import copy
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

MIN_BASELINE_ROWS = 5  # fewer confirmations than this and the patient has no personal tap baseline


def window_signals_from_rows(rows: list[dict], now: datetime, days: int) -> list[dict]:
    buckets: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for r in rows:
        age = (now - r["time"]).total_seconds()
        if 0 <= age < days * 86400:
            buckets[(r["patient_id"], int(age // 86400))].append(r)
    out = []
    for (pid, days_ago), rs in sorted(buckets.items()):
        n = len(rs)
        out.append({
            "patient_id": pid, "days_ago": days_ago, "needs": n,
            "pain_needs": sum(r["confirmed_group"] == "pain" for r in rs),
            "high_risk": sum(r["risk"] == "high" for r in rs),
            "escalations": sum(bool(r["escalated"]) for r in rs),
            "avg_taps": sum(r["taps"] for r in rs) / n,
            "avg_tap_interval": sum(r["mean_tap_interval"] for r in rs) / n,
            "accuracy": sum(bool(r["correct"]) for r in rs) / n,
            "scan_share": sum(r["mode"] == "scan" for r in rs) / n,
        })
    return out


class MemoryStore:
    def __init__(self):
        self.events: list[dict] = []
        self.beliefs: list[dict] = []
        self.rows: list[dict] = []
        self.decision_actions: list[dict] = []
        self.reliability: dict[str, tuple[float, float]] = {}
        self.hypotheses: dict[str, dict] = {}
        self.inquiries: dict[str, dict] = {}
        self.profiles: dict[str, dict] = {}
        self.suggestions: dict[str, dict] = {}
        self.cases: dict[str, dict] = {}

    async def init(self): ...
    async def close(self): ...

    async def is_empty(self) -> bool:
        return not self.rows

    async def bulk_seed(self, confirmations, events):
        self.rows.extend(confirmations)
        self.events.extend(events)

    async def log_event(self, time, patient_id, session_id, event_type, payload):
        self.events.append({"time": time, "patient_id": patient_id, "session_id": session_id,
                            "event_type": event_type, "payload": payload})

    async def log_belief(self, time, patient_id, session_id, step, belief):
        self.beliefs.append({"time": time, "patient_id": patient_id, "session_id": session_id, "step": step,
                             "belief": belief})

    async def log_confirmation(self, row):
        self.rows.append({**row, "origin": row.get("origin", "live_demo")})

    async def log_decision_actions(self, rows):
        self.decision_actions.extend({**r, "origin": r.get("origin", "live_demo")} for r in rows)

    async def decision_action_history(self, session_id):
        rows = [r for r in self.decision_actions if r["session_id"] == session_id]
        return sorted(rows, key=lambda r: (r["time"], r["rank"]))

    async def belief_evolution(self, session_id):
        rows = [{"time": b["time"], "step": b["step"], "need_id": nid, "prob": p}
                for b in self.beliefs if b["session_id"] == session_id for nid, p in b["belief"].items()]
        return sorted(rows, key=lambda r: (r["time"], r["need_id"]))

    async def window_signals(self, days=8):
        return window_signals_from_rows(self.rows, datetime.now(timezone.utc), days)

    async def mode_changes(self, hours=24):
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        return dict(Counter(e["patient_id"] for e in self.events
                            if e["event_type"] == "mode_changed" and e["time"] >= since))

    async def confirmations(self, since, patient_id=None):
        return [r for r in self.rows if r["time"] >= since and (patient_id is None or r["patient_id"] == patient_id)]

    async def history_counts(self, patient_id):
        return dict(Counter(r["confirmed_need"] for r in self.rows if r["patient_id"] == patient_id))

    async def get_reliability(self, key):
        return self.reliability.get(key)

    async def set_reliability(self, key, a, b):
        self.reliability[key] = (a, b)

    # ---- nurse views: in-process mirrors of the Timescale queries -------------------------------

    @staticmethod
    def _local_floor(t, bucket: str, tz):
        local = t.astimezone(tz)
        local = local.replace(minute=0, second=0, microsecond=0)
        if bucket == "1 day":
            local = local.replace(hour=0)
        return local.astimezone(timezone.utc)

    @staticmethod
    def _bucket_starts(since, until, bucket: str, tz):
        step = timedelta(days=1) if bucket == "1 day" else timedelta(hours=1)
        t = MemoryStore._local_floor(since, bucket, tz)
        out = []
        while t < until:
            out.append(t)
            # step in local time so days stay aligned to local midnight across DST changes
            t = (t.astimezone(tz) + step).astimezone(timezone.utc) if bucket == "1 day" else t + step
        return out

    def _rows_between(self, since, until, patient_ids):
        ids = set(patient_ids)
        return [r for r in self.rows if since <= r["time"] < until and r["patient_id"] in ids]

    async def requests_by_bucket(self, since, until, bucket, patient_ids, tz):
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(tz)
        counts = defaultdict(lambda: [0, 0])
        rows = self._rows_between(since, until, patient_ids)
        for r in rows:
            c = counts[(self._local_floor(r["time"], bucket, zone), r["patient_id"])]
            c[0] += 1
            c[1] += bool(r["escalated"])
        present = sorted({r["patient_id"] for r in rows})
        return [{"bucket": b, "patient_id": pid, "requests": counts[(b, pid)][0], "urgent": counts[(b, pid)][1]}
                for pid in present for b in self._bucket_starts(since, until, bucket, zone)]

    async def needs_by_day(self, since, until, patient_ids, tz):
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(tz)
        counts = Counter((self._local_floor(r["time"], "1 day", zone), r["patient_id"], r["confirmed_group"])
                         for r in self._rows_between(since, until, patient_ids))
        return [{"day": d, "patient_id": pid, "confirmed_group": g, "n": n} for (d, pid, g), n in sorted(counts.items())]

    async def hour_of_day_profile(self, patient_id, since, until, tz):
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(tz)
        rows = self._rows_between(since, until, [patient_id])
        hours = self._bucket_starts(since, until, "1 hour", zone)
        counts = Counter((self._local_floor(r["time"], "1 hour", zone), r["confirmed_group"]) for r in rows)
        groups = sorted({r["confirmed_group"] for r in rows})
        series: dict[tuple[str, int], list[float]] = defaultdict(list)
        for h in hours:
            hod = h.astimezone(zone).hour
            total = 0.0
            for g in groups:
                series[(g, hod)].append(float(counts[(h, g)]))
                total += counts[(h, g)]
            if rows:
                series[("_total", hod)].append(total)

        def pct(xs, q):
            xs = sorted(xs)
            return xs[min(int(q * len(xs)), len(xs) - 1)]
        return [{"confirmed_group": g, "hod": hod, "mean": statistics.mean(xs), "p10": pct(xs, 0.1),
                 "p50": pct(xs, 0.5), "p90": pct(xs, 0.9), "days": len(xs)}
                for (g, hod), xs in sorted(series.items())]

    async def events_between(self, since, until, event_types, patient_ids):
        types, ids = set(event_types), set(patient_ids)
        return sorted((e for e in self.events if since <= e["time"] < until and e["event_type"] in types
                       and e["patient_id"] in ids), key=lambda e: e["time"])

    async def tap_stats(self, patient_ids, since, recent_since):
        out = []
        for pid in patient_ids:
            taps = [e for e in self.events if e["patient_id"] == pid and e["event_type"] == "tap"
                    and e["time"] >= since and (e.get("payload") or {}).get("latency_ms")]
            if not taps:
                continue
            recent = [e for e in taps if e["time"] >= recent_since]
            before = [e for e in taps if e["time"] < recent_since]
            med = lambda es: statistics.median(e["payload"]["latency_ms"] for e in es) if es else None   # noqa: E731
            out.append({"patient_id": pid, "recent_ms": med(recent), "usual_ms": med(before),
                        "mistaps": sum(bool(e["payload"].get("mistap")) for e in recent), "recent_taps": len(recent)})
        return out

    async def unsure_answers(self, patient_ids, since):
        return dict(Counter(e["patient_id"] for e in self.events
                            if e["event_type"] == "answer" and e["time"] >= since and e["patient_id"] in set(patient_ids)
                            and (e.get("payload") or {}).get("answer") == "unsure"))

    async def longest_quiet(self, patient_ids, start, end, kinds):
        out = {}
        for pid in patient_ids:
            times = sorted(e["time"] for e in self.events if e["patient_id"] == pid and e["event_type"] in kinds
                           and start <= e["time"] < end)
            if times:   # like heartbeat_agg: each interaction keeps the patient "live" for 5 minutes
                gaps = [(times[0] - start).total_seconds()] + [
                    max((b - a).total_seconds() - 300, 0) for a, b in zip(times, times[1:] + [end])]
                out[pid] = max(gaps)
        return out

    async def events_of_type(self, event_type, since, patient_id=None):
        return [e for e in self.events if e["event_type"] == event_type and e["time"] >= since
                and (patient_id is None or e["patient_id"] == patient_id)]

    async def list_hypotheses(self):
        return sorted((copy.deepcopy(h) for h in self.hypotheses.values()), key=lambda h: h["created_at"], reverse=True)

    async def upsert_hypothesis(self, hypothesis):
        self.hypotheses[hypothesis["id"]] = copy.deepcopy(hypothesis)

    async def list_inquiries(self):
        return sorted((dict(i) for i in self.inquiries.values()), key=lambda i: i["created_at"], reverse=True)

    async def upsert_inquiry(self, inquiry):
        self.inquiries[inquiry["id"]] = dict(inquiry)

    async def daily_confirmed_needs(self, patient_id, days):
        since = datetime.now(timezone.utc) - timedelta(days=days)
        mine = [r for r in self.rows if r["patient_id"] == patient_id and r["time"] > since]
        buckets: dict[tuple, int] = defaultdict(int)
        for r in mine:
            key = (r["time"].date(), r["confirmed_need"], r["confirmed_group"])
            buckets[key] += 1
        return [{"bucket": d, "confirmed_need": need, "confirmed_group": group, "n": n}
                for (d, need, group), n in sorted(buckets.items())]

    async def last_activity(self, patient_id):
        candidates = [{"time": e["time"], "kind": e["event_type"]} for e in self.events if e["patient_id"] == patient_id]
        candidates += [{"time": r["time"], "kind": "confirmation"} for r in self.rows if r["patient_id"] == patient_id]
        return max(candidates, key=lambda c: c["time"]) if candidates else None

    async def interaction_baseline(self, patient_id, days):
        since = datetime.now(timezone.utc) - timedelta(days=days)
        mine = [r for r in self.rows if r["patient_id"] == patient_id and r["time"] > since]
        if not mine:
            return {"avg_tap_interval": None, "stddev_tap_interval": None, "avg_taps": None, "n": 0}
        intervals = [r["mean_tap_interval"] for r in mine]
        return {
            "avg_tap_interval": statistics.mean(intervals),
            "stddev_tap_interval": statistics.pstdev(intervals) if len(intervals) > 1 else 0.0,
            "avg_taps": statistics.mean(r["taps"] for r in mine), "n": len(mine),
        }

    async def tigerdata_counts(self):
        latest = max((e["time"] for e in self.events), default=None)
        return {"events": len(self.events), "confirmations": len(self.rows), "belief_snapshots": len(self.beliefs),
                "decision_actions": len(self.decision_actions), "latest_event_time": latest.isoformat() if latest else None}

    async def tigerdata_hypertable_stats(self):
        return []  # no real hypertables without Tiger Data; the API reports this explicitly

    async def tigerdata_compression_stats(self):
        return [{"table": t, "available": False} for t in
                ("events", "confirmations", "belief_snapshots", "decision_actions")]

    async def recent_sessions(self, patient_id, limit=10):
        latest: dict[str, datetime] = {}
        for r in self.decision_actions:
            if r["patient_id"] != patient_id:
                continue
            if r["session_id"] not in latest or r["time"] > latest[r["session_id"]]:
                latest[r["session_id"]] = r["time"]
        ranked = sorted(latest.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        return [{"session_id": sid, "time": t} for sid, t in ranked]

    async def tap_baseline(self, patient_id, days=14):
        since = datetime.now(timezone.utc) - timedelta(days=days)
        xs = [r["mean_tap_interval"] for r in self.rows
              if r["patient_id"] == patient_id and r["time"] >= since and r["mean_tap_interval"] > 0]
        return statistics.median(xs) if len(xs) >= MIN_BASELINE_ROWS else None

    async def get_profile(self, patient_id):
        return self.profiles.get(patient_id)

    async def put_profile(self, profile):
        self.profiles[profile["patient_id"]] = profile

    async def list_suggestions(self):
        return sorted(self.suggestions.values(), key=lambda s: s["created_at"], reverse=True)

    async def upsert_suggestion(self, suggestion):
        self.suggestions[suggestion["id"]] = suggestion

    async def upsert_case(self, case):
        self.cases[case["id"]] = case

    async def get_case(self, case_id):
        return self.cases.get(case_id)
