"""Unit insights and Care forecast: the two nurse views inside the nurse station, one for the past, one ahead.

Overview
========
Both views show the 6 unit patients (``data/patients.py``), whose full history lives in Tiger Data (seeded
confirmations, plus taps, chart events and risk scores from ``data/unit_history.py``). Nothing here decides
or delays an alert: these are planning views.

Unit insights: what HAS happened (24 h / 7 days / 14 days, no predictions)
-------------------------------------------------------------------------
1. Heatmap: requests per patient per hour (24 h) or local day (7/14 d), urgent ones marked, empty buckets
   kept. ``time_bucket_gapfill`` over the ``patient_hourly_needs`` continuous aggregate.
2. Timeline: request, urgent alert, family consult and communication changes per patient, last 12/24 h.
   Range scan on the ``events`` hypertable.
3. Requests by type per local day, with chart-event markers (medication and care changes).
   ``patient_hourly_needs`` re-bucketed into local days, plus the ``chart_events`` hypertable.
4. Communication gauges: seconds per tap in the last 24 h vs the patient's own previous week (Toolkit
   ``percentile_agg``), corrected taps and "not sure" answers, longest quiet stretch while awake (Toolkit
   ``heartbeat_agg`` / ``dead_ranges``). Green / amber / red, always with the number and words.

Care forecast: what is LIKELY to happen next (only a faint lead-in of the past)
-----------------------------------------------------------------------------
1. Next 12 hours per patient: expected requests per hour by need type, with a 10th-90th percentile band.
   Base = the patient's own history at the same hour of day over up to 14 days (gapfilled hourly counts,
   Toolkit ``percentile_agg``). Gemini may adjust each need type with a fixed label
   (lower 0.7 / same 1.0 / higher 1.3 / much higher 1.6) and a reason that must quote one of the facts it
   was given, exactly like profile items (engine/profile.py): unknown patients, types or labels, and
   reasons that don't quote a fact, are dropped. One batched request for the unit, cached 30 minutes,
   fetched in the background; until then (or with Gemini off / out of quota) the base forecast is shown
   as "Based on past patterns only".
2. Risk trajectory: the risk engine's fall / dehydration / delirium-infection scores (``risk_scores_6h``)
   for the last 72 h, projected 24 h ahead with Holt's linear exponential smoothing and a widening band.
   Display only: the projection never changes the risk engine's levels or flags.
3. Unit busy hours ahead: the sum of every patient's expected requests per hour.
4. "Why" cards: each patient's top 3 expected needs in the next 4 hours, with Gemini's reason or
   "Usually asks for this around now".
5. Forecast check: yesterday's base forecast (history up to 24 h ago) against what actually happened.
6. Early flags: when the risk engine first raised each concern for these patients (amber / red) and the
   signals behind it, from their own ``risk_scores`` rows.

Both pages lead with plain-language bullet points; every chart sits behind a "See chart" toggle.
"""
import asyncio
import logging
import math
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from ..catalog import Catalog
from ..config import settings
from ..data.patients import PATIENT_BY_ID, PATIENTS, PERSON_BY_ID
from ..engine.ladder import LEVELS
from .gemini import Gemini

log = logging.getLogger(__name__)

UNIT = [p["id"] for p in PATIENTS]
INTERACTIONS = ("tap", "answer", "silence_check_answered")   # things only the patient does (as silence_monitor)
TIMELINE = {"nurse_confirmed": "request", "escalated": "urgent", "unresponsive_escalated": "urgent",
            "consult_requested": "consult", "level_changed": "change", "mode_changed": "change"}
RANGES = {"24h": (1, "1 hour"), "7d": (7, "1 day"), "14d": (14, "1 day")}
WAKING_FROM = 7    # local hour the "longest quiet stretch" window starts
WAKING_TO = 22
HISTORY_DAYS = 14
FORECAST_HOURS = 12
LEAD_IN_HOURS = 6
WHY_HOURS = 4
CACHE_S = 30 * 60
MULTIPLIER = {"lower": 0.7, "same": 1.0, "higher": 1.3, "much_higher": 1.6}
RISK_STEP = timedelta(hours=6)   # risk_scores_6h bucket
RISK_HISTORY_H = 72
RISK_AHEAD_STEPS = 4             # 24 h


