"""Backtest the risk engine on the held-out synthetic patients and print the numbers to quote.

    python -m app.risk.backtest                      held-out split (default), writes docs/backtest/
    python -m app.risk.backtest --split train        the training split, for comparison
    python -m app.risk.backtest --out somewhere/

Reports, per split:
  * lead time before each outcome event: from the first flag on the patient's own risk after the
    storyline began (watch or elevated) to the labelled outcome; median and range over detected storylines
  * detection rate: storylines whose own risk flagged before the outcome (any level, and elevated only)
  * false flags per patient-week on the stable controls, against config.FALSE_ALARM_BUDGET

Writes backtest_<split>.json (exact numbers), .md (the table) and .svg (lead-time chart).
All data is synthetic; this is a regression check for the engine, not evidence of clinical benefit.
"""
import argparse
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

from ..catalog import get_catalog
from ..config import REPO_ROOT
from .config import DEFAULT, FALSE_ALARM_BUDGET, RiskConfig
from .evaluate import evaluate
from .synthetic import COHORT, Cohort, generate

OUT = REPO_ROOT / "docs" / "backtest"
SPLIT_NAME = {"test": "held-out", "train": "training"}


def _stats(values: list[float]) -> dict | None:
    if not values:
        return None
    return {"median": round(statistics.median(values), 1), "min": round(min(values), 1),
            "max": round(max(values), 1), "n": len(values)}


def backtest(cohort: Cohort, split: str = "test", cfg: RiskConfig = DEFAULT) -> dict:
    ids = [s.id for s in COHORT if s.split == split]
    results = evaluate(cohort, cfg, ids)
    outcomes = {o["patient_id"]: o for o in cohort.outcomes}

    stories = []
    for r in (r for r in results if r["storyline"] != "control"):
        leads = {lv: r[f"{lv}_lead_h"] for lv in ("watch", "elevated") if r[f"{lv}_lead_h"] is not None}
        first = max(leads, key=leads.get) if leads else None       # the earlier flag has the larger lead
        lead_h = leads.get(first) if first else None
        stories.append({
            "patient_id": r["patient_id"], "storyline": r["storyline"],
            "outcome": outcomes[r["patient_id"]]["outcome"], "outcome_time": outcomes[r["patient_id"]]["time"],
            "first_flag": first, "lead_h": lead_h, "lead_days": round(lead_h / 24, 2) if lead_h else None,
            "elevated_lead_h": r["elevated_lead_h"], "other_risk_flags": r["false"],
        })

    controls = []
    for r in (r for r in results if r["storyline"] == "control"):
        weeks = r["scored_days"] / 7
        controls.append({"patient_id": r["patient_id"], "confounder": r["confounder"],
                         "patient_weeks": round(weeks, 2), "elevated": r["false_elevated"], "watch": r["false_watch"],
                         "flags": r["false"]})
    weeks = sum(c["patient_weeks"] for c in controls)
    elevated = sum(c["elevated"] for c in controls)
    any_flags = elevated + sum(c["watch"] for c in controls)
    detected = [s for s in stories if s["lead_h"] is not None]
    detected_elev = [s for s in stories if s["elevated_lead_h"] is not None]

    return {
        "split": split, "synthetic": True, "config_version": cfg.version(), "hold_hours": cfg.hold_hours,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": cohort.seed,
        "storylines": stories,
        "detection": {"any_flag": len(detected), "elevated": len(detected_elev), "of": len(stories),
                      "any_flag_rate": round(len(detected) / len(stories), 3) if stories else None,
                      "elevated_rate": round(len(detected_elev) / len(stories), 3) if stories else None},
        "lead_h": _stats([s["lead_h"] for s in detected]),
        "elevated_lead_h": _stats([s["elevated_lead_h"] for s in detected_elev]),
        "controls": controls,
        "false_flags": {
            "control_patient_weeks": round(weeks, 2), "elevated": elevated, "any": any_flags,
            "elevated_per_patient_week": round(elevated / weeks, 3) if weeks else None,
            "any_per_patient_week": round(any_flags / weeks, 3) if weeks else None,
            "budget": {"elevated_per_patient_week": FALSE_ALARM_BUDGET.elevated_per_patient_week,
                       "any_per_patient_week": FALSE_ALARM_BUDGET.any_per_patient_week},
        },
    }


