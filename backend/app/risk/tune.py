"""Tune risk weights and level thresholds on the training split only, then print MODELS for config.py.

    python -m app.risk.tune

Signs and starting magnitudes are clinical priors (PRIORS below). For each risk, coordinate ascent
scales each weight by one of MULTIPLIERS and picks watch/elevated thresholds from a small grid, to
maximise: lead time of the risk's own flag before its training outcome, minus false flags on every
other training patient, minus a small pull back towards the priors. Held-out patients are never loaded.

With one training storyline per risk this is calibration, not learning: keep the grids coarse.
"""
import math

from ..catalog import get_catalog
from .config import DEFAULT, MODELS, RiskConfig, RiskModel, SIGNALS
from .engine import LevelState, advance, raw_level, scoring_times, sigmoid
from .evaluate import SPEC, hours_before, patient_signals
from .signals import PatientSignals
from .synthetic import Cohort, generate, holdout_ids, tuning_ids

PRIORS = {
    "fall": {"night_toilet": 1.0, "tap_latency": 0.6, "tap_variability": 0.4, "fatigue": 0.8},
    "dehydration": {"fluid_intake": 1.0, "missed_meals": 0.7, "fatigue": 0.6, "discomfort": 0.4},
    "delirium": {"night_requests": 0.7, "tap_inconsistency": 1.0, "new_discomfort": 0.6, "tap_variability": 0.6},
}
INTERCEPT = -3.0              # fixed: with thresholds tuned, the intercept would be redundant
MULTIPLIERS = (0.5, 1.0, 1.5, 2.0)
THRESHOLDS = [(w, e) for w in (0.3, 0.4, 0.5, 0.6) for e in (0.6, 0.7, 0.8, 0.9) if e >= w + 0.2]
PASSES = 2
MAX_LEAD_H = 72               # earlier than 3 days before the outcome earns nothing extra
FALSE_ELEVATED = 1.0          # penalty per false elevated flag on a control
FALSE_WATCH = 0.2             # ... per false watch flag
OTHER_STORYLINE = 0.5         # false flags on a patient with a different storyline count half
PRIOR_PULL = 0.05             # per unit of |log multiplier|


def training_signals(cohort: Cohort) -> dict[str, PatientSignals]:
    ids = tuning_ids()
    assert not set(ids) & set(holdout_ids()), "held-out patients in the tuning split"
    return {pid: patient_signals(cohort, pid) for pid in ids}


def _series(sig: PatientSignals, keys: list[str], cfg: RiskConfig):
    """Per hour: each signal's capped z in the risky direction (0 when missing), and whether it had data."""
    out = []
    for t in scoring_times(sig, cfg):
        feats = sig.features(t, cfg)
        x = {k: 0.0 if feats[k].z is None else min(max(SIGNALS[k].direction * feats[k].z, 0.0), cfg.z_cap)
             for k in keys}
        out.append((t, x, {k: feats[k].z is not None for k in keys}))
    return out


def _flags(series, model: RiskModel, cfg: RiskConfig) -> list[tuple]:
    st, flags, total = LevelState(), [], sum(model.weights.values())
    for t, x, have in series:
        enough = sum(w for k, w in model.weights.items() if have[k]) >= cfg.min_weight_share * total
        score = sigmoid(model.intercept + sum(w * x[k] for k, w in model.weights.items()))
        raw = raw_level(st.raw, score, model, cfg) if enough else st.raw
        st, flag = advance(st, raw, t, cfg)
        if flag:
            flags.append((t, flag))
    return flags


def objective(risk: str, model: RiskModel, series: dict, outcomes: dict, cfg: RiskConfig) -> float:
    j = 0.0
    for pid, s in series.items():
        spec, outcome = SPEC[pid], outcomes.get(pid)
        own = spec.storyline == risk
        weight = 1.0 if spec.storyline == "control" else OTHER_STORYLINE
        got = {"elevated": False, "watch": False}
        for t, level in _flags(s, model, cfg):
            if own and outcome["onset"] <= t < outcome["time"]:
                if not got[level]:
                    got[level] = True
                    lead = min(hours_before(t, outcome["time"]), MAX_LEAD_H) / MAX_LEAD_H
                    j += lead if level == "elevated" else 0.25 * lead
            else:
                j -= (1.0 if own else weight) * (FALSE_ELEVATED if level == "elevated" else FALSE_WATCH)
    return j


def tune_risk(risk: str, signals: dict[str, PatientSignals], outcomes: dict, cfg: RiskConfig) -> RiskModel:
    prior = PRIORS[risk]
    series = {pid: _series(sig, list(prior), cfg) for pid, sig in signals.items()}
    mult = {k: 1.0 for k in prior}

    def best_for(m: dict) -> tuple[float, RiskModel]:
        weights = {k: round(prior[k] * m[k], 2) for k in prior}
        pull = PRIOR_PULL * sum(abs(math.log(v)) for v in m.values())
        best = None
        for watch, elevated in THRESHOLDS:
            model = RiskModel(MODELS[risk].label, INTERCEPT, weights, watch, elevated)
            j = objective(risk, model, series, outcomes, cfg) - pull
            if best is None or j > best[0] + 1e-9:
                best = (j, model)
        return best

    current = best_for(mult)
    for _ in range(PASSES):
        for k in prior:
            for v in MULTIPLIERS:
                if v == mult[k]:
                    continue
                trial = best_for(mult | {k: v})
                if trial[0] > current[0] + 1e-9:
                    mult, current = mult | {k: v}, trial
    return current[1]


def tune(cohort: Cohort | None = None, cfg: RiskConfig = DEFAULT) -> dict[str, RiskModel]:
    cohort = cohort or generate(get_catalog())
    signals = training_signals(cohort)
    outcomes = {o["patient_id"]: o for o in cohort.outcomes if o["patient_id"] in signals}
    return {risk: tune_risk(risk, signals, outcomes, cfg) for risk in PRIORS}


def main():
    models = tune()
    print("# Tuned by `python -m app.risk.tune` on the training split only.")
    print("MODELS = {")
    for risk, m in models.items():
        print(f"    {risk!r}: RiskModel(\n        {m.label!r}, {m.intercept},\n        {m.weights!r},\n"
              f"        watch={m.watch}, elevated={m.elevated}),")
    print("}")


if __name__ == "__main__":
    main()
