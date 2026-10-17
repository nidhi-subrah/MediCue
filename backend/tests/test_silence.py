"""Unit tests for every transition of the silence state machines (app/risk/silence.py)."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.risk.silence import (SilenceConfig, acknowledge, assess_inactivity, in_quiet_hours, mid_dialogue_stalled,
                              mid_dialogue_timeout, should_start_ladder, start_ladder, tick, usual_gaps)

CFG = SilenceConfig()
TZ = ZoneInfo("America/Toronto")
NOON = datetime(2026, 10, 14, 12, 0, tzinfo=TZ).astimezone(timezone.utc)
S = timedelta(seconds=1)


def kinds(effects):
    return [e["type"] for e in effects]


def audits(effects):
    return [e["event"] for e in effects if e["type"] == "audit"]


# ---- Mode A ---------------------------------------------------------------------------------------

def test_mode_a_timeout_floor_multiple_fatigue_and_cap():
    assert mid_dialogue_timeout([], 1.0, CFG) == 30.0                       # no history: the floor
    assert mid_dialogue_timeout([2000] * 5, 1.0, CFG) == 30.0               # 4 x 2 s < 30 s
    assert mid_dialogue_timeout([10000] * 5, 1.0, CFG) == 40.0              # 4 x 10 s
    assert mid_dialogue_timeout([10000] * 5, 3.0, CFG) == 60.0              # fatigue factor capped at 1.5
    assert mid_dialogue_timeout([60000] * 5, 1.0, CFG) == CFG.mid_cap_s     # never unbounded
    assert mid_dialogue_timeout([1000] * 50 + [10000] * 20, 1.0, CFG) == 40.0  # recent taps only


@pytest.mark.parametrize("status", ["area", "waiting_consult", "escalated", "sent"])
def test_mode_a_ignores_sessions_not_waiting_on_the_patient(status):
    assert not mid_dialogue_stalled(status, 10_000, 30)


@pytest.mark.parametrize("status", ["feeling", "question"])
def test_mode_a_fires_at_the_timeout_not_before(status):
    assert not mid_dialogue_stalled(status, 29.9, 30)
    assert mid_dialogue_stalled(status, 30.0, 30)


# ---- Mode B ---------------------------------------------------------------------------------------

def daily(at_hours: list[int], days: int = 7) -> list[datetime]:
    """Interactions at these local hours on each of the past `days` days."""
    out = []
    for d in range(1, days + 1):
        day = (NOON - timedelta(days=d)).astimezone(TZ)
        out += [day.replace(hour=h, minute=0).astimezone(timezone.utc) for h in at_hours]
    return sorted(out)


def test_usual_gaps_measure_each_past_day_at_this_clock_time():
    gaps = usual_gaps(daily([9, 11]), NOON, CFG)
    assert gaps == [3600.0] * 7


def test_mode_b_normal_gap_is_not_abnormal():
    hist = daily([9, 11]) + [NOON - timedelta(hours=1)]
    a = assess_inactivity(hist, NOON, TZ, CFG, NOON - timedelta(days=30))
    assert not a.abnormal and a.threshold_s == CFG.min_gap_s


def test_mode_b_gap_beyond_usual_pattern_is_abnormal():
    hist = daily([9, 11]) + [NOON - timedelta(hours=3)]
    a = assess_inactivity(hist, NOON, TZ, CFG, NOON - timedelta(days=30))
    assert a.abnormal and "No interaction for 3 h 00 min" in a.reason


def test_mode_b_threshold_follows_the_patients_own_pattern():
    sparse = daily([6])                                    # usually 6 h since the last tap at noon
    a = assess_inactivity(sparse + [NOON - timedelta(hours=7)], NOON, TZ, CFG, NOON - timedelta(days=30))
    assert not a.abnormal and a.threshold_s == pytest.approx(1.5 * 6 * 3600)


def test_mode_b_quiet_hours_suppress_new_checks():
    night = datetime(2026, 10, 14, 2, 0, tzinfo=TZ).astimezone(timezone.utc)
    a = assess_inactivity([night - timedelta(hours=9)], night, TZ, CFG, night - timedelta(days=30))
    assert a.quiet and not a.abnormal and "Quiet hours" in a.reason
    assert in_quiet_hours(night, TZ, CFG) and not in_quiet_hours(NOON, TZ, CFG)
    assert in_quiet_hours(night, TZ, replace(CFG, quiet_start_hour=1, quiet_end_hour=5))


def test_mode_b_without_history_uses_the_fallback_and_monitoring_start():
    a = assess_inactivity([], NOON, TZ, CFG, NOON - timedelta(hours=5))
    assert a.abnormal and a.threshold_s == CFG.fallback_gap_s and "monitoring started" in a.reason
    assert not assess_inactivity([], NOON, TZ, CFG, NOON - timedelta(hours=3)).abnormal


def test_should_start_ladder_rules():
    a = assess_inactivity([], NOON, TZ, CFG, NOON - timedelta(hours=5))
    assert should_start_ladder(a, False, None, None, NOON, CFG)
    assert not should_start_ladder(a, True, None, None, NOON, CFG)                       # one at a time
    closed = NOON - timedelta(minutes=30)
    assert not should_start_ladder(a, False, closed, None, NOON, CFG)                    # re-arm wait
    assert should_start_ladder(a, False, closed, closed + timedelta(minutes=5), NOON, CFG)  # new interaction
    assert should_start_ladder(a, False, NOON - timedelta(hours=2), None, NOON, CFG)     # re-armed
    calm = assess_inactivity([NOON - timedelta(minutes=5)], NOON, TZ, CFG, NOON)
    assert not should_start_ladder(calm, False, None, None, NOON, CFG)


# ---- ladder ---------------------------------------------------------------------------------------

def started(contact="fam-lin"):
    return start_ladder("L1", "p-chen", contact, NOON, "test", CFG)


def at_contact():
    lad, _ = started()
    return tick(lad, NOON + CFG.tablet_timeout_s * S, CFG)[0]


def at_nurse():
    lad = at_contact()
    return tick(lad, lad.current.deadline, CFG)[0]


def test_start_opens_the_tablet_check_with_a_timer_and_audit():
    lad, eff = started()
    assert lad.active and lad.current.kind == "tablet" and lad.current.status == "open"
    assert lad.current.deadline == NOON + CFG.tablet_timeout_s * S
    assert kinds(eff) == ["audit", "tablet_check", "audit"]
    assert audits(eff) == ["ladder_started", "step_started"]


def test_tick_before_a_deadline_does_nothing():
    lad, _ = started()
    assert tick(lad, lad.current.deadline - S, CFG) == (lad, [])


def test_patient_answering_in_time_closes_the_ladder():
    lad, _ = started()
    lad, eff = acknowledge(lad, "tablet", "patient", "p-chen", NOON + 10 * S, CFG)
    assert not lad.active and lad.step("tablet").status == "acknowledged"
    assert audits(eff) == ["step_acknowledged", "ladder_closed"] and "ladder_closed" in kinds(eff)


def test_tablet_timeout_messages_the_trusted_contact():
    lad = at_contact()
    assert lad.step("tablet").status == "timed_out" and lad.current.kind == "contact"
    assert lad.current.deadline == lad.current.started_at + CFG.contact_timeout_s * S


def test_tablet_timeout_without_a_contact_goes_to_the_nurse():
    lad, _ = started(contact=None)
    lad, eff = tick(lad, lad.current.deadline, CFG)
    assert lad.current.kind == "nurse" and "nurse_alert" in kinds(eff) and "message_contact" not in kinds(eff)


def test_contact_ok_closes_the_ladder_and_the_timed_out_tablet_step():
    lad, eff = acknowledge(at_contact(), "contact", "contact", "fam-lin", NOON + 200 * S, CFG)
    assert not lad.active
    assert {s.kind: (s.status, s.ack_by) for s in lad.steps} == {
        "tablet": ("acknowledged", "fam-lin"), "contact": ("acknowledged", "fam-lin")}
    assert audits(eff) == ["step_acknowledged", "step_acknowledged", "ladder_closed"]


def test_contact_concern_escalates_to_the_nurse_immediately():
    lad, eff = acknowledge(at_contact(), "contact", "contact", "fam-lin", NOON + 200 * S, CFG, "concern")
    assert lad.active and lad.current.kind == "nurse" and "nurse_alert" in kinds(eff)
    assert lad.step("contact").outcome == "concern"


def test_contact_timeout_alerts_the_nurse():
    lad = at_contact()
    lad, eff = tick(lad, lad.current.deadline, CFG)
    assert lad.step("contact").status == "timed_out" and lad.current.kind == "nurse"
    assert kinds(eff).count("nurse_alert") == 1 and audits(eff) == ["step_timed_out", "step_started"]


def test_unacknowledged_nurse_alert_reminds_and_never_closes():
    lad = at_nurse()
    for n in range(1, 6):
        lad, eff = tick(lad, lad.current.deadline, CFG)
        assert lad.active and lad.current.reminders == n and kinds(eff) == ["nurse_reminder", "audit"]


def test_nurse_acknowledgement_closes_every_open_step():
    lad, eff = acknowledge(at_nurse(), "nurse", "nurse", "Priya", NOON + 2000 * S, CFG)
    assert not lad.active and all(s.status == "acknowledged" and s.ack_by == "Priya" for s in lad.steps)
    assert audits(eff) == ["step_acknowledged"] * 3 + ["ladder_closed"]


def test_nurse_can_close_early_from_any_step():
    lad, _ = started()
    lad, _ = acknowledge(lad, "tablet", "nurse", "Priya", NOON + 5 * S, CFG)
    assert not lad.active


def test_late_patient_response_is_recorded_but_does_not_cancel():
    lad, eff = acknowledge(at_contact(), "tablet", "patient", "p-chen", NOON + 300 * S, CFG)
    assert lad.active and lad.current.kind == "contact" and lad.step("tablet").status == "acknowledged"
    assert eff[0]["detail"]["late"] is True and "ladder_closed" not in kinds(eff)


def test_contact_ok_after_the_nurse_was_alerted_does_not_cancel():
    lad, _ = acknowledge(at_nurse(), "contact", "contact", "fam-lin", NOON + 2000 * S, CFG)
    assert lad.active and lad.current.kind == "nurse" and lad.current.status == "open"


def test_time_alone_never_closes_a_ladder():
    lad, _ = started()
    t = NOON
    for _ in range(50):
        t = lad.current.deadline
        lad, _ = tick(lad, t, CFG)
    assert lad.active and lad.current.kind == "nurse" and lad.current.reminders >= 45


@pytest.mark.parametrize("step,role,actor", [
    ("contact", "patient", "p-chen"),       # patients answer the tablet only
    ("nurse", "contact", "fam-lin"),        # only a nurse closes the nurse step
    ("contact", "contact", "fam-someone"),  # only the ladder's trusted contact
])
def test_wrong_people_cannot_acknowledge(step, role, actor):
    with pytest.raises(PermissionError):
        acknowledge(at_nurse(), step, role, actor, NOON + 2000 * S, CFG)


def test_invalid_acknowledgements_are_rejected():
    lad, _ = started()
    with pytest.raises(ValueError):
        acknowledge(lad, "contact", "contact", "fam-lin", NOON, CFG)        # not started yet
    with pytest.raises(ValueError):
        acknowledge(lad, "tablet", "patient", "p-chen", NOON, CFG, "concern")
    closed, _ = acknowledge(lad, "tablet", "patient", "p-chen", NOON, CFG)
    with pytest.raises(ValueError):
        acknowledge(closed, "tablet", "nurse", "Priya", NOON, CFG)           # already closed
    late, _ = acknowledge(at_contact(), "tablet", "patient", "p-chen", NOON + 300 * S, CFG)
    with pytest.raises(ValueError):
        acknowledge(late, "tablet", "patient", "p-chen", NOON + 301 * S, CFG)  # double acknowledgement
    assert tick(closed, NOON + 10_000 * S, CFG) == (closed, [])              # closed ladders stay closed


def test_every_transition_writes_an_audit_row():
    lad, eff = started()
    trail = audits(eff)
    for _ in range(3):
        lad, eff = tick(lad, lad.current.deadline, CFG)
        trail += audits(eff)
    lad, eff = acknowledge(lad, "nurse", "nurse", "Priya", lad.current.deadline, CFG)
    trail += audits(eff)
    assert trail == ["ladder_started", "step_started", "step_timed_out", "step_started", "step_timed_out",
                     "step_started", "nurse_reminder", "step_acknowledged", "step_acknowledged",
                     "step_acknowledged", "ladder_closed"]


# ---- runtime: the real app, end to end ------------------------------------------------------------

import time  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.risk.silence_monitor import utcnow  # noqa: E402
from tests.conftest import login_as_nurse


def receive(ws, msg_type):
    for _ in range(20):
        m = ws.receive_json()
        if m["type"] == msg_type:
            return m
    raise AssertionError(f"no {msg_type} message")


def test_mode_a_escalates_a_stalled_request_with_its_label():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            monitor = app.state.silence
            s = client.post("/api/sessions", json={"patient_id": "p-patel", "language": "en"}).json()
            s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).json()
            assert s["status"] == "feeling"
            app.state.svc.sessions[s["session_id"]].prompted_at = time.time() - 100
            client.portal.call(monitor.tick, utcnow())
            alert = receive(nurse, "alert")["alert"]
            assert alert["priority"] == "urgent" and alert["label"] == "Patient stopped responding mid-request"
            assert alert["sbar"]["situation"].startswith("Patient stopped responding mid-request.")
            assert alert["top"] and alert["prediction_set"]                     # the current belief, with uncertainty
            assert client.get(f"/api/sessions/{s['session_id']}").json()["status"] == "escalated"
            rows = client.get("/api/risk/silence/audit?patient_id=p-patel").json()
            assert any(r["mode"] == "A" and r["event"] == "mid_dialogue_escalated" for r in rows)


def test_mode_a_does_not_fire_while_the_patient_is_responding():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = client.post("/api/sessions", json={"patient_id": "p-patel", "language": "en"}).json()
        s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).json()
        client.portal.call(app.state.silence.tick, utcnow())
        assert client.get(f"/api/sessions/{s['session_id']}").json()["status"] == "feeling"


def test_ladder_end_to_end_contact_concern_then_nurse_acknowledges():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=patient:p-chen") as tablet, \
            client.websocket_connect("/ws?channel=family:fam-lin") as lin:
            monitor = app.state.silence
            t0 = utcnow()
            lad = client.portal.call(monitor.start_ladder, "p-chen", t0, "test: no interaction")
            check = receive(tablet, "welfare_check")
            assert check["respond_path"] == f"/api/risk/silence/ladders/{lad.id}/patient_ok"

            client.portal.call(monitor.tick, t0 + timedelta(seconds=CFG.tablet_timeout_s))
            assert receive(lin, "silence_check")["ladder"]["current"] == "contact"
            r = client.post(f"/api/risk/silence/ladders/{lad.id}/ack",
                            json={"step": "contact", "role": "contact", "actor": "fam-someone"})
            assert r.status_code == 403
            r = client.post(f"/api/risk/silence/ladders/{lad.id}/ack",
                            json={"step": "contact", "role": "contact", "actor": "fam-lin", "outcome": "concern"})
            assert r.json()["current"] == "nurse" and r.json()["active"]

            alert = next(a for a in client.get("/api/alerts?status=open").json() if a["id"] == r.json()["alert_id"])
            assert alert["kind"] == "welfare" and "reported a concern" in alert["sbar"]["situation"]
            assert client.post(f"/api/risk/silence/ladders/{lad.id}/patient_ok").json()["active"]  # late: no cancel

            client.post(f"/api/alerts/{alert['id']}/confirm", json={"nurse": "Priya"})   # the dashboard button
            client.portal.call(monitor.tick, utcnow())
            done = client.get(f"/api/risk/silence/ladders?patient_id=p-chen").json()[0]
            assert not done["active"] and done["steps"][-1]["ack_by"] == client.get("/api/auth/me").json()["name"]   # the logged-in nurse
            events = [r["event"] for r in client.get(f"/api/risk/silence/audit?ladder_id={lad.id}").json()]
            assert events == ["ladder_started", "step_started",            # tablet check
                              "step_timed_out", "step_started",            # -> trusted contact
                              "step_acknowledged", "step_started",         # contact: concern -> nurse now
                              "step_acknowledged",                         # late patient answer, recorded only
                              "step_acknowledged", "ladder_closed"]        # nurse closes it
            assert client.post(f"/api/risk/silence/ladders/{lad.id}/patient_ok").status_code == 409


def test_patient_answering_the_tablet_check_closes_it_and_counts_as_interaction():
    with TestClient(app) as client:
        login_as_nurse(client)
        monitor = app.state.silence
        lad = client.portal.call(monitor.start_ladder, "p-patel", utcnow(), "test")
        body = client.post(f"/api/risk/silence/ladders/{lad.id}/patient_ok").json()
        assert not body["active"]
        assert any(e["event_type"] == "silence_check_answered" and e["patient_id"] == "p-patel"
                   for e in app.state.store.events)
