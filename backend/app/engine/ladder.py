"""Communication ladder: a live ability level per patient session, so the tablet simplifies itself.

    1 · Full        body map, then all 13 feelings
    2 · Simplified  only the most likely options (from the belief), larger buttons, shorter labels
    3 · Yes / No    no grids: every step is one yes/no question from the engine, read aloud
    4 · Assisted    "show someone" screen, a consult to family, and a shorter silence timer
    floor           no input at all: the silence monitor (risk/silence.py) escalates, as before

Evidence of strain, each input or signal adding points:

* a slow input: latency ≥ 2× the patient's usual gap (+1), ≥ 3× (+1.5)
* an answer the belief gave < 20% chance (+1), a "not sure" (+0.5)
* a missed tap or a correction reported by the tablet (+0.5)
* no input for half the silence timeout (+STEP_DOWN_AT: steps down at once, see SessionService)

Points are scaled by the profile's fatigue sensitivity. At STEP_DOWN_AT the level goes down one step and
the points reset. A good input (on time, unsurprising) takes 0.5 points off; STEP_UP_AFTER good inputs in
a row step back up one level. Waiting for several good inputs is the hysteresis that keeps the screen
from flickering between levels.

A manual change (the patient's or a nurse's "make it easier / harder") is respected: automatic recovery
never makes the screen harder than the level someone chose. Automatic step-downs still happen, because
a patient who is struggling should not be held at a level that no longer works for them.

Safety: the level changes how the engine asks, never what it concludes. The safety floor, escalation and
the silence monitor read the same belief at every level. This module is pure: no I/O, no clock.
"""
from __future__ import annotations

from dataclasses import dataclass, field

LEVELS = {1: "Full", 2: "Simplified", 3: "Yes / No", 4: "Assisted"}
MIN_LEVEL, MAX_LEVEL = 1, 4

STEP_DOWN_AT = 2.0
STEP_UP_AFTER = 2
SLOW, VERY_SLOW = 2.0, 3.0
SIGNAL_POINTS = {"miss": 0.5, "correction": 0.5, "deletion": 0.5}


@dataclass
class Evidence:
    """What has happened since the last level change, for the reason shown to nurses."""
    slowest: float = 0.0          # slowest input as a multiple of the patient's usual gap
    surprising: int = 0
    unsure: int = 0
    misses: int = 0
    corrections: int = 0
    idle_s: float = 0.0

    def reason(self) -> str:
        parts = []
        if self.idle_s:
            parts.append(f"no input for {self.idle_s:.0f} s")
        if self.slowest >= SLOW:
            parts.append(f"answers {self.slowest:.1f}× slower than usual")
        if self.surprising:
            parts.append(f"{self.surprising} unexpected answer{'s' if self.surprising > 1 else ''}")
        if self.unsure:
            parts.append(f"'not sure' {'once' if self.unsure == 1 else f'{self.unsure} times'}")
        if self.misses:
            parts.append(f"{self.misses} missed tap{'s' if self.misses > 1 else ''}")
        if self.corrections:
            parts.append(f"{self.corrections} correction{'s' if self.corrections > 1 else ''}")
        return ", ".join(parts) or "signs of strain"


@dataclass
class Change:
    t: float
    from_level: int
    to_level: int
    source: str                   # "auto" | "idle" | "patient" | "nurse" | "profile"
    reason: str

    def public(self) -> dict:
        return {"t": self.t, "from": self.from_level, "to": self.to_level, "from_label": LEVELS[self.from_level],
                "to_label": LEVELS[self.to_level], "source": self.source, "reason": self.reason}


