"""Catch It Early: compare each patient's last 24 h against their own previous days.

Input rows come from the store's `window_signals` (the Timescale continuous aggregate, or the
in-memory equivalent). Flags are prompts for clinical review, not alarms or diagnoses.
"""
import statistics
from datetime import datetime, timedelta, timezone

WINDOWS = 8  # index 0 = 7 days ago ... index 7 = last 24 h

METRICS = {
    # metric: (label, direction, min absolute change, unit formatter)
    "pain_needs":       ("Pain requests per 24 h", +1, 2.0, "{:.0f}"),
    "high_risk":        ("High-risk signals per 24 h", +1, 1.0, "{:.0f}"),
    "avg_tap_interval": ("Seconds per tap", +1, 1.0, "{:.1f} s"),
    "avg_taps":         ("Taps per resolved need", +1, 0.7, "{:.1f}"),
    "accuracy":         ("First-guess accuracy", -1, 0.15, "{:.0%}"),
    "scan_share":       ("Needs sent in switch-scan mode", +1, 0.25, "{:.0%}"),
    "needs":            ("Total requests per 24 h", +1, 3.0, "{:.0f}"),
}
COMMUNICATION_METRICS = {"avg_tap_interval", "avg_taps", "scan_share"}


def build_trends(rows: list[dict], patients: list[dict], mode_changes: dict[str, int]) -> list[dict]:
    by_patient: dict[str, dict[int, dict]] = {}
    for r in rows:
        by_patient.setdefault(r["patient_id"], {})[int(r["days_ago"])] = r

    out = []
    for p in patients:
        windows = by_patient.get(p["id"], {})
        series = {m: [_num(windows.get(WINDOWS - 1 - i, {}).get(m)) for i in range(WINDOWS)] for m in METRICS}
        flags = []
        for metric, (label, direction, min_abs, fmt) in METRICS.items():
            flag = _flag(p, metric, label, direction, min_abs, fmt, series[metric])
            if flag:
                flags.append(flag)
        out.append({"patient_id": p["id"], "patient_name": p["name"], "room": p["room"], "series": series,
                    "flags": sorted(flags, key=lambda f: -f["z"]),
                    "mode_changes_24h": mode_changes.get(p["id"], 0)})
    return sorted(out, key=lambda t: (-len(t["flags"]), t["room"]))


def _num(v):
    return None if v is None else float(v)


def _flag(patient, metric, label, direction, min_abs, fmt, values):
    current = values[-1]
    baseline = [v for v in values[:-1] if v is not None]
    if current is None or len(baseline) < 3:
        return None
    mean = statistics.mean(baseline)
    sd = statistics.pstdev(baseline)
    diff = (current - mean) * direction
    z = diff / max(sd, 0.1 * abs(mean), min_abs / 2)
    if z < 2 or diff < min_abs:
        return None
    msg = f"{label}: {fmt.format(current)} in the last 24 h vs {fmt.format(mean)} baseline"
    if mean > 0 and direction > 0:
        msg += f" ({current / mean:.1f}×)"
    recent = _recent_chart_events(patient, hours=48)
    if recent:
        msg += f". Recent chart event: {recent[0]}"
    if metric in COMMUNICATION_METRICS:
        msg += ". Communication may be getting harder; consider reviewing the access mode."
    return {"patient_id": patient["id"], "metric": metric, "label": label, "message": msg,
            "current": round(current, 3), "baseline": round(mean, 3), "z": round(z, 2),
            "severity": "attention" if z >= 3 else "review"}


def _recent_chart_events(patient, hours):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return [e["label"] for e in patient.get("chart_events", []) if datetime.fromisoformat(e["time"]) >= since]
