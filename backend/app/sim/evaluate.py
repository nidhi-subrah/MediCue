"""Measure the PRD's demo success metrics on synthetic scenarios.

    python -m app.sim.evaluate            (from backend/)
"""
import random
import statistics
import sys

from ..catalog import get_catalog
from ..config import settings
from .simulator import SCENARIOS, calibrate, run_dialogue

FIXED_TREE_QUESTIONS = 3  # baseline: area, feeling, then category → item → confirm


def evaluate_scenarios(repeats: int = 20, seed: int = 5) -> dict:
    """Scripted scenarios: the patient taps what they intend and answers truthfully 95% of the time."""
    cat, cfg = get_catalog(), settings.engine
    rng = random.Random(seed)
    results = [run_dialogue(cat, cfg, rng, true_need=need, patient_reliability=0.95, taps=(area, feeling))
               for need, area, feeling in SCENARIOS for _ in range(repeats)]
    high = [r for r in results if cat.by_id[r.true_need]["risk"] == "high"]
    mean_q = statistics.mean(r.questions for r in results)
    return {
        "scenario_dialogues": len(results),
        "scenario_top1_accuracy": statistics.mean(r.top_need == r.true_need for r in results),
        "scenario_mean_patient_inputs": statistics.mean(r.taps for r in results),
        "scenario_high_risk_escalated_without_question": statistics.mean(r.escalated_without_question for r in high),
        "scenario_questions_saved_vs_fixed_tree": 1 - mean_q / FIXED_TREE_QUESTIONS,
        "scenario_low_risk_false_escalation_rate": statistics.mean(
            r.outcome == "escalate" for r in results if cat.by_id[r.true_need]["risk"] == "low"),
    }


def evaluate(n: int = 400, seed: int = 11) -> dict:
    """Noisy synthetic population: true need drawn from the prior, patients mis-tap 3-20% of the time."""
    cat, cfg = get_catalog(), settings.engine
    cp = calibrate(cat, cfg)
    rng = random.Random(seed)
    results = [run_dialogue(cat, cfg, rng) for _ in range(n)]

    high = [r for r in results if cat.by_id[r.true_need]["risk"] == "high"]
    covered = [r.true_need in cp.predict_set(cat.need_ids, r.final_belief) for r in results]
    set_sizes = [len(cp.predict_set(cat.need_ids, r.final_belief)) for r in results]
    mean_q = statistics.mean(r.questions for r in results)
    return {
        "dialogues": n,
        "top1_accuracy": statistics.mean(r.top_need == r.true_need for r in results),
        "conformal_coverage": statistics.mean(covered),
        "mean_set_size": statistics.mean(set_sizes),
        "qhat": cp.qhat,
        "mean_patient_inputs": statistics.mean(r.taps for r in results),
        "high_risk_cases": len(high),
        "high_risk_escalated": statistics.mean(r.outcome == "escalate" for r in high) if high else None,
        "high_risk_escalated_without_question":
            statistics.mean(r.escalated_without_question for r in high) if high else None,
        "questions_saved_vs_fixed_tree": 1 - mean_q / FIXED_TREE_QUESTIONS,
        "mean_questions": mean_q,
        "consult_rate": statistics.mean(r.consults > 0 for r in results),
        "low_risk_false_escalation_rate": statistics.mean(
            r.outcome == "escalate" for r in results if cat.by_id[r.true_need]["risk"] == "low"),
    }


TARGETS = {
    "scenario_top1_accuracy": (">=", 0.85), "conformal_coverage": (">=", 0.90),
    "scenario_mean_patient_inputs": ("<=", 5), "mean_patient_inputs": ("<=", 5),
    "scenario_high_risk_escalated_without_question": (">=", 1.0),
    "scenario_questions_saved_vs_fixed_tree": (">=", 0.40),
}

if __name__ == "__main__":
    m = {**evaluate_scenarios(), **evaluate(int(sys.argv[1]) if len(sys.argv) > 1 else 400)}
    for k, v in m.items():
        target = TARGETS.get(k)
        mark = ""
        if target and v is not None:
            ok = v >= target[1] if target[0] == ">=" else v <= target[1]
            mark = f"   target {target[0]} {target[1]}  {'PASS' if ok else 'MISS'}"
        print(f"{k:42s} {v if not isinstance(v, float) else round(v, 3)}{mark}")
