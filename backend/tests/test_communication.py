"""MediCue Adaptive Communication Engine: signal detection, adaptation policy and the live session around them."""
import time

import pytest
from fastapi.testclient import TestClient

from app.catalog import SAFETY_QUESTION, get_catalog
from app.engine.communication import policy as P
from app.engine.communication.signals import (CORRECTION, MISS, MISSED_RESPONSE, READ_ALOUD, RESPONSE, Interaction,
                                              PersonalBaseline, detect)
from app.engine.options import likely_taps
from app.main import app
from app.risk.silence import SilenceConfig, mid_dialogue_timeout
from app.risk.silence_monitor import utcnow
from app.services.communication_language import CommunicationLanguageService
from tests.conftest import login_as_nurse

cat = get_catalog()


def responses(*secs, **flags):
    return [Interaction(RESPONSE, i, s, **flags) for i, s in enumerate(secs)]


def run(log, state=P.CommunicationState(), personal=None, **ctx):
    return P.decide(detect(log, personal=personal), state, P.PolicyContext(**ctx))


# ---- layer 1: signal detection (no policy, no rendering) ---------------------------------------------

def test_signals_are_measured_independently_of_the_policy():
    sig = detect(responses(2.4, 2.7, 2.6, 5.8, 6.4))
    assert sig.within_session_baseline_s == 2.6 and sig.current_latency_s == pytest.approx(6.1)
    assert sig.slowdown_ratio == pytest.approx(6.1 / 2.6) and sig.sustained_slowdown and sig.slow_responses == 2
    assert sig.baseline_status == "COLD_START" and sig.baseline_source == "session"


def test_baseline_status_follows_how_much_history_there_is():
    assert detect([], personal=None).baseline_status == "COLD_START"
    assert detect([], personal=PersonalBaseline(3.0, 2)).baseline_status == "LEARNING"
    assert detect([], personal=PersonalBaseline(3.0, 20)).baseline_status == "PERSONALIZED"


def test_counts_cover_only_the_window_since_the_last_change():
    log = [Interaction(CORRECTION, 0), Interaction(CORRECTION, 1), *responses(2.0, 2.1)]
    assert detect(log).correction_count == 2
    assert detect(log, since=2).correction_count == 0


# ---- layer 2: adaptation policy (no session, no React) -----------------------------------------------

def test_normal_interactions_stay_standard():
    assert not run(responses(2.4, 2.7, 2.6, 2.5, 2.8, 2.6)).should_adapt


def test_one_slow_response_does_not_adapt():
    assert not run(responses(2.4, 2.7, 2.6, 5.8, 2.5)).should_adapt


def test_sustained_slowdown_simplifies_and_says_why_in_numbers():
    d = run(responses(2.4, 2.7, 2.6, 5.8, 6.4))
    assert d.should_adapt and d.suggested_mode == P.Mode.SIMPLIFIED and d.reason == P.SLOW_RESPONSE
    assert d.severity == 2 and "this session's baseline" in d.explanation and "2.3×" in d.explanation
    assert d.patient_message == "I've simplified the choices." and not d.requires_patient_confirmation


def test_first_time_patient_adapts_on_the_within_session_baseline():
    d = run(responses(2.4, 2.7, 2.6, 5.8, 6.4), personal=None)
    assert d.suggested_mode == P.Mode.SIMPLIFIED


def test_personalized_patient_is_compared_with_their_usual():
    # Slow from the first response: no session baseline yet, but twice their usual.
    d = run(responses(9.0, 9.5), personal=PersonalBaseline(4.4, 20))
    assert d.suggested_mode == P.Mode.SIMPLIFIED and "their usual" in d.explanation
    # The same latencies are normal for a patient whose usual is 9 s.
    assert not run(responses(9.0, 9.5), personal=PersonalBaseline(9.0, 20)).should_adapt


def test_repeated_corrections_make_targets_bigger_then_fewer():
    log = responses(2.0, 2.0, 2.0) + [Interaction(CORRECTION, 3), Interaction(MISS, 4)]
    d = run(log)
    assert d.reason == P.FREQUENT_CORRECTIONS and d.add_modifiers == P.PRECISION and d.suggested_mode is None
    assert d.patient_message == "I'll make the choices easier to select."
    d2 = run(log, state=P.CommunicationState(modifiers=P.PRECISION))
    assert d2.suggested_mode == P.Mode.SIMPLIFIED


def test_one_correction_is_not_impairment():
    assert not run(responses(2.0, 2.0, 2.0) + [Interaction(CORRECTION, 3)]).should_adapt


def test_repeated_uncertainty_simplifies_wording_then_asks_yes_no():
    log = [*responses(2.0, 2.0), *responses(2.0, 2.0, unsure=True)]
    d = run(log)
    assert d.reason == P.REPEATED_UNCERTAINTY and P.SIMPLE_WORDING in d.add_modifiers and d.suggested_mode is None
    d2 = run(log, state=P.CommunicationState(modifiers=frozenset({P.SIMPLE_WORDING})))
    assert d2.suggested_mode == P.Mode.BINARY