def _tz() -> str:
    return settings.unit_tz.key


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _floor_hour(t: datetime) -> datetime:
    return t.replace(minute=0, second=0, microsecond=0)


def _local_midnight(t: datetime) -> datetime:
    local = t.astimezone(settings.unit_tz)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat()


def _level(value: float | None, amber: float, red: float) -> str:
    if value is None:
        return "unknown"
    return "red" if value >= red else "amber" if value >= amber else "green"


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().replace("→", "->")).strip(" .,;:!\"'")


class NurseViews:
    def __init__(self, cat: Catalog, store, risk_store, gemini: Gemini, profiles=None):
        self.cat, self.store, self.risk_store, self.gemini, self.profiles = cat, store, risk_store, gemini, profiles
        self.groups = {g["id"]: g["label"] for g in cat.raw["groups"]}
        self._adjust: dict | None = None          # {"at", "items": {(pid, group): {...}}}
        self._adjust_task: asyncio.Task | None = None

    @staticmethod
    def _patient(pid: str) -> dict:
        p = PATIENT_BY_ID[pid]
        return {"patient_id": pid, "name": p["name"], "room": p["room"]}

    def _need_label(self, nid: str | None) -> str:
        return self.cat.by_id[nid]["label"] if nid in self.cat.by_id else (nid or "Request")

    # ======================================================================================================
    # Nurse station board: each patient's state RIGHT NOW (no trends: those are Unit insights)
    # ======================================================================================================

    async def board(self, svc, silence) -> list[dict]:
        """One row per unit patient, most pressing first: an open urgent request, a check-in waiting on a nurse,
        a routine request waiting, the patient answering on the tablet now, family being asked, or calm with
        the time of their last request."""
        now = _now()
        ladders = {}
        if silence:
            for lad in silence.ladders_view(None, None, True):
                ladders.setdefault(lad["patient_id"], lad)
        latest = {}
        for s in svc.sessions.values():
            pid = s.patient["id"]
            if pid not in latest or s.started > latest[pid].started:
                latest[pid] = s
        rank = {"urgent": 0, "checkin": 1, "waiting": 2, "answering": 3, "consult": 4, "calm": 5}
        rows = []
        for pid in UNIT:
            open_alerts = sorted((a for a in svc.alerts.values() if a["patient_id"] == pid and a["status"] == "open"),
                                 key=lambda a: (a["priority"] != "urgent", a["created_at"]))
            s = latest.get(pid)
            level = s.ladder.level if s else None
            level_label = LEVELS[level] if s and level and level > 1 else None   # only when the screen is simpler
            if open_alerts:
                a = open_alerts[0]
                state = "urgent" if a["priority"] == "urgent" else "waiting"
                what = a.get("label") or (a["top"][0]["label"] if a.get("top") else "Request")
                headline, since = f"{'Urgent request' if state == 'urgent' else 'Waiting'}: {what}", a["created_at"]
            elif pid in ladders:
                state, headline, since = "checkin", "Check-in: hasn't tapped for a while", ladders[pid]["started_at"]
            elif s and s.status in ("area", "feeling", "question"):
                state, headline, since = "answering", "Answering on the tablet now", _iso(datetime.fromtimestamp(s.started, timezone.utc))
            elif s and s.status == "waiting_consult" and s.consult_id in svc.consults:
                c = svc.consults[s.consult_id]
                state, headline, since = "consult", f"Asking {c['person_name']} ({c['relation']})", c["created_at"]
            else:
                rows_ = await self.store.confirmations(now - timedelta(hours=48), pid)
                last = max(rows_, key=lambda r: r["time"], default=None)
                state = "calm"
                if last:
                    headline, since = f"Last asked: {self._need_label(last['confirmed_need']).lower()}", _iso(last["time"])
                else:
                    headline, since = "No requests in the last 2 days", None
            rows.append(self._patient(pid) | {"state": state, "headline": headline, "since": since,
                                              "open_requests": len(open_alerts), "screen": level_label})
        return sorted(rows, key=lambda r: rank[r["state"]])

    # ======================================================================================================
    # Unit insights
    # ======================================================================================================

    async def insights(self, range_: str = "24h", timeline_hours: int = 12) -> dict:
        days, bucket = RANGES.get(range_, RANGES["24h"])
        now = _now()
        if bucket == "1 hour":
            until = _floor_hour(now) + timedelta(hours=1)
            since = until - timedelta(hours=24)
        else:
            until = _local_midnight(now) + timedelta(days=1)
            since = until - timedelta(days=days)
        heat, timeline, needs, gauges = await asyncio.gather(
            self._heatmap(since, until, bucket), self._timeline(now, timeline_hours),
            self._needs_by_type(max(days, 7), now), self._gauges(now))
        return {"range": range_ if range_ in RANGES else "24h", "bucket": bucket, "since": _iso(since),
                "until": _iso(until), "generated_at": _iso(now), "heatmap": heat, "timeline": timeline,
                "needs_by_type": needs, "gauges": gauges}

    async def _heatmap(self, since: datetime, until: datetime, bucket: str) -> dict:
        rows = await self.store.requests_by_bucket(since, until, bucket, UNIT, _tz())
        by_patient = defaultdict(dict)
        for r in rows:
            by_patient[r["patient_id"]][r["bucket"]] = r
        step = timedelta(hours=1) if bucket == "1 hour" else timedelta(days=1)
        starts, t = [], since
        while t < until:
            starts.append(t)
            t = (t.astimezone(settings.unit_tz) + step).astimezone(timezone.utc) if bucket == "1 day" else t + step
        out = []
        for pid in UNIT:
            cells = []
            for s in starts:
                r = by_patient[pid].get(s) or next((v for k, v in by_patient[pid].items() if abs((k - s).total_seconds()) < 1), None)
                cells.append({"start": _iso(s), "requests": r["requests"] if r else 0, "urgent": r["urgent"] if r else 0})
            out.append(self._patient(pid) | {"cells": cells, "total": sum(c["requests"] for c in cells)})
        peak = max((c["requests"] for p in out for c in p["cells"]), default=0)
        return {"columns": [_iso(s) for s in starts], "patients": out, "max": peak}

    async def cell(self, patient_id: str, start: datetime, bucket: str) -> dict:
        """What happened in one heatmap cell."""
        end = start + (timedelta(days=1) if bucket == "1 day" else timedelta(hours=1))
        rows = [r for r in await self.store.confirmations(start, patient_id) if r["time"] < end]
        return self._patient(patient_id) | {"start": _iso(start), "end": _iso(end), "items": [
            {"time": _iso(r["time"]), "label": self._need_label(r["confirmed_need"]), "urgent": bool(r["escalated"]),
             "group": self.groups.get(r["confirmed_group"], r["confirmed_group"])}
            for r in sorted(rows, key=lambda r: r["time"])]}

    def _timeline_label(self, e: dict) -> str:
        p, kind = e.get("payload") or {}, e["event_type"]
        if kind == "nurse_confirmed":
            return f"{self._need_label(p.get('need'))} · confirmed"
        if kind == "escalated":
            need = p.get("need") or ((p.get("top") or [{}])[0].get("need"))
            return f"Urgent alert: {self._need_label(need)}"
        if kind == "unresponsive_escalated":
            return "Stopped responding mid-request · nurse alerted"
        if kind == "consult_requested":
            person = PERSON_BY_ID.get(p.get("person"), {})
            return f"Asked {person.get('name', 'a family member')}"
        if kind == "level_changed":
            return f"Screen changed to {p.get('to_label', 'a different level')}"
        if kind == "mode_changed":
            return {"large": "Switched to larger buttons", "scan": "Switched to scanning",
                    "grid": "Switched to standard buttons"}.get(p.get("to"), "Input changed")
        return kind

    async def _timeline(self, now: datetime, hours: int) -> dict:
        hours = 24 if hours >= 24 else 12
        since = now - timedelta(hours=hours)
        events = await self.store.events_between(since, now, list(TIMELINE), UNIT)
        lanes = {pid: [] for pid in UNIT}
        for e in events:
            lanes[e["patient_id"]].append({"time": _iso(e["time"]), "kind": TIMELINE[e["event_type"]],
                                           "label": self._timeline_label(e)})
        return {"hours": hours, "since": _iso(since), "until": _iso(now),
                "patients": [self._patient(pid) | {"items": lanes[pid]} for pid in UNIT]}

    async def _needs_by_type(self, days: int, now: datetime) -> dict:
        until = _local_midnight(now) + timedelta(days=1)
        since = until - timedelta(days=days)
        rows = await self.store.needs_by_day(since, until, UNIT, _tz())
        by_day = defaultdict(Counter)
        by_day_patient = defaultdict(Counter)
        for r in rows:
            day = r["day"].astimezone(settings.unit_tz).date().isoformat()
            by_day[day][r["confirmed_group"]] += r["n"]
            by_day_patient[(day, r["patient_id"])][r["confirmed_group"]] += r["n"]
        day_list = [(since + timedelta(days=i)).astimezone(settings.unit_tz).date().isoformat() for i in range(days)]
        markers = []
        if self.risk_store:
            for pid in UNIT:
                for c in await self.risk_store.chart_events(pid, since):
                    label = (c.get("payload") or {}).get("label")
                    if c["kind"] in ("med_change", "care_event") and label:
                        markers.append(self._patient(pid) | {"time": _iso(c["time"]), "label": label, "kind": c["kind"],
                                                             "day": c["time"].astimezone(settings.unit_tz).date().isoformat()})
        return {
            "groups": [{"id": g, "label": label} for g, label in self.groups.items()],
            "days": [{"day": d, "counts": {g: by_day[d].get(g, 0) for g in self.groups},
                      "by_patient": {pid: dict(by_day_patient[(d, pid)]) for pid in UNIT if by_day_patient[(d, pid)]}}
                     for d in day_list],
            "markers": sorted(markers, key=lambda m: m["time"]),
        }

    async def _gauges(self, now: datetime) -> list[dict]:
        recent = now - timedelta(hours=24)
        taps = {r["patient_id"]: r for r in await self.store.tap_stats(UNIT, now - timedelta(days=8), recent)}
        unsure = await self.store.unsure_answers(UNIT, recent)
        local = now.astimezone(settings.unit_tz)
        start = local.replace(hour=WAKING_FROM, minute=0, second=0, microsecond=0)
        if local.hour < WAKING_FROM:   # before 7 am: yesterday's waking hours
            start -= timedelta(days=1)
        end = min(local, start.replace(hour=WAKING_TO))
        start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
        quiet = await self.store.longest_quiet(UNIT, start, end, INTERACTIONS) if end > start else {}
        # The patient's own usual: median of their longest quiet stretch over the same hours on the last 7 days.
        usual_quiet: dict[str, list[float]] = defaultdict(list)
        if end > start:
            for k in range(1, 8):
                day_start, day_end = start - timedelta(days=k), end - timedelta(days=k)
                for pid, s in (await self.store.longest_quiet(UNIT, day_start, day_end, INTERACTIONS)).items():
                    usual_quiet[pid].append(s)
        out = []
        for pid in UNIT:
            t = taps.get(pid) or {}
            ratio = (t["recent_ms"] / t["usual_ms"]) if t.get("recent_ms") and t.get("usual_ms") else None
            corrected = (t.get("mistaps") or 0) + unsure.get(pid, 0)
            quiet_s = quiet.get(pid, (end - start).total_seconds() if end > start else None)
            days = sorted(usual_quiet.get(pid, []))
            usual_s = days[len(days) // 2] if len(days) >= 3 else None
            quiet_ratio = quiet_s / usual_s if quiet_s is not None and usual_s else None
            speed_level = _level(ratio, 1.25, 1.6)
            out.append(self._patient(pid) | {
                "tap_speed": {"ratio": round(ratio, 2) if ratio else None,
                              "recent_s": round(t["recent_ms"] / 1000, 1) if t.get("recent_ms") else None,
                              "usual_s": round(t["usual_ms"] / 1000, 1) if t.get("usual_ms") else None,
                              "level": speed_level,
                              "words": {"green": "About their usual", "amber": "Slower than usual",
                                        "red": "Much slower than usual"}.get(speed_level, "Not enough taps yet")},
                "corrections": {"count": corrected, "level": _level(corrected, 2, 4),
                                "words": "Taps they had to fix or answered “not sure”, last 24 h"},
                "quiet": {"seconds": round(quiet_s) if quiet_s is not None else None,
                          "usual_seconds": round(usual_s) if usual_s else None,
                          "level": _level(quiet_ratio, 1.5, 2.0) if quiet_ratio else "unknown",
                          "since": _iso(start),
                          "words": f"Longest quiet stretch since {WAKING_FROM} am" if end > start else "Overnight"},
            })
        return out

    # ======================================================================================================
    # Care forecast
    # ======================================================================================================

    async def _base(self, pid: str, until: datetime, hours: list[datetime], requests: list[dict]) -> dict:
        """Hour-of-day profile from the patient's own history before `until`, applied to `hours`."""
        first = min((r["time"] for r in requests if r["time"] < until), default=None)
        if first is None:
            return {"hours": [], "enough": False, "days": 0}
        since = max(until - timedelta(days=HISTORY_DAYS), _local_midnight(first))
        rows = await self.store.hour_of_day_profile(pid, since, until, _tz())
        prof = {(r["confirmed_group"], r["hod"]): r for r in rows}
        days = max((r["days"] for r in rows), default=0)
        out = []
        for h in hours:
            hod = h.astimezone(settings.unit_tz).hour
            by_group = {g: float(prof.get((g, hod), {}).get("mean") or 0.0) for g in self.groups}
            total = prof.get(("_total", hod), {})
            out.append({"start": _iso(h), "by_group": by_group, "expected": sum(by_group.values()),
                        "low": float(total.get("p10") or 0.0), "high": float(total.get("p90") or 0.0)})
        return {"hours": out, "enough": days >= 3, "days": days}

    async def _facts(self, pid: str, base: dict, requests: list[dict], risk: list[dict], now: datetime) -> list[str]:
        """Plain sentences Gemini may cite; an adjustment's evidence must quote one of them."""
        p = PATIENT_BY_ID[pid]
        facts = [f"{p['diagnosis']}"]
        facts += [f"Chart: {v['value']}" for v in p["chart"].values() if v["flag"]]
        if self.risk_store:
            for c in await self.risk_store.chart_events(pid, now - timedelta(hours=48)):
                label = (c.get("payload") or {}).get("label")
                if label:
                    facts.append(f"Chart change: {label}")
        if self.profiles:
            facts += [f"Profile: {i['effect']}" for i in self.profiles.public(pid)["items"]]
        recent = Counter(self._need_label(r["confirmed_need"]) for r in requests if r["time"] >= now - timedelta(hours=24))
        facts += [f"Last 24 h: {label} ×{n}" for label, n in recent.most_common(5)]
        facts += [f"Risk: {r['label']} is {r['level']} ({r['caption'].lower()})" for r in risk if r["level"] != "green"]
        return facts

    def _validate(self, raw: list[dict], facts: dict[str, list[str]]) -> dict:
        out = {}
        by_name = {k.lower(): k for k in self.groups} | {v.lower(): k for k, v in self.groups.items()}
        for a in raw:
            pid, label = a.get("patient_id"), (a.get("label") or "").replace(" ", "_")
            group = by_name.get((a.get("group") or "").strip().lower())   # the id, or its display name
            evidence, reason = (a.get("evidence") or "").strip(), (a.get("reason") or "").strip()
            if pid not in facts or group not in self.groups or label not in MULTIPLIER or not reason:
                continue
            if len(_norm(evidence)) < 3 or not any(_norm(evidence) in _norm(f) for f in facts[pid]):
                continue   # a reason that doesn't quote a fact it was given is dropped
            out[(pid, group)] = {"label": label, "multiplier": MULTIPLIER[label], "reason": reason, "evidence": evidence}
        return out

    async def _refresh_adjustments(self, payload: list[dict], facts: dict[str, list[str]]):
        try:
            raw = await self.gemini.forecast_adjustments(payload, list(self.groups.items()))
            if raw is not None:
                self._adjust = {"at": time.time(), "items": self._validate(raw, facts)}
        except Exception:
            log.exception("forecast adjustment failed; base forecast stays")

    def _adjustments(self, payload: list[dict], facts: dict[str, list[str]]) -> tuple[dict, str]:
        fresh = self._adjust and time.time() - self._adjust["at"] < CACHE_S
        if not fresh and self.gemini.enabled and self.gemini.paused_for == 0 and not (
                self._adjust_task and not self._adjust_task.done()):
            self._adjust_task = asyncio.create_task(self._refresh_adjustments(payload, facts))
        if self._adjust and fresh:
            return self._adjust["items"], "gemini"
        pending = bool(self._adjust_task and not self._adjust_task.done())
        return {}, "pending" if pending else "base"

    async def _risk(self, pid: str, now: datetime) -> list[dict]:
        if not self.risk_store:
            return []
        from ..risk.config import DEFAULT
        rows = [r for r in await self.risk_store.trend(pid) if r["bucket"] >= now - timedelta(hours=RISK_HISTORY_H)]
        out = []
        for risk, model in DEFAULT.models.items():
            series = sorted((r for r in rows if r["risk"] == risk), key=lambda r: r["bucket"])
            if len(series) < 3:
                continue
            ys = [r["mean_score"] for r in series]
            proj = holt(ys, RISK_AHEAD_STEPS)
            last = series[-1]["bucket"]
            points = [{"start": _iso(r["bucket"]), "score": round(r["mean_score"], 3)} for r in series]
            ahead = [{"start": _iso(last + RISK_STEP * (k + 1)), "score": round(v, 3), "low": round(lo, 3),
                      "high": round(hi, 3)} for k, (v, lo, hi) in enumerate(proj)]
            current = ys[-1]
            level = "red" if current >= model.elevated else "amber" if current >= model.watch else "green"
            caption = "Holding steady"
            if level == "red":
                caption = "Already in the red range"
            else:
                target, name = (model.elevated, "red") if level == "amber" else (model.watch, "amber")
                hit = next((k for k, (v, _, _) in enumerate(proj) if v >= target), None)
                if hit is not None:
                    caption = f"May reach {name} in about {(hit + 1) * 6} hours"
                elif proj and proj[-1][0] > current + 0.05:
                    caption = "Rising slowly"
                elif proj and proj[-1][0] < current - 0.05:
                    caption = "Easing"
            out.append({"risk": risk, "label": model.label, "amber": model.watch, "red": model.elevated,
                        "level": level, "caption": caption, "history": points, "ahead": ahead})
        return out

    async def _flags(self, pid: str) -> list[dict]:
        """When the risk engine first noticed each concern for this patient, and the signals behind it."""
        if not self.risk_store:
            return []
        from ..risk.config import DEFAULT
        out = []
        for r in await self.risk_store.flags(pid):
            contributors = sorted((c for c in (r.get("contributors") or []) if c.get("contribution")),
                                  key=lambda c: -c["contribution"])
            out.append({"time": _iso(r["time"]), "risk": r["risk"], "label": DEFAULT.models[r["risk"]].label,
                        "level": {"watch": "amber", "elevated": "red"}.get(r["flag"], r["flag"]),
                        "why": [f"{c['label']}: {c['text']}" for c in contributors[:2]]})
        return sorted(out, key=lambda f: f["time"])

    async def forecast(self) -> dict:
        now = _now()
        start = _floor_hour(now) + timedelta(hours=1)
        hours = [start + timedelta(hours=k) for k in range(FORECAST_HOURS)]
        since = now - timedelta(days=HISTORY_DAYS + 1)
        lead = await self.store.requests_by_bucket(_floor_hour(now) - timedelta(hours=LEAD_IN_HOURS - 1),
                                                   _floor_hour(now) + timedelta(hours=1), "1 hour", UNIT, _tz())
        lead_by = defaultdict(list)
        for r in lead:
            lead_by[r["patient_id"]].append({"start": _iso(r["bucket"]), "requests": r["requests"]})

        patients, payload, facts = [], [], {}
        for pid in UNIT:
            requests = await self.store.confirmations(since, pid)
            base = await self._base(pid, start, hours, requests)
            risk = await self._risk(pid, now)
            facts[pid] = await self._facts(pid, base, requests, risk, now)
            payload.append({"patient_id": pid, "facts": facts[pid],
                            "expected_next_12h": {self.groups[g]: round(sum(h["by_group"][g] for h in base["hours"]), 1)
                                                  for g in self.groups} if base["hours"] else {}})
            patients.append({"pid": pid, "base": base, "risk": risk, "requests": requests})

        adjust, source = self._adjustments(payload, facts)
        out_patients, unit = [], [0.0] * FORECAST_HOURS
        for p in patients:
            pid, base = p["pid"], p["base"]
            series = []
            for i, h in enumerate(base["hours"]):
                by_group = {g: round(v * adjust.get((pid, g), {}).get("multiplier", 1.0), 3)
                            for g, v in h["by_group"].items()}
                expected = sum(by_group.values())
                scale = expected / h["expected"] if h["expected"] else 1.0
                series.append({"start": h["start"], "by_group": by_group, "expected": round(expected, 3),
                               "low": round(h["low"] * scale, 3), "high": round(max(h["high"] * scale, expected), 3)})
                unit[i] += expected
            out_patients.append(self._patient(pid) | {
                "enough_history": base["enough"], "history_days": base["days"], "lead_in": lead_by.get(pid, []),
                "hours": series, "risk": p["risk"], "flags": await self._flags(pid),
                "why": self._why(pid, p["requests"], adjust, start),
                "adjustments": [{"group": g, "group_label": self.groups[g], **a}
                                for (apid, g), a in adjust.items() if apid == pid and a["label"] != "same"]})
        return {
            "generated_at": _iso(now), "source": source, "hours": [_iso(h) for h in hours],
            "groups": [{"id": g, "label": label} for g, label in self.groups.items()],
            "patients": out_patients,
            "unit": [{"start": _iso(h), "expected": round(v, 2)} for h, v in zip(hours, unit)],
            "check": await self._check(now),
            "notice": "Forecasts are estimates for planning, not diagnoses. Urgent signals always alert immediately.",
        }

    def _why(self, pid: str, requests: list[dict], adjust: dict, start: datetime) -> list[dict]:
        """Top 3 needs expected in the next WHY_HOURS hours, from the patient's own history at those hours."""
        if not requests:
            return []
        hods = {(start + timedelta(hours=k)).astimezone(settings.unit_tz).hour for k in range(WHY_HOURS)}
        first = min(r["time"] for r in requests)
        days = max((start - _local_midnight(first)).days, 1)
        counts = Counter(r["confirmed_need"] for r in requests
                         if r["time"].astimezone(settings.unit_tz).hour in hods and r["confirmed_need"] in self.cat.by_id)
        scored = []
        for need, n in counts.items():
            group = self.cat.by_id[need]["group"]
            a = adjust.get((pid, group))
            scored.append({"need": need, "label": self._need_label(need), "group": group,
                           "expected": round(n / days * (a["multiplier"] if a else 1.0), 2),
                           "reason": a["reason"] if a and a["label"] != "same" else "Usually asks for this around now",
                           "source": "gemini" if a and a["label"] != "same" else "pattern"})
        return sorted(scored, key=lambda s: -s["expected"])[:3]

    async def _check(self, now: datetime) -> dict:
        """Yesterday's base forecast (history up to 24 h ago) vs what happened, unit total per hour."""
        end = _floor_hour(now)
        start = end - timedelta(hours=24)
        hours = [start + timedelta(hours=k) for k in range(24)]
        expected = [0.0] * 24
        since = now - timedelta(days=HISTORY_DAYS + 2)
        for pid in UNIT:
            base = await self._base(pid, start, hours, await self.store.confirmations(since, pid))
            for i, h in enumerate(base["hours"]):
                expected[i] += h["expected"]
        actual_rows = await self.store.requests_by_bucket(start, end, "1 hour", UNIT, _tz())
        actual = defaultdict(int)
        for r in actual_rows:
            actual[r["bucket"].astimezone(timezone.utc).replace(tzinfo=timezone.utc)] += r["requests"]
        points = [{"start": _iso(h), "expected": round(e, 2), "actual": actual.get(h, 0)} for h, e in zip(hours, expected)]
        total_e, total_a = sum(p["expected"] for p in points), sum(p["actual"] for p in points)
        return {"points": points, "expected_total": round(total_e, 1), "actual_total": total_a}


def holt(ys: list[float], steps: int, alpha: float = 0.5, beta: float = 0.3) -> list[tuple[float, float, float]]:
    """Holt's linear exponential smoothing: (forecast, low, high) for each step ahead, clipped to [0, 1].
    The band is ±1.28 × the in-sample one-step error SD × sqrt(step) (an ~80% band)."""
    level, trend = ys[0], ys[1] - ys[0]
    errors = []
    for y in ys[1:]:
        errors.append(y - (level + trend))
        new_level = alpha * y + (1 - alpha) * (level + trend)
        trend = beta * (new_level - level) + (1 - beta) * trend
        level = new_level
    sd = math.sqrt(sum(e * e for e in errors) / len(errors)) if errors else 0.0
    out = []
    for k in range(1, steps + 1):
        v = level + k * trend
        w = 1.28 * sd * math.sqrt(k)
        out.append((min(max(v, 0.0), 1.0), min(max(v - w, 0.0), 1.0), min(max(v + w, 0.0), 1.0)))
    return out
