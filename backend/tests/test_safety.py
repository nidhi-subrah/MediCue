"""Safety claims, as tests. Each section maps to one sentence we say in the demo.

(a) A high-risk need always escalates, whatever silence detection is doing.
(b) Every escalation-ladder transition behaves as specified (the full state x event matrix).
(c) On stable control patients the risk engine stays within the configured false-alarm budget.
"""
import inspect
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.catalog import get_catalog
from app.config import settings
from app.engine.dialogue import Dialogue
from app.main import app
from app.risk.backtest import backtest
from app.risk.config import FALSE_ALARM_BUDGET
from app.risk.silence import SilenceConfig, acknowledge, start_ladder, tick
from app.risk.silence_monitor import utcnow
from app.risk.synthetic import generate
from app.services import sessions
from tests.conftest import login_as_nurse

cat = get_catalog()


# ---- (a) high-risk needs escalate regardless of silence state -------------------------------------

def _receive_alert(ws, alert_id):
    for _ in range(30):
        m = ws.receive_json()
        if m["type"] == "alert" and m["alert"]["id"] == alert_id:
            return m["alert"]
    raise AssertionError("urgent alert never reached the nurse channel")


def _ladder_at(client, pid, step):
    """Put the patient's inactivity check at `step` (or closed)."""
    monitor = app.state.silence
    t0 = utcnow()
    lad = client.portal.call(monitor.start_ladder, pid, t0, "test")
    cfg = monitor.cfg
    if step in ("contact", "nurse", "closed"):
        client.portal.call(monitor.tick, t0 + timedelta(seconds=cfg.tablet_timeout_s))
    if step in ("nurse", "closed"):
        client.portal.call(monitor.tick, t0 + timedelta(seconds=cfg.tablet_timeout_s + cfg.contact_timeout_s))
    if step == "closed":
        client.portal.call(monitor.acknowledge, lad.id, "nurse", "nurse", "Priya")
    assert monitor.ladders[lad.id].active == (step != "closed")


def _break_monitor(client, pid):
    async def boom(*_, **__):
        raise RuntimeError("silence store down")
    monitor = app.state.silence
    monitor.store.interactions = boom
    monitor.store.recent_latencies = boom
    monitor.store.log_silence = boom
    client.portal.call(monitor.tick, utcnow())       # a failing tick is logged, never raised


def _stalled_request(client, pid):
    s = client.post("/api/sessions", json={"patient_id": pid, "language": "en"}).json()
    s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "belly"}).json()
    assert s["status"] in ("feeling", "question")
    app.state.svc.sessions[s["session_id"]].prompted_at = time.time() - 600   # overdue, monitor not yet run


SILENCE_STATES = {
    "no check running": lambda c, pid: None,
    "tablet check running": lambda c, pid: _ladder_at(c, pid, "tablet"),
    "trusted contact being asked": lambda c, pid: _ladder_at(c, pid, "contact"),
    "nurse already alerted by a check": lambda c, pid: _ladder_at(c, pid, "nurse"),
    "check just closed": lambda c, pid: _ladder_at(c, pid, "closed"),
    "monitor stopped": lambda c, pid: c.portal.call(app.state.silence.stop),
    "monitor failing": _break_monitor,
    "another request stalled mid-dialogue": _stalled_request,
}
HIGH_RISK_TAPS = [("chest", "pain"), ("chest", "hard_to_breathe"), ("mouth_throat", "hard_to_breathe")]


@pytest.mark.parametrize("state", list(SILENCE_STATES))
@pytest.mark.parametrize("area,feeling", HIGH_RISK_TAPS)
@pytest.mark.parametrize("pid", ["p-chen", "p-kowalski"])   # p-kowalski: lowest signal reliability (0.625)
def test_high_risk_need_escalates_regardless_of_silence_state(state, area, feeling, pid):
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            SILENCE_STATES[state](client, pid)
            s = client.post("/api/sessions", json={"patient_id": pid, "language": "en"}).json()
            s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": area}).json()
            if s["status"] == "feeling":
                s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "feeling", "tap_id": feeling}).json()
            assert s["status"] == "escalated" and s["questions_asked"] == 0
            alert = _receive_alert(nurse, s["alert_id"])
            assert alert["priority"] == "urgent" and alert["status"] == "open"


def test_silence_cannot_replace_or_duplicate_a_high_risk_escalation():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
        s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "chest"}).json()
        session = app.state.svc.sessions[s["session_id"]]
        session.prompted_at = time.time() - 600
        client.portal.call(app.state.silence.tick, utcnow())
        alerts = [a for a in app.state.svc.alerts.values() if a["session_id"] == s["session_id"]]
        assert len(alerts) == 1 and alerts[0]["priority"] == "urgent" and not alerts[0].get("label")
        assert session.status == "escalated"


def test_escalation_path_does_not_depend_on_silence_detection():
    src = inspect.getsource(sessions)
    assert "from ..risk" not in src and "import risk" not in src


@pytest.mark.parametrize("reliability", [0.55, 0.625, 0.7, 0.85, 0.97])   # 0.55 = the lowest the app allows
@pytest.mark.parametrize("area,feeling", HIGH_RISK_TAPS)
@pytest.mark.parametrize("tired", [False, True])
def test_engine_escalates_a_high_risk_tap_pair_on_the_safety_floor(reliability, area, feeling, tired):
    """By the second tap at the latest, with no question asked, via the deterministic floor (not the scores)."""
    d = Dialogue(cat, settings.engine, list(cat.base_prior), reliability,
                 chart_flags={lk.id: False for lk in cat.lookups})
    if tired:
        d.questions_asked = settings.engine.max_questions
        d.tap_times = [0.0, 5.0, 60.0]                # slowing taps: fatigue at its cap
    d.apply_tap("area", area)
    decision = d.step()
    if decision.chosen.kind != "escalate":
        assert decision.chosen.kind == "tap"          # waits for the feeling tap; never asks first
        d.apply_tap("feeling", feeling)
        decision = d.step()
    assert decision.chosen.kind == "escalate" and decision.reason.startswith("Safety floor")


