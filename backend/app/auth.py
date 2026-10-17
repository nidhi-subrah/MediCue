"""Demo auth: two fixed accounts (patient / nurse), server-side sessions, httpOnly cookie.

Passwords come from env vars so the real values never land in source control (see .env.example).
Falls back to the hackathon demo passwords ("patient" / "nurse") when unset, since this app only
ever holds synthetic data.
"""
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from .data.patients import PATIENT_BY_ID

SESSION_COOKIE = "ss_session"
SESSION_TTL_S = 60 * 60 * 12  # 12h, long enough for a demo/shift without being left open forever

DEMO_PATIENT_ID = os.getenv("DEMO_PATIENT_ID", "p-chen")
if DEMO_PATIENT_ID not in PATIENT_BY_ID:
    DEMO_PATIENT_ID = next(iter(PATIENT_BY_ID))


@dataclass(frozen=True)
class DemoUser:
    id: str
    email: str
    role: str  # "patient" | "nurse"
    name: str
    patient_id: str | None   # set only for role == "patient"
    _salt: bytes
    _hash: bytes

    def public(self) -> dict:
        return {"email": self.email, "role": self.role, "name": self.name, "patient_id": self.patient_id}


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)


def _make_user(id: str, email: str, password: str, role: str, name: str, patient_id: str | None = None) -> DemoUser:
    salt = secrets.token_bytes(16)
    return DemoUser(id, email, role, name, patient_id, salt, _hash_password(password, salt))


USERS_BY_EMAIL: dict[str, DemoUser] = {}


LEGACY_DOMAIN = "@medicare.demo"   # the demo accounts' old addresses still sign in (saved logins, old docs)


def _register(user: DemoUser) -> None:
    USERS_BY_EMAIL[user.email] = user
    USERS_BY_EMAIL[user.email.replace("@medicue.demo", LEGACY_DOMAIN)] = user


_register(_make_user(
    "u-patient-demo", "patient@medicue.demo", os.getenv("DEMO_PATIENT_PASSWORD", "patient"),
    "patient", "Demo Patient", DEMO_PATIENT_ID,
))
_register(_make_user(
    "u-nurse-demo", "nurse@medicue.demo", os.getenv("DEMO_NURSE_PASSWORD", "nurse"),
    "nurse", "Demo Nurse",
))


def demo_accounts() -> list[dict]:
    """The built-in demo logins, for the login page. Empty as soon as real passwords are set in the
    environment, so a deployment with its own passwords never shows them."""
    out = []
    if not os.getenv("DEMO_NURSE_PASSWORD"):
        out.append({"role": "nurse", "email": "nurse@medicue.demo", "password": "nurse"})
    if not os.getenv("DEMO_PATIENT_PASSWORD"):
        out.append({"role": "patient", "email": "patient@medicue.demo", "password": "patient"})
    return out


def verify_password(user: DemoUser, password: str) -> bool:
    return hmac.compare_digest(_hash_password(password, user._salt), user._hash)


# ---- sessions (single-process, in-memory: fine for a demo/hackathon deploy) ------------------------

_sessions: dict[str, tuple[str, float]] = {}  # session_id -> (email, expires_at)


def create_session(email: str) -> str:
    session_id = secrets.token_urlsafe(32)
    _sessions[session_id] = (email, time.time() + SESSION_TTL_S)
    return session_id


def destroy_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


def user_for_session_id(session_id: str | None) -> DemoUser | None:
    """Sync lookup for callers that aren't a plain HTTP dependency (e.g. the WebSocket handshake)."""
    if not session_id:
        return None
    entry = _sessions.get(session_id)
    if not entry:
        return None
    email, expires_at = entry
    if time.time() > expires_at:
        _sessions.pop(session_id, None)
        return None
    return USERS_BY_EMAIL.get(email)


async def current_user(request: Request) -> DemoUser:
    user = user_for_session_id(request.cookies.get(SESSION_COOKIE))
    if not user:
        raise HTTPException(401, "not authenticated")
    return user


async def require_nurse(user: DemoUser = Depends(current_user)) -> DemoUser:
    if user.role != "nurse":
        raise HTTPException(403, "nurse access required")
    return user


def check_patient_access(patient_id: str, user: DemoUser) -> None:
    """Nurses may act on any patient; a patient account only on its own record."""
    if user.role == "nurse":
        return
    if user.role == "patient" and user.patient_id == patient_id:
        return
    raise HTTPException(403, "not authorized for this patient")
