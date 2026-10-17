import time

from fastapi.testclient import TestClient

from app.catalog import SAFETY_QUESTION, get_catalog
from app.engine.ladder import STEP_UP_AFTER, Ladder, likely_taps
from app.main import app
from app.risk.silence import SilenceConfig, mid_dialogue_timeout
from app.risk.silence_monitor import utcnow

cat = get_catalog()


# ---- pure ladder ------------------------------------------------------------------------------------

def test_on_time_consistent_inputs_keep_the_full_level():
    lad = Ladder()
    for t in range(6):
        assert lad.observe_input(t, latency_s=3, usual_s=3) is None
    assert lad.level == 1


def test_slow_answers_step_down_with_a_reason_nurses_can_read():
    lad = Ladder()
    assert lad.observe_input(0, latency_s=7.2, usual_s=3) is None      # one slow answer is not enough
    c = lad.observe_input(1, latency_s=7.5, usual_s=3)
    assert c and (c.from_level, c.to_level) == (1, 2)
    assert "2.5× slower than usual" in c.reason


def test_surprising_and_unsure_answers_count():
    lad = Ladder()
    lad.observe_input(0, 3, 3, unsure=True)
    assert lad.observe_input(1, 3, 3, unsure=True) is None
    c = lad.observe_input(2, 3, 3, surprising=True)
    assert c and c.to_level == 2
    assert "unexpected answer" in c.reason and "not sure" in c.reason


def test_mistaps_from_the_tablet_count():
    lad = Ladder()
    for t in range(3):
        assert lad.observe_signal("miss", t) is None
    c = lad.observe_signal("miss", 3)
    assert c and c.to_level == 2 and "4 missed taps" in c.reason


def test_fatigue_sensitive_patients_step_down_sooner():
    tired = Ladder(sensitivity=1.6)
    tired.observe_input(0, 7, 3)
    assert tired.observe_input(1, 3, 3, unsure=True)    # 1.6 + 0.8 ≥ 2
    normal = Ladder()
    normal.observe_input(0, 7, 3)
    assert normal.observe_input(1, 3, 3, unsure=True) is None


def test_recovery_waits_for_several_good_inputs():
    lad = Ladder(level=3)
    for t in range(STEP_UP_AFTER - 1):
        assert lad.observe_input(t, 3, 3) is None
    c = lad.observe_input(9, 3, 3)
    assert c and (c.from_level, c.to_level) == (3, 2)


def test_a_bad_input_resets_the_recovery_streak():
    lad = Ladder(level=3)
    for t in range(STEP_UP_AFTER - 1):
        lad.observe_input(t, 3, 3)
    lad.observe_signal("miss", 5)
    for t in range(STEP_UP_AFTER - 1):
        assert lad.observe_input(10 + t, 3, 3) is None
    assert lad.level == 3


def test_manual_easier_is_not_undone_by_automatic_recovery():
    lad = Ladder()
    c = lad.set_level(3, "patient", 0)
    assert c and c.reason == "patient asked for easier"
    for t in range(10):
        lad.observe_input(t, 3, 3)
    assert lad.level == 3


def test_struggling_still_steps_down_after_a_manual_harder():
    lad = Ladder(level=3)
    lad.set_level(1, "nurse", 0)
    lad.observe_input(1, 10, 3)
    assert lad.observe_input(2, 10, 3).to_level == 2


def test_idle_steps_down_at_once_and_says_so():
    lad = Ladder()
    c = lad.observe_idle(18, 0)
    assert c and c.to_level == 2 and c.source == "idle" and "no input for 18 s" in c.reason


def test_levels_stay_within_bounds():
    lad = Ladder(level=4)
    assert lad.observe_idle(30, 0) is None and lad.level == 4
    assert lad.set_level(9, "nurse", 1) is None and lad.level == 4
    assert lad.set_level(0, "nurse", 2).to_level == 1


def test_simplified_options_always_keep_a_way_to_report_an_emergency():
    # A belief sure it is about thirst would rank chest and breathing low; they stay on screen anyway.
    belief = [0.0001] * cat.n
    belief[cat.index["thirsty"]] = 1
    areas = likely_taps(cat.area_lik, belief, cat.high_risk, k=3)
    feelings = likely_taps(cat.feeling_lik, belief, cat.high_risk, k=3)
    assert "mouth_throat" in areas and "chest" in areas
    assert "thirsty" in feelings and "pain" in feelings and "hard_to_breathe" in feelings


def test_assisted_level_halves_the_silence_timeout():
    cfg = SilenceConfig()
    assert mid_dialogue_timeout([], 1.0, cfg, level=4) == mid_dialogue_timeout([], 1.0, cfg) * cfg.mid_assisted_factor
    assert mid_dialogue_timeout([], 1.0, cfg, level=3) == mid_dialogue_timeout([], 1.0, cfg)


