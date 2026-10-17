import asyncio
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.catalog import get_catalog
from app.risk import start
from app.risk import tune as tune_mod
from app.risk.config import DEFAULT, MODELS, RiskModel
from app.risk.engine import NOTICE, LevelState, advance, raw_level, score_patient, score_risk, scoring_times
from app.risk.evaluate import evaluate, summarize
from app.risk.signals import Feature, PatientSignals
from app.risk.synthetic import generate, holdout_ids, tuning_ids

cat = get_catalog()
cohort = generate(cat)
T0 = datetime(2026, 3, 1, tzinfo=timezone.utc)
MODEL = RiskModel("Test risk", -3.0, {"fatigue": 1.0, "fluid_intake": 1.0}, watch=0.5, elevated=0.7)


def feats(**z):
    return {k: Feature(1.0, 1.0, 1.0, z.get(k), 7) for k in ("fatigue", "fluid_intake")}


def test_score_is_additive_one_sided_and_capped():
    s = score_risk(MODEL, feats(fatigue=2.0, fluid_intake=-1.5), DEFAULT)   # fluid falling is the risky way
    assert abs(s["logit"] - (-3.0 + 2.0 + 1.5)) < 1e-9
    assert abs(s["logit"] - MODEL.intercept - sum(c["contribution"] for c in s["contributors"])) < 1e-6
    improving = score_risk(MODEL, feats(fatigue=2.0, fluid_intake=+3.0), DEFAULT)  # more fluid can't hide fatigue
    assert abs(improving["logit"] - (-3.0 + 2.0)) < 1e-9
    capped = score_risk(MODEL, feats(fatigue=50.0, fluid_intake=0.0), DEFAULT)
    assert abs(capped["logit"] - (-3.0 + DEFAULT.z_cap)) < 1e-9


def test_missing_data_is_reported_not_treated_as_normal():
    s = score_risk(MODEL, feats(fatigue=None, fluid_intake=None), DEFAULT)
    assert not s["enough_data"] and set(s["missing"]) == {"fatigue", "fluid_intake"}


def test_hysteresis_keeps_a_level_until_the_score_drops_past_the_margin():
    assert raw_level("low", 0.45, MODEL, DEFAULT) == "low"
    assert raw_level("watch", 0.45, MODEL, DEFAULT) == "watch"
    assert raw_level("watch", 0.35, MODEL, DEFAULT) == "low"
    assert raw_level("elevated", 0.65, MODEL, DEFAULT) == "elevated"
    assert raw_level("elevated", 0.55, MODEL, DEFAULT) == "watch"


def test_flag_fires_only_after_the_level_holds():
    st, flags = LevelState(), []
    for h in range(10):
        st, flag = advance(st, "elevated", T0 + timedelta(hours=h), DEFAULT)
        flags.append(flag)
    assert flags.index("elevated") == DEFAULT.hold_hours and flags.count("elevated") == 1
    # flickering between low and elevated never holds, so never flags
    st, fired = LevelState(), []
    for h in range(24):
        st, flag = advance(st, "elevated" if h % 2 else "low", T0 + timedelta(hours=h), DEFAULT)
        fired.append(flag)
    assert not any(fired) and st.level == "low"


def test_flicker_between_watch_and_elevated_still_holds_watch():
    st, flags = LevelState(), []
    for h in range(8):
        st, flag = advance(st, "elevated" if h % 2 else "watch", T0 + timedelta(hours=h), DEFAULT)
        flags.append(flag)
    assert "watch" in flags and "elevated" not in flags


def _patient(latency_ms: list[int]) -> PatientSignals:
    """One tap-heavy session per hour; latency per day as given."""
    events = []
    for d, ms in enumerate(latency_ms):
        for h in range(8, 20):
            t = T0 + timedelta(days=d, hours=h)
            sid = f"s{d}-{h}"
            events.append({"time": t, "session_id": sid, "event_type": "session_started", "payload": {}})
            for k in range(3):
                events.append({"time": t + timedelta(seconds=k), "session_id": sid, "event_type": "tap",
                               "payload": {"latency_ms": ms + 50 * k}})
    return PatientSignals(events, [])


