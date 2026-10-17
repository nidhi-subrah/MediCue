"""Synthetic patients for calibration and evaluation.

A synthetic patient has a true need, a true signal reliability, and a chart sampled from the lookup
model. It taps, answers questions and is described by consulted people according to the same
likelihood model the engine assumes (plus noise), so the metrics are honest about the model but
optimistic about real-world patients. Treat them as a regression suite, not clinical evidence.
"""
import random
from dataclasses import dataclass

from ..catalog import Catalog
from ..config import EngineConfig
from ..engine.belief import argmax, yes_prob
from ..engine.conformal import ConformalPredictor
from ..engine.decision import Consultant, Decision
from ..engine.dialogue import Dialogue


@dataclass
class SimResult:
    true_need: str
    final_belief: list[float]
    top_need: str
    outcome: str            # "escalate" | "send"
    taps: int               # all patient inputs: taps + answers
    questions: int
    consults: int
    escalated_without_question: bool
    sim_seconds_to_alert: float
    dialogue: Dialogue | None = None      # the finished dialogue and final decision (e.g. for case packets)
    decision: Decision | None = None


def _sample(rng: random.Random, probs: list[float]) -> int:
    r, acc = rng.random(), 0.0
    for i, p in enumerate(probs):
        acc += p
        if r <= acc:
            return i
    return len(probs) - 1


def _sample_tap(rng, table: dict[str, list[float]], need_i: int, reliability: float) -> str:
    ids = list(table)
    if rng.random() > reliability:
        return rng.choice(ids)
    return ids[_sample(rng, [table[t][need_i] for t in ids])]


# Canonical scenarios: the taps a patient intends for each need (used for the PRD demo metrics).
SCENARIOS = [
    ("pain_chest", "chest", "pain"), ("short_of_breath", "chest", "hard_to_breathe"),
    ("secretions", "mouth_throat", "hard_to_breathe"), ("pain_head", "head", "pain"),
    ("pain_abdomen", "belly", "pain"), ("pain_surgical", "surgical_site", "pain"),
    ("pain_back", "back", "pain"), ("pain_limb", "arms_legs", "pain"),
    ("urinate", "toilet", "need_toilet"), ("bowel", "toilet", "need_toilet"),
    ("soiled", "toilet", "uncomfortable"), ("thirsty", "mouth_throat", "thirsty"),
    ("hungry", "mouth_throat", "hungry"), ("too_hot", "whole_body", "too_hot"),
    ("too_cold", "whole_body", "too_cold"), ("reposition", "whole_body", "uncomfortable"),
    ("nausea", "belly", "sick"), ("anxious", "people", "scared"),
    ("want_family", "people", "want_someone"), ("medication_question", "people", "medicine"),
]


def run_dialogue(cat: Catalog, cfg: EngineConfig, rng: random.Random, true_need: str | None = None,
                 patient_reliability: float | None = None, with_family: bool = True,
                 taps: tuple[str, str] | None = None) -> SimResult:
    ti = cat.index[true_need] if true_need else _sample(rng, cat.base_prior)
    r_true = patient_reliability if patient_reliability is not None else rng.uniform(0.8, 0.97)
    chart = {lk.id: rng.random() < lk.p_true[ti] for lk in cat.lookups}
    family = [Consultant("sim-family", "Family", "daughter", 0.8)] if with_family else []
    family_true_rel = 0.8

    d = Dialogue(cat, cfg, list(cat.base_prior), reliability=0.85, consultants=family, chart_flags=chart)
    t, consults = 0.0, 0
    # seconds per input grows as the synthetic patient tires
    pace = rng.uniform(2.0, 4.0)

    def next_t():
        nonlocal t, pace
        t += pace
        pace *= rng.uniform(1.0, 1.25)
        return t

    area, feeling = taps or (_sample_tap(rng, cat.area_lik, ti, r_true), _sample_tap(rng, cat.feeling_lik, ti, r_true))
    d.apply_tap("area", area, next_t())
    decision = d.step()
    if decision.chosen.kind == "escalate":
        # Help is already on the way; the patient's feeling tap refines the open alert.
        d.apply_tap("feeling", feeling, next_t())
    else:
        d.apply_tap("feeling", feeling, next_t())
        decision = d.step()

    for _ in range(12):
        kind = decision.chosen.kind
        if kind in ("escalate", "send"):
            break
        if kind == "ask":
            q = cat.question_by_id[decision.chosen.id]
            p_yes = yes_prob(q.p_yes, r_true)[ti]
            d.apply_answer(q.id, "yes" if rng.random() < p_yes else "no", next_t())
        elif kind == "consult":
            person = next(c for c in family if c.id == decision.chosen.id)
            options = d.consult_options()
            d.mark_consulted(person.id)
            truth = cat.need_ids[ti] if cat.need_ids[ti] in options else None
            if rng.random() < family_true_rel:
                ans = truth
            else:
                ans = rng.choice([o for o in options + [None] if o != truth])
            d.apply_consult(person, options, ans)
            consults += 1
            t += 90.0
        decision = d.step()

    return SimResult(
        true_need=cat.need_ids[ti], final_belief=d.belief, top_need=cat.need_ids[argmax(d.belief)],
        outcome=decision.chosen.kind if decision.chosen.kind in ("escalate", "send") else "send",
        taps=d.taps, questions=d.questions_asked, consults=consults,
        escalated_without_question=decision.chosen.kind == "escalate" and d.questions_asked == 0,
        sim_seconds_to_alert=t, dialogue=d, decision=decision)


def calibrate(cat: Catalog, cfg: EngineConfig, n: int = 600, seed: int = 7) -> ConformalPredictor:
    rng = random.Random(seed)
    cp = ConformalPredictor(cfg.alpha)
    scores = []
    for _ in range(n):
        r = run_dialogue(cat, cfg, rng)
        scores.append(1 - r.final_belief[cat.index[r.true_need]])
    cp.calibrate(scores)
    return cp
