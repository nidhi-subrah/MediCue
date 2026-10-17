from fastapi.testclient import TestClient

from app.catalog import get_catalog
from app.config import settings
from app.engine.belief import tap_likelihood
from app.engine.dialogue import Dialogue
from app.engine.personal import PersonalModel
from app.main import app
from app.sim.learning import learning_curve
from tests.conftest import login_as_nurse

cat = get_catalog()
cfg = settings.engine


def test_no_history_means_standard_meanings():
    m = PersonalModel()
    for kind, tap in (("area", "head"), ("feeling", "scared")):
        assert m.likelihood(cat, kind, tap, 0.85) == tap_likelihood(cat, kind, tap, 0.85)


def test_learned_likelihoods_stay_distributions():
    m = PersonalModel()
    for _ in range(5):
        m.add("whole_body", "scared", "too_cold")
    i = cat.index["too_cold"]
    total = sum(m.likelihood(cat, "feeling", f, 1.0)[i] for f in cat.feeling_lik)
    assert abs(total - 1) < 1e-9


def test_gesture_is_read_correctly_after_learning():
    curve = learning_curve(cat, cfg, cat.base_prior, 0.85, {}, "whole_body", "scared", "too_cold", 5)
    assert curve[0]["first_guess"] != "too_cold"               # misread the first time
    assert all(s["first_guess"] == "too_cold" for s in curve[1:])
    p = [s["p_true_after_gesture"] for s in curve]
    assert p == sorted(p) and p[-1] > 3 * p[0]                  # confidence grows with each confirmation
    assert curve[-1]["inputs"] < curve[0]["inputs"]             # fewer interactions
    assert all(s["correct"] for s in curve)


def test_learning_never_suppresses_escalation():
    """Even if 'chest' has meant 'reposition me' ten times, a chest tap still escalates at once."""
    m = PersonalModel()
    for _ in range(10):
        m.add("chest", "uncomfortable", "reposition")
    d = Dialogue(cat, cfg, list(cat.base_prior), 0.85, [], {}, personal=m)
    d.apply_tap("area", "chest", 0)
    assert d.step().chosen.kind == "escalate"


def _session(client, pid, area, feeling, true_need):
    s = client.post("/api/sessions", json={"patient_id": pid, "language": "en"}).json()
    sid = s["session_id"]
    client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": area})
    s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "feeling", "tap_id": feeling}).json()
    after_gesture = next((b["p"] for b in s["belief"] if b["need"] == true_need), 0.0)
    for _ in range(8):
        if s["status"] == "question":
            yes = s["question"]["id"] in (f"need:{true_need}", f"group:{cat.by_id[true_need]['group']}")
            s = client.post(f"/api/sessions/{sid}/answer",
                            json={"question_id": s["question"]["id"], "answer": "yes" if yes else "no"}).json()
        elif s["status"] == "waiting_consult":
            s = client.post(f"/api/sessions/{sid}/skip_consult").json()
        else:
            break
    client.post(f"/api/alerts/{s['alert_id']}/confirm", json={"need_id": true_need})
    return after_gesture, s


def test_nurse_confirmations_teach_the_live_engine():
    with TestClient(app) as client:
        login_as_nurse(client)
        first, _ = _session(client, "p-kowalski", "whole_body", "scared", "too_cold")
        _session(client, "p-kowalski", "whole_body", "scared", "too_cold")
        third, s = _session(client, "p-kowalski", "whole_body", "scared", "too_cold")
        assert third > first
        assert any("nurse-confirmed gesture" in r for r in s["prior_reasons"])
        learned = client.get("/api/patients/p-kowalski/learning").json()
        sig = next(x for x in learned["signals"] if x["area"] == "whole_body" and x["feeling"] == "scared")
        assert sig["need"] == "too_cold" and sig["count"] >= 2 and sig["personal"]


def test_learning_demo_endpoint():
    with TestClient(app) as client:
        login_as_nurse(client)
        r = client.post("/api/patients/p-chen/learning/demo",
                        json={"area": "whole_body", "feeling": "scared", "need": "too_cold", "sessions": 5}).json()
        assert len(r["sessions"]) == 5 and r["sessions"][-1]["inputs"] < r["sessions"][0]["inputs"]
        bad = client.post("/api/patients/p-chen/learning/demo", json={"area": "nose", "feeling": "scared", "need": "too_cold"})
        assert bad.status_code == 409
