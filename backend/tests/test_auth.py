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
        r = client.post("/api/auth/login", json={"email": "nobody@medicue.demo", "password": "Rn-Lantern-6307!"})
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


# ---- signed sessions: one login works on every backend instance (Vercel runs many) --------------------

import os  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402

from app import auth  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def shared_secret(monkeypatch):
    """Every instance configured with the same SESSION_SECRET, as in production."""
    monkeypatch.setattr(auth, "_SECRET", b"test-session-secret")
    return "test-session-secret"


def test_login_then_many_authenticated_requests():
    with TestClient(app) as client:
        login_as_nurse(client)
        for _ in range(5):
            assert client.get("/api/auth/me").status_code == 200
            assert client.get("/api/patients").status_code == 200
            assert client.get("/api/research/hypotheses").status_code == 200


def test_concurrent_requests_with_one_login_all_succeed():
    with TestClient(app) as client:
        login_as_nurse(client)
        with ThreadPoolExecutor(8) as pool:
            codes = list(pool.map(lambda _: client.get("/api/patients").status_code, range(24)))
        assert codes == [200] * 24


def test_session_issued_by_one_instance_is_accepted_by_another(shared_secret):
    """A separate Python process is a separate instance: no shared memory, only the shared secret."""
    token = auth.create_session("nurse@medicue.demo")
    code = ("from app.auth import user_for_session_id; import sys; "
            "u = user_for_session_id(sys.argv[1]); print(u.email if u else None, u.role if u else None)")
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"} | {"SESSION_SECRET": shared_secret}
    r = subprocess.run([sys.executable, "-c", code, token], cwd=BACKEND, env=env, capture_output=True, text=True,
                       timeout=60)
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == ["nurse@medicue.demo", "nurse"]


def test_instance_with_a_different_secret_rejects_the_session():
    token = auth.create_session("nurse@medicue.demo")
    code = "from app.auth import user_for_session_id; import sys; print(user_for_session_id(sys.argv[1]))"
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"} | {"SESSION_SECRET": "another-secret"}
    r = subprocess.run([sys.executable, "-c", code, token], cwd=BACKEND, env=env, capture_output=True, text=True,
                       timeout=60)
    assert r.stdout.strip() == "None"


def test_tampered_or_expired_sessions_are_rejected(shared_secret):
    token = auth.create_session("patient@medicue.demo")
    payload, signature = token.split(".")
    forged = auth._b64(auth.json.dumps({"e": "nurse@medicue.demo", "x": int(time.time()) + 3600, "n": "x"},
                                       separators=(",", ":")).encode())
    assert auth.user_for_session_id(f"{forged}.{signature}") is None            # payload swapped
    assert auth.user_for_session_id(f"{payload}.{signature[:-2]}AA") is None    # signature altered
    assert auth.user_for_session_id("not-a-token") is None
    assert auth.user_for_session_id(auth.create_session("nurse@medicue.demo", now=time.time() - auth.SESSION_TTL_S - 5)) is None


def test_role_checks_still_apply_with_signed_sessions():
    with TestClient(app) as client:
        login_as_patient(client)
        assert client.get("/api/auth/me").json()["role"] == "patient"
        assert client.get("/api/patients").status_code == 403


def test_logout_ends_the_session():
    with TestClient(app) as client:
        login_as_nurse(client)
        token = client.cookies.get(auth.SESSION_COOKIE)
        client.post("/api/auth/logout")
        assert client.get("/api/auth/me").status_code == 401                      # cookie cleared
        client.cookies.set(auth.SESSION_COOKIE, token)
        assert client.get("/api/auth/me").status_code == 401                      # revoked on this instance


def test_health_reports_whether_sessions_are_shared():
    with TestClient(app) as client:
        assert "shared_sessions" in client.get("/api/health").json()