def test_missed_taps_alone_never_turn_on_audio():
    d = run(responses(2.0, 2.0, 2.0) + [Interaction(MISS, 3), Interaction(MISS, 4), Interaction(MISS, 5)])
    assert P.AUDIO not in d.add_modifiers and d.offer != P.OFFER_AUDIO


def test_repeated_read_aloud_offers_audio_first_and_waits_for_a_yes():
    d = run(responses(2.0, 2.0) + [Interaction(READ_ALOUD, 2), Interaction(READ_ALOUD, 3)])
    assert d.offer == P.OFFER_AUDIO and d.requires_patient_confirmation
    st = P.CommunicationState()
    assert P.apply(st, d, accepted=False).modifiers == frozenset()            # declined: nothing changes
    assert P.OFFER_AUDIO in P.apply(st, d, accepted=False).declined
    assert P.AUDIO in P.apply(st, d, accepted=True).modifiers


def test_struggling_in_yes_no_offers_assisted_communication():
    log = responses(2.0, 2.0, 2.0) + [Interaction(MISSED_RESPONSE, 3, idle_s=18)]
    d = run(log, state=P.CommunicationState(mode=P.Mode.BINARY))
    assert d.offer == P.OFFER_ASSISTED and d.requires_patient_confirmation
    assert d.patient_message == "Would you like someone to help you communicate?"


def test_one_slow_response_never_jumps_to_assisted():
    d = run(responses(2.4, 2.7, 2.6, 5.8))
    assert not d.should_adapt or d.suggested_mode != P.Mode.ASSISTED


def test_escalation_outranks_every_adaptation():
    log = responses(2.4, 2.7, 2.6, 5.8, 6.4) + [Interaction(MISSED_RESPONSE, 5, idle_s=20)]
    assert not run(log, escalating=True).should_adapt


def test_transitions_are_deterministic():
    log = responses(2.4, 2.7, 2.6, 5.8, 6.4) + [Interaction(CORRECTION, 5)]
    assert run(log) == run(log) == run(list(log))


def test_recovery_steps_back_up_but_never_past_a_manual_choice():
    st = P.CommunicationState(mode=P.Mode.SIMPLIFIED)
    assert run(responses(2.0, 2.1, 2.0), state=st).suggested_mode == P.Mode.STANDARD
    manual = P.apply(P.CommunicationState(), P.request(P.CommunicationState(), "mode", 2))
    assert not run(responses(2.0, 2.1, 2.0), state=manual).should_adapt


def test_messages_are_neutral():
    for text in P.MESSAGES.values():
        low = text.lower()
        assert not any(w in low for w in ("slow", "mistake", "confus", "impair", "wrong"))


# ---- wording: Gemini can only change presentation ----------------------------------------------------

def test_gemini_rewrites_that_add_a_clinical_concept_are_rejected():
    lang = CommunicationLanguageService(cat, app.state.gemini if hasattr(app.state, "gemini") else None)
    assert lang.valid_rewrite("Do you want a drink?", "Thirsty?", 5, intent="ask whether it is: Thirsty")
    assert not lang.valid_rewrite("Do you want a drink?", "Thirsty?", 5)   # without that intent, "thirsty" is new
    assert not lang.valid_rewrite("Do you want a drink?", "Do you have chest pain?", 8)     # new concept
    assert not lang.valid_rewrite("Is it about pain?", "", 5)                                 # empty
    assert not lang.valid_rewrite("Is it about pain?", "Pain", 5)                             # no longer a question
    assert not lang.valid_rewrite("Is it about pain?", "Is it maybe about pain or anything else at all?", 5)


def test_wording_falls_back_to_the_catalog_without_gemini():
    lang = CommunicationLanguageService(cat, gemini=None)
    q = "need:thirsty"
    assert lang.question(q, "standard") == "Do you want a drink?"
    assert lang.question(q, "binary") == "Thirsty?"                  # catalog short form
    assert lang.question(SAFETY_QUESTION, "binary") == "Chest or breathing?"


def test_simplified_options_always_keep_a_way_to_report_an_emergency():
    belief = [0.0001] * cat.n
    belief[cat.index["thirsty"]] = 1
    assert "chest" in likely_taps(cat.area_lik, belief, cat.high_risk, k=2)


def test_assisted_mode_shortens_the_silence_timeout():
    cfg = SilenceConfig()
    assert mid_dialogue_timeout([], 1.0, cfg, level=4) == mid_dialogue_timeout([], 1.0, cfg) * cfg.mid_assisted_factor


# ---- live sessions: the three layers together --------------------------------------------------------

