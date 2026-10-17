"""Scripted ambiguous-evening scenario (sim/demo_scenarios.py) and the Template/Gemini SBAR comparison."""
import json

from fastapi.testclient import TestClient

from app.data.patients import PATIENT_BY_ID
from app.main import app
from app.services.case_packet import NEXT_STEPS, case_facts, template_case_sbar
from app.services.gemini import Gemini
from app.sim.demo_scenarios import AMBIGUOUS_EVENING, run_offline
from tests.test_case_sbar import FakeModels, gemini_with, receive

CHEN = PATIENT_BY_ID["p-chen"]


def play(client, pause_s=0.0):
    r = client.post(f"/api/demo/scenarios/{AMBIGUOUS_EVENING.id}", json={"pause_s": pause_s})
    assert r.status_code == 200, r.text
    return r.json()


def test_offline_story_fatigue_rises_and_the_engine_stops_asking():
    out = run_offline(AMBIGUOUS_EVENING)
    answers = [s for s in out["steps"] if "→ unsure" in s["text"]]
    fatigue = [s["fatigue"] for s in answers]
    assert fatigue == sorted(fatigue) and fatigue[-1] >= 2.0 and len(set(fatigue)) == len(fatigue)
    assert answers[-1]["can_answer"] is False                       # his answers are no longer reliable
    assert all(s["next"] != "ask" for s in out["steps"][len(out["steps"]) - 2:])   # it stopped asking him
    p = out["packet"]
    assert p["variant"] == "full" and p["stop_reason"]["code"] == "FATIGUE_HIGH"
    assert p["uncertainty"]["set_size"] >= 2 and p["next_step"]["code"] in NEXT_STEPS


def test_live_demo_puts_a_case_packet_on_the_nurse_screen():
    with TestClient(app) as client, client.websocket_connect("/ws?channel=nurse") as nurse:
        run = play(client)
        assert run["status"] == "sent" and run["alert_id"]
        assert any(s["mode"] == "large" for s in run["steps"])        # the tablet switched as he tired
        assert receive(nurse, run["alert_id"], "alert")["patient_name"] == "Wei Chen"
        case = receive(nurse, run["alert_id"], "case")
        p = case["packet"]
        assert p["stop_reason"]["code"] == "FATIGUE_HIGH" and "stopped" in p["stop_reason"]["text"]
        offline = run_offline(AMBIGUOUS_EVENING)["packet"]
        assert p["stop_reason"]["code"] == offline["stop_reason"]["code"]
        assert case["sbar"]["recommendation"] == p["next_step"]["text"]


def test_demo_endpoints():
    with TestClient(app) as client:
        listed = client.get("/api/demo/scenarios").json()
        assert [s["id"] for s in listed] == [AMBIGUOUS_EVENING.id] and listed[0]["hour"] == 19
        assert client.post("/api/demo/scenarios/nope", json={}).status_code == 404


# ---- Template vs Gemini: the same packet, two wordings ---------------------------------------------

def test_with_gemini_off_the_case_keeps_the_template_and_the_facts():
    with TestClient(app) as client, client.websocket_connect("/ws?channel=nurse") as nurse:
        run = play(client)
        case = receive(nurse, run["alert_id"], "case")
        assert case["gemini"] == {"outcome": "disabled", "sbar": None, "problems": []}
        assert case["sbar"] == case["sbar_template"] == template_case_sbar(case["packet"], CHEN)
        assert case["facts"] == json.loads(json.dumps(case_facts(case["packet"], CHEN)))


def _with_gemini(reply: str | None, error: Exception | None = None) -> Gemini:
    return gemini_with(FakeModels(reply, error=error))


class ReadsTheFacts:
    """A stand-in for Gemini that, like the real model, rewords the facts it is sent in the prompt."""
    calls = 0

    async def generate_content(self, contents: str, **_):
        ReadsTheFacts.calls += 1
        facts = json.loads(contents.split("Facts (JSON):\n", 1)[1])
        pt = facts["patient"]
        reply = {"situation": f"{pt['name']} in room {pt['room']} asked for something that is still unclear.",
                 "background": pt["background"], "assessment": facts["uncertainty"],
                 "recommendation": facts["next_step"]}
        return type("Resp", (), {"text": json.dumps(reply)})()


def test_with_gemini_on_both_versions_are_kept_and_the_facts_are_identical():
    with TestClient(app) as client, client.websocket_connect("/ws?channel=nurse") as nurse:
        app.state.svc.gemini = gemini_with(ReadsTheFacts())
        try:
            run = play(client)
            first = receive(nurse, run["alert_id"], "case")            # template first, at once
            assert first["sbar_source"] == "template" and first["gemini"]["outcome"] == "pending"
            case = receive(nurse, run["alert_id"], "case")             # then Gemini's checked wording
            assert case["gemini"]["outcome"] == "gemini" and case["sbar_source"] == "gemini"
            assert case["gemini"]["sbar"]["situation"].endswith("still unclear.")
            assert case["sbar_template"] == first["sbar_template"]       # same packet, same template
            assert case["sbar_template"]["situation"] != case["gemini"]["sbar"]["situation"]
            assert case["gemini"]["sbar"]["recommendation"] == case["packet"]["next_step"]["text"]
            assert case["facts"] == first["facts"]                      # Gemini saw only these facts
        finally:
            app.state.svc.gemini = Gemini(api_key=None)


def test_a_rejected_gemini_wording_is_shown_with_its_reasons_and_the_template_stays():
    with TestClient(app) as client, client.websocket_connect("/ws?channel=nurse") as nurse:
        bad = {"situation": "Wei Chen needs help.", "background": "Day 2 after a stroke.",
               "assessment": "Probably nauseous at 91%.", "recommendation": "Give an antiemetic."}
        app.state.svc.gemini = _with_gemini(json.dumps(bad))
        try:
            run = play(client)
            receive(nurse, run["alert_id"], "case")
            case = receive(nurse, run["alert_id"], "case")
            assert case["gemini"]["outcome"] == "rejected" and case["gemini"]["sbar"] is None
            assert any("91" in x for x in case["gemini"]["problems"])
            assert case["sbar_source"] == "template" and case["sbar"] == case["sbar_template"]
        finally:
            app.state.svc.gemini = Gemini(api_key=None)


def test_ask_gemini_again_after_no_reply():
    with TestClient(app) as client, client.websocket_connect("/ws?channel=nurse") as nurse:
        app.state.svc.gemini = _with_gemini(None, error=RuntimeError("quota"))
        try:
            run = play(client)
            receive(nurse, run["alert_id"], "case")
            assert receive(nurse, run["alert_id"], "case")["gemini"]["outcome"] == "no_reply"
            case = client.get(f"/api/cases/{run['alert_id']}").json()
            app.state.svc.gemini = _with_gemini(json.dumps(case["sbar_template"]))
            again = client.post(f"/api/cases/{run['alert_id']}/gemini").json()
            assert again["gemini"]["outcome"] == "gemini" and again["sbar_source"] == "gemini"
        finally:
            app.state.svc.gemini = Gemini(api_key=None)
