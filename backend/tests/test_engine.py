import random

from app.catalog import get_catalog
from app.config import settings
from app.engine.belief import PriorContext, context_prior, tap_likelihood
from app.engine.conformal import ConformalPredictor
from app.engine.dialogue import Dialogue
from app.sim.evaluate import evaluate_scenarios
from app.sim.simulator import SCENARIOS, run_dialogue

cat = get_catalog()
cfg = settings.engine
NO_FLAGS = {lk.id: False for lk in cat.lookups}


def dialogue(**kw):
    return Dialogue(cat, cfg, list(cat.base_prior), 0.85, chart_flags=kw.get("flags", NO_FLAGS))


def test_tap_likelihoods_are_distributions():
    for table in (cat.area_lik, cat.feeling_lik):
        for i in range(cat.n):
            assert abs(sum(table[t][i] for t in table) - 1) < 1e-9


def test_not_sure_tap_carries_no_information():
    lik = tap_likelihood(cat, "feeling", "not_sure", 0.85)
    assert max(lik) / min(lik) < 1.6


def test_chest_tap_escalates_immediately():
    d = dialogue()
    d.apply_tap("area", "chest")
    decision = d.step()
    assert decision.chosen.kind == "escalate"
    assert d.questions_asked == 0


def test_chart_cannot_talk_engine_out_of_patient_signalled_emergency():
    flags = dict(NO_FLAGS, low_fluid_intake=True, meal_missed=True)
    d = dialogue(flags=flags)
    d.apply_tap("area", "mouth_throat")
    d.step()
    d.apply_tap("feeling", "hard_to_breathe")
    assert d.step().chosen.kind == "escalate"


def test_low_risk_need_is_not_escalated():
    d = dialogue()
    d.apply_tap("area", "mouth_throat")
    d.step()
    d.apply_tap("feeling", "thirsty")
    decision = d.step()
    assert decision.chosen.kind in ("send", "ask")
    assert d.top(1)[0]["need"] == "thirsty"


def test_no_questions_during_tap_phase():
    d = dialogue()
    d.apply_tap("area", "toilet")
    assert d.step().chosen.kind in ("tap", "escalate")


def test_fatigue_grows_as_taps_slow():
    d = dialogue()
    d.apply_tap("area", "whole_body", t=0)
    d.apply_tap("feeling", "uncomfortable", t=2)
    fresh = d.fatigue()
    d.apply_answer("group:comfort", "yes", t=10)
    assert d.fatigue() > fresh


def test_context_prior_raises_surgical_pain_after_surgery():
    p0, _ = context_prior(cat, PriorContext(hour=14))
    p1, reasons = context_prior(cat, PriorContext(hour=14, days_since_surgery=1))
    i = cat.index["pain_surgical"]
    assert p1[i] > 2 * p0[i]
    assert any("surgery" in r for r in reasons)


def test_conformal_set_never_empty_and_covers_on_calibration_data():
    cp = ConformalPredictor(0.1)
    rng = random.Random(1)
    results = [run_dialogue(cat, cfg, rng) for _ in range(200)]
    cp.calibrate([1 - r.final_belief[cat.index[r.true_need]] for r in results])
    covered = [r.true_need in cp.predict_set(cat.need_ids, r.final_belief) for r in results]
    assert sum(covered) / len(covered) >= 0.9
    assert cp.predict_set(cat.need_ids, [1 / cat.n] * cat.n)


def test_prd_scenario_targets():
    m = evaluate_scenarios(repeats=10)
    assert m["scenario_high_risk_escalated_without_question"] == 1.0
    assert m["scenario_top1_accuracy"] >= 0.85
    assert m["scenario_mean_patient_inputs"] <= 5
    assert m["scenario_questions_saved_vs_fixed_tree"] >= 0.4


def test_every_scenario_uses_known_taps():
    for need, area, feeling in SCENARIOS:
        assert need in cat.index and area in cat.area_lik and feeling in cat.feeling_lik