# ---- live sessions -----------------------------------------------------------------------------------

def _start(client, pid="p-patel"):
    return client.post("/api/sessions", json={"patient_id": pid, "language": "en"}).json()


def test_session_reports_its_level_and_simplified_options():
    with TestClient(app) as client:
        s = _start(client)
        assert s["ladder"]["level"] == 1 and s["ladder"]["options"] is None
        s = client.post(f"/api/sessions/{s['session_id']}/level", json={"level": 2}).json()
        assert s["ladder"]["level"] == 2 and s["mode"] != "grid"
        assert 5 <= len(s["ladder"]["options"]["area"]) < len(cat.area_labels)
        assert "chest" in s["ladder"]["options"]["area"]


def test_mistaps_reshape_the_tablet_mid_conversation():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        for _ in range(4):
            s = client.post(f"/api/sessions/{sid}/signal", json={"kind": "miss"}).json()
        assert s["ladder"]["level"] == 2
        assert s["ladder"]["changes"][-1]["reason"] == "4 missed taps"
        assert client.post(f"/api/sessions/{sid}/signal", json={"kind": "shake"}).status_code == 422


def test_yes_no_level_replaces_the_taps_with_questions_and_still_resolves():
    with TestClient(app) as client:
        s = _start(client)
        s = client.post(f"/api/sessions/{s['session_id']}/level", json={"level": 3}).json()
        assert s["status"] == "question" and s["taps"] == 0
        assert s["question"]["id"] == SAFETY_QUESTION     # no body map, so rule out an emergency first
        # Answer as a thirsty patient would; the engine must still get there by questions alone.
        thirsty = cat.index["thirsty"]
        for _ in range(12):
            if s["status"] == "waiting_consult":       # the engine may ask the grandson; carry on alone
                s = client.post(f"/api/sessions/{s['session_id']}/skip_consult").json()
                continue
            if s["status"] != "question":
                break
            q = cat.question_by_id[s["question"]["id"]]
            s = client.post(f"/api/sessions/{s['session_id']}/answer",
                            json={"question_id": q.id, "answer": "yes" if q.p_yes[thirsty] >= 0.5 else "no"}).json()
        assert s["status"] == "sent" and s["belief"][0]["need"] == "thirsty"


def test_yes_no_level_still_escalates_chest_pain():
    with TestClient(app) as client:
        s = _start(client)
        s = client.post(f"/api/sessions/{s['session_id']}/level", json={"level": 3}).json()
        chest = cat.index["pain_chest"]
        for _ in range(10):
            if s["status"] != "question":
                break
            q = cat.question_by_id[s["question"]["id"]]
            s = client.post(f"/api/sessions/{s['session_id']}/answer",
                            json={"question_id": q.id, "answer": "yes" if q.p_yes[chest] >= 0.5 else "no"}).json()
        assert s["status"] == "escalated"


def test_assisted_level_asks_family_without_leaving_the_question():
    with TestClient(app) as client:
        s = _start(client, "p-chen")    # daughter Lin reads his gestures
        sid = s["session_id"]
        with client.websocket_connect("/ws?channel=family:fam-lin") as family:
            s = client.post(f"/api/sessions/{sid}/level", json={"level": 4, "by": "nurse"}).json()
            assert s["ladder"]["level"] == 4
            assert s["status"] == "question"          # the silence timer keeps watching the patient
            assert s["ladder"]["assist"]["person_name"]
            assert family.receive_json()["type"] == "consult"


def test_nurse_station_sees_the_level_timeline():
    with TestClient(app) as client:
        s = _start(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            client.post(f"/api/sessions/{s['session_id']}/level", json={"level": 2, "by": "nurse"})
            msg = nurse.receive_json()
            assert msg["type"] == "level_changed" and msg["change"]["to_label"] == "Simplified"
        row = next(r for r in client.get("/api/ladder").json() if r["patient_id"] == "p-patel")
        assert row["level"] == 2 and row["changes"][-1]["reason"] == "nurse asked for easier"


def test_silence_halfway_steps_down_and_escalation_is_not_delayed():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).json()
        assert s["status"] == "feeling"
        session = app.state.svc.sessions[sid]
        monitor = app.state.silence
        prompted = time.time() - 20             # past half the 30 s floor, before the timeout
        session.prompted_at = prompted
        client.portal.call(monitor.check_mid_dialogue, utcnow())
        assert session.ladder.level == 2
        assert session.status == "feeling" and session.prompted_at == prompted   # clock not restarted
        session.prompted_at = prompted = time.time() - 31
        client.portal.call(monitor.check_mid_dialogue, utcnow())
        assert session.status == "escalated"