def _start(client, pid="p-patel"):
    login_as_nurse(client)
    return client.post("/api/sessions", json={"patient_id": pid, "language": "en"}).json()


def _latency(sid, seconds):
    app.state.svc.sessions[sid].prompted_at = time.time() - seconds


def _skip(client, s):
    while s["status"] == "waiting_consult":
        s = client.post(f"/api/sessions/{s['session_id']}/skip_consult").json()
    return s


def _demo_a(client):
    """Mr. Chen: 2.4, 2.7, 2.6 s, then 5.8 and 6.4 s."""
    s = _start(client, "p-chen")
    sid = s["session_id"]
    _latency(sid, 2.4)
    s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "whole_body"}).json()
    opt = s["options"]["predicted"][0]
    _latency(sid, 2.7)
    s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "feeling", "tap_id": opt["feeling"], "option_id": opt["id"]}).json()
    for secs in (2.6, 5.8, 6.4):
        s = _skip(client, s)
        _latency(sid, secs)
        s = client.post(f"/api/sessions/{sid}/answer", json={"question_id": s["question"]["id"], "answer": "no"}).json()
    return s


def test_demo_a_slowdown_simplifies_the_live_tablet():
    with TestClient(app) as client:
        s = _demo_a(client)
        c = s["communication"]
        assert c["mode"] == "SIMPLIFIED" and c["presentation"]["option_count"] == 2
        assert c["message"]["text"] == "I've simplified the choices."
        change = c["changes"][-1]
        assert change["renderer"]["before"]["option_count"] == 4 and change["renderer"]["after"]["option_count"] == 2
        assert change["signals"]["slowdown_ratio"] > 2


def test_mode_switches_keep_session_belief_and_confirmed_answers():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).json()
        belief, confirmed = s["belief"], s["communication"]["summary"]["confirmed"]
        for level in (2, 1, 2):
            s = client.post(f"/api/sessions/{sid}/level", json={"level": level}).json()
            assert s["session_id"] == sid and s["belief"] == belief
            assert s["communication"]["summary"]["confirmed"] == confirmed
        s = client.post(f"/api/sessions/{sid}/level", json={"level": 3}).json()   # yes/no: same belief, a question
        assert s["session_id"] == sid and s["belief"] == belief and s["status"] == "question"


def test_not_sure_stays_uncertainty_and_is_never_a_no():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        s = client.post(f"/api/sessions/{sid}/level", json={"level": 3}).json()
        s = client.post(f"/api/sessions/{sid}/answer", json={"question_id": s["question"]["id"], "answer": "unsure"}).json()
        d = app.state.svc.sessions[sid].dialogue
        assert d.answers[-1][1] == "unsure"
        assert any(u["value"] == "Not sure" for u in s["communication"]["summary"]["unresolved"])


def test_yes_no_mode_still_escalates_chest_pain():
    with TestClient(app) as client:
        s = _start(client)
        s = client.post(f"/api/sessions/{s['session_id']}/level", json={"level": 3}).json()
        assert s["question"]["id"] == SAFETY_QUESTION
        s = client.post(f"/api/sessions/{s['session_id']}/answer", json={"question_id": SAFETY_QUESTION, "answer": "yes"}).json()
        assert s["status"] == "escalated"


def test_escalation_comes_first_even_while_struggling():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        for _ in range(3):
            client.post(f"/api/sessions/{sid}/signal", json={"kind": "miss"})
        _latency(sid, 30)
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "chest"}).json()
        assert s["status"] == "escalated" and s["questions_asked"] == 0


def test_yes_no_walks_the_areas_options_and_a_yes_is_that_tap():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).json()
        s = client.post(f"/api/sessions/{sid}/level", json={"level": 3}).json()
        assert s["question"]["id"].startswith("option:mouth_throat.") and s["question"]["wording"] == "binary"
        spec = {o["id"]: o for o in cat.raw["area_options"]["mouth_throat"]["options"]}
        assert spec[s["question"]["id"].removeprefix("option:")].get("high_risk")   # choking screened first
        for _ in range(len(spec)):   # every option of the area can be asked before the "yes"
            oid = s["question"]["id"].removeprefix("option:")
            yes = spec[oid]["feeling"] == "thirsty"
            s = client.post(f"/api/sessions/{sid}/answer", json={"question_id": s["question"]["id"],
                                                                 "answer": "yes" if yes else "no"}).json()
            if yes:
                break
        assert app.state.svc.sessions[sid].dialogue.feeling == "thirsty" and s["choice"]["id"] == oid


def test_read_aloud_offer_then_accept_turns_audio_on():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        for _ in range(2):
            s = client.post(f"/api/sessions/{sid}/signal", json={"kind": "read_aloud"}).json()
        assert s["communication"]["offer"]["offer"] == "audio_first" and not s["communication"]["audio_enabled"]
        s = client.post(f"/api/sessions/{sid}/communication/offer", json={"offer": "audio_first", "choice": "accept"}).json()
        assert s["communication"]["audio_enabled"] and s["communication"]["offer"] is None


