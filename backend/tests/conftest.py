"""Shared test helpers. Most of this suite exercises nurse-station flows against the real session
service, so tests log in as the demo nurse account unless they are specifically testing auth itself."""
from fastapi.testclient import TestClient


def login_as_nurse(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"email": "nurse@medicure.test", "password": "Rn-Lantern-6307!"})
    assert r.status_code == 200, r.text


def login_as_patient(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"email": "patient@medicure.test", "password": "Pt-Harbor-4821!"})
    assert r.status_code == 200, r.text