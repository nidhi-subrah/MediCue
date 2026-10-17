"""Fixes from the pre-demo bug sweep."""
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import login_as_nurse, login_as_patient


def _receive(ws, kind, pred=lambda m: True):
    for _ in range(40):
        m = ws.receive_json()
        if m["type"] == kind and pred(m):
            return m
    raise AssertionError(f"no {kind} message")


# ---- Urgent help on a patient's tablet reaches the nurse --------------------------------------------

def test_urgent_help_from_the_patients_tablet_alerts_the_nurse():
    with TestClient(app) as nurse_c, TestClient(app) as patient_c:
        login_as_nurse(nurse_c)
        login_as_patient(patient_c)
        with nurse_c.websocket_connect("/ws?channel=nurse") as nurse:
            r = patient_c.post("/api/patients/p-chen/urgent")
            assert r.status_code == 200
            alert = _receive(nurse, "alert", lambda m: m["alert"]["kind"] == "urgent")["alert"]
            assert alert["priority"] == "urgent" and alert["patient_id"] == "p-chen" and alert["status"] == "open"
            assert "pressed Urgent help" in alert["sbar"]["situation"]
            # a second press re-sends the same alert instead of stacking duplicates
            again = patient_c.post("/api/patients/p-chen/urgent").json()
            assert again["id"] == alert["id"] and again["presses"] == 2
            urgent = [a for a in nurse_c.get("/api/alerts").json() if a["kind"] == "urgent"]
            assert len(urgent) == 1
            # the nurse acknowledges it like any non-need alert; a new press afterwards is a new alert
            nurse_c.post(f"/api/alerts/{alert['id']}/confirm", json={"need_id": None})
            assert patient_c.post("/api/patients/p-chen/urgent").json()["id"] != alert["id"]


def test_a_patient_cannot_raise_urgent_help_for_someone_else():
    with TestClient(app) as client:
        login_as_patient(client)
        assert client.post("/api/patients/p-okoye/urgent").status_code == 403
        assert client.post("/api/patients/nobody/urgent").status_code == 404


def test_urgent_help_needs_a_login():
    with TestClient(app) as client:
        assert client.post("/api/patients/p-chen/urgent").status_code == 401


# ---- the logged-in nurse is recorded --------------------------------------------------------------

def test_confirm_and_acknowledge_record_the_logged_in_nurse():
    with TestClient(app) as client:
        login_as_nurse(client)
        name = client.get("/api/auth/me").json()["name"]
        s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
        s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "chest"}).json()
        client.get("/api/alerts")                                     # let the case packet attach
        ack = client.post(f"/api/cases/{s['alert_id']}/acknowledge", json={"nurse": "someone else"}).json()
        assert ack["acknowledged"]["by"] == name
        done = client.post(f"/api/alerts/{s['alert_id']}/confirm",
                           json={"need_id": "pain_chest", "nurse": "someone else"}).json()
        assert done["confirmed_by"] == name
        assert client.get(f"/api/cases/{s['alert_id']}").json()["feedback"]["by"] == name


# ---- analytics says which store it read ----------------------------------------------------------

def test_analytics_says_when_no_tiger_data_is_connected():
    with TestClient(app) as client:
        login_as_nurse(client)
        assert client.get("/api/analytics/tigerdata").json()["store"] == "memory"   # tests run without a database


# ---- demo accounts on the login page -------------------------------------------------------------

def test_demo_accounts_are_listed_only_with_the_built_in_passwords(monkeypatch):
    with TestClient(app) as client:
        listed = client.get("/api/auth/demo-accounts").json()
        assert {a["role"] for a in listed} == {"nurse", "patient"}
        for a in listed:                                              # and they really work
            assert client.post("/api/auth/login", json={"email": a["email"], "password": a["password"]}).status_code == 200
        monkeypatch.setenv("DEMO_NURSE_PASSWORD", "real-secret")
        assert [a["role"] for a in client.get("/api/auth/demo-accounts").json()] == ["patient"]
        monkeypatch.setenv("DEMO_PATIENT_PASSWORD", "another")
        assert client.get("/api/auth/demo-accounts").json() == []
