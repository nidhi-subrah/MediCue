"""Demo auth: two fixed accounts (patient / nurse), signed session cookies (httpOnly).

Passwords come from env vars so the real values never land in source control (see .env.example).
Falls back to the demo passwords in DEFAULT_PASSWORDS when unset, since this app only ever holds
synthetic data.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from .data.patients import PATIENT_BY_ID

log = logging.getLogger(__name__)

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

# Deliberately not common words: "patient" / "nurse" are on breached-password lists, so browsers warn on them.
DEFAULT_PASSWORDS = {"patient": "Pt-Harbor-4821!", "nurse": "Rn-Lantern-6307!"}


LEGACY_DOMAIN = "@medicare.demo"   # the demo accounts' old addresses still sign in (saved logins, old docs)


def _register(user: DemoUser) -> None:
    USERS_BY_EMAIL[user.email] = user
    USERS_BY_EMAIL[user.email.replace("@medicue.demo", LEGACY_DOMAIN)] = user


_register(_make_user(
    "u-patient-demo", "patient@medicue.demo", os.getenv("DEMO_PATIENT_PASSWORD", DEFAULT_PASSWORDS["patient"]),
    "patient", "Demo Patient", DEMO_PATIENT_ID,
))
_register(_make_user(
    "u-nurse-demo", "nurse@medicue.demo", os.getenv("DEMO_NURSE_PASSWORD", DEFAULT_PASSWORDS["nurse"]),
    "nurse", "Demo Nurse",
))


def demo_accounts() -> list[dict]:
    """The built-in demo logins, for the login page. Empty as soon as real passwords are set in the
    environment, so a deployment with its own passwords never shows them."""
    out = []
    if not os.getenv("DEMO_NURSE_PASSWORD"):
        out.append({"role": "nurse", "email": "nurse@medicue.demo", "password": DEFAULT_PASSWORDS["nurse"]})
    if not os.getenv("DEMO_PATIENT_PASSWORD"):
        out.append({"role": "patient", "email": "patient@medicue.demo", "password": DEFAULT_PASSWORDS["patient"]})
    return out


def verify_password(user: DemoUser, password: str) -> bool:
    return hmac.compare_digest(_hash_password(password, user._salt), user._hash)


# ---- sessions -------------------------------------------------------------------------------------
# The cookie carries its own proof: {email, expiry, nonce} signed with HMAC-SHA256 under SESSION_SECRET. Any
# backend instance holding the same secret can verify it, so a login works across serverless invocations
# (Vercel runs many independent instances, each with its own memory; a session kept in one instance's memory
# was invisible to the others, so requests that landed elsewhere got 401). Role and account still come from
# USERS_BY_EMAIL on every request, so authorization is unchanged.

def _load_secret() -> tuple[bytes, bool]:
    configured = os.getenv("SESSION_SECRET", "").strip()
    if configured:
        return configured.encode("utf-8"), True
    # Fine for one local process; across several instances every instance would sign differently.
    log.warning("SESSION_SECRET is not set: sessions only work within this one process. "
                "Set SESSION_SECRET (the same value on every instance) in production.")
    return secrets.token_bytes(32), False


_SECRET, SESSION_SECRET_CONFIGURED = _load_secret()
_revoked: set[str] = set()   # nonces logged out on this instance (other instances rely on the cleared cookie)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    return _b64(hmac.new(_SECRET, payload.encode("ascii"), hashlib.sha256).digest())


def create_session(email: str, now: float | None = None) -> str:
    claims = {"e": email, "x": int((now or time.time()) + SESSION_TTL_S), "n": secrets.token_urlsafe(12)}
    payload = _b64(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
    return f"{payload}.{_sign(payload)}"


def _claims(token: str | None) -> dict | None:
    """The token's claims when the signature is valid and it hasn't expired or been revoked here."""
    if not token or token.count(".") != 1:
        return None
    payload, signature = token.split(".")
    if not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        claims = json.loads(_unb64(payload))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict) or time.time() > claims.get("x", 0) or claims.get("n") in _revoked:
        return None
    return claims


def destroy_session(token: str) -> None:
    claims = _claims(token)
    if claims:
        _revoked.add(claims["n"])


def user_for_session_id(token: str | None) -> DemoUser | None:
    """Sync lookup for callers that aren't a plain HTTP dependency (e.g. the WebSocket handshake)."""
    claims = _claims(token)
    return USERS_BY_EMAIL.get(claims["e"]) if claims else None


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
