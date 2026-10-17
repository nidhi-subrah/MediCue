"""Learning curve: replay the same patient-specific gesture over several sessions with the real engine.

Session k uses a PersonalModel that has seen the nurse confirm the true need after sessions 1..k-1.
The simulated patient taps the gesture and answers every question truthfully; nobody is consulted, so
the count is purely the patient's own effort. Deterministic: the same inputs give the same curve.
"""
from ..catalog import Catalog
from ..config import EngineConfig
from ..engine.belief import yes_prob
from ..engine.dialogue import Dialogue
from ..engine.personal import PersonalModel


def learning_curve(cat: Catalog, cfg: EngineConfig, prior: list[float], reliability: float,
                   chart_flags: dict[str, bool], area: str, feeling: str, need: str, sessions: int = 5,
                   start: PersonalModel | None = None) -> list[dict]:
    model = start or PersonalModel()
    truth = cat.index[need]
    out = []
    for k in range(1, sessions + 1):
        d = Dialogue(cat, cfg, list(prior), reliability, [], dict(chart_flags), personal=model)
        t = 0.0
        d.apply_tap("area", area, t)
        decision = d.step()
        if decision.chosen.kind != "escalate":
            t += 3
            d.apply_tap("feeling", feeling, t)
            decision = d.step()
        else:
            d.apply_tap("feeling", feeling, t + 3)   # patient refines the open alert
        first = d.top(1)[0]                          # the engine's reading of the gesture, before any question
        first_p_true = d.belief[truth]
        for _ in range(cfg.max_questions + 2):
            if decision.chosen.kind != "ask":
                break
            q = cat.question_by_id[decision.chosen.id]
            t += 3
            d.apply_answer(q.id, "yes" if yes_prob(q.p_yes, 1.0)[truth] >= 0.5 else "no", t)
            decision = d.step()
        top = d.top(1)[0]
        out.append({
            "session": k, "inputs": d.taps, "questions": d.questions_asked,
            "outcome": decision.chosen.kind if decision.chosen.kind in ("send", "escalate") else "send",
            "top_need": top["need"], "top_label": top["label"], "top_p": top["p"],
            "correct": top["need"] == need, "learned_from": model.n,
            "first_guess": first["need"], "first_guess_label": first["label"], "first_guess_p": round(first["p"], 3),
            "p_true_after_gesture": round(first_p_true, 3),
        })
        model.add(area, feeling, need)   # the nurse confirms what the patient actually needed
    return out
