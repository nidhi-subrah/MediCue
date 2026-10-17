"""Adaptive communication, layer 2: Adaptation Policy. Should the way we ask change, and how little can we change?

Input: ``InteractionSignals`` (layer 1), the session's ``CommunicationState``, and a ``PolicyContext``
(is the engine escalating, which people could help). Output: an ``AdaptationDecision``. ``apply`` turns a
decision into the next state. Nothing here renders anything or touches the belief: the decision engine
still decides WHAT to ask (or to escalate); this decides HOW to ask it.

Modes (one at a time, numbered so they read as a ladder)          Modifiers (any combination)
    1 STANDARD    up to 4 choices                                 large_targets, extra_spacing
    2 SIMPLIFIED  2-3 larger choices, shorter wording             confirm_selections
    3 BINARY      one yes / no / not sure question at a time      simple_wording
    4 ASSISTED    someone helps; confirmed and unresolved shown   audio (read aloud)

Rules, first match wins (``decide``):
    0  the engine is escalating                  -> no adaptation, ever (escalation outranks everything)
    1  in BINARY and still struggling            -> offer assisted communication (patient chooses)
       (a missed response, 2+ uncertain, 2+ slips, or a sustained slowdown)
    2  2+ missed responses in any mode           -> offer assisted (severe failure)
    3  a missed response                         -> one step simpler
    4  sustained slowdown, or one slow response plus another sign of difficulty
                                                 -> one step simpler (STANDARD -> SIMPLIFIED -> BINARY)
    5  2+ corrections / missed taps              -> bigger, spaced-out targets and a confirmation step;
                                                    if those are already on, fewer choices
    6  2+ "not sure" / unexpected answers        -> simpler wording; if already simple, yes/no questions
    7  "read aloud" pressed twice                -> offer audio-first (patient chooses)
    8  2 good responses in a row                 -> one step back up (never above a manual choice)

Never inferred from signals: visual impairment (missed taps never turn on
audio; only the patient's own "read aloud" use, their request or their profile does), cognition, diagnosis.
Patient-facing messages are neutral ("I've simplified the choices"), never about the patient's ability.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import IntEnum

from .signals import InteractionSignals


class Mode(IntEnum):
    STANDARD = 1
    SIMPLIFIED = 2
    BINARY = 3
    ASSISTED = 4


LABEL = {Mode.STANDARD: "Standard", Mode.SIMPLIFIED: "Simplified", Mode.BINARY: "Yes / No", Mode.ASSISTED: "Assisted"}

LARGE_TARGETS, EXTRA_SPACING, CONFIRM_SELECTIONS = "large_targets", "extra_spacing", "confirm_selections"
SIMPLE_WORDING, AUDIO = "simple_wording", "audio"
PRECISION = frozenset({LARGE_TARGETS, EXTRA_SPACING, CONFIRM_SELECTIONS})

# Reasons
SLOW_RESPONSE = "SLOW_RESPONSE"
FREQUENT_CORRECTIONS = "FREQUENT_CORRECTIONS"
REPEATED_UNCERTAINTY = "REPEATED_UNCERTAINTY"
AUDIO_PREFERENCE = "AUDIO_PREFERENCE"
REPEATED_INTERACTION_FAILURE = "REPEATED_INTERACTION_FAILURE"
MISSED_RESPONSE = "MISSED_RESPONSE"
RECOVERED = "RECOVERED"
EXPLICIT_REQUEST = "EXPLICIT_REQUEST"
PROFILE = "PROFILE"

OFFER_AUDIO, OFFER_ASSISTED = "audio_first", "assisted"

# What each mode looks like on screen (layer 3 renders it; the numbers live here so the nurse trace and the
# tablet agree).
MAX_OPTIONS = {Mode.STANDARD: 4, Mode.SIMPLIFIED: 2, Mode.BINARY: 1, Mode.ASSISTED: 1}

MESSAGES = {
    Mode.SIMPLIFIED: "I've simplified the choices.",
    Mode.BINARY: "I'll ask simple yes or no questions.",
    "up": "Showing more choices again.",
    "precision": "I'll make the choices easier to select.",
    "wording": "Let me ask that more simply.",
    OFFER_AUDIO: "Would you like me to read the questions and choices aloud?",
    OFFER_ASSISTED: "Would you like someone to help you communicate?",
}


@dataclass(frozen=True)
class PolicyConfig:
    corrections: int = 2             # corrections + missed taps in the window
    uncertain: int = 2               # "not sure" + unexpected answers in the window
    severe_missed: int = 2           # missed responses that justify offering help from any mode
    read_aloud: int = 2
    recover_after: int = 2           # good responses in a row to step back up


DEFAULT = PolicyConfig()


@dataclass(frozen=True)
class CommunicationState:
    mode: Mode = Mode.STANDARD
    modifiers: frozenset[str] = frozenset()
    floor: Mode = Mode.STANDARD      # recovery never goes harder than a manual choice
    declined: frozenset[str] = frozenset()   # offers the patient turned down this window

    def public(self) -> dict:
        return {"mode": self.mode.name, "level": int(self.mode), "label": LABEL[self.mode],
                "modifiers": sorted(self.modifiers),
                "audio_enabled": AUDIO in self.modifiers, "floor": int(self.floor),
                "max_options": MAX_OPTIONS[self.mode]}


@dataclass(frozen=True)
class PolicyContext:
    escalating: bool = False          # the bedside decision engine is escalating (safety floor or otherwise)
    caregiver_available: bool = False


@dataclass(frozen=True)
class AdaptationDecision:
    should_adapt: bool
    reason: str | None = None
    severity: int = 0                 # 0 none, 1 presentation, 2 fewer options, 3 yes/no, 4 assisted
    suggested_mode: Mode | None = None
    add_modifiers: frozenset[str] = frozenset()
    remove_modifiers: frozenset[str] = frozenset()
    requires_patient_confirmation: bool = False
    offer: str | None = None          # OFFER_AUDIO | OFFER_ASSISTED, when the patient should choose
    patient_message: str | None = None
    explanation: str = ""             # for nurses: what was measured, in numbers

    def public(self) -> dict:
        return {"should_adapt": self.should_adapt, "reason": self.reason, "severity": self.severity,
                "suggested_mode": self.suggested_mode.name if self.suggested_mode else None,
                "add_modifiers": sorted(self.add_modifiers), "remove_modifiers": sorted(self.remove_modifiers),
                "requires_patient_confirmation": self.requires_patient_confirmation, "offer": self.offer,
                "patient_message": self.patient_message, "explanation": self.explanation}


NO_CHANGE = AdaptationDecision(False)


def _base_words(sig: InteractionSignals) -> str:
    return "their usual" if sig.baseline_source == "personal" else "this session's baseline"


def _slow_text(sig: InteractionSignals) -> str:
    if sig.slowdown_ratio is None:
        return "responses slowed"
    return (f"response time rose to {sig.slowdown_ratio:.1f}× {_base_words(sig)} across "
            f"{sig.slow_responses} response{'s' if sig.slow_responses != 1 else ''}")


def _others(sig: InteractionSignals) -> list[str]:
    out = []
    if sig.correction_count:
        out.append(f"{sig.correction_count} correction{'s' if sig.correction_count > 1 else ''}")
    if sig.failed_input_attempts:
        out.append(f"{sig.failed_input_attempts} missed tap{'s' if sig.failed_input_attempts > 1 else ''}")
    if sig.uncertainty_count:
        out.append(f"'not sure' ×{sig.uncertainty_count}")
    if sig.inconsistent_count:
        out.append(f"{sig.inconsistent_count} unexpected answer{'s' if sig.inconsistent_count > 1 else ''}")
    return out


def _step_down(state: CommunicationState, reason: str, explanation: str) -> AdaptationDecision:
    to = Mode(min(state.mode + 1, Mode.BINARY))
    return AdaptationDecision(True, reason, int(to), to, patient_message=MESSAGES[to], explanation=explanation)


def _offer_assisted(state: CommunicationState, explanation: str) -> AdaptationDecision:
    if OFFER_ASSISTED in state.declined:
        return NO_CHANGE
    return AdaptationDecision(True, REPEATED_INTERACTION_FAILURE, 4, Mode.ASSISTED,
                              requires_patient_confirmation=True, offer=OFFER_ASSISTED,
                              patient_message=MESSAGES[OFFER_ASSISTED], explanation=explanation)


def decide(sig: InteractionSignals, state: CommunicationState, ctx: PolicyContext = PolicyContext(),
           cfg: PolicyConfig = DEFAULT) -> AdaptationDecision:
    if ctx.escalating or state.mode == Mode.ASSISTED:
        return NO_CHANGE
    slips = sig.correction_count + sig.failed_input_attempts
    unsure = sig.uncertainty_count + sig.inconsistent_count
    idle = f"no response for {sig.longest_idle_s:.0f} s" if sig.longest_idle_s else "a missed response"

    if state.mode == Mode.BINARY and (sig.missed_response_count or unsure >= cfg.uncertain
                                      or slips >= cfg.corrections or sig.sustained_slowdown):
        why = [idle] if sig.missed_response_count else []
        why += [_slow_text(sig)] if sig.sustained_slowdown else []
        why += _others(sig)
        return _offer_assisted(state, "Still hard in yes/no mode: " + ", ".join(why) + ".")
    if sig.missed_response_count >= cfg.severe_missed:
        return _offer_assisted(state, f"{sig.missed_response_count} missed responses ({idle}).")
    if sig.missed_response_count:
        return _step_down(state, MISSED_RESPONSE, f"Simplified after {idle}.")

    # Fatigue is not a companion signal here: the dialogue's fatigue score is partly built from the same
    # slowdown, so counting it again would let one slow response trigger on its own.
    other_difficulty = slips or unsure
    if sig.sustained_slowdown or (sig.slow_responses and other_difficulty):
        extra = _others(sig)
        text = _slow_text(sig).capitalize() + (f"; also {', '.join(extra)}" if extra else "") + "."
        return _step_down(state, SLOW_RESPONSE, text)

    if slips >= cfg.corrections:
        text = ", ".join(_others(sig)).capitalize() + "."
        if not PRECISION <= state.modifiers:
            return AdaptationDecision(True, FREQUENT_CORRECTIONS, 1, add_modifiers=PRECISION,
                                      patient_message=MESSAGES["precision"], explanation=text)
        if state.mode == Mode.STANDARD:
            return AdaptationDecision(True, FREQUENT_CORRECTIONS, 2, Mode.SIMPLIFIED,
                                      patient_message=MESSAGES[Mode.SIMPLIFIED], explanation=text)

    if unsure >= cfg.uncertain:
        text = ", ".join(_others(sig)).capitalize() + "."
        if SIMPLE_WORDING not in state.modifiers:
            return AdaptationDecision(True, REPEATED_UNCERTAINTY, 1, add_modifiers=frozenset({SIMPLE_WORDING}),
                                      patient_message=MESSAGES["wording"], explanation=text)
        if state.mode < Mode.BINARY:
            return AdaptationDecision(True, REPEATED_UNCERTAINTY, 3, Mode.BINARY,
                                      patient_message=MESSAGES[Mode.BINARY],
                                      explanation=text[:-1] + " after simpler wording; one question at a time.")

    if sig.read_aloud_count >= cfg.read_aloud and AUDIO not in state.modifiers and OFFER_AUDIO not in state.declined:
        return AdaptationDecision(True, AUDIO_PREFERENCE, 0, add_modifiers=frozenset({AUDIO}),
                                  requires_patient_confirmation=True, offer=OFFER_AUDIO,
                                  patient_message=MESSAGES[OFFER_AUDIO],
                                  explanation=f"Used read aloud {sig.read_aloud_count} times.")

    if sig.good_streak >= cfg.recover_after and state.mode > state.floor:
        to = Mode(state.mode - 1)
        return AdaptationDecision(True, RECOVERED, 0, to, patient_message=MESSAGES["up"],
                                  explanation=f"{sig.good_streak} steady responses in a row.")
    return NO_CHANGE


def request(state: CommunicationState, kind: str, value, by: str = "patient") -> AdaptationDecision:
    """Explicit requests: a mode ("easier" / "more choices"), or read aloud on or off. Read aloud only turns
    on this way or when the patient accepts the policy's offer; signals never turn it on by themselves."""
    who = "nurse" if by == "nurse" else "patient"
    if kind == "mode":
        to = Mode(min(max(int(value), Mode.STANDARD), Mode.ASSISTED))
        if to == state.mode:
            return NO_CHANGE
        easier = to > state.mode
        message = (MESSAGES.get(to) if easier else MESSAGES["up"]) if to != Mode.ASSISTED else None
        return AdaptationDecision(True, EXPLICIT_REQUEST, int(to), to, patient_message=message,
                                  explanation=f"{who.capitalize()} asked for {'easier' if easier else 'more choices'}.")
    if kind == "audio":
        on = bool(value)
        if on == (AUDIO in state.modifiers):
            return NO_CHANGE
        return AdaptationDecision(True, AUDIO_PREFERENCE, 0, add_modifiers=frozenset({AUDIO}) if on else frozenset(),
                                  remove_modifiers=frozenset() if on else frozenset({AUDIO}),
                                  explanation=f"{who.capitalize()} turned read aloud {'on' if on else 'off'}.")
    raise ValueError(f"unknown request {kind!r}")


def apply(state: CommunicationState, d: AdaptationDecision, accepted: bool = True, by: str | None = None
          ) -> CommunicationState:
    """The next state. An offer the patient hasn't accepted changes nothing; one they declined is remembered
    so it isn't offered again in this window."""
    if not d.should_adapt:
        return state
    if d.requires_patient_confirmation and not accepted:
        return replace(state, declined=state.declined | {d.offer} if d.offer else state.declined)
    mode = d.suggested_mode or state.mode
    floor = state.floor
    if d.reason == EXPLICIT_REQUEST:
        floor = min(mode, Mode.BINARY)   # a manual choice holds against automatic recovery
    return replace(state, mode=mode, floor=floor,
                   modifiers=(state.modifiers | d.add_modifiers) - d.remove_modifiers,
                   declined=frozenset() if d.suggested_mode else state.declined)


def starting(level: int) -> CommunicationState:
    """Where a patient starts, from their profile (engine/profile.py ``start_level``)."""
    return CommunicationState(mode=Mode(level))