# ---- output ---------------------------------------------------------------------------------------

def _h(v: float | None) -> str:
    return "no flag" if v is None else f"{v:.1f} h ({v / 24:.1f} d)"


def summary_lines(b: dict) -> list[str]:
    d, f, lead = b["detection"], b["false_flags"], b["lead_h"]
    budget = f["budget"]
    within = (f["elevated_per_patient_week"] <= budget["elevated_per_patient_week"]
              and f["any_per_patient_week"] <= budget["any_per_patient_week"])
    out = [
        f"Detection: {d['any_flag']} of {d['of']} storylines flagged before the outcome "
        f"({d['any_flag_rate']:.0%}); {d['elevated']} of {d['of']} reached elevated ({d['elevated_rate']:.0%}).",
    ]
    if lead:
        out.append(f"Lead time: median {lead['median']:.1f} h ({lead['median'] / 24:.1f} days), "
                   f"range {lead['min']:.1f}-{lead['max']:.1f} h ({lead['min'] / 24:.1f}-{lead['max'] / 24:.1f} days), "
                   f"n = {lead['n']}.")
    out.append(f"False flags on stable controls: {f['elevated_per_patient_week']:.2f} elevated and "
               f"{f['any_per_patient_week']:.2f} of any level per patient-week "
               f"({f['elevated']} elevated, {f['any']} total over {f['control_patient_weeks']:.1f} patient-weeks). "
               f"Budget {budget['elevated_per_patient_week']} / {budget['any_per_patient_week']}: "
               f"{'within' if within else 'OVER'}.")
    return out


def table(b: dict) -> str:
    rows = ["| Patient | Storyline | First flag | Lead before outcome | Elevated lead | Other-risk flags |",
            "|---|---|---|---|---|---|"]
    for s in b["storylines"]:
        rows.append(f"| {s['patient_id']} | {s['storyline']} | {s['first_flag'] or '-'} | {_h(s['lead_h'])} | "
                    f"{_h(s['elevated_lead_h'])} | {len(s['other_risk_flags'])} |")
    rows += ["", "| Control | Confounder | Patient-weeks | False elevated | False watch |", "|---|---|---|---|---|"]
    for c in b["controls"]:
        rows.append(f"| {c['patient_id']} | {c['confounder'] or 'none'} | {c['patient_weeks']:.2f} | "
                    f"{c['elevated']} | {c['watch']} |")
    return "\n".join(rows)


