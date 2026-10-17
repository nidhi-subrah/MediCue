"""Case-packet SBAR: template, Gemini guardrails, fallbacks, and that alerts never wait for it."""
import asyncio
import itertools
import json
import time

import pytest
from fastapi.testclient import TestClient

from app.data.patients import PATIENT_BY_ID
from app.main import app
from app.services.case_packet import check_case_sbar, template_case_sbar
from app.services.gemini import Gemini
from tests.test_case_packet import SEND, cat, dialogue, packet
from tests.conftest import login_as_nurse

CHEN = PATIENT_BY_ID["p-chen"]


def belly_unclear():
    d = dialogue()
    d.apply_tap("area", "belly")
    d.apply_tap("feeling", "not_sure")
    return packet(d, SEND, chart=CHEN["chart"])


def faithful(p: dict) -> dict:
    """What a well-behaved model might write: reworded, same facts, uncertainty kept."""
    top = p["top_needs"]
    return {
        "situation": f"{CHEN['name']} in room {CHEN['room']} made a request the aid could not pin down.",
        "background": "Recovering after a stroke; tapped Belly, then Not sure.",
        "assessment": f"It is still unclear: {top[0]['label']} is most likely at {round(top[0]['p'] * 100)}%, "
                      f"with {top[1]['label']} possible at {round(top[1]['p'] * 100)}%.",
        "recommendation": f"Next: {p['next_step']['text']}.",
    }


# ---- template --------------------------------------------------------------------------------------

def test_template_passes_its_own_checks_for_every_tap_pair():
    for area, feeling in itertools.product([a["id"] for a in cat.raw["areas"]], [f["id"] for f in cat.raw["feelings"]]):
        d = dialogue()
        d.apply_tap("area", area)
        d.apply_tap("feeling", feeling)
        p = packet(d, SEND, chart=CHEN["chart"])
        sbar = template_case_sbar(p, CHEN)
        assert check_case_sbar(sbar, p, CHEN, cat) == [], (area, feeling)
        assert sbar["recommendation"] == p["next_step"]["text"]


# ---- validator -------------------------------------------------------------------------------------

def test_faithful_wording_passes():
    p = belly_unclear()
    assert check_case_sbar(faithful(p), p, CHEN, cat) == []


@pytest.mark.parametrize("field,text,problem", [
    ("assessment", "Belly pain is likely at 87%.", "number not in packet: 87"),
    ("assessment", "It may be chest pain.", "need not in packet: Chest pain"),
    ("background", "SpO2 has been dropping; it may be belly pain.", "chart field not in packet"),
    ("background", "Chart shows SpO2 96 → 92% over 2 h.", "chart field not in packet"),
    ("recommendation", "Give acetaminophen and reassess.", "banned term"),
    ("assessment", "Possibly a urinary infection.", "banned term: infection"),
    ("assessment", "Hungry has been ruled out; belly pain is likely.", "banned term"),
    ("assessment", "The patient definitely has belly pain.", "banned term: definitely"),
    ("assessment", "Belly pain.", "assessment drops the uncertainty"),
    ("situation", "", "situation: empty or too long"),
])
def test_validator_rejects(field, text, problem):
    p = belly_unclear()
    sbar = faithful(p) | {field: text}
    assert any(problem in x for x in check_case_sbar(sbar, p, CHEN, cat)), check_case_sbar(sbar, p, CHEN, cat)


# ---- Gemini call: success and every fallback ---------------------------------------------------------

class FakeModels:
    def __init__(self, reply=None, error=None, delay=0.0):
        self.reply, self.error, self.delay, self.calls = reply, error, delay, 0

    async def generate_content(self, **_):
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return type("Resp", (), {"text": self.reply})()


def gemini_with(models: FakeModels) -> Gemini:
    g = Gemini(api_key=None)
    g.client = type("Client", (), {"aio": type("Aio", (), {"models": models})()})()
    return g


def call(g: Gemini, p: dict, timeout=5.0):
    return asyncio.run(g.case_sbar(p, CHEN, cat, timeout=timeout))


def test_gemini_wording_is_used_when_it_passes_and_the_recommendation_is_the_next_step_verbatim():
    p = belly_unclear()
    sbar, source = call(gemini_with(FakeModels(json.dumps(faithful(p)))), p)
    assert source == "gemini" and sbar["assessment"] == faithful(p)["assessment"]
    assert sbar["recommendation"] == p["next_step"]["text"]


