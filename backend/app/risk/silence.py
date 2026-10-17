"""Silence detection as pure state machines. No I/O, no clock: callers pass `now` and apply the effects.

Mode A, mid-dialogue timeout. A patient who has started a request (status `feeling` or `question`)
and then stops responding is escalated at once with the current belief. The timeout is
max(30 s, 4 x the patient's recent median tap latency x a fatigue factor), capped so it never grows
without bound.

Mode B, abnormal inactivity. Time since the patient's last interaction is compared with how long it
usually has been at this clock time on each of the previous 7 days. No ladder starts in quiet hours.
If abnormal, an escalation ladder runs:

    tablet check  --timeout-->  trusted contact  --timeout-->  nurse alert  --timeout--> reminder, repeat

Every step has a deadline, needs an explicit acknowledgement from a human to close, and writes audit
rows. Nothing auto-cancels a ladder: patient activity, a late tablet response or a contact saying
"they're fine" after the nurse was alerted never closes it. Only these close it:
  * the patient answers the tablet check before its deadline
  * the trusted contact acknowledges "ok" while theirs is the current step
  * a nurse acknowledges, at any step
A contact who reports a concern escalates to the nurse immediately.
"""
import bisect
import math
import statistics
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, tzinfo

MID_DIALOGUE = frozenset(("feeling", "question"))   # waiting on the patient after their first input
MODE_A_LABEL = "Patient stopped responding mid-request"
STEPS = ("tablet", "contact", "nurse")
ALLOWED = {"tablet": {"patient", "nurse"}, "contact": {"contact", "nurse"}, "nurse": {"nurse"}}
EFFECT_OF = {"tablet": "tablet_check", "contact": "message_contact", "nurse": "nurse_alert"}


@dataclass(frozen=True)
class SilenceConfig:
    # Mode A
    mid_floor_s: float = 30.0
    mid_latency_multiple: float = 4.0
    mid_max_fatigue_factor: float = 1.5
    mid_cap_s: float = 180.0
    mid_recent_taps: int = 20
    # Mode B
    quiet_start_hour: int = 22          # local; no new ladder starts from here ...
    quiet_end_hour: int = 7             # ... until here
    baseline_days: int = 7
    min_baseline_days: int = 4
    gap_quantile: float = 0.9
    gap_multiple: float = 1.5
    min_gap_s: float = 2 * 3600
    fallback_gap_s: float = 4 * 3600    # threshold while there is too little history
    rearm_s: float = 2 * 3600           # after a ladder closes, wait this long (or for a new interaction)
    # ladder timers
    tablet_timeout_s: float = 90
    contact_timeout_s: float = 600
    nurse_reminder_s: float = 300


# ---- Mode A ---------------------------------------------------------------------------------------

def mid_dialogue_timeout(latencies_ms: list[float], fatigue: float, cfg: SilenceConfig) -> float:
    recent = latencies_ms[-cfg.mid_recent_taps:]
    median_s = statistics.median(recent) / 1000 if recent else 0.0
    factor = min(max(fatigue, 1.0), cfg.mid_max_fatigue_factor)
    return min(max(cfg.mid_floor_s, cfg.mid_latency_multiple * median_s * factor), cfg.mid_cap_s)


def mid_dialogue_stalled(status: str, idle_s: float, timeout_s: float) -> bool:
    return status in MID_DIALOGUE and idle_s >= timeout_s


# ---- Mode B ---------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Inactivity:
    abnormal: bool
    gap_s: float
    threshold_s: float
    usual_s: tuple[float, ...]      # time since last interaction at this clock time, one per past day
    quiet: bool
    reason: str


def in_quiet_hours(t: datetime, tz: tzinfo, cfg: SilenceConfig) -> bool:
    h = t.astimezone(tz).hour
    if cfg.quiet_start_hour <= cfg.quiet_end_hour:
        return cfg.quiet_start_hour <= h < cfg.quiet_end_hour
    return h >= cfg.quiet_start_hour or h < cfg.quiet_end_hour


def usual_gaps(interactions: list[datetime], now: datetime, cfg: SilenceConfig) -> list[float]:
    """For each of the past days: seconds since the last interaction at this same clock time."""
    out = []
    for k in range(1, cfg.baseline_days + 1):
        at = now - timedelta(days=k)
        i = bisect.bisect_right(interactions, at)
        if i:
            out.append((at - interactions[i - 1]).total_seconds())
    return out


