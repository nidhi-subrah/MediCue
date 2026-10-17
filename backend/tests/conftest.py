"""Shared test helpers. Most of this suite exercises nurse-station flows against the real session
service, so tests log in as the demo nurse account unless they are specifically testing auth itself."""
import os

# The app no longer seeds Mai's 22 synthetic residents (it shows only the 6 unit patients), but the risk
# engine's backtest and API tests need them. Set before anything imports app.config.
os.environ.setdefault("SEED_SYNTHETIC_COHORT", "1")

from fastapi.testclient import TestClient  # noqa: E402


def login_as_nurse(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"email": "nurse@medicue.demo", "password": "nurse"})
    assert r.status_code == 200, r.text


def login_as_patient(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"email": "patient@medicue.demo", "password": "patient"})
    assert r.status_code == 200, r.text