@pytest.mark.parametrize("reliability", [0.7, 0.85, 0.97])
def test_a_single_chest_tap_escalates_at_once_from_reliability_0_7(reliability):
    d = Dialogue(cat, settings.engine, list(cat.base_prior), reliability,
                 chart_flags={lk.id: False for lk in cat.lookups})
    d.apply_tap("area", "chest")
    assert d.step().chosen.kind == "escalate"


# ---- (b) every ladder transition, as specified -----------------------------------------------------

CFG = SilenceConfig()
NOW = datetime(2026, 10, 14, 16, 0, tzinfo=timezone.utc)
S = timedelta(seconds=1)


def ladder(state: str):
    lad, _ = start_ladder("L", "p-chen", "fam-lin", NOW, "test", CFG)
    if state in ("contact", "nurse", "closed"):
        lad, _ = tick(lad, lad.current.deadline, CFG)
    if state in ("nurse", "closed"):
        lad, _ = tick(lad, lad.current.deadline, CFG)
    if state == "closed":
        lad, _ = acknowledge(lad, "nurse", "nurse", "Priya", lad.current.deadline - S, CFG)
    return lad


EVENTS = {
    "deadline passes": lambda l: tick(l, l.current.deadline, CFG),
    "patient answers tablet": lambda l: acknowledge(l, "tablet", "patient", "p-chen", NOW + 9999 * S, CFG),
    "contact says ok": lambda l: acknowledge(l, "contact", "contact", "fam-lin", NOW + 9999 * S, CFG),
    "contact raises concern": lambda l: acknowledge(l, "contact", "contact", "fam-lin", NOW + 9999 * S, CFG, "concern"),
    "nurse acknowledges": lambda l: acknowledge(l, l.current.kind, "nurse", "Priya", NOW + 9999 * S, CFG),
    "stranger acknowledges contact": lambda l: acknowledge(l, "contact", "contact", "fam-x", NOW + 9999 * S, CFG),
}

# (state, event) -> (current step afterwards, still active) or the exception it must raise
SPEC = {
    ("tablet", "deadline passes"): ("contact", True),
    ("tablet", "patient answers tablet"): ("tablet", False),
    ("tablet", "contact says ok"): ValueError,                 # contact not asked yet
    ("tablet", "contact raises concern"): ValueError,
    ("tablet", "nurse acknowledges"): ("tablet", False),
    ("tablet", "stranger acknowledges contact"): ValueError,
    ("contact", "deadline passes"): ("nurse", True),
    ("contact", "patient answers tablet"): ("contact", True),   # late: recorded, no cancel
    ("contact", "contact says ok"): ("contact", False),
    ("contact", "contact raises concern"): ("nurse", True),     # straight to the nurse
    ("contact", "nurse acknowledges"): ("contact", False),
    ("contact", "stranger acknowledges contact"): PermissionError,
    ("nurse", "deadline passes"): ("nurse", True),              # reminder, never closes
    ("nurse", "patient answers tablet"): ("nurse", True),
    ("nurse", "contact says ok"): ("nurse", True),
    ("nurse", "contact raises concern"): ("nurse", True),
    ("nurse", "nurse acknowledges"): ("nurse", False),
    ("nurse", "stranger acknowledges contact"): PermissionError,
    ("closed", "deadline passes"): ("nurse", False),            # closed stays closed, no effects
    ("closed", "patient answers tablet"): ValueError,
    ("closed", "contact says ok"): ValueError,
    ("closed", "contact raises concern"): ValueError,
    ("closed", "nurse acknowledges"): ValueError,
    ("closed", "stranger acknowledges contact"): ValueError,
}


def test_spec_covers_every_state_and_event():
    assert set(SPEC) == {(s, e) for s in ("tablet", "contact", "nurse", "closed") for e in EVENTS}


@pytest.mark.parametrize("state,event", list(SPEC))
def test_ladder_transition(state, event):
    lad, expected = ladder(state), SPEC[(state, event)]
    if isinstance(expected, type):
        with pytest.raises(expected):
            EVENTS[event](lad)
        return
    new, effects = EVENTS[event](lad)
    assert (new.current.kind, new.active) == expected
    audit = [e for e in effects if e["type"] == "audit"]
    if state == "closed":
        assert effects == [] and new == lad
    else:
        assert audit, "every transition writes an audit row"
        assert all(a["ladder_id"] == "L" and a["time"] for a in audit)
    if not new.active and lad.active:
        assert all(s.status == "acknowledged" for s in new.steps if s.kind == new.current.kind)
        assert any(e["type"] == "ladder_closed" for e in effects)


# ---- (c) false-alarm budget on stable controls -----------------------------------------------------

@pytest.fixture(scope="module")
def cohort():
    return generate(cat)


@pytest.mark.parametrize("split", ["test", "train"])
def test_controls_stay_within_the_false_alarm_budget(cohort, split):
    f = backtest(cohort, split)["false_flags"]
    assert f["control_patient_weeks"] > 3
    assert f["elevated_per_patient_week"] <= FALSE_ALARM_BUDGET.elevated_per_patient_week, f
    assert f["any_per_patient_week"] <= FALSE_ALARM_BUDGET.any_per_patient_week, f
