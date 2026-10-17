"""SilentSignal API.

    uvicorn app.main:app --reload        (from backend/)
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .catalog import get_catalog
from .config import settings
from .data import seed
from .data.patients import PATIENT_BY_ID, PATIENTS, PERSON_BY_ID
from .risk import router as risk_router, start as start_risk, start_silence
from .services.gemini import Gemini
from .services.hub import Hub
from .services.research import run_research
from .services.sessions import SessionService
from .services.trends import build_trends
from .sim.simulator import calibrate
from .store import make_store

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("silentsignal")


@asynccontextmanager
async def lifespan(app: FastAPI):
    cat = get_catalog()
    store = make_store()
    await store.init()
    if settings.seed_demo_data and await store.is_empty():
        rows, events = seed.generate(cat)
        await store.bulk_seed(rows, events)
        log.info("seeded %d synthetic confirmations", len(rows))
    app.state.risk = await start_risk(store)
    conformal = await asyncio.to_thread(calibrate, cat, settings.engine)
    log.info("conformal q̂ = %.3f from %d calibration dialogues", conformal.qhat, conformal.n_calibration)
    gemini = Gemini()
    log.info("Gemini %s", "enabled" if gemini.enabled else "disabled (template fallbacks)")
    app.state.cat, app.state.store, app.state.gemini = cat, store, gemini
    app.state.hub = Hub()
    app.state.svc = SessionService(cat, settings.engine, store, app.state.hub, gemini, conformal)
    app.state.silence = start_silence(app.state.svc, app.state.risk)
    try:
        await run_research(cat, store, gemini, PATIENT_BY_ID)
    except Exception:
        log.exception("initial research run failed")
    yield
    if app.state.silence:
        await app.state.silence.stop()
    await store.close()


app = FastAPI(title="SilentSignal", lifespan=lifespan)
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
    return {"ok": True, "gemini": app.state.gemini.enabled, "store": type(app.state.store).__name__,
            "conformal_qhat": svc().conformal.qhat}


@app.get("/api/catalog")
async def catalog():
    return app.state.cat.public()


@app.get("/api/patients")
async def patients():
    return [await svc().patient_view(p["id"]) for p in PATIENTS]


@app.get("/api/patients/{pid}")
async def patient(pid: str):
    if pid not in PATIENT_BY_ID:
        raise HTTPException(404, "unknown patient")
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


class AnswerBody(BaseModel):
    question_id: str
    answer: str        # "yes" | "no" | "unsure"


class ModeBody(BaseModel):
    mode: str


async def _call(coro):
    try:
        return await coro
    except KeyError as e:
        raise HTTPException(404, f"not found: {e}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e


@app.post("/api/sessions")
async def start_session(body: StartBody):
    return await _call(svc().start(body.patient_id, body.language, body.mode))


@app.get("/api/sessions/{sid}")
async def get_session(sid: str):
    s = _need(svc().sessions.__getitem__, sid)
    return await svc().state(s)


@app.post("/api/sessions/{sid}/tap")
async def tap(sid: str, body: TapBody):
    return await _call(svc().tap(sid, body.kind, body.tap_id))


@app.post("/api/sessions/{sid}/answer")
async def answer(sid: str, body: AnswerBody):
    return await _call(svc().answer(sid, body.question_id, body.answer))


@app.post("/api/sessions/{sid}/mode")
async def mode(sid: str, body: ModeBody):
    return await _call(svc().set_mode(sid, body.mode))


@app.post("/api/sessions/{sid}/skip_consult")
async def skip_consult(sid: str):
    return await _call(svc().skip_consult(sid))


# ---- nurse ----------------------------------------------------------------------------------------

class ConfirmBody(BaseModel):
    need_id: str | None = None
    nurse: str = "nurse"


@app.get("/api/alerts")
async def alerts(status: str | None = None):
    items = [a for a in svc().alerts.values() if status is None or a["status"] == status]
    items.sort(key=lambda a: a["created_at"], reverse=True)
    return sorted(items, key=lambda a: (a["status"] != "open", a["priority"] != "urgent"))


@app.post("/api/alerts/{aid}/confirm")
async def confirm(aid: str, body: ConfirmBody):
    if body.need_id and body.need_id not in app.state.cat.index:
        raise HTTPException(422, "unknown need")
    return await _call(svc().confirm(aid, body.need_id, body.nurse))


@app.get("/api/trends")
async def trends():
    store = app.state.store
    rows = await store.window_signals(8)
    changes = await store.mode_changes(24)
    return build_trends(rows, PATIENTS, changes)


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


# ---- research -------------------------------------------------------------------------------------

class ReviewBody(BaseModel):
    status: str            # validated | rejected | needs_more_data
    reviewer: str = "clinical lead"
    note: str | None = None


@app.get("/api/research/findings")
async def findings():
    return await app.state.store.list_findings()


@app.post("/api/research/run")
async def research_run():
    return await run_research(app.state.cat, app.state.store, app.state.gemini, PATIENT_BY_ID)


@app.post("/api/research/findings/{fid}/review")
async def review(fid: str, body: ReviewBody):
    if body.status not in ("validated", "rejected", "needs_more_data"):
        raise HTTPException(422, "bad status")
    found = {f["id"]: f for f in await app.state.store.list_findings()}
    if fid not in found:
        raise HTTPException(404, "unknown finding")
    f = found[fid] | {"status": body.status, "reviewer": body.reviewer, "note": body.note,
                      "reviewed_at": datetime.now(timezone.utc).isoformat()}
    await app.state.store.upsert_finding(f)
    return f


# ---- realtime -------------------------------------------------------------------------------------

@app.websocket("/ws")
async def ws(websocket: WebSocket, channel: str):
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