@pytest.mark.parametrize("case", ["new number", "new need", "treatment", "not json", "exception", "timeout"])
def test_gemini_failures_fall_back_to_the_template(case):
    p = belly_unclear()
    bad = faithful(p)
    models = {
        "new number": FakeModels(json.dumps(bad | {"assessment": "Belly pain is likely at 64%."})),
        "new need": FakeModels(json.dumps(bad | {"assessment": "It may be shortness of breath."})),
        "treatment": FakeModels(json.dumps(bad | {"recommendation": "Give an analgesic."})),
        "not json": FakeModels("Sure! Here is the SBAR you asked for."),
        "exception": FakeModels(error=RuntimeError("boom")),
        "timeout": FakeModels(json.dumps(bad), delay=1.0),
    }[case]
    sbar, source = call(gemini_with(models), p, timeout=0.2)
    assert source == "template" and sbar == template_case_sbar(p, CHEN) and models.calls >= 1


def test_without_a_key_gemini_is_never_called():
    p = belly_unclear()
    g = Gemini(api_key=None)
    assert not g.enabled
    assert call(g, p) == (template_case_sbar(p, CHEN), "template")


# ---- live: attached after the alert, never delaying it ---------------------------------------------

def finish(client, sid, s):
    for _ in range(10):
        if s["status"] == "question":
            s = client.post(f"/api/sessions/{sid}/answer", json={"question_id": s["question"]["id"], "answer": "unsure"}).json()
        elif s["status"] == "waiting_consult":
            s = client.post(f"/api/sessions/{sid}/skip_consult").json()
        else:
            return s
    return s


def receive(ws, alert_id, kind):
    for _ in range(40):
        m = ws.receive_json()
        if kind == "case" and m["type"] == "case" and m["case"]["alert_id"] == alert_id:
            return m["case"]
        if m["type"] == kind and kind != "case" and m["alert"]["id"] == alert_id:
            return m["alert"]
    raise AssertionError(f"no {kind} for {alert_id}")


def unclear_session(client):
    s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
    sid = s["session_id"]
    client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "belly"})
    return finish(client, sid, client.post(f"/api/sessions/{sid}/tap", json={"kind": "feeling", "tap_id": "not_sure"}).json())


def test_unclear_request_gets_a_full_packet_after_the_alert():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = unclear_session(client)
            first = receive(nurse, s["alert_id"], "alert")
            assert first["case"] is None                                # the alert goes out first, unchanged
            case = receive(nurse, s["alert_id"], "case")
            pkt = case["packet"]
            assert pkt["variant"] == "full" and pkt["stop_reason"]["code"] not in ("RESOLVED", "SAFETY_FLOOR")
            assert case["sbar_source"] == "template" and case["sbar"]["recommendation"] == pkt["next_step"]["text"]
            assert client.get("/api/alerts").json()[0]["sbar"] == first["sbar"]   # the existing SBAR is untouched


def test_clear_request_gets_no_packet():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = client.post("/api/sessions", json={"patient_id": "p-patel", "language": "en"}).json()
        sid = s["session_id"]
        client.post(f"/api/sessions/{sid}/tap", json={"kind": "area", "tap_id": "mouth_throat"})
        s = client.post(f"/api/sessions/{sid}/tap", json={"kind": "feeling", "tap_id": "thirsty"}).json()
        for _ in range(6):
            if s["status"] != "question":
                break
            s = client.post(f"/api/sessions/{sid}/answer", json={"question_id": s["question"]["id"], "answer": "yes"}).json()
        client.get("/api/alerts")                                   # let background tasks run
        alert = next(a for a in client.get("/api/alerts").json() if a["id"] == s["alert_id"])
        assert alert["case"] is None
        assert client.get(f"/api/cases/{s['alert_id']}").status_code == 404


def test_a_hanging_gemini_never_delays_an_urgent_alert():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            slow = FakeModels(json.dumps({"situation": "x", "background": "x", "assessment": "x", "recommendation": "x"}), delay=30)
            app.state.svc.gemini = gemini_with(slow)
            try:
                s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
                t0 = time.monotonic()
                s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "chest"}).json()
                assert s["status"] == "escalated" and time.monotonic() - t0 < 2
                alert = receive(nurse, s["alert_id"], "alert")
                assert alert["priority"] == "urgent"
                case = receive(nurse, s["alert_id"], "case")            # light packet, while Gemini still hangs
                assert case["packet"]["stop_reason"]["code"] == "SAFETY_FLOOR" and case["packet"]["variant"] == "light"
                assert case["sbar_source"] == "template" and time.monotonic() - t0 < 5
            finally:
                app.state.svc.gemini = Gemini(api_key=None)
