from fastapi.testclient import TestClient

from app.catalog import get_catalog
from app.data.patients import PATIENT_BY_ID
from app.engine.research_decision import (Clinician, ResearchConfig, eig_clinician, eig_data, score_actions,
                                          update)
from app.main import app
from app.services.research import template_digest
from app.services.research_data import parse_observation, validate_test
from tests.conftest import login_as_nurse

cat = get_catalog()
cfg = ResearchConfig()


# ---- decision engine ----------------------------------------------------------------------------

def test_information_gain_is_largest_when_uncertain():
    assert eig_data(0.5, 8, 0.5, 0.1, 0.3) > eig_data(0.95, 8, 0.5, 0.1, 0.3)
    assert eig_clinician(0.5, 0.9, 0.2, 0.7) > eig_clinician(0.5, 0.6, 0.2, 0.7)


def test_scores_are_deterministic_and_prefer_free_data_first():
    clin = [Clinician("rn-priya", "Priya S.", "RN", 0.89)]
    kw = dict(n_new=8, p1=0.49, p0=0.11, data_weight=0.25, expected_new_24h=1.0, clinicians=clin, asked=set(), cfg=cfg)
    a, b = score_actions(0.5, **kw), score_actions(0.5, **kw)
    assert [x.public() for x in a] == [x.public() for x in b]
    assert a[0].kind == "CHECK_DATA"
    ask = next(x for x in a if x.kind == "ASK_CLINICIAN")
    assert "unchecked_data" in ask.costs


def test_observer_is_discounted_when_asked_about_their_own_idea():
    own = score_actions(0.6, n_new=0, p1=None, p0=None, data_weight=0, expected_new_24h=0,
                        clinicians=[Clinician("a", "A", "RN", 0.9, originator=True)], asked=set(), cfg=cfg)
    other = score_actions(0.6, n_new=0, p1=None, p0=None, data_weight=0, expected_new_24h=0,
                          clinicians=[Clinician("b", "B", "RN", 0.9)], asked=set(), cfg=cfg)
    assert own[0].eig < other[0].eig or own[0].kind == "WAIT"


def test_confidence_update_is_bounded():
    assert 0.01 <= update(0.5, -50) and update(0.5, 50) <= 0.99


# ---- observation parsing ------------------------------------------------------------------------

def test_observation_becomes_family_visit_test():
    p = parse_observation(cat, "Mr. Chen seems more anxious after his daughter leaves.", PATIENT_BY_ID, None)
    assert p["patient_id"] == "p-chen"
    assert p["need_ids"] == ["anxious"]
    assert p["test"]["type"] == "after_event"
    assert p["claim"] == "Wei Chen becomes more anxious after family visits end"


def test_untestable_observation_still_becomes_hypothesis_spec():
    p = parse_observation(cat, "Something seems off with Mrs. Kowalski lately.", PATIENT_BY_ID, None)
    assert p["patient_id"] == "p-kowalski" and p["test"] is None


def test_llm_specs_are_validated_against_vocabulary():
    assert validate_test(cat, {"type": "time_window", "patient_id": "p-chen", "need_ids": ["made_up"], "hours": [18]},
                         PATIENT_BY_ID) is None
    assert validate_test(cat, {"type": "drop_tables", "patient_id": "p-chen"}, PATIENT_BY_ID) is None
    ok = {"type": "time_window", "patient_id": "p-chen", "need_ids": ["anxious"], "hours": [18, 19]}
    assert validate_test(cat, ok, PATIENT_BY_ID) == ok


def test_digest_fallback_text():
    text = template_digest({"changed": 2, "clinician_gained": 1, "system_inconclusive": 1, "pending_review": 1,
                            "waiting_clinician": 0, "statements": []})
    assert text == ("2 hypotheses changed this shift. 1 clinician observation gained support. "
                    "1 system-generated hypothesis remains inconclusive. 1 hypothesis is waiting for clinical lead review.")


# ---- full loop through the API ------------------------------------------------------------------

def test_demo_observation_runs_check_data_then_asks_another_clinician():
    with TestClient(app) as client:
        login_as_nurse(client)
        hs = client.get("/api/research/hypotheses").json()
        h = next(x for x in hs if x["origin"] == "clinician")
        kinds = [t["kind"] for t in h["timeline"]]
        assert kinds[0] == "created" and "evidence" in kinds
        assert h["evidence"][0]["source"] == "data" and h["confidence"] > 0.5
        assert h["status"] == "WAITING_FOR_CLINICIAN"
        assert h["asked"] == ["rn-marcus"]          # not Priya, who made the observation
        assert h["decision_trace"]["ranked"][0]["kind"] == "ASK_CLINICIAN"


def test_clinician_answer_then_lead_review_completes_lifecycle():
    with TestClient(app) as client:
        login_as_nurse(client)
        inq = next(i for i in client.get("/api/research/inquiries?status=pending").json() if "family visits" in i["question"])
        h = client.post(f"/api/research/inquiries/{inq['id']}/answer", json={"response": "agree", "note": "seen it"}).json()
        assert h["status"] == "SUPPORTED_PENDING_REVIEW" and h["evidence"][-1]["source"] == "clinician"
        assert client.post(f"/api/research/inquiries/{inq['id']}/answer", json={"response": "agree"}).status_code == 409

        done = client.post(f"/api/research/hypotheses/{h['id']}/review", json={"decision": "validated"}).json()
        assert done["status"] == "VALIDATED"
        assert len(done["timeline"]) > len(h["timeline"])        # history is appended, never replaced
        assert client.post(f"/api/research/hypotheses/{h['id']}/review", json={"decision": "rejected"}).status_code == 409


def test_new_observation_and_rejection_are_preserved_across_cycles():
    with TestClient(app) as client:
        login_as_nurse(client)
        h = client.post("/api/research/observations", json={
            "text": "Irena Kowalski seems more anxious in the evening.", "clinician_id": "psw-joe"}).json()
        assert h["observation_text"] == "Irena Kowalski seems more anxious in the evening."
        assert h["origin"] == "clinician" and h["test"]["type"] == "time_window"

        system = next(x for x in client.get("/api/research/hypotheses").json() if x["origin"] == "system")
        client.post(f"/api/research/hypotheses/{system['id']}/review", json={"decision": "rejected", "note": "artefact"})
        client.post("/api/research/cycle")
        again = {x["id"]: x for x in client.get("/api/research/hypotheses").json()}
        assert again[system["id"]]["status"] == "REJECTED"
        assert client.get("/api/research/digest").json()["text"]


def test_observation_validation():
    with TestClient(app) as client:
        login_as_nurse(client)
        assert client.post("/api/research/observations", json={"text": " ", "clinician_id": "rn-priya"}).status_code == 422
        assert client.post("/api/research/observations", json={"text": "x", "clinician_id": "nobody"}).status_code == 404
