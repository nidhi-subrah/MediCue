"""Clinician copilot acceptance tests, one section per requirement.

(1) With Gemini disabled, a full packet and SBAR are still produced, from templates.
(2) Validation rejects an SBAR with a number, need or chart field that is not in the packet.
(3) Treatment and diagnosis phrases are rejected.
(4) The high-risk path escalates with the same timing as before.
(5) Every stop_reason code is covered, end to end.
"""
import asyncio
import copy
import json
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.engine.decision import Action, Decision
from app.main import app
from app.services import sessions as sessions_mod
from app.services.case_packet import STOP_TEXT, check_case_sbar, template_case_sbar
from app.services.gemini import Gemini
from tests.test_case_packet import PACKET, SEND, cat, cfg, dialogue, packet, run
from tests.test_case_sbar import CHEN, FakeModels, belly_unclear, faithful, gemini_with, receive, unclear_session

REPO = Path(__file__).resolve().parents[2]
HIGH_RISK_TAPS = [("chest", "pain"), ("chest", "hard_to_breathe"), ("mouth_throat", "hard_to_breathe")]


def detail(g: Gemini, p: dict, timeout=5.0):
    return asyncio.run(g.case_sbar_detail(p, CHEN, cat, timeout=timeout))


# ---- (1) Gemini disabled: full packet and SBAR from templates ---------------------------------------

def test_gemini_disabled_still_produces_a_full_packet_and_sbar():
    with TestClient(app) as client, client.websocket_connect("/ws?channel=nurse") as nurse:
        assert not app.state.svc.gemini.enabled                       # no key in tests
        s = unclear_session(client)
        receive(nurse, s["alert_id"], "case")
        case = client.get(f"/api/cases/{s['alert_id']}").json()
        p = case["packet"]
        assert p["variant"] == "full" and p["stop_reason"]["code"] != "RESOLVED"
        assert p["selections"] and len(p["top_needs"]) == 3
        assert p["uncertainty"]["text"] and p["next_step"]["text"] and p["stop_reason"]["text"]
        assert case["sbar_source"] == "template"
        assert all(case["sbar"][k].strip() for k in ("situation", "background", "assessment", "recommendation"))
        assert case["sbar"]["recommendation"] == p["next_step"]["text"]
        assert check_case_sbar(case["sbar"], p, CHEN, cat) == []      # the template passes its own checks


def test_gemini_disabled_makes_no_call_and_says_so():
    p = belly_unclear()
    sbar, source, outcome, problems = detail(Gemini(api_key=None), p)
    assert (source, outcome, problems) == ("template", "disabled", []) and sbar == template_case_sbar(p, CHEN)


# ---- (2) validation rejects facts that are not in the packet ---------------------------------------

def _absent_needs(p: dict) -> list[str]:
    present = {n["label"] for n in p["top_needs"]} | {x["label"] for x in p["less_likely"]}
    return [n["label"] for n in cat.needs if n["label"] not in present]


@pytest.mark.parametrize("text", ["Belly pain is possible at 87%.", "Possible belly pain (0.93).",
                                  "Belly pain is possible; 1234 inputs so far."])
def test_rejects_a_number_not_in_the_packet(text):
    p = belly_unclear()
    problems = check_case_sbar(faithful(p) | {"assessment": text}, p, CHEN, cat)
    assert any(x.startswith("number not in packet") for x in problems), problems


@pytest.mark.parametrize("form", ["exact", "lower", "paraphrase"])
def test_rejects_a_need_not_in_the_packet(form):
    p = belly_unclear()
    assert "Short of breath" in _absent_needs(p)
    name = {"exact": "Short of breath", "lower": "short of breath", "paraphrase": "shortness of breath"}[form]
    problems = check_case_sbar(faithful(p) | {"assessment": f"It may be {name}."}, p, CHEN, cat)
    assert any(x == "need not in packet: Short of breath" for x in problems), problems


@pytest.mark.parametrize("text", [
    "The SpO2 trending down may matter.",               # the chart field's label
    f"Chart: {CHEN['chart']['spo2_dropping']['value']}.",  # its value on this patient's chart
    "There may be a fever.",                            # a keyword for it
    "Blood pressure may be relevant.",
])
def test_rejects_a_chart_field_not_in_the_packet(text):
    p = belly_unclear()
    assert {c["lookup"] for c in p["chart_context"]}.isdisjoint({"spo2_dropping", "febrile", "bp_elevated"})
    problems = check_case_sbar(faithful(p) | {"background": text}, p, CHEN, cat)
    assert any(x.startswith("chart field not in packet") for x in problems), problems


