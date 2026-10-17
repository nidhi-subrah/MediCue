"""Risk engine configuration: the signals, one additive log-odds model per risk, levels and hysteresis.

Each signal is z-scored against the patient's own trailing 7-day baseline. A model adds
`weight x z` for each of its signals, counting only movement in the risky direction and capping z,
so one wild signal cannot dominate and an improving signal cannot hide a worsening one.

Weights and level thresholds come from `python -m app.risk.tune`, which reads only the training
split (synthetic.tuning_ids()). Re-run it after changing signals or the generator and paste its output
into MODELS. tests/test_risk_engine.py fails if MODELS drifts from what tuning produces.
"""
import hashlib
from dataclasses import dataclass, field

LEVELS = ("low", "watch", "elevated")


@dataclass(frozen=True)
class Signal:
    label: str
    direction: int      # +1: a rise is the risky direction; -1: a fall is
    min_scale: float    # floor on the baseline spread, in the signal's own unit (counts: 1 event, ~Poisson noise)
    fmt: str            # how a value reads in a reason, e.g. "{:.0f} mL"


SIGNALS = {
    "night_toilet":      Signal("Night bathroom requests", +1, 1.0, "{:.0f}"),
    "night_requests":    Signal("Night-time requests", +1, 1.0, "{:.0f}"),
    "tap_latency":       Signal("Seconds per tap", +1, 0.25, "{:.1f} s"),
    "tap_variability":   Signal("Tap timing variability", +1, 0.05, "{:.2f}"),
    "tap_inconsistency": Signal("Mis-taps corrected", +1, 0.03, "{:.0%}"),
    "fatigue":           Signal("Fatigue score", +1, 0.1, "{:.2f}"),
    "fluid_intake":      Signal("Fluid intake", -1, 150.0, "{:.0f} mL"),
    "missed_meals":      Signal("Missed meals", +1, 1.0, "{:.0f}"),
    "discomfort":        Signal("Pain/discomfort reports", +1, 1.0, "{:.0f}"),
    "new_discomfort":    Signal("New kinds of discomfort", +1, 1.0, "{:.0f}"),
}


@dataclass(frozen=True)
class RiskModel:
    label: str
    intercept: float            # log-odds with every signal at the patient's baseline
    weights: dict[str, float]   # log-odds per baseline SD of movement in the risky direction
    watch: float                # score that enters "watch"
    elevated: float             # score that enters "elevated"


# Tuned by `python -m app.risk.tune` on the training split only.
MODELS = {
    'fall': RiskModel(
        'Fall risk', -3.0,
        {'night_toilet': 0.5, 'tap_latency': 0.3, 'tap_variability': 0.2, 'fatigue': 0.4},
        watch=0.6, elevated=0.9),
    'dehydration': RiskModel(
        'Dehydration concern', -3.0,
        {'fluid_intake': 0.5, 'missed_meals': 0.35, 'fatigue': 0.6, 'discomfort': 0.2},
        watch=0.6, elevated=0.8),
    'delirium': RiskModel(
        'Delirium/infection concern', -3.0,
        {'night_requests': 0.35, 'tap_inconsistency': 0.5, 'new_discomfort': 0.6, 'tap_variability': 0.6},
        watch=0.5, elevated=0.7),
}


@dataclass(frozen=True)
class RiskConfig:
    models: dict[str, RiskModel] = field(default_factory=lambda: dict(MODELS))
    window_hours: int = 24          # "recent" window the score looks at
    baseline_days: int = 7          # trailing baseline: the 7 windows before the recent one
    min_baseline_days: int = 4      # fewer usable baseline windows -> the signal counts as missing
    z_cap: float = 4.0              # cap on any one signal's z
    hysteresis: float = 0.1         # a level is left only when the score drops this far below its entry threshold
    hold_hours: float = 4.0         # a level change must hold this long before it becomes the level (and flags)
    min_weight_share: float = 0.5   # share of a model's weight that must have data, else the level is frozen

    def version(self) -> str:
        return hashlib.sha1(repr(self).encode()).hexdigest()[:8]


DEFAULT = RiskConfig()


@dataclass(frozen=True)
class FalseAlarmBudget:
    """Most false flags the engine may raise on stable control patients, per patient-week.

    A product decision, not a tuned value: tests/test_safety.py fails if the backtest goes over it.
    """
    elevated_per_patient_week: float = 0.5
    any_per_patient_week: float = 1.0


FALSE_ALARM_BUDGET = FalseAlarmBudget()
