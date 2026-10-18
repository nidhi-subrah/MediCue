"""One patient dialogue: belief state + evidence + decision loop, with no I/O.

Used by the live SessionService and by the simulator (calibration and evaluation), so both run
exactly the same logic.
"""
import time
from dataclasses import dataclass, field

from ..catalog import SAFETY_QUESTION, Catalog
from ..config import EngineConfig
from .belief import (answer_likelihood, bayes_update, consult_likelihood, entropy, p_high_risk,
                     tap_likelihood, top_items)
from .personal import PersonalModel
from .decision import Action, Consultant, Decision, DecisionInput, consult_options, decide

SURPRISING_ANSWER = 0.2   # an answer the belief gave less than this chance counts as inconsistent


@dataclass
class TraceStep:
    t: float
    kind: str
    label: str
    detail: str
    top: list[dict]
    entropy: float
    p_high: float
    belief: tuple[float, ...] = ()   # full belief after this step (read by services/case_packet.py)

    def public(self) -> dict:
        return {"t": self.t, "kind": self.kind, "label": self.label, "detail": self.detail, "top": self.top[:3],
                "entropy": round(self.entropy, 3), "p_high": round(self.p_high, 4)}


@dataclass
class Dialogue:
    cat: Catalog
    cfg: EngineConfig
    prior: list[float]
    reliability: float
    consultants: list[Consultant] = field(default_factory=list)
    chart_flags: dict[str, bool] = field(default_factory=dict)
    baseline_interval: float | None = None   # patient's usual seconds between inputs (from history)
    fatigue_sensitivity: float = 1.0         # from the patient profile (engine/profile.py)
    personal: PersonalModel | None = None    # this patient's learned gesture meanings (engine/personal.py)

    def __post_init__(self):
        self.belief = list(self.prior)
        self.signal_belief = list(self.prior)   # patient + people evidence only (safety floor)
        self.escalated = False
        self.trace: list[TraceStep] = []
        self.area: str | None = None
        self.feeling: str | None = None
        self.tap_times: list[float] = []
        self.questions_asked = 0
        self.asked: set[str] = set()
        self.answers: list[tuple[str, str]] = []           # (question text, answer)
        self.used_lookups: set[str] = set()
        self.lookup_results: list[tuple[str, str, bool]] = []  # (id, label, flag)
        self.consulted: set[str] = set()
        self.consult_answers: list[tuple[str, str]] = []   # (person name, answer label)
        self.inconsistencies = 0.0                         # surprising answers (+1) and "not sure" (+0.5)
        self.yes_no = False                                # adaptive communication yes/no mode: questions, no taps
        self._record("prior", "Prior from context", "")

    # ---- evidence ----------------------------------------------------------------------------

    @property
    def taps(self) -> int:
        return len(self.tap_times)

    @property
    def dialogue_open(self) -> bool:
        return self.yes_no or (self.area is not None and self.feeling is not None)

    def open_yes_no(self):
        """Skip the remaining taps: from now on the engine reaches the need through yes/no questions only
        (adaptive communication's yes/no mode, engine/communication). Sticky, so stepping back up mid-dialogue keeps going."""
        if not self.yes_no:
            self.yes_no = True
            self._record("communication", "Switched to yes/no questions", "")

    @property
    def max_questions(self) -> int:
        return self.cfg.max_questions + (self.cfg.yes_no_extra_questions if self.yes_no else 0)

    def apply_tap(self, kind: str, tap_id: str, t: float | None = None):
        self.tap_times.append(t if t is not None else time.time())
        standard = tap_likelihood(self.cat, kind, tap_id, self.reliability)
        if self.personal and self.personal.n:
            # Learned meanings steer the decision belief; the safety belief keeps the standard reading,
            # so a patient's history can never suppress escalation of a high-risk tap.
            self.belief = bayes_update(self.belief, self.personal.likelihood(self.cat, kind, tap_id, self.reliability))
            self.signal_belief = bayes_update(self.signal_belief, standard)
        else:
            self._signal(standard)
        if kind == "area":
            self.area = tap_id
            label = self.cat.area_labels[tap_id]
        else:
            self.feeling = tap_id
            label = self.cat.feeling_labels[tap_id]
        self._record("tap", f"Tapped {kind}: {label}", tap_id)
        self._skip_answered_questions()

    def _skip_answered_questions(self):
        """Once both taps are in, don't ask what they already said: area "Head" + feeling "Hurts" is the answer
        to "Does your head hurt?" (and to "Is it about pain?"). Only skips the question; the belief update from
        the taps is unchanged, and the question does not count toward the question limit."""
        if self.area is None or self.feeling != "pain":   # "Hurts" is the reported case; other feelings keep their confirm question
            return
        matches = [n for n in self.cat.raw["needs"]
                   if max(n["areas"], key=n["areas"].get) == self.area
                   and max(n["feelings"], key=n["feelings"].get) == self.feeling]
        if len(matches) == 1:   # several matches (e.g. three washroom needs) still need a question to tell them apart
            self.asked.add(f"need:{matches[0]['id']}")
            self.asked.add(f"group:{matches[0]['group']}")
        if self.feeling == "pain":
            # "Head" + "Hurts" has told us where it hurts: asking whether some other body part hurts is noise.
            for n in self.cat.raw["needs"]:
                if n["group"] == "pain" and self.area not in n["areas"]:
                    self.asked.add(f"need:{n['id']}")

    def apply_answer(self, question_id: str, answer: str, t: float | None = None) -> bool:
        """Returns True when the answer was surprising given the belief (the ladder counts it)."""
        q = self.cat.question_by_id[question_id]
        surprising = False
        self.tap_times.append(t if t is not None else time.time())
        self.questions_asked += 1
        self.asked.add(question_id)
        self.answers.append((q.text, answer))
        if answer == "unsure":
            self.inconsistencies += 0.5
        else:
            lik = answer_likelihood(q.p_yes, answer, self.reliability)
            if sum(b * l for b, l in zip(self.belief, lik)) < SURPRISING_ANSWER:
                self.inconsistencies += 1
                surprising = True
        self._signal(answer_likelihood(q.p_yes, answer, self.reliability))
        self._record("answer", f"{q.text} → {answer}", question_id)
        return surprising

    def apply_lookup(self, lookup_id: str):
        lk = self.cat.lookup_by_id[lookup_id]
        flag = bool(self.chart_flags.get(lookup_id, False))
        self.used_lookups.add(lookup_id)
        self.lookup_results.append((lookup_id, lk.label, flag))
        lik = lk.p_true if flag else [1 - p for p in lk.p_true]
        self.belief = bayes_update(self.belief, lik)
        self._record("lookup", f"Chart: {lk.label} → {'yes' if flag else 'no'}", lookup_id)

    def mark_consulted(self, person_id: str):
        self.consulted.add(person_id)

    def apply_consult(self, person: Consultant, options: list[str], answer: str | None):
        """answer = need id from options, None = 'something else', 'unsure' = no information."""
        if answer == "unsure":
            self.consult_answers.append((person.name, "unsure"))
            self._record("consult", f"{person.name}: unsure", person.id)
            return
        self._signal(consult_likelihood(self.cat, options, answer, person.reliability))
        label = self.cat.by_id[answer]["label"] if answer else "something else"
        self.consult_answers.append((person.name, label))
        self._record("consult", f"{person.name} says: {label}", person.id)

    def _signal(self, lik: list[float]):
        self.belief = bayes_update(self.belief, lik)
        self.signal_belief = bayes_update(self.signal_belief, lik)

    # ---- decision loop -----------------------------------------------------------------------

    def fatigue(self) -> float:
        """(1 + 0.35·questions) × slowdown × (1 + 0.3·inconsistencies) × sensitivity. See engine/profile.py."""
        base = 1.0 + 0.35 * self.questions_asked
        gaps = [b - a for a, b in zip(self.tap_times, self.tap_times[1:])]
        slowdown = 1.0
        if gaps and self.baseline_interval:
            slowdown = min(max(gaps[-1] / self.baseline_interval, 1.0), 3.0)
        elif len(gaps) >= 2 and gaps[0] > 0:
            slowdown = min(max(gaps[-1] / gaps[0], 1.0), 3.0)
        return base * slowdown * (1.0 + 0.3 * self.inconsistencies) * self.fatigue_sensitivity

    @property
    def patient_can_answer(self) -> bool:
        return self.inconsistencies < self.cfg.max_inconsistent_answers

    def decision_input(self) -> DecisionInput:
        return DecisionInput(
            belief=self.belief, reliability=self.reliability, fatigue=self.fatigue(),
            questions_asked=self.questions_asked, max_questions=self.max_questions, asked=self.asked, used_lookups=self.used_lookups,
            available_lookups=set(self.chart_flags) if self.chart_flags else set(),
            consultants=self.consultants, consulted=self.consulted, dialogue_open=self.dialogue_open,
            signal_p_high=p_high_risk(self.cat, self.signal_belief),
            patient_can_answer=self.patient_can_answer)

    def step(self) -> Decision:
        """Run near-free lookups until the best action needs the patient, a person, or ends the dialogue."""
        while True:
            d = decide(self.cat, self.cfg, self.decision_input())
            if self._needs_safety_screen(d):
                q = self.cat.question_by_id[SAFETY_QUESTION]
                return Decision(Action("ask", q.id, f"Ask: {q.text}", 0.0, 0.0, {}), d.ranked,
                                "Yes/no questions replace the taps, so first rule out an emergency the "
                                "body map would have caught in one tap.")
            if d.chosen.kind != "lookup":
                if d.chosen.kind == "escalate":
                    self.escalated = True
                return d
            self.apply_lookup(d.chosen.id)

    def _needs_safety_screen(self, d: Decision) -> bool:
        """In yes/no mode the patient never got to tap chest or "hard to breathe", and a low prior means the
        engine would rarely ask about them. Screen for them first, unless the engine is already escalating."""
        return (self.yes_no and self.feeling is None and SAFETY_QUESTION not in self.asked
                and self.patient_can_answer and d.chosen.kind not in ("escalate", "lookup"))

    def attach_context(self):
        """After escalation, list the remaining chart fields for the nurse. Display only: they do not
        update the belief, so chart context can't relabel what the patient signalled."""
        for lk in self.cat.lookups:
            if lk.id in self.chart_flags and lk.id not in self.used_lookups:
                self.used_lookups.add(lk.id)
                self.lookup_results.append((lk.id, lk.label, bool(self.chart_flags[lk.id])))

    def consult_options(self) -> list[str]:
        return consult_options(self.cat, self.belief)

    # ---- views -------------------------------------------------------------------------------

    def p_high(self) -> float:
        return p_high_risk(self.cat, self.belief)

    def top(self, k: int = 6) -> list[dict]:
        return top_items(self.cat, self.belief, k)

    def _record(self, kind: str, label: str, detail: str):
        self.trace.append(TraceStep(time.time(), kind, label, detail, top_items(self.cat, self.belief, 3),
                                    entropy(self.belief), p_high_risk(self.cat, self.belief), tuple(self.belief)))