def _quantile(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[max(math.ceil(q * len(s)) - 1, 0)]


def _hm(seconds: float) -> str:
    m = int(seconds // 60)
    return f"{m // 60} h {m % 60:02d} min" if m >= 60 else f"{m} min"


def assess_inactivity(interactions: list[datetime], now: datetime, tz: tzinfo, cfg: SilenceConfig,
                      monitoring_since: datetime) -> Inactivity:
    interactions = sorted(t for t in interactions if t <= now)
    last = interactions[-1] if interactions else monitoring_since
    gap = (now - last).total_seconds()
    usual = usual_gaps(interactions, now, cfg)
    if len(usual) >= cfg.min_baseline_days:
        q = _quantile(usual, cfg.gap_quantile)
        threshold = max(cfg.min_gap_s, cfg.gap_multiple * q)
        basis = f"usually at most {_hm(q)} at this time of day ({len(usual)} days)"
    else:
        threshold = cfg.fallback_gap_s
        basis = f"not enough history ({len(usual)} days), default limit"
    quiet = in_quiet_hours(now, tz, cfg)
    abnormal = gap > threshold and not quiet
    since = "last interaction" if interactions else "monitoring started"
    reason = f"No interaction for {_hm(gap)} since {since}; {basis} {_hm(threshold)}."
    if quiet and gap > threshold:
        reason += " Quiet hours: no check started."
    return Inactivity(abnormal, gap, threshold, tuple(usual), quiet, reason)


def should_start_ladder(a: Inactivity, ladder_active: bool, last_closed_at: datetime | None,
                        last_interaction: datetime | None, now: datetime, cfg: SilenceConfig) -> bool:
    if not a.abnormal or ladder_active:
        return False
    if last_closed_at is None or (last_interaction and last_interaction > last_closed_at):
        return True
    return (now - last_closed_at).total_seconds() >= cfg.rearm_s


# ---- escalation ladder ----------------------------------------------------------------------------

@dataclass(frozen=True)
class Step:
    kind: str                       # tablet | contact | nurse
    started_at: datetime
    deadline: datetime
    status: str = "open"            # open | timed_out | acknowledged
    ack_by: str | None = None
    ack_role: str | None = None
    ack_at: datetime | None = None
    outcome: str | None = None      # ok | concern
    note: str | None = None
    reminders: int = 0


@dataclass(frozen=True)
class Ladder:
    id: str
    patient_id: str
    contact_id: str | None
    started_at: datetime
    reason: str
    steps: tuple[Step, ...] = ()
    closed_at: datetime | None = None

    @property
    def active(self) -> bool:
        return self.closed_at is None

    @property
    def current(self) -> Step:
        return self.steps[-1]

    def step(self, kind: str) -> Step | None:
        return next((s for s in self.steps if s.kind == kind), None)

    def public(self) -> dict:
        iso = lambda v: v.isoformat() if isinstance(v, datetime) else v
        return {"id": self.id, "patient_id": self.patient_id, "contact_id": self.contact_id,
                "started_at": iso(self.started_at), "reason": self.reason, "active": self.active,
                "closed_at": iso(self.closed_at), "current": self.current.kind if self.steps else None,
                "steps": [{k: iso(v) for k, v in s.__dict__.items()} for s in self.steps]}


def _audit(lad: Ladder, now: datetime, event: str, step: str | None = None, role: str | None = None,
           actor: str | None = None, **detail) -> dict:
    return {"type": "audit", "time": now, "patient_id": lad.patient_id, "ladder_id": lad.id, "mode": "B",
            "event": event, "step": step, "role": role, "actor": actor, "detail": detail}


def _set(lad: Ladder, step: Step) -> Ladder:
    return replace(lad, steps=tuple(step if s.kind == step.kind else s for s in lad.steps))


def _begin(lad: Ladder, kind: str, now: datetime, cfg: SilenceConfig) -> tuple[Ladder, list[dict]]:
    timeout = {"tablet": cfg.tablet_timeout_s, "contact": cfg.contact_timeout_s, "nurse": cfg.nurse_reminder_s}[kind]
    step = Step(kind, now, now + timedelta(seconds=timeout))
    lad = replace(lad, steps=lad.steps + (step,))
    return lad, [{"type": EFFECT_OF[kind], "step": kind, "deadline": step.deadline},
                 _audit(lad, now, "step_started", kind, timeout_s=timeout, deadline=step.deadline.isoformat())]


def _close(lad: Ladder, now: datetime, by: str, role: str) -> tuple[Ladder, list[dict]]:
    lad = replace(lad, closed_at=now)
    return lad, [{"type": "ladder_closed"}, _audit(lad, now, "ladder_closed", role=role, actor=by)]


def _next(lad: Ladder, kind: str) -> str:
    return "contact" if kind == "tablet" and lad.contact_id else "nurse"


def start_ladder(ladder_id: str, patient_id: str, contact_id: str | None, now: datetime, reason: str,
                 cfg: SilenceConfig) -> tuple[Ladder, list[dict]]:
    lad = Ladder(ladder_id, patient_id, contact_id, now, reason)
    first = [_audit(lad, now, "ladder_started", reason=reason, contact=contact_id)]
    lad, effects = _begin(lad, "tablet", now, cfg)
    return lad, first + effects


def tick(lad: Ladder, now: datetime, cfg: SilenceConfig) -> tuple[Ladder, list[dict]]:
    """Apply any deadline that has passed. Escalates or reminds; never closes the ladder."""
    if not lad.active or now < lad.current.deadline:
        return lad, []
    cur = lad.current
    if cur.kind == "nurse":
        n = cur.reminders + 1
        lad = _set(lad, replace(cur, deadline=now + timedelta(seconds=cfg.nurse_reminder_s), reminders=n))
        return lad, [{"type": "nurse_reminder", "step": "nurse", "reminders": n},
                     _audit(lad, now, "nurse_reminder", "nurse", reminders=n)]
    lad = _set(lad, replace(cur, status="timed_out"))
    effects = [_audit(lad, now, "step_timed_out", cur.kind)]
    lad, more = _begin(lad, _next(lad, cur.kind), now, cfg)
    return lad, effects + more


def acknowledge(lad: Ladder, kind: str, role: str, actor: str, now: datetime, cfg: SilenceConfig,
                outcome: str = "ok", note: str | None = None) -> tuple[Ladder, list[dict]]:
    if not lad.active:
        raise ValueError("this check is already closed")
    if kind not in STEPS or outcome not in ("ok", "concern"):
        raise ValueError("unknown step or outcome")
    step = lad.step(kind)
    if step is None:
        raise ValueError(f"the {kind} step has not started")
    if step.status == "acknowledged":
        raise ValueError(f"the {kind} step is already acknowledged")
    if role not in ALLOWED[kind] or (role == "contact" and actor != lad.contact_id):
        raise PermissionError(f"a {role} cannot acknowledge the {kind} step")
    if role == "patient" and outcome != "ok":
        raise ValueError("the tablet check only records a response")

    def ack(lad: Ladder, s: Step) -> tuple[Ladder, dict]:
        lad = _set(lad, replace(s, status="acknowledged", ack_by=actor, ack_role=role, ack_at=now,
                                outcome=outcome, note=note))
        return lad, _audit(lad, now, "step_acknowledged", s.kind, role, actor, outcome=outcome, note=note,
                           late=s.status == "timed_out")

    if role == "nurse":   # a nurse who has checked closes every open step and the ladder
        effects = []
        for s in lad.steps:
            if s.status != "acknowledged":
                lad, a = ack(lad, s)
                effects.append(a)
        lad, closing = _close(lad, now, actor, role)
        return lad, effects + closing

    was_current = step is lad.current and step.status == "open"
    lad, a = ack(lad, step)
    effects = [a]
    if not was_current:
        return lad, effects                     # late: recorded, but the ladder keeps escalating
    if outcome == "concern":
        lad, more = _begin(lad, "nurse", now, cfg)
        return lad, effects + more
    for s in lad.steps:                         # the current step's human has checked: earlier steps too
        if s.status == "timed_out":
            lad, a = ack(lad, s)
            effects.append(a)
    lad, closing = _close(lad, now, actor, role)
    return lad, effects + closing