def test_z_score_is_against_the_patients_own_baseline():
    t = T0 + timedelta(days=8)
    fast = _patient([2000] * 7 + [4000]).features(t, DEFAULT)["tap_latency"]
    slow = _patient([4000] * 7 + [4000]).features(t, DEFAULT)["tap_latency"]
    assert fast.z > 2 and abs(slow.z) < 0.5          # the same 4 s is a big change for one, normal for the other


def test_every_row_is_explained():
    pid = "syn-01"
    sig = PatientSignals([e for e in cohort.events if e["patient_id"] == pid],
                         [c for c in cohort.chart_events if c["patient_id"] == pid])
    rows, _ = score_patient(pid, sig, scoring_times(sig, DEFAULT), DEFAULT)
    assert len(rows) == 3 * len(scoring_times(sig, DEFAULT))
    for r in rows:
        assert 0 <= r["score"] <= 1 and r["level"] in ("low", "watch", "elevated")
        assert r["reason"].endswith(NOTICE)
        assert set(r["missing"]) | {c["signal"] for c in r["contributors"]} == set(DEFAULT.models[r["risk"]].weights)
        for c in r["contributors"]:
            assert {"value", "baseline", "z", "direction", "contribution"} <= set(c)
    again, _ = score_patient(pid, sig, scoring_times(sig, DEFAULT), DEFAULT)
    assert again == rows


def test_tuning_reads_only_training_patients_and_reproduces_config(monkeypatch):
    seen = []
    real = tune_mod.patient_signals
    monkeypatch.setattr(tune_mod, "patient_signals", lambda c, pid: seen.append(pid) or real(c, pid))
    models = tune_mod.tune(cohort)
    assert set(seen) == set(tuning_ids()) and not set(seen) & set(holdout_ids())
    assert models == MODELS, "config.MODELS is stale: re-run `python -m app.risk.tune` and paste its output"


def test_training_split_regression():
    s = summarize(evaluate(cohort, DEFAULT, tuning_ids()))   # held-out split is deliberately not asserted here
    assert s["storylines"] == 9 and s["detected_elevated"] >= 6
    assert s["false_elevated_controls"] == 0


def test_start_never_raises(monkeypatch):
    import app.risk.store as store_mod
    monkeypatch.setattr(store_mod, "make_risk_store", lambda _: 1 / 0)
    assert asyncio.run(start(object())) is None


def test_api_labels_synthetic_and_explains():
    from app.main import app
    with TestClient(app) as client:
        body = client.get("/api/risk/patients").json()
        assert "Synthetic data" in body["notice"] and "not diagnoses" in body["notice"]
        assert len(body["patients"]) == 22 and all(p["synthetic"] for p in body["patients"])
        detail = client.get("/api/risk/patients/syn-01").json()
        assert set(detail["risks"]) == {"fall", "dehydration", "delirium"}
        assert detail["trend"] and detail["history"]
        assert client.get("/api/risk/patients/nobody").status_code == 404


def test_dashboard_endpoints_for_the_ui():
    from app.main import app
    with TestClient(app) as client:
        p = client.get("/api/risk/patients").json()["patients"][0]
        for r in p["risks"].values():
            assert 0 < len(r["spark"]) <= 28 and r["thresholds"]["watch"] < r["thresholds"]["elevated"]
            assert all({"signal", "label"} <= set(m) for m in r["missing"])
        cases = client.get("/api/risk/timeline").json()["cases"]
        assert len(cases) == 13 and all("synthetic" in c["headline"] for c in cases)
        hit = next(c for c in cases if c["lead_days"] is not None)
        t = client.get(f"/api/risk/timeline/{hit['patient_id']}").json()
        assert t["headline"].startswith("Flag fired ") and t["flag"] and t["series"]
        assert t["outcome"]["onset"] <= t["flag"]["time"] < t["outcome"]["time"]
        assert set(t["series"][-1]["z"]) == {s["key"] for s in t["signals"]}
        assert client.get("/api/risk/timeline/syn-08").status_code == 404   # controls have no outcome
