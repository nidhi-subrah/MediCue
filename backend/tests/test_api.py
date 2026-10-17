from fastapi.testclient import TestClient

from app.main import app


def run_until_done(client, state, answer="yes"):
    for _ in range(8):
        if state["status"] == "question":
            state = client.post(f"/api/sessions/{state['session_id']}/answer",
                                json={"question_id": state["question"]["id"], "answer": answer}).json()
        elif state["status"] == "waiting_consult":
            state = client.post(f"/api/sessions/{state['session_id']}/skip_consult").json()
        else:
            break
    return state


def test_full_flow_routine_need_then_confirm():
    with TestClient(app) as client:
        assert client.get("/api/health").json()["ok"]
        cat = client.get("/api/catalog").json()
        assert len(cat["needs"]) == 20

        s = client.post("/api/sessions", json={"patient_id": "p-patel", "language": "en"}).json()
        assert s["status"] == "area"
        s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).json()
        assert s["status"] == "feeling"
        s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "feeling", "tap_id": "thirsty"}).json()
        s = run_until_done(client, s)
        assert s["status"] == "sent"
        assert s["belief"][0]["need"] == "thirsty"

        alerts = client.get("/api/alerts?status=open").json()
        alert = next(a for a in alerts if a["id"] == s["alert_id"])
        assert alert["priority"] == "routine"
        assert alert["sbar"]["situation"]
        done = client.post(f"/api/alerts/{alert['id']}/confirm", json={"need_id": "thirsty"}).json()
        assert done["status"] == "confirmed"


def test_chest_pain_escalates_and_pushes_to_nurse_websocket():
    with TestClient(app) as client:
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
            s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "chest"}).json()
            assert s["status"] == "escalated"
            assert s["questions_asked"] == 0
            msg = nurse.receive_json()
            assert msg["type"] == "alert" and msg["alert"]["priority"] == "urgent"
            # patient can still refine the open alert with a feeling tap
            s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "feeling", "tap_id": "pain"}).json()
            assert s["belief"][0]["need"] == "pain_chest"


def test_wrong_input_kind_is_rejected():
    with TestClient(app) as client:
        s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
        r = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "feeling", "tap_id": "pain"})
        assert r.status_code == 409


def test_trends_flag_seeded_patterns():
    with TestClient(app) as client:
        trends = {t["patient_id"]: t for t in client.get("/api/trends").json()}
        assert any(f["metric"] == "pain_needs" for f in trends["p-chen"]["flags"])
        assert any(f["metric"] in ("avg_tap_interval", "avg_taps", "scan_share") for f in trends["p-alvarez"]["flags"])
        assert len(trends["p-chen"]["series"]["pain_needs"]) == 8


def test_research_findings_and_review_feed_prior():
    with TestClient(app) as client:
        findings = client.get("/api/research/findings").json()
        kinds = {f["kind"] for f in findings}
        assert "time_of_day" in kinds
        f = next(f for f in findings if f["kind"] == "time_of_day")
        r = client.post(f"/api/research/findings/{f['id']}/review",
                        json={"status": "rejected", "note": "staffing artefact"}).json()
        assert r["status"] == "rejected"
        client.post("/api/research/run")
        again = {x["id"]: x for x in client.get("/api/research/findings").json()}
        assert again[f["id"]]["status"] == "rejected"


def test_welfare_check_requires_preauthorised_caregiver():
    with TestClient(app) as client:
        r = client.post("/api/welfare", json={"patient_id": "p-chen", "requested_by": "fam-miguel"})
        assert r.status_code == 403
        w = client.post("/api/welfare", json={"patient_id": "p-chen", "requested_by": "fam-lin"}).json()
        assert client.post(f"/api/welfare/{w['id']}/respond").json()["status"] == "responded"


def open_consult(client):
    """Drive p-chen to a pending consult (head + pain, then 'unsure' to every question)."""
    s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
    sid = s["session_id"]
    client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "head"})
    s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "feeling", "tap_id": "pain"}).json()
    for _ in range(5):
        if s["status"] != "question":
            break
        s = client.post(f"/api/sessions/{sid}/answer",
                        json={"question_id": s["question"]["id"], "answer": "unsure"}).json()
    assert s["status"] == "waiting_consult"
    return s


def test_late_consult_answer_keeps_patients_open_question():
    with TestClient(app) as client:
        s = open_consult(client)
        sid, cid = s["session_id"], s["consult"]["id"]
        s = client.post(f"/api/sessions/{sid}/skip_consult").json()
        assert s["status"] == "question"
        qid = s["question"]["id"]
        assert client.post(f"/api/consults/{cid}/answer", json={"need_id": None}).status_code == 200
        after = client.get(f"/api/sessions/{sid}").json()
        assert after["status"] == "question" and after["question"]["id"] == qid
        r = client.post(f"/api/sessions/{sid}/answer", json={"question_id": qid, "answer": "yes"})
        assert r.status_code == 200


def test_consult_answer_outside_options_is_rejected_without_closing_it():
    with TestClient(app) as client:
        s = open_consult(client)
        cid = s["consult"]["id"]
        r = client.post(f"/api/consults/{cid}/answer", json={"need_id": "pain_chest_not_offered"})
        assert r.status_code == 409
        assert client.post(f"/api/consults/{cid}/answer", json={"need_id": None}).status_code == 200
        after = client.get(f"/api/sessions/{s['session_id']}").json()
        assert after["status"] != "waiting_consult" or after["consult"]["id"] != cid  # moved on


def test_alert_confirm_is_once_only():
    with TestClient(app) as client:
        s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
        s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "chest"}).json()
        aid = s["alert_id"]
        assert client.post(f"/api/alerts/{aid}/confirm", json={"need_id": "pain_chest"}).status_code == 200
        assert client.post(f"/api/alerts/{aid}/confirm", json={"need_id": "pain_chest"}).status_code == 409
