"""Early-warning metrics on the synthetic cohort, reported separately for the train and held-out test split.

    python -m app.risk.evaluate            training split only (safe while developing)
    python -m app.risk.evaluate --test     adds the held-out split: final evaluation only

For each storyline patient: did its own risk reach `elevated` (a fired flag) between onset and the
outcome, and how many hours before the outcome? Flags before onset, and flags on the other two risks,
are counted as false. For controls: every fired flag is false. Synthetic data; a regression check for
the engine, not evidence of clinical performance.
"""
import argparse
import statistics
from datetime import datetime

from ..catalog import get_catalog
from .config import DEFAULT, RiskConfig
from .engine import score_patient, scoring_times
from .signals import PatientSignals
from .synthetic import COHORT, Cohort, generate

SPEC = {s.id: s for s in COHORT}


def patient_signals(cohort: Cohort, patient_id: str) -> PatientSignals:
    return PatientSignals([e for e in cohort.events if e["patient_id"] == patient_id],
                          [c for c in cohort.chart_events if c["patient_id"] == patient_id])


def hours_before(t: datetime, outcome: datetime) -> float:
    return (outcome - t).total_seconds() / 3600


def patient_result(patient_id: str, flags: list[tuple[datetime, str, str]], outcome: dict | None,
                   scored_days: float) -> dict:
    """flags: (time, risk, level) for every fired flag."""
    spec = SPEC[patient_id]
    res = {"patient_id": patient_id, "storyline": spec.storyline, "split": spec.split,
           "confounder": spec.confounder, "scored_days": scored_days, "elevated_lead_h": None,
           "watch_lead_h": None, "false_elevated": 0, "false_watch": 0, "false": []}
    for t, risk, level in flags:
        own = outcome is not None and risk == spec.storyline
        if own and outcome["onset"] <= t < outcome["time"]:
            key = f"{level}_lead_h"
            if res[key] is None:
                res[key] = round(hours_before(t, outcome["time"]), 1)
        else:
            res[f"false_{level}"] += 1
            res["false"].append(f"{risk}:{level}@{t:%m-%d %H:%M}")
    return res


def evaluate(cohort: Cohort, cfg: RiskConfig = DEFAULT, ids: list[str] | None = None) -> list[dict]:
    outcomes = {o["patient_id"]: o for o in cohort.outcomes}
    out = []
    for spec in COHORT:
        if ids is not None and spec.id not in ids:
            continue
        sig = patient_signals(cohort, spec.id)
        times = scoring_times(sig, cfg)
        rows, _ = score_patient(spec.id, sig, times, cfg)
        flags = [(r["time"], r["risk"], r["flag"]) for r in rows if r["flag"]]
        out.append(patient_result(spec.id, flags, outcomes.get(spec.id), len(times) / 24))
    return out


def summarize(results: list[dict]) -> dict:
    stories = [r for r in results if r["storyline"] != "control"]
    controls = [r for r in results if r["storyline"] == "control"]
    leads = [r["elevated_lead_h"] for r in stories if r["elevated_lead_h"] is not None]
    control_days = sum(r["scored_days"] for r in controls)
    return {
        "storylines": len(stories),
        "detected_elevated": len(leads),
        "detected_watch_or_elevated": sum(r["elevated_lead_h"] is not None or r["watch_lead_h"] is not None
                                          for r in stories),
        "median_lead_h": statistics.median(leads) if leads else None,
        "false_elevated_storylines": sum(r["false_elevated"] for r in stories),
        "false_elevated_controls": sum(r["false_elevated"] for r in controls),
        "false_watch_controls": sum(r["false_watch"] for r in controls),
        "control_patient_days": round(control_days, 1),
    }


def main():
    ap = argparse.ArgumentParser(description="Early-warning metrics on the synthetic cohort.")
    ap.add_argument("--test", action="store_true",
                    help="also report the held-out split. Only for the final evaluation, never while tuning.")
    args = ap.parse_args()
    cohort = generate(get_catalog())
    print(f"SYNTHETIC DATA. Risk engine {DEFAULT.version()}, hold {DEFAULT.hold_hours:g} h. "
          "Lead = hours before the outcome that the patient's own risk flag fired.\n")
    for split in ("train", "test") if args.test else ("train",):
        results = evaluate(cohort, DEFAULT, [s.id for s in COHORT if s.split == split])
        print(f"== {split} ==")
        for r in results:
            lead = lambda v: "-" if v is None else f"{v:.0f} h"
            print(f"  {r['patient_id']} {r['storyline']:11} {r['confounder'] or '':17} "
                  f"elevated {lead(r['elevated_lead_h']):>5}  watch {lead(r['watch_lead_h']):>5}  "
                  f"false {', '.join(r['false']) or '-'}")
        print("  " + ", ".join(f"{k} {v}" for k, v in summarize(results).items()) + "\n")


if __name__ == "__main__":
    main()
