"""MediCue API.

    uvicorn app.main:app --reload        (from backend/)
"""
import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from typing import Literal

from pydantic import BaseModel, Field

from .auth import (
    DemoUser, SESSION_COOKIE, SESSION_TTL_S, USERS_BY_EMAIL, check_patient_access, create_session, demo_accounts,
    current_user, destroy_session, require_nurse, user_for_session_id, verify_password,
)
from .catalog import get_catalog
from .config import settings
from .data import seed
from .data.unit_history import ensure_unit_history
from .data.patients import CLINICAL_LEAD, PATIENT_BY_ID, PATIENTS, PERSON_BY_ID, STAFF
from .risk import router as risk_router, start as start_risk, start_silence
from .services.analytics import get_belief_evolution, get_decision_action_history, tigerdata_overview
from .services.gemini import Gemini
from .services.handoff import build_handoff
from .services.nurse_views import RANGES, NurseViews
from .services.hub import Hub
from .services.predictions import PredictionService
from .services.profiles import ProfileService
from .services.research import ResearchAgent
from .services.sessions import SessionService
from .services.trends import build_trends
from .sim.simulator import calibrate
from .store import make_store

if sys.platform == "win32":
    # psycopg's async driver (Tiger Data) can't run on Windows' default Proactor loop. This covers scripts and
    # the test client; uvicorn picks its loop before importing the app, so run it with --reload on Windows.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("medicue")


@asynccontextmanager
async def lifespan(app: FastAPI):
    cat = get_catalog()
    store = make_store()
    await store.init()
    if settings.seed_demo_data and await store.is_empty():
        rows, events = seed.generate(cat)
        for r in rows:
            r["origin"] = "synthetic_history"
        for e in events:
            e["origin"] = "synthetic_history"
        await store.bulk_seed(rows, events)
        log.info("seeded %d synthetic confirmations", len(rows))
    app.state.risk = await start_risk(store)
    if settings.seed_demo_data:   # the unit patients' taps, chart events and risk scores (data/unit_history.py)
        await ensure_unit_history(store, app.state.risk, cat)
    conformal = await asyncio.to_thread(calibrate, cat, settings.engine)
    log.info("conformal q̂ = %.3f from %d calibration dialogues", conformal.qhat, conformal.n_calibration)
    gemini = Gemini()
    log.info("Gemini %s", "enabled" if gemini.enabled else "disabled (template fallbacks)")
    app.state.cat, app.state.store, app.state.gemini = cat, store, gemini
    app.state.hub = Hub()
    app.state.profiles = ProfileService(cat, store, gemini, app.state.hub)
    app.state.predictions = PredictionService(cat, store, gemini, app.state.profiles)
    app.state.svc = SessionService(cat, settings.engine, store, app.state.hub, gemini, conformal, app.state.profiles,
                                   app.state.predictions)
    app.state.silence = start_silence(app.state.svc, app.state.risk)
    app.state.research = ResearchAgent(cat, store, gemini, app.state.hub)
    app.state.nurse_views = NurseViews(cat, store, app.state.risk, gemini, app.state.profiles)

    # Profiles (one Gemini request for the whole unit), then the first research cycle. With Gemini on this
    # runs in the background so rate-limit retries never delay startup; sessions use whatever profile is
    # ready and never wait for Gemini. With Gemini off it is quick and runs before the app serves requests.
    async def background_start():
        try:
            await app.state.profiles.warm()
        except Exception:
            log.exception("profile extraction failed")
        try:
            await app.state.svc.lang.warm()
        except Exception:
            log.exception("adaptive wording failed (catalog wording kept)")
        try:
            await app.state.research.ensure_demo_observation()
            await app.state.research.cycle()
        except Exception:
            log.exception("initial research cycle failed")

    if gemini.enabled:
        warm = asyncio.create_task(background_start())
    else:
        await background_start()
        warm = None
    ticker = asyncio.create_task(_research_ticker(app.state.research))
    yield
    if app.state.silence:
        await app.state.silence.stop()
    ticker.cancel()
    if warm:
        warm.cancel()
    await store.close()


