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