def chart_svg(b: dict) -> str:
    """Horizontal bars: hours from the first flag to the outcome, one per storyline. Dot: the elevated flag."""
    stories = b["storylines"]
    row, top, left, right, axis = 34, 64, 150, 90, 34
    width = 640
    plot_w = width - left - right
    height = top + row * len(stories) + axis
    hi = max([24.0] + [s["lead_h"] or 0 for s in stories])
    step = 24 if hi <= 120 else 48
    xmax = step * -(-hi // step)
    x = lambda h: left + h / xmax * plot_w
    ticks = [step * i for i in range(int(xmax // step) + 1)]
    name = SPLIT_NAME.get(b["split"], b["split"])
    title = f"Lead time before the synthetic outcome ({name} patients)"

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        f'role="img" aria-labelledby="t d" font-family="IBM Plex Sans, system-ui, sans-serif">',
        f'<title id="t">{title}</title>',
        f'<desc id="d">{" ".join(summary_lines(b))} Synthetic data.</desc>',
        "<style>"
        ":root{--surface:#fbfaf7;--ink:#1d1c1a;--ink2:#57544e;--ink3:#7a766d;--grid:#e4e0d7;--bar:#24487a}"
        "@media (prefers-color-scheme: dark){:root{--surface:#1c1b18;--ink:#ebe8e1;--ink2:#aaa59b;--ink3:#8a867d;"
        "--grid:#34322d;--bar:#8fb1e3}}"
        ".bg{fill:var(--surface)}.t{fill:var(--ink);font-size:14px;font-weight:600}"
        ".s{fill:var(--ink3);font-size:11px}.l{fill:var(--ink);font-size:12px}.v{fill:var(--ink2);font-size:12px}"
        ".g{stroke:var(--grid);stroke-width:1}.bar{fill:var(--bar)}"
        ".dot{fill:var(--ink);stroke:var(--surface);stroke-width:2}"
        "</style>",
        f'<rect class="bg" width="{width}" height="{height}"/>',
        f'<text class="t" x="16" y="22">{title}</text>',
        '<text class="s" x="16" y="40">Synthetic data. Bar: first flag on the patient\'s own risk. '
        'Dot: first elevated flag.</text>',
        # legend (two marks, so a legend; text in text tokens)
        f'<rect class="bar" x="{left}" y="48" width="14" height="8" rx="2"/>'
        f'<text class="s" x="{left + 20}" y="56">first flag</text>'
        f'<circle class="dot" cx="{left + 90}" cy="52" r="4.5"/>'
        f'<text class="s" x="{left + 99}" y="56">elevated flag</text>',
    ]
    for t in ticks:
        parts.append(f'<line class="g" x1="{x(t):.1f}" x2="{x(t):.1f}" y1="{top - 4}" y2="{height - axis + 4}"/>'
                     f'<text class="s" x="{x(t):.1f}" y="{height - axis + 20}" text-anchor="middle">{t} h</text>')
    for i, s in enumerate(stories):
        cy = top + i * row + row / 2
        parts.append(f'<text class="l" x="{left - 10}" y="{cy + 4:.1f}" text-anchor="end">'
                     f'{s["patient_id"]} · {s["storyline"]}</text>')
        lead = s["lead_h"]
        if lead is None:
            parts.append(f'<text class="v" x="{left + 4}" y="{cy + 4:.1f}">no flag before the outcome</text>')
            continue
        w, bh = x(lead) - left, 18
        r = min(4, w / 2)   # 4px rounded data end, square at the baseline
        parts.append(
            f'<path class="bar" d="M{left},{cy - bh / 2:.1f}h{w - r:.1f}a{r},{r} 0 0 1 {r},{r}v{bh - 2 * r:.1f}'
            f'a{r},{r} 0 0 1 {-r},{r}h{-(w - r):.1f}z"><title>{s["patient_id"]}: first {s["first_flag"]} flag '
            f'{lead:.1f} h ({lead / 24:.1f} days) before the synthetic {s["storyline"]} event</title></path>')
        parts.append(f'<text class="v" x="{x(lead) + 8:.1f}" y="{cy + 4:.1f}">{lead / 24:.1f} d</text>')
        if s["elevated_lead_h"] is not None:
            parts.append(f'<circle class="dot" cx="{x(s["elevated_lead_h"]):.1f}" cy="{cy:.1f}" r="4.5">'
                         f'<title>elevated flag {s["elevated_lead_h"]:.1f} h before</title></circle>')
    parts.append("</svg>")
    return "\n".join(parts)


def write(b: dict, out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    stem = out / f"backtest_{b['split']}"
    md = (f"# Risk engine backtest: {SPLIT_NAME.get(b['split'], b['split'])} patients (synthetic data)\n\n"
          f"Engine {b['config_version']}, hold {b['hold_hours']:g} h, seed {b['seed']}, generated {b['generated_at']}.\n\n"
          + "\n".join(f"- {line}" for line in summary_lines(b)) + "\n\n" + table(b) + "\n\n"
          f"![Lead time chart](backtest_{b['split']}.svg)\n\n"
          "All data is synthetic. Flags are prompts for clinician review, not diagnoses.\n")
    files = {stem.with_suffix(".json"): json.dumps(b, indent=2, default=str) + "\n",
             stem.with_suffix(".md"): md, stem.with_suffix(".svg"): chart_svg(b) + "\n"}
    for path, text in files.items():
        path.write_text(text)
    return list(files)


def main():
    ap = argparse.ArgumentParser(description="Backtest the risk engine on synthetic patients.")
    ap.add_argument("--split", choices=("test", "train"), default="test")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    b = backtest(generate(get_catalog()), args.split)
    print(f"SYNTHETIC DATA. Backtest on {SPLIT_NAME[args.split]} patients. Engine {b['config_version']}, "
          f"hold {b['hold_hours']:g} h, seed {b['seed']}.\n")
    print(table(b) + "\n")
    for line in summary_lines(b):
        print(line)
    for path in write(b, args.out):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
