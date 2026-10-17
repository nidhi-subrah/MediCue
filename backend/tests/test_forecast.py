from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.risk import forecast as fc
from app.risk.config import DEFAULT

NOW = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
FALL = DEFAULT.models["fall"]


def series(*scores, step_h=6):
    return [(NOW - timedelta(hours=step_h * (len(scores) - 1 - i)), s) for i, s in enumerate(scores)]


def test_trend_reads_rising_steady_and_easing():
    assert fc.trend(series(0.2, 0.3, 0.4, 0.5), NOW)["direction"] == "rising"
    assert fc.trend(series(0.3, 0.31, 0.3, 0.3), NOW)["direction"] == "steady"
    assert fc.trend(series(0.6, 0.5, 0.4, 0.3), NOW)["direction"] == "easing"
    assert fc.trend(series(0.2, 0.3), NOW)["direction"] == "unknown"


def test_only_recent_history_counts_toward_the_trend():
    old_rise = [(NOW - timedelta(days=5) + timedelta(hours=6 * i), 0.1 * i) for i in range(5)]
    assert fc.trend(old_rise + series(0.3, 0.3, 0.3, 0.3), NOW)["direction"] == "steady"


def test_eta_to_the_next_level_when_rising():
    tr = fc.trend(series(0.3, 0.35, 0.4, 0.45), NOW)          # +0.2 a day
    out = fc.outlook("low", 0.45, FALL, tr)
    assert out["next_word"] == "Watch" and out["eta_hours"] == round((FALL.watch - 0.45) / tr["slope_h"])


def test_no_eta_when_steady_already_high_or_too_far():
    steady = fc.trend(series(0.3, 0.3, 0.3, 0.3), NOW)
    assert fc.outlook("low", 0.3, FALL, steady)["eta_hours"] is None
    rising = fc.trend(series(0.8, 0.85, 0.9, 0.95), NOW)
    assert fc.outlook("elevated", 0.95, FALL, rising)["eta_hours"] is None
    slow = fc.trend(series(0.05, 0.06, 0.07, 0.08), NOW)      # weeks away
    assert fc.outlook("low", 0.08, FALL, slow)["eta_hours"] is None


def test_changes_are_plain_words_with_a_check_and_no_sd():
    c = {"signal": "night_toilet", "value": 4, "baseline": 1, "contribution": 0.4}
    [ch] = fc.changes("fall", [c])
    assert ch["what"] == "Bathroom trips at night" and ch["detail"] == "4 in the last day, usually about 1"
    assert "call bell" in ch["check"]
    [tired] = fc.changes("fall", [{"signal": "fatigue", "value": 2.1, "baseline": 1.4, "contribution": 0.3}])
    assert tired["detail"] == "about 1.5× their usual over the last day"


def test_summary_states_timing_only_as_a_projection():
    tr = fc.trend(series(0.3, 0.35, 0.4, 0.45), NOW)
    out = fc.outlook("low", 0.45, FALL, tr)
    text = fc.summary("Wei Chen", "fall", "low", tr, out, [])
    assert text.startswith("Wei: fall risk is Low and rising") and "if this continues" in text


def test_forecast_endpoint_ranks_who_needs_a_check_first():
    with TestClient(app) as client:
        f = client.get("/api/risk/forecast").json()
        assert f["patients"] and f["counts"]["patients"] == len(f["patients"])
        flags = [p["needs_check"] for p in f["patients"]]
        assert flags == sorted(flags, reverse=True)               # everyone needing a check comes first
        p = f["patients"][0]
        r = p["risks"][0]
        assert r["level_word"] in ("Low", "Watch", "High") and r["summary"] and r["history"]
        assert "SD" not in f["ward_summary"] and all("SD" not in c["detail"] for c in r["changes"])
