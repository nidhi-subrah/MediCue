"""Adaptive communication, layer 1: Signal Detection. What happened while the patient was answering?

This layer only measures. It never decides to change anything (that is ``policy.py``) and never renders
anything (that is the tablet, ``frontend/components/talk``). Pure and deterministic: the same interaction
log always gives the same signals.

Inputs
------
* The session's interaction log: one ``Interaction`` per thing the patient did (a response with its
  latency, a correction, a missed tap, a "read aloud" press, a silence long enough to count as a missed
  response). The session service appends to it; nothing here reads the clock.
* The patient's personal baseline, when there is history (``PersonalBaseline``).
* The current fatigue score from the dialogue (``engine/dialogue.py``).

Baselines
---------
``COLD_START``    no history: compare with this session's own first responses.
``LEARNING``      a little history: this session's baseline once it has one, the history until then.
``PERSONALIZED``  enough history: compare with the patient's usual response time.

Slowdown is a ratio of medians, never a fixed number of seconds: median of the last ``recent`` responses
over the baseline. One slow response is an outlier; ``sustained_slowdown`` needs every one of the last
``recent`` responses to be slow. When both baselines exist, a slowdown against either counts and the larger
is reported with its source: the session trend catches a drop within this conversation even for a patient
who is usually slow, the personal one catches a patient who is slow from the first tap.

Counts (corrections, uncertainty, missed responses...) cover the window since the last adaptation, so a
change is judged on what happened after it, not before.
"""
from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass, field

COLD_START, LEARNING, PERSONALIZED = "COLD_START", "LEARNING", "PERSONALIZED"

# Interaction kinds
RESPONSE = "response"            # a tap or an answer, with its latency
CORRECTION = "correction"        # went back, or rejected a confirmation ("Change")
MISS = "miss"                    # a tap that landed on no control
MISSED_RESPONSE = "missed_response"   # silence for half the silence timeout mid-request
READ_ALOUD = "read_aloud"        # pressed "read aloud" / replay
KINDS = (RESPONSE, CORRECTION, MISS, MISSED_RESPONSE, READ_ALOUD)


@dataclass(frozen=True)
class SignalConfig:
    baseline_responses: int = 3      # within-session baseline: median of the first N responses
    recent_responses: int = 2        # current latency: median of the last M responses
    slow_ratio: float = 1.8          # a response this many times the baseline counts as slow
    personalized_sessions: int = 5   # history needed before the personal baseline takes over


DEFAULT = SignalConfig()


@dataclass(frozen=True)
class Interaction:
    kind: str
    t: float
    latency_s: float | None = None   # responses only
    unsure: bool = False             # answered "not sure" / "none of these"
    surprising: bool = False         # an answer the belief gave < 20% chance (engine/dialogue.py)
    idle_s: float | None = None      # missed responses only


@dataclass(frozen=True)
class PersonalBaseline:
    latency_s: float | None          # patient's usual seconds per input
    sessions: int                    # how many past sessions it comes from


@dataclass(frozen=True)
class InteractionSignals:
    response_latency_s: float | None       # the latest response
    current_latency_s: float | None        # median of the last `recent_responses` since the last change
    baseline_latency_s: float | None       # what "usual" means right now
    baseline_source: str | None            # "session" | "personal": which baseline the slowdown is against
    within_session_baseline_s: float | None
    personal_baseline_latency_s: float | None
    baseline_status: str
    personal_baseline_available: bool
    slowdown_ratio: float | None
    slow_responses: int                    # of the recent ones, how many were slow
    sustained_slowdown: bool
    correction_count: int
    uncertainty_count: int
    inconsistent_count: int
    missed_response_count: int
    failed_input_attempts: int
    read_aloud_count: int                  # whole session
    longest_idle_s: float | None
    good_streak: int                       # on-time, certain responses in a row with no slip in between
    responses_in_window: int
    fatigue_score: float
    recent_mode_changes: int

    def public(self) -> dict:
        return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def _median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def baseline_status(personal: PersonalBaseline | None, cfg: SignalConfig = DEFAULT) -> str:
    if not personal or not personal.latency_s or personal.sessions <= 0:
        return COLD_START
    return PERSONALIZED if personal.sessions >= cfg.personalized_sessions else LEARNING


def detect(log: list[Interaction], since: int = 0, personal: PersonalBaseline | None = None,
           fatigue: float = 1.0, recent_mode_changes: int = 0, cfg: SignalConfig = DEFAULT) -> InteractionSignals:
    """Signals for the whole session (`log`), counting difficulties from index `since` (the last change)."""
    latencies = [i.latency_s for i in log if i.kind == RESPONSE and i.latency_s is not None]
    window = log[since:]
    recent_all = [i.latency_s for i in window if i.kind == RESPONSE and i.latency_s is not None]
    recent = recent_all[-cfg.recent_responses:]

    session_base = _median(latencies[:cfg.baseline_responses]) if len(latencies) >= cfg.baseline_responses else None
    status = baseline_status(personal, cfg)
    personal_s = personal.latency_s if personal and personal.latency_s else None
    current = _median(recent)

    def against(b: float | None) -> tuple[float | None, int, bool]:
        if not b or current is None:
            return None, 0, False
        slow = sum(1 for x in recent if x >= cfg.slow_ratio * b)
        return current / b, slow, len(recent) == cfg.recent_responses and slow == cfg.recent_responses

    candidates = [("session", session_base)]
    if status != COLD_START:   # LEARNING / PERSONALIZED: the patient's own history counts too
        candidates.append(("personal", personal_s))
    scored = [(src, b, *against(b)) for src, b in candidates if b]
    if scored:   # the strongest evidence: sustained first, then the larger ratio
        src, base, ratio, slow, sustained = max(scored, key=lambda x: (x[4], x[2] or 0))
    else:
        src, base, ratio, slow, sustained = None, (personal_s if status == PERSONALIZED else None), None, 0, False

    # Good streak: trailing responses that were on time and certain, with no slip after them.
    streak = 0
    for i in reversed(window):
        if i.kind == RESPONSE:
            on_time = not base or i.latency_s is None or i.latency_s < cfg.slow_ratio * base
            if on_time and not i.unsure and not i.surprising:
                streak += 1
                continue
        if i.kind == READ_ALOUD:
            continue
        break

    count = lambda kind: sum(1 for i in window if i.kind == kind)
    idles = [i.idle_s for i in window if i.kind == MISSED_RESPONSE and i.idle_s is not None]
    return InteractionSignals(
        response_latency_s=latencies[-1] if latencies else None, current_latency_s=current,
        baseline_latency_s=base, baseline_source=src, within_session_baseline_s=session_base, personal_baseline_latency_s=personal_s,
        baseline_status=status, personal_baseline_available=personal_s is not None,
        slowdown_ratio=ratio, slow_responses=slow, sustained_slowdown=sustained,
        correction_count=count(CORRECTION),
        uncertainty_count=sum(1 for i in window if i.kind == RESPONSE and i.unsure),
        inconsistent_count=sum(1 for i in window if i.kind == RESPONSE and i.surprising),
        missed_response_count=count(MISSED_RESPONSE), failed_input_attempts=count(MISS),
        read_aloud_count=sum(1 for i in log if i.kind == READ_ALOUD),
        longest_idle_s=max(idles) if idles else None, good_streak=streak,
        responses_in_window=len(recent_all), fatigue_score=fatigue, recent_mode_changes=recent_mode_changes)