def test_demo_d_assisted_communication_preserves_confirmed_information():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "belly"}).json()
        s = client.post(f"/api/sessions/{sid}/level", json={"level": 3}).json()
        client.portal.call(app.state.svc.idle_step_down, sid, 18.0)      # no response in yes/no mode
        s = client.get(f"/api/sessions/{sid}").json()
        assert s["communication"]["offer"]["offer"] == "assisted"
        assert s["communication"]["offer"]["choices"] == ["get_nurse", "ask_caregiver", "keep_trying"]
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = client.post(f"/api/sessions/{sid}/communication/offer",
                            json={"offer": "assisted", "choice": "get_nurse"}).json()
            for _ in range(10):
                m = nurse.receive_json()
                if m["type"] == "alert" and m["alert"].get("label") == "Needs help communicating":
                    break
        assert s["communication"]["mode"] == "ASSISTED" and s["session_id"] == sid
        summary = s["communication"]["summary"]
        assert {"field": "Where", "value": "Belly"} in summary["confirmed"]
        assert any(u["field"] == "What it's like" for u in summary["unresolved"])
        alert = app.state.svc.alerts[s["alert_id"]]
        assert alert["reason"] == "Patient was unable to complete communication. Confirmed information preserved."
        assert alert["communication"]["confirmed"] == summary["confirmed"]


def test_keep_trying_declines_without_changing_anything():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        client.post(f"/api/sessions/{sid}/level", json={"level": 3})
        client.portal.call(app.state.svc.idle_step_down, sid, 18.0)
        s = client.post(f"/api/sessions/{sid}/communication/offer", json={"offer": "assisted", "choice": "keep_trying"}).json()
        assert s["communication"]["mode"] == "BINARY" and s["communication"]["offer"] is None


def test_adaptation_events_are_logged_for_trends():
    with TestClient(app) as client:
        s = _demo_a(client)
        sid = s["session_id"]
        kinds = [e["event_type"] for e in app.state.store.events if e.get("session_id") == sid]
        assert "communication_difficulty_detected" in kinds and "communication_mode_changed" in kinds
        e = next(e for e in app.state.store.events if e.get("session_id") == sid
                 and e["event_type"] == "communication_mode_changed")
        assert e["payload"]["from_mode"] == "STANDARD" and e["payload"]["to_mode"] == "SIMPLIFIED"
        assert e["payload"]["reason"] == "SLOW_RESPONSE" and e["payload"]["slowdown_ratio"] > 2
        rows = client.get("/api/communication").json()
        row = next(r for r in rows if r["session_id"] == sid)
        assert row["last_change"]["to_mode"] == "SIMPLIFIED" and row["changes"]


def test_back_is_a_correction_and_the_undone_answer_earns_no_credit():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        for _ in range(2):
            s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "head"}).json()
            s = client.post(f"/api/sessions/{sid}/back").json()
        c = s["communication"]
        assert c["changes"] and c["changes"][-1]["reason"] == "FREQUENT_CORRECTIONS"
        assert "confirm_selections" in c["modifiers"]


def test_confirmation_time_is_not_counted_as_slowness():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        _latency(sid, 9.0)
        client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "head", "confirm_ms": 7000})
        assert app.state.svc.sessions[sid].interactions[-1].latency_s == pytest.approx(2.0, abs=0.2)


def test_silence_counts_a_missed_response_without_delaying_escalation():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "mouth_throat"}).json()
        session, monitor = app.state.svc.sessions[sid], app.state.silence
        prompted = time.time() - 20
        session.prompted_at = prompted
        client.portal.call(monitor.check_mid_dialogue, utcnow())
        assert session.comm.mode == P.Mode.SIMPLIFIED and session.prompted_at == prompted
        session.prompted_at = time.time() - 31
        client.portal.call(monitor.check_mid_dialogue, utcnow())
        assert session.status == "escalated"


def test_the_tablet_is_english_only():
    with TestClient(app) as client:
        s = _start(client, "p-chen")                   # chart language: Chinese
        c = s["communication"]
        assert "language" not in c and "suggested_language" not in c and c["text"]["yes"] == "Yes"
        assert client.post(f"/api/sessions/{s['session_id']}/communication/language",
                           json={"language": "es"}).status_code in (404, 405)


def test_taps_that_name_the_need_are_not_asked_again_as_a_question():
    with TestClient(app) as client:
        s = _start(client)
        sid = s["session_id"]
        client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "head"})
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "feeling", "tap_id": "pain"}).json()
        q = s.get("question")
        assert q is None or q["id"] not in ("need:pain_head", "group:pain")