@dataclass
class Ladder:
    level: int = MIN_LEVEL
    sensitivity: float = 1.0      # profile fatigue sensitivity: tiring patients step down sooner
    strain: float = 0.0
    good: int = 0                 # good inputs in a row
    floor: int = MIN_LEVEL        # automatic recovery never goes below (harder than) this
    evidence: Evidence = field(default_factory=Evidence)
    changes: list[Change] = field(default_factory=list)

    @classmethod
    def starting(cls, level: int, reason: str, t: float, sensitivity: float = 1.0) -> Ladder:
        lad = cls(level=MIN_LEVEL, sensitivity=sensitivity)
        if level > MIN_LEVEL:
            lad._move(level, "profile", reason, t)
        return lad

    # ---- evidence ----------------------------------------------------------------------------

    def observe_input(self, t: float, latency_s: float, usual_s: float | None,
                      surprising: bool = False, unsure: bool = False) -> Change | None:
        points = 0.0
        ratio = latency_s / usual_s if usual_s and usual_s > 0 else 0.0
        if ratio >= SLOW:
            points += 1.5 if ratio >= VERY_SLOW else 1.0
            self.evidence.slowest = max(self.evidence.slowest, ratio)
        if surprising:
            points += 1.0
            self.evidence.surprising += 1
        if unsure:
            points += 0.5
            self.evidence.unsure += 1
        if points:
            self.good = 0
            return self._strain(points, t)
        self.strain = max(0.0, self.strain - 0.5)
        self.good += 1
        if self.good >= STEP_UP_AFTER and self.level > self.floor:
            return self._move(self.level - 1, "auto", "answering steadily again", t)
        return None

    def observe_signal(self, kind: str, t: float) -> Change | None:
        if kind not in SIGNAL_POINTS:
            raise ValueError(f"unknown signal {kind!r}")
        if kind == "miss":
            self.evidence.misses += 1
        else:
            self.evidence.corrections += 1
        self.good = 0
        return self._strain(SIGNAL_POINTS[kind], t)

    def observe_idle(self, idle_s: float, t: float) -> Change | None:
        """Called once per prompt when the patient has been silent for half the silence timeout."""
        self.evidence.idle_s = idle_s
        self.good = 0
        return self._strain(STEP_DOWN_AT / self.sensitivity, t, source="idle")

    def set_level(self, level: int, source: str, t: float) -> Change | None:
        level = min(max(level, MIN_LEVEL), MAX_LEVEL)
        if level == self.level:
            return None
        easier = level > self.level
        who = "nurse" if source == "nurse" else "patient"
        self.floor = level
        return self._move(level, source, f"{who} asked for {'easier' if easier else 'more choices'}", t)

    # ---- internals ---------------------------------------------------------------------------

    def _strain(self, points: float, t: float, source: str = "auto") -> Change | None:
        self.strain += points * self.sensitivity
        if self.strain >= STEP_DOWN_AT and self.level < MAX_LEVEL:
            return self._move(self.level + 1, source, self.evidence.reason(), t)
        return None

    def _move(self, level: int, source: str, reason: str, t: float) -> Change:
        c = Change(t, self.level, level, source, reason)
        self.level, self.strain, self.good, self.evidence = level, 0.0, 0, Evidence()
        self.changes.append(c)
        return c

    def public(self) -> dict:
        return {"level": self.level, "label": LEVELS[self.level], "floor": self.floor,
                "strain": round(self.strain, 2), "changes": [c.public() for c in self.changes]}


# ---- level 2: which options to show ----------------------------------------------------------------

def likely_taps(lik: dict[str, list[float]], belief: list[float], high_risk: list[bool], k: int = 5) -> list[str]:
    """The k taps the patient most likely means next, P(tap) = Σ_n b(n)·P(tap | n), plus, always, the tap
    that best signals each high-risk need, so simplifying can never hide a way to report an emergency."""
    score = {t: sum(b * l for b, l in zip(belief, row)) for t, row in lik.items()}
    keep = sorted(score, key=lambda t: -score[t])[:k]
    for n, high in enumerate(high_risk):
        if high:
            best = max(lik, key=lambda t: lik[t][n])
            if best not in keep:
                keep.append(best)
    order = list(lik)
    return sorted(keep, key=order.index)   # catalog order, so options don't jump around between steps
