"""Per-patient signals from the event stream and chart events, z-scored against the patient's own baseline.

Rows are binned by hour into sums and counts (like the core `patient_hourly_signals` aggregate), so any
24 h window is an exact difference of prefix sums. A window's value is None when it has too little data
to say anything; the engine reports such a signal as missing rather than treating it as normal.

Live sessions log tap latency and fatigue but have no mis-tap correction step, so `tap_inconsistency`
only exists where taps carry a `mistap` field (today: the synthetic cohort).
"""
import bisect
import math
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta

from ..config import settings
from .config import SIGNALS, RiskConfig

NIGHT_HOURS = frozenset((22, 23, 0, 1, 2, 3, 4, 5))   # 22:00-06:00 local
TOILET = frozenset(("urinate", "bowel", "soiled"))
DISCOMFORT = frozenset(("pain_head", "pain_chest", "pain_abdomen", "pain_back", "pain_limb", "pain_surgical",
                        "nausea"))
HOUR = timedelta(hours=1)
DAY = timedelta(days=1)
NEW_LOOKBACK = timedelta(days=7)    # a kind of discomfort is "new" if not reported in the 7 days before

FIELDS = ("rows", "night_requests", "night_toilet", "discomfort", "timed_taps", "log_sum", "log_sq",
          "checked_taps", "mistaps", "fatigue_n", "fatigue_sum", "fluid_n", "fluid_ml", "meal_n", "missed_meals")


@dataclass
class Feature:
    value: float | None
    baseline: float | None = None   # mean of the usable baseline windows
    scale: float | None = None      # spread the z is measured in (SD, floored)
    z: float | None = None
    n_baseline: int = 0


def floor_hour(t: datetime) -> datetime:
    return t.replace(minute=0, second=0, microsecond=0)


def is_night(t: datetime) -> bool:
    return t.astimezone(settings.unit_tz).hour in NIGHT_HOURS


class PatientSignals:
    def __init__(self, events: list[dict], chart: list[dict]):
        events = sorted(events, key=lambda e: e["time"])
        times = [r["time"] for r in events] + [c["time"] for c in chart]
        self.origin = floor_hour(min(times)) if times else None
        self.last = max(times) if times else None
        n = self._idx(self.last) + 1 if times else 0
        bins = {f: [0.0] * n for f in FIELDS}
        self.reports: dict[str, list[datetime]] = {}    # discomfort need -> request times
        started: dict[str, datetime] = {}

        for e in events:
            t, p, kind = e["time"], e["payload"] or {}, e["event_type"]
            h = self._idx(t)
            bins["rows"][h] += 1
            if kind == "session_started":
                started[e["session_id"]] = t
                bins["night_requests"][h] += is_night(t)
            elif kind == "tap":
                if p.get("latency_ms"):
                    x = math.log(max(p["latency_ms"], 50) / 1000)
                    bins["timed_taps"][h] += 1
                    bins["log_sum"][h] += x
                    bins["log_sq"][h] += x * x
                if "mistap" in p:
                    bins["checked_taps"][h] += 1
                    bins["mistaps"][h] += bool(p["mistap"])
            elif kind == "fatigue":
                bins["fatigue_n"][h] += 1
                bins["fatigue_sum"][h] += p["score"]
            elif kind == "nurse_confirmed" and p.get("need"):
                t0 = started.get(e["session_id"], t)   # count the request when it was made
                h0 = self._idx(t0)
                bins["night_toilet"][h0] += p["need"] in TOILET and is_night(t0)
                if p["need"] in DISCOMFORT:
                    bins["discomfort"][h0] += 1
                    self.reports.setdefault(p["need"], []).append(t0)
        for c in chart:
            h = self._idx(c["time"])
            bins["rows"][h] += 1
            if c["kind"] == "fluid" and c["value"] is not None:
                bins["fluid_n"][h] += 1
                bins["fluid_ml"][h] += c["value"]
            elif c["kind"] == "meal":
                bins["meal_n"][h] += 1
                bins["missed_meals"][h] += bool(c["payload"].get("missed"))

        for ts in self.reports.values():
            ts.sort()
        self.prefix = {}
        for f, vals in bins.items():
            acc, out = 0.0, [0.0]
            for v in vals:
                acc += v
                out.append(acc)
            self.prefix[f] = out
        self._cache: dict[tuple[datetime, datetime], dict] = {}

    def _idx(self, t: datetime) -> int:
        return int((t - self.origin) // HOUR)

    def _sum(self, f: str, start: datetime, end: datetime) -> float:
        p = self.prefix[f]
        i = min(max(self._idx(start), 0), len(p) - 1)
        j = min(max(self._idx(end), 0), len(p) - 1)
        return p[j] - p[i] if j > i else 0.0

    def _new_discomfort(self, start: datetime, end: datetime) -> int:
        n = 0
        for ts in self.reports.values():
            lo, hi = bisect.bisect_left(ts, start), bisect.bisect_left(ts, end)
            if hi > lo and bisect.bisect_left(ts, start - NEW_LOOKBACK) == lo:
                n += hi - lo
        return n

    def window(self, start: datetime, end: datetime) -> dict[str, float | None]:
        """Signal values for [start, end), both on hour boundaries."""
        if (start, end) in self._cache:
            return self._cache[start, end]
        if self.origin is None or self._sum("rows", start, end) == 0:
            out = {k: None for k in SIGNALS}
        else:
            s = lambda f: self._sum(f, start, end)
            n, checked = s("timed_taps"), s("checked_taps")
            mean_log = s("log_sum") / n if n else 0.0
            out = {
                "night_toilet": s("night_toilet"),
                "night_requests": s("night_requests"),
                "discomfort": s("discomfort"),
                "new_discomfort": self._new_discomfort(start, end),
                "tap_latency": math.exp(mean_log) if n >= 3 else None,
                "tap_variability": math.sqrt(max(s("log_sq") / n - mean_log ** 2, 0.0)) if n >= 3 else None,
                "tap_inconsistency": s("mistaps") / checked if checked >= 5 else None,
                "fatigue": s("fatigue_sum") / s("fatigue_n") if s("fatigue_n") else None,
                "fluid_intake": s("fluid_ml") if s("fluid_n") >= 3 else None,
                "missed_meals": s("missed_meals") if s("meal_n") >= 2 else None,
            }
        self._cache[start, end] = out
        return out

    def features(self, t: datetime, cfg: RiskConfig) -> dict[str, Feature]:
        """Each signal over the 24 h before t, against the 7 windows before that."""
        t = floor_hour(t)
        w = timedelta(hours=cfg.window_hours)
        recent = self.window(t - w, t)
        base = [self.window(t - w - k * DAY, t - k * DAY) for k in range(1, cfg.baseline_days + 1)]
        out = {}
        for key, sig in SIGNALS.items():
            vals = [b[key] for b in base if b[key] is not None]
            value = recent[key]
            if value is None or len(vals) < cfg.min_baseline_days:
                out[key] = Feature(value, statistics.mean(vals) if vals else None, None, None, len(vals))
                continue
            mean = statistics.mean(vals)
            scale = max(statistics.pstdev(vals), 0.1 * abs(mean), sig.min_scale)
            out[key] = Feature(value, mean, scale, (value - mean) / scale, len(vals))
        return out