async def _research_ticker(agent: ResearchAgent):
    """Re-check every active hypothesis periodically: new confirmed needs arrive as the unit works."""
    while True:
        await asyncio.sleep(settings.research_tick_s)
        try:
            await agent.cycle()
        except Exception:
            log.exception("research cycle failed")


app = FastAPI(title="MediCue", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])
app.include_router(risk_router)


def svc() -> SessionService:
    return app.state.svc


def _need(fn, *args):
    try:
        return fn(*args)
    except KeyError as e:
        raise HTTPException(404, f"not found: {e}") from e


# ---- reference data -------------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"ok": True, "gemini": app.state.gemini.enabled, "gemini_paused_s": round(app.state.gemini.paused_for),
            "store": type(app.state.store).__name__,
            "conformal_qhat": svc().conformal.qhat}


@app.get("/api/catalog")
async def catalog():
    return app.state.cat.public()


# ---- auth -------------------------------------------------------------------------------------------

class LoginBody(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
async def login(body: LoginBody, response: Response):
    user = USERS_BY_EMAIL.get(body.email.strip().lower())
    if not user or not verify_password(user, body.password):
        raise HTTPException(401, "incorrect email or password")
    session_id = create_session(user.email)
    response.set_cookie(
        SESSION_COOKIE, session_id, httponly=True, samesite="lax", max_age=SESSION_TTL_S, path="/",
    )
    return user.public()


@app.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    session_id = request.cookies.get(SESSION_COOKIE)
    if session_id:
        destroy_session(session_id)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/demo-accounts")
async def auth_demo_accounts():
    """Demo logins shown on the login page, only while the built-in demo passwords are in use."""
    return demo_accounts()


@app.get("/api/auth/me")
async def me(user: DemoUser = Depends(current_user)):
    return user.public()


@app.get("/api/patients")
async def patients(user: DemoUser = Depends(require_nurse)):
    return [await svc().patient_view(p["id"]) for p in PATIENTS]


@app.post("/api/patients/{pid}/urgent")
async def patient_urgent(pid: str, user: DemoUser = Depends(current_user)):
    """Urgent help pressed on this patient's tablet: alerts the nurse station at once."""
    if pid not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")
    check_patient_access(pid, user)
    return await svc().patient_urgent(pid, user.email)


@app.get("/api/patients/{pid}")
async def patient(pid: str, user: DemoUser = Depends(current_user)):
    if pid not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")
    check_patient_access(pid, user)
    return await svc().patient_view(pid)


@app.get("/api/people/{person_id}")
async def person(person_id: str):
    p = PERSON_BY_ID.get(person_id)
    if not p:
        raise HTTPException(404, "unknown person")
    return {"id": p["id"], "name": p["name"], "relation": p["relation"], "patient_id": p["patient_id"],
            "patient_name": PATIENT_BY_ID[p["patient_id"]]["name"]}


# ---- patient sessions -----------------------------------------------------------------------------

class StartBody(BaseModel):
    patient_id: str
    language: str | None = None
    mode: str = "grid"


class TapBody(BaseModel):
    kind: str          # "area" | "feeling"
    tap_id: str
    option_id: str | None = None   # which tailored option sent this feeling tap (engine/options.py)
    confirm_ms: int = 0            # time spent on an "Is that right?" confirmation (not counted as slowness)


class AnswerBody(BaseModel):
    question_id: str
    answer: str        # "yes" | "no" | "unsure"


class ModeBody(BaseModel):
    mode: str


class SignalBody(BaseModel):
    kind: Literal["miss", "correction", "deletion", "read_aloud"]


class LanguageBody(BaseModel):
    language: str
    by: Literal["patient", "nurse"] = "patient"


class AudioBody(BaseModel):
    enabled: bool
    by: Literal["patient", "nurse"] = "patient"


class OfferBody(BaseModel):
    offer: Literal["audio_first", "assisted"]
    choice: Literal["accept", "decline", "get_nurse", "ask_caregiver", "keep_trying"]


class LevelBody(BaseModel):
    level: int = Field(ge=1, le=4)
    by: Literal["patient", "nurse"] = "patient"


async def _call(coro):
    try:
        return await coro
    except KeyError as e:
        raise HTTPException(404, f"not found: {e}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e


async def _require_session_access(sid: str, user: DemoUser = Depends(current_user)) -> DemoUser:
    """A session belongs to one patient; nurses may touch any, a patient only their own."""
    s = _need(svc().sessions.__getitem__, sid)
    check_patient_access(s.patient["id"], user)
    return user


@app.post("/api/sessions")
async def start_session(body: StartBody, user: DemoUser = Depends(current_user)):
    check_patient_access(body.patient_id, user)
    return await _call(svc().start(body.patient_id, body.language, body.mode))


@app.get("/api/sessions/{sid}")
async def get_session(sid: str, user: DemoUser = Depends(_require_session_access)):
    s = _need(svc().sessions.__getitem__, sid)
    return await svc().state(s)


@app.post("/api/sessions/{sid}/tap")
async def tap(sid: str, body: TapBody, user: DemoUser = Depends(_require_session_access)):
    return await _call(svc().tap(sid, body.kind, body.tap_id, body.option_id, body.confirm_ms))


@app.post("/api/sessions/{sid}/answer")
async def answer(sid: str, body: AnswerBody, user: DemoUser = Depends(_require_session_access)):
    return await _call(svc().answer(sid, body.question_id, body.answer))


@app.post("/api/sessions/{sid}/mode")
async def mode(sid: str, body: ModeBody, user: DemoUser = Depends(_require_session_access)):
    return await _call(svc().set_mode(sid, body.mode))


@app.post("/api/sessions/{sid}/signal")
async def signal(sid: str, body: SignalBody, user: DemoUser = Depends(_require_session_access)):
    """A missed tap, a correction or a "read aloud" press: adaptive communication's signal detection."""
    return await _call(svc().signal(sid, body.kind))


@app.post("/api/sessions/{sid}/level")
async def set_level(sid: str, body: LevelBody, user: DemoUser = Depends(_require_session_access)):
    """Manual "make it easier / harder" from the patient or a nurse (communication mode 1-4)."""
    return await _call(svc().set_level(sid, body.level, body.by))


@app.post("/api/sessions/{sid}/communication/language")
async def set_language(sid: str, body: LanguageBody, user: DemoUser = Depends(_require_session_access)):
    """Explicit language choice. The only way the tablet's language changes; never inferred."""
    return await _call(svc().set_language(sid, body.language, body.by))


@app.post("/api/sessions/{sid}/communication/audio")
async def set_audio(sid: str, body: AudioBody, user: DemoUser = Depends(_require_session_access)):
    """Read aloud on or off (audio-first), by the patient's or a nurse's explicit choice."""
    return await _call(svc().set_audio(sid, body.enabled, body.by))


@app.post("/api/sessions/{sid}/communication/offer")
async def answer_offer(sid: str, body: OfferBody, user: DemoUser = Depends(_require_session_access)):
    """The patient's answer to an adaptation that needs their yes: audio-first, or help communicating."""
    return await _call(svc().respond_offer(sid, body.offer, body.choice))


@app.get("/api/communication")
async def communication(hours: int = 12, user: DemoUser = Depends(require_nurse)):
    """Each patient's communication mode, why it changed (signals, policy, renderer), and this shift's changes."""
    return await svc().communication_overview(hours)


@app.post("/api/sessions/{sid}/skip_consult")
async def skip_consult(sid: str, user: DemoUser = Depends(_require_session_access)):
    return await _call(svc().skip_consult(sid))


@app.post("/api/sessions/{sid}/back")
async def back(sid: str, user: DemoUser = Depends(_require_session_access)):
    """Undo the patient's last input (only while they're still answering; nothing sent yet)."""
    return await _call(svc().back(sid))


# ---- nurse ----------------------------------------------------------------------------------------

class ConfirmBody(BaseModel):
    need_id: str | None = None
    nurse: str = "nurse"          # ignored: the logged-in nurse is recorded
    note: str | None = None      # optional observation; Gemini suggests profile changes from it
    case_helpful: bool | None = None   # verdict on the alert's case packet, if it has one


@app.get("/api/alerts")
async def alerts(status: str | None = None, user: DemoUser = Depends(require_nurse)):
    items = [a for a in svc().alerts.values() if status is None or a["status"] == status]
    items.sort(key=lambda a: a["created_at"], reverse=True)
    return sorted(items, key=lambda a: (a["status"] != "open", a["priority"] != "urgent"))


@app.post("/api/alerts/{aid}/confirm")
async def confirm(aid: str, body: ConfirmBody, user: DemoUser = Depends(require_nurse)):
    if body.need_id and body.need_id not in app.state.cat.index:
        raise HTTPException(422, "unknown need")
    return await _call(svc().confirm(aid, body.need_id, user.name, body.note, body.case_helpful))


class CaseAckBody(BaseModel):
    nurse: str = "nurse"          # ignored: the logged-in nurse is recorded


@app.post("/api/cases/{cid}/acknowledge")
async def case_acknowledge(cid: str, body: CaseAckBody, user: DemoUser = Depends(require_nurse)):
    """"I've read this case packet and I'm on it." The alert stays open until the need is confirmed."""
    return await _call(svc().acknowledge_case(cid, user.name))


@app.post("/api/cases/{cid}/gemini")
async def case_gemini(cid: str, user: DemoUser = Depends(require_nurse)):
    """Ask Gemini again to word a case's SBAR (checked as always; the template stays if it fails or Gemini is off)."""
    return await _call(svc().regenerate_case_sbar(cid))


class DemoRunBody(BaseModel):
    pause_s: float = 0.4          # between scripted inputs, so the tablet and nurse screen can be watched


@app.get("/api/demo/scenarios")
async def demo_scenarios(user: DemoUser = Depends(require_nurse)):
    from .sim.demo_scenarios import SCENARIOS
    return [{k: getattr(sc, k) for k in ("id", "title", "patient_id", "hour", "description")} for sc in SCENARIOS.values()]


@app.post("/api/demo/scenarios/{scenario_id}")
async def demo_run(scenario_id: str, body: DemoRunBody, user: DemoUser = Depends(require_nurse)):
    """Play a scripted scenario through the real session service (synthetic patient; the engine decides)."""
    from .sim.demo_scenarios import SCENARIOS, run_live
    sc = SCENARIOS.get(scenario_id)
    if not sc:
        raise HTTPException(404, "unknown demo scenario")
    out = await _call(run_live(svc(), sc, min(max(body.pause_s, 0.0), 3.0)))
    out["scenario"] = {k: out["scenario"][k] for k in ("id", "title", "patient_id", "hour", "description")}
    return out


@app.get("/api/cases/{cid}")
async def case(cid: str, user: DemoUser = Depends(require_nurse)):
    """A clinician-copilot case record (id = alert id): packet, SBAR and the nurse's feedback."""
    alert = svc().alerts.get(cid)
    found = (alert or {}).get("case") or await app.state.store.get_case(cid)
    if not found:
        raise HTTPException(404, "no case packet for this id")
    return found


async def _trends():
    store = app.state.store
    rows = await store.window_signals(8)
    changes = await store.mode_changes(24)
    return build_trends(rows, PATIENTS, changes)


# ---- nurse views: Unit insights (past) and Care forecast (ahead) --------------------------------------

@app.get("/api/nurse/insights")
async def nurse_insights(range: str = "24h", timeline_hours: int = 12, user: DemoUser = Depends(require_nurse)):
    if range not in RANGES:
        raise HTTPException(422, f"range must be one of {', '.join(RANGES)}")
    return await app.state.nurse_views.insights(range, timeline_hours)


@app.get("/api/nurse/insights/cell")
async def nurse_insights_cell(patient_id: str, start: datetime, bucket: str = "1 hour",
                              user: DemoUser = Depends(require_nurse)):
    if patient_id not in PATIENT_BY_ID or bucket not in ("1 hour", "1 day"):
        raise HTTPException(422, "unknown patient or bucket")
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    return await app.state.nurse_views.cell(patient_id, start, bucket)


@app.get("/api/nurse/forecast")
async def nurse_forecast(user: DemoUser = Depends(require_nurse)):
    return await app.state.nurse_views.forecast()


@app.get("/api/analytics/tigerdata")
async def analytics_tigerdata(patient_id: str | None = None, days: int = 8, user: DemoUser = Depends(require_nurse)):
    if patient_id and patient_id not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")
    return await tigerdata_overview(app.state.store, patient_id, days)


@app.get("/api/analytics/sessions/{sid}/decision-trace")
async def analytics_decision_trace(sid: str, user: DemoUser = Depends(require_nurse)):
    store = app.state.store
    actions = await get_decision_action_history(store, sid)
    belief = await get_belief_evolution(store, app.state.cat, sid)
    if not actions and not belief:
        raise HTTPException(404, "no recorded decision data for this session")
    return {"session_id": sid, "decision_actions": actions, "belief_evolution": belief}


@app.get("/api/trends")
async def trends(user: DemoUser = Depends(require_nurse)):
    return await _trends()


@app.get("/api/handoff")
async def handoff(hours: int = 12, user: DemoUser = Depends(require_nurse)):
    return await build_handoff(app.state.cat, app.state.store, svc(), app.state.profiles, app.state.gemini,
                               await _trends(), max(1, min(hours, 48)))


# ---- patient profiles -----------------------------------------------------------------------------

class NotesBody(BaseModel):
    notes: str


class SuggestionReviewBody(BaseModel):
    approve: bool
    reviewer: str = "nurse"


def _patient_or_404(pid: str):
    if pid not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")


class LearningDemoBody(BaseModel):
    area: str
    feeling: str
    need: str
    sessions: int = 5


@app.get("/api/patients/{pid}/learning")
async def patient_learning(pid: str, user: DemoUser = Depends(require_nurse)):
    """What this patient's own gestures have come to mean, learned from nurse confirmations."""
    if pid not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")
    return await svc().learning(pid)


@app.post("/api/patients/{pid}/learning/demo")
async def patient_learning_demo(pid: str, body: LearningDemoBody, user: DemoUser = Depends(require_nurse)):
    """Replay one gesture over several sessions with the real engine (in memory, nothing stored)."""
    if pid not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")
    return await _call(svc().learning_demo(pid, body.area, body.feeling, body.need, body.sessions))


@app.get("/api/patients/{pid}/profile")
async def get_profile(pid: str, user: DemoUser = Depends(require_nurse)):
    _patient_or_404(pid)
    return app.state.profiles.public(pid)


@app.post("/api/patients/{pid}/notes")
async def set_notes(pid: str, body: NotesBody, user: DemoUser = Depends(require_nurse)):
    _patient_or_404(pid)
    if not body.notes.strip():
        raise HTTPException(422, "notes are empty")
    return await app.state.profiles.set_notes(pid, body.notes)


@app.post("/api/patients/{pid}/profile/refresh")
async def refresh_profile(pid: str, user: DemoUser = Depends(require_nurse)):
    _patient_or_404(pid)
    await app.state.profiles.extract(pid)
    return app.state.profiles.public(pid)


@app.get("/api/suggestions")
async def suggestions(status: str | None = None, user: DemoUser = Depends(require_nurse)):
    items = await app.state.profiles.list_suggestions()
    return [s for s in items if status is None or s["status"] == status]


@app.post("/api/suggestions/{sid}/review")
async def review_suggestion(sid: str, body: SuggestionReviewBody, user: DemoUser = Depends(require_nurse)):
    return await _call(app.state.profiles.review(sid, body.approve, body.reviewer))


# ---- family / consults / welfare ------------------------------------------------------------------

class ConsultAnswerBody(BaseModel):
    need_id: str | None = None   # None = "something else"
    unsure: bool = False


@app.get("/api/consults")
async def consults(person_id: str):
    return svc().consults_for(person_id)


@app.post("/api/consults/{cid}/answer")
async def consult_answer(cid: str, body: ConsultAnswerBody):
    return await _call(svc().answer_consult(cid, "unsure" if body.unsure else body.need_id))


class WelfareBody(BaseModel):
    patient_id: str
    requested_by: str


@app.post("/api/welfare")
async def welfare(body: WelfareBody):
    return await _call(svc().start_welfare(body.patient_id, body.requested_by))


@app.post("/api/welfare/{wid}/respond")
async def welfare_respond(wid: str):
    return await _call(svc().respond_welfare(wid))


# ---- research agent ------------------------------------------------------------------------------

def agent() -> ResearchAgent:
    return app.state.research


class ObservationBody(BaseModel):
    text: str
    clinician_id: str
    patient_id: str | None = None


class InquiryAnswerBody(BaseModel):
    response: str            # agree | disagree | unsure
    note: str | None = None


class ReviewBody(BaseModel):
    decision: str            # validated | rejected | needs_more_data
    reviewer: str = CLINICAL_LEAD["name"]
    note: str | None = None


@app.get("/api/research/clinicians")
async def research_clinicians(user: DemoUser = Depends(require_nurse)):
    return {"staff": [{k: s[k] for k in ("id", "name", "role", "patients")} for s in STAFF], "lead": CLINICAL_LEAD}


@app.get("/api/research/hypotheses")
async def hypotheses(user: DemoUser = Depends(require_nurse)):
    return await agent().hypotheses()


@app.get("/api/research/inquiries")
async def inquiries(status: str | None = None, user: DemoUser = Depends(require_nurse)):
    return await agent().inquiries(status)


@app.get("/api/research/digest")
async def digest(user: DemoUser = Depends(require_nurse)):
    return await agent().digest()


@app.post("/api/research/observations")
async def add_observation(body: ObservationBody, user: DemoUser = Depends(require_nurse)):
    if not body.text.strip():
        raise HTTPException(422, "observation text is empty")
    return await _call(agent().add_observation(body.text.strip(), body.clinician_id, body.patient_id))


@app.post("/api/research/inquiries/{iid}/answer")
async def answer_inquiry(iid: str, body: InquiryAnswerBody, user: DemoUser = Depends(require_nurse)):
    return await _call(agent().answer_inquiry(iid, body.response, body.note))


@app.post("/api/research/hypotheses/{hid}/review")
async def review(hid: str, body: ReviewBody, user: DemoUser = Depends(require_nurse)):
    return await _call(agent().review(hid, body.decision, body.reviewer, body.note))


@app.post("/api/research/cycle")
async def research_cycle(user: DemoUser = Depends(require_nurse)):
    return await agent().cycle()


# ---- realtime -------------------------------------------------------------------------------------

def _can_subscribe(channel: str, user: DemoUser | None) -> bool:
    """`nurse` carries alerts and case packets; `patient:{id}` carries that one patient's session/welfare
    pushes. `family:{id}` stays open, same as the rest of the unauthenticated family/contact flow."""
    if channel == "nurse":
        return bool(user and user.role == "nurse")
    if channel.startswith("patient:"):
        pid = channel.split(":", 1)[1]
        return bool(user) and (user.role == "nurse" or user.patient_id == pid)
    return True


@app.websocket("/ws")
async def ws(websocket: WebSocket, channel: str):
    user = user_for_session_id(websocket.cookies.get(SESSION_COOKIE))
    if not _can_subscribe(channel, user):
        await websocket.close(code=4403)
        return
    await websocket.accept()
    hub: Hub = app.state.hub
    hub.subscribe(channel, websocket)
    try:
        while True:
            await websocket.receive_text()  # keepalive pings from the client
    except WebSocketDisconnect:
        hub.unsubscribe(websocket)


# ---- built frontend (single-process deploy) -------------------------------------------------------

if settings.frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=settings.frontend_dist / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        dist = settings.frontend_dist.resolve()
        target = (dist / path).resolve()
        if path and target.is_file() and target.is_relative_to(dist):
            return FileResponse(target)
        return FileResponse(settings.frontend_dist / "index.html")