@pytest.mark.parametrize("bad", ["number", "need", "chart"])
def test_a_rejected_gemini_reply_falls_back_to_the_template(bad):
    p = belly_unclear()
    reply = faithful(p) | {"number": {"assessment": "Belly pain is possible at 87%."},
                           "need": {"assessment": "It may be shortness of breath."},
                           "chart": {"background": "There may be a fever."}}[bad]
    sbar, source, outcome, problems = detail(gemini_with(FakeModels(json.dumps(reply))), p)
    assert (source, outcome) == ("template", "rejected") and problems and sbar == template_case_sbar(p, CHEN)


# ---- (3) treatment and diagnosis language ----------------------------------------------------------

BANNED_PHRASES = [
    "Give 1 g acetaminophen.", "Administer morphine now.", "Start IV fluids.", "Consider antibiotics.",
    "Increase the dose.", "Treat with oxygen therapy.", "Insert a urinary catheter.", "Prescribe an analgesic.",
    "This looks like a UTI.", "Likely pneumonia.", "Possible heart attack.", "Suspect a hip fracture.",
    "Diagnosis: dehydration.", "Signs of infection.", "Could be delirium.",
    "Belly pain has been ruled out.", "She is definitely thirsty.", "Hunger is confirmed.",
]


@pytest.mark.parametrize("phrase", BANNED_PHRASES)
def test_rejects_treatment_and_diagnosis_language(phrase):
    p = belly_unclear()
    for field in ("assessment", "recommendation"):
        problems = check_case_sbar(faithful(p) | {field: f"{phrase} Belly pain is possible."}, p, CHEN, cat)
        assert any(x.startswith("banned term") for x in problems), (field, problems)


def test_the_packets_own_wording_is_not_mistaken_for_advice():
    d = dialogue()
    d.apply_tap("area", "people")
    d.apply_tap("feeling", "medicine")
    p = packet(d, SEND, chart=CHEN["chart"])
    assert "Question about medication" in {n["label"] for n in p["top_needs"]}
    sbar = faithful(p) | {"assessment": "A question about medication is possible; it is not clear yet.",
                          "background": "Recovering after a stroke."}   # from the chart's diagnosis line
    assert check_case_sbar(sbar, p, CHEN, cat) == []


# ---- (4) the high-risk path escalates with the same timing as before ------------------------------

def _trail(d, area, feeling, build_packets: bool):
    d.apply_tap("area", area)
    out = []
    for _ in range(8):
        if build_packets:
            snapshot = copy.deepcopy((d.belief, d.signal_belief, d.questions_asked, d.taps, len(d.trace)))
            packet(d, None, status="feeling")
            assert (d.belief, d.signal_belief, d.questions_asked, d.taps, len(d.trace)) == snapshot
        dec = d.step()
        out.append((dec.chosen.kind, dec.chosen.id, dec.reason, d.taps, d.questions_asked))
        if dec.chosen.kind in ("escalate", "send", "consult"):
            return out
        if dec.chosen.kind == "tap":
            d.apply_tap("feeling", feeling)
        else:
            d.apply_answer(dec.chosen.id, "no")
    return out


@pytest.mark.parametrize("reliability", [0.55, 0.7, 0.85, 0.97])
@pytest.mark.parametrize("area,feeling", HIGH_RISK_TAPS)
def test_engine_escalates_after_the_same_inputs_with_or_without_packets(reliability, area, feeling):
    plain = _trail(dialogue(reliability=reliability), area, feeling, False)
    watched = _trail(dialogue(reliability=reliability), area, feeling, True)
    assert plain == watched
    kind, _, reason, taps, questions = plain[-1]
    assert kind == "escalate" and reason.startswith("Safety floor") and questions == 0 and taps <= 2


def _live_escalation(client, area, feeling):
    s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
    sid = s["session_id"]
    t0 = time.perf_counter()
    s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": area}).json()
    if s["status"] == "feeling":
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "feeling", "tap_id": feeling}).json()
    return s, time.perf_counter() - t0


def _comparable(s, alert):
    return (s["status"], s["taps"], s["questions_asked"], s["last_decision"]["chosen"]["kind"],
            s["last_decision"]["reason"], alert["priority"], alert["top"], alert["sbar"], alert["reason"])


