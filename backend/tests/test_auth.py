"""Login, sessions, and that patient/nurse access boundaries actually hold at the API layer."""
from fastapi.testclient import TestClient

from app.auth import DEMO_PATIENT_ID
from app.main import app
from tests.conftest import login_as_nurse, login_as_patient


def test_me_requires_a_session():
    with TestClient(app) as client:
        assert client.get("/api/auth/me").status_code == 401


def test_login_rejects_wrong_password():
    with TestClient(app) as client:
        r = client.post("/api/auth/login", json={"email": "nurse@medicue.demo", "password": "wrong"})
        assert r.status_code == 401


def test_login_rejects_unknown_email():
    with TestClient(app) as client:
        r = client.post("/api/auth/login", json={"email": "nobody@medicue.demo", "password": "nurse"})
        assert r.status_code == 401


def test_nurse_login_sets_session_and_reports_role():
    with TestClient(app) as client:
        login_as_nurse(client)
        me = client.get("/api/auth/me").json()
        assert me["role"] == "nurse"
        assert me["patient_id"] is None


def test_patient_login_reports_own_patient_id():
    with TestClient(app) as client:
        login_as_patient(client)
        me = client.get("/api/auth/me").json()
        assert me["role"] == "patient"
        assert me["patient_id"] == DEMO_PATIENT_ID


def test_logout_clears_the_session():
    with TestClient(app) as client:
        login_as_nurse(client)
        assert client.get("/api/auth/me").status_code == 200
        client.post("/api/auth/logout")
        assert client.get("/api/auth/me").status_code == 401


def test_nurse_only_endpoint_rejects_patient_with_403():
    with TestClient(app) as client:
        login_as_patient(client)
        assert client.get("/api/patients").status_code == 403
        assert client.get("/api/alerts").status_code == 403
        assert client.get("/api/communication").status_code == 403


def test_nurse_only_endpoint_allows_nurse():
    with TestClient(app) as client:
        login_as_nurse(client)
        assert client.get("/api/patients").status_code == 200
        assert client.get("/api/alerts").status_code == 200


def test_unauthenticated_requests_are_rejected():
    with TestClient(app) as client:
        assert client.get("/api/patients").status_code == 401
        assert client.post("/api/sessions", json={"patient_id": DEMO_PATIENT_ID}).status_code == 401


def test_patient_cannot_start_a_session_for_someone_else():
    with TestClient(app) as client:
        login_as_patient(client)
        other = next(p for p in ["p-alvarez", "p-okoye", "p-patel"] if p != DEMO_PATIENT_ID)
        r = client.post("/api/sessions", json={"patient_id": other})
        assert r.status_code == 403


def test_patient_can_start_and_drive_their_own_session():
    with TestClient(app) as client:
        login_as_patient(client)
        s = client.post("/api/sessions", json={"patient_id": DEMO_PATIENT_ID}).json()
        assert s["status"] == "area"
        got = client.get(f"/api/sessions/{s['session_id']}")
        assert got.status_code == 200


def test_patient_cannot_read_or_drive_another_patients_session():
    with TestClient(app) as client:
        # A nurse opens another patient's session...
        login_as_nurse(client)
        other = next(p for p in ["p-alvarez", "p-okoye", "p-patel"] if p != DEMO_PATIENT_ID)
        s = client.post("/api/sessions", json={"patient_id": other}).json()
        sid = s["session_id"]

        # ...and the demo patient must not be able to read or act on it, even knowing its id.
        login_as_patient(client)
        assert client.get(f"/api/sessions/{sid}").status_code == 403
        assert client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).status_code == 403


def test_patient_cannot_view_another_patients_record_by_changing_the_id():
    with TestClient(app) as client:
        login_as_patient(client)
        other = next(p for p in ["p-alvarez", "p-okoye", "p-patel"] if p != DEMO_PATIENT_ID)
        assert client.get(f"/api/patients/{other}").status_code == 403
        assert client.get(f"/api/patients/{DEMO_PATIENT_ID}").status_code == 200
