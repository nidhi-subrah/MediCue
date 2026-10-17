"""Risk engine: per patient, per hour, three composite risks from the patient's own signals.

    logit(risk) = intercept + sum_i  w_i * min(max(direction_i * z_i, 0), z_cap)
    score       = 1 / (1 + exp(-logit))

Levels use hysteresis (enter at the threshold, leave only `hysteresis` below it), and a level only
becomes the patient's level after it has held for `hold_hours`; an upward change then fires a flag.
When too little of a model's weight has data, the level is frozen rather than reset to low.

Everything here is deterministic arithmetic over stored signals. No model call, no network.
Outputs are prompts for clinician review, not diagnoses.
"""
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .config import LEVELS, SIGNALS, RiskConfig, RiskModel
from .signals import HOUR, Feature, PatientSignals, floor_hour

RANK = {level: i for i, level in enumerate(LEVELS)}
NOTICE = "For clinician review; not a diagnosis."


@dataclass
class LevelState:
    raw: str = "low"                                        # level after hysteresis, before the hold
    level: str = "low"                                      # level that has held long enough
    up: dict[str, datetime] = field(default_factory=dict)   # level -> since when raw has been at or above it
    down: dict[str, datetime] = field(default_factory=dict) # level -> since when raw has been at or below it

    def public(self) -> dict:
        return {"raw": self.raw, "level": self.level,
                "up": {k: v.isoformat() for k, v in self.up.items()},
                "down": {k: v.isoformat() for k, v in self.down.items()}}

    @classmethod
    def load(cls, d: dict | None) -> "LevelState":
        if not d:
            return cls()
        return cls(d["raw"], d["level"], {k: datetime.fromisoformat(v) for k, v in d["up"].items()},
                   {k: datetime.fromisoformat(v) for k, v in d["down"].items()})


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def contribution(model: RiskModel, key: str, z: float, cfg: RiskConfig) -> float:
    return model.weights[key] * min(max(SIGNALS[key].direction * z, 0.0), cfg.z_cap)


def raw_level(prev: str, score: float, model: RiskModel, cfg: RiskConfig) -> str:
    """Threshold the score with hysteresis: entering needs the threshold, staying needs threshold - margin."""
    for level, threshold in (("elevated", model.elevated), ("watch", model.watch)):
        if score >= threshold or (RANK[prev] >= RANK[level] and score >= threshold - cfg.hysteresis):
            return level
    return "low"


def advance(state: LevelState, raw: str, t: datetime, cfg: RiskConfig) -> tuple[LevelState, str | None]:
    """Apply the hold: the level moves to `raw` only once raw has stayed there `hold_hours`."""
    held = timedelta(hours=cfg.hold_hours)
    up = {lv: state.up.get(lv, t) for lv in ("watch", "elevated") if RANK[raw] >= RANK[lv]}
    down = {lv: state.down.get(lv, t) for lv in ("low", "watch") if RANK[raw] <= RANK[lv]}
    level = state.level
    rises = [lv for lv, since in up.items() if RANK[lv] > RANK[level] and t - since >= held]
    falls = [lv for lv, since in down.items() if RANK[lv] < RANK[level] and t - since >= held]
    if rises:
        level = max(rises, key=RANK.get)
    elif falls:
        level = min(falls, key=RANK.get)
    flag = level if RANK[level] > RANK[state.level] else None
    return LevelState(raw, level, up, down), flag


def _fmt(key: str, v: float | None) -> str:
    return "-" if v is None else SIGNALS[key].fmt.format(v)


def score_risk(model: RiskModel, feats: dict[str, Feature], cfg: RiskConfig) -> dict:
    logit, available = model.intercept, 0.0
    contributors, missing = [], []
    for key, w in model.weights.items():
        f = feats[key]
        if f.z is None:
            missing.append(key)
            continue
        available += w
        c = contribution(model, key, f.z, cfg)
        logit += c
        contributors.append({
            "signal": key, "label": SIGNALS[key].label, "value": f.value, "baseline": f.baseline,
            "z": round(f.z, 2), "direction": "up" if f.z > 0.05 else "down" if f.z < -0.05 else "flat",
            "contribution": round(c, 3), "text": f"{_fmt(key, f.value)} vs usual {_fmt(key, f.baseline)}"})
    contributors.sort(key=lambda c: -c["contribution"])
    return {"score": sigmoid(logit), "logit": logit, "contributors": contributors, "missing": missing,
            "enough_data": available >= cfg.min_weight_share * sum(model.weights.values())}


def reason(model: RiskModel, level: str, scored: dict, flag: str | None, cfg: RiskConfig) -> str:
    top = [c for c in scored["contributors"] if c["contribution"] >= 0.05][:3]
    if not scored["enough_data"]:
        missing = ", ".join(SIGNALS[k].label.lower() for k in scored["missing"])
        text = f"{model.label}: not enough recent data to score ({missing} missing); level held at {level}."
    elif not top:
        text = f"{model.label} {level}: every signal is within this patient's usual range."
    else:
        parts = [f"{c['label'].lower()} {c['direction']} ({c['text']}, {abs(c['z']):.1f} SD)" for c in top]
        text = f"{model.label} {level}: " + "; ".join(parts) + "."
        if flag:
            text += f" Held for {cfg.hold_hours:g} h."
    return f"{text} {NOTICE}"


def score_patient(patient_id: str, sig: PatientSignals, times: list[datetime], cfg: RiskConfig,
                  states: dict[str, LevelState] | None = None) -> tuple[list[dict], dict[str, LevelState]]:
    """Rows for risk_scores at each time, carrying hysteresis state forward from `states`."""
    states = dict(states or {})
    rows = []
    version = cfg.version()
    for t in times:
        feats = sig.features(t, cfg)
        for risk, model in cfg.models.items():
            st = states.get(risk) or LevelState()
            scored = score_risk(model, feats, cfg)
            raw = raw_level(st.raw, scored["score"], model, cfg) if scored["enough_data"] else st.raw
            st, flag = advance(st, raw, t, cfg)
            states[risk] = st
            rows.append({
                "time": t, "patient_id": patient_id, "risk": risk, "label": model.label,
                "score": round(scored["score"], 4), "raw_level": st.raw, "level": st.level, "flag": flag,
                "enough_data": scored["enough_data"], "contributors": scored["contributors"],
                "missing": scored["missing"], "reason": reason(model, st.level, scored, flag, cfg),
                "state": st.public(), "config_version": version,
            })
    return rows, states


def scoring_times(sig: PatientSignals, cfg: RiskConfig) -> list[datetime]:
    """Every hour from when a minimal baseline exists up to (and including the hour after) the last row."""
    if sig.origin is None:
        return []
    t = sig.origin + timedelta(hours=cfg.window_hours) * (cfg.min_baseline_days + 1)
    stop = floor_hour(sig.last) + HOUR
    out = []
    while t <= stop:
        out.append(t)
        t += HOUR
    return out