@pytest.mark.parametrize("area,feeling", HIGH_RISK_TAPS)
def test_live_escalation_is_identical_with_the_copilot_on_or_off(area, feeling, monkeypatch):
    results = {}
    for mode in ("on", "off"):
        with TestClient(app) as client:
            if mode == "off":
                async def no_copilot(self, alert_id, s):
                    return None
                monkeypatch.setattr(sessions_mod.SessionService, "_attach_case_packet", no_copilot)
            s, _ = _live_escalation(client, area, feeling)
            alert = next(a for a in client.get("/api/alerts").json() if a["id"] == s["alert_id"])
            results[mode] = _comparable(s, alert)
            assert (alert["case"] is None) == (mode == "off")
        monkeypatch.undo()
    assert results["on"] == results["off"]


def test_the_alert_is_pushed_before_any_packet_work_starts(monkeypatch):
    with TestClient(app) as client:
        hub, published, seen_at_build = app.state.hub, [], []
        real_publish, real_build = hub.publish, sessions_mod.build_case_packet

        async def spy_publish(channel, message):
            published.append(message["type"])
            await real_publish(channel, message)

        def spy_build(*args, **kwargs):
            seen_at_build.append(list(published))
            return real_build(*args, **kwargs)

        monkeypatch.setattr(hub, "publish", spy_publish)
        monkeypatch.setattr(sessions_mod, "build_case_packet", spy_build)
        s, _ = _live_escalation(client, "chest", "pain")
        client.get("/api/alerts")                                    # let the background task run
        assert s["status"] == "escalated" and seen_at_build
        assert "alert" in seen_at_build[0]                           # the alert was already on its way


def test_escalation_latency_stays_within_budget_with_the_copilot_on():
    """Tap to escalated response, five times; the PRD target is under 10 s, this checks well under 1 s."""
    with TestClient(app) as client:
        times = [_live_escalation(client, "chest", "pain")[1] for _ in range(5)]
    assert max(times) < 1.0, times


# ---- (5) every stop_reason code, end to end ---------------------------------------------------------

def _ambiguous():
    d = dialogue()
    d.apply_tap("area", "belly")
    d.apply_tap("feeling", "uncomfortable")
    return d


def _packet_for(code: str) -> dict:
    if code == "RESOLVED":
        d = dialogue()
        return packet(d, run(d, "mouth_throat", "thirsty", answer="yes"))
    if code == "SAFETY_FLOOR":
        d = dialogue()
        return packet(d, run(d, "chest", "pain"), status="escalated")
    if code == "PATIENT_TIMEOUT":
        return packet(_ambiguous(), Decision(Action("escalate", "unresponsive", "", 0, 0, {}), [], ""), status="escalated")
    if code == "CONSULT_PENDING":
        return packet(_ambiguous(), None, status="waiting_consult",
                      consult={"person_name": "Lin Chen", "relation": "daughter", "status": "pending"})
    d = _ambiguous()
    if code == "MAX_QUESTIONS":
        d.questions_asked = cfg.max_questions
    if code == "FATIGUE_HIGH":
        d.inconsistencies = cfg.max_inconsistent_answers
    return packet(d, SEND)


@pytest.mark.parametrize("code", list(STOP_TEXT))
def test_each_stop_reason_produces_a_valid_packet_and_sbar(code):
    p = _packet_for(code)
    assert p["stop_reason"]["code"] == code
    assert p["variant"] == ("light" if code == "SAFETY_FLOOR" else "full")
    sbar = template_case_sbar(p, CHEN)
    assert check_case_sbar(sbar, p, CHEN, cat) == [] and sbar["recommendation"] == p["next_step"]["text"]


def test_stop_reasons_match_across_backend_shared_types_and_ui():
    codes = set(STOP_TEXT)
    union = re.search(r"export type StopReason =(.*?);", (REPO / "shared/types.ts").read_text(), re.S).group(1)
    assert set(re.findall(r'"([A-Z_]+)"', union)) == codes
    ui = (REPO / "frontend/components/nurse/case-packet.tsx").read_text()
    stop_map = re.search(r"const STOP: Record<StopReason.*?= \{(.*?)\n\}", ui, re.S).group(1)
    assert set(re.findall(r"^\s+([A-Z_]+):", stop_map, re.M)) == codes   # every code has an icon and title
