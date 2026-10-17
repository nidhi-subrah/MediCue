"""Tailored second-step options, Gemini ranking, high-risk pins and send-straight-away. No network."""
import asyncio

from fastapi.testclient import TestClient

from app.catalog import get_catalog
from app.config import settings
from app.engine import options as opts
from app.engine.conformal import ConformalPredictor
from app.main import app
from app.services.gemini import Gemini
from app.services.hub import Hub
from app.services.predictions import PredictionService
from app.services.sessions import SessionService
from app.store.memory import MemoryStore
from tests.conftest import login_as_nurse

cat = get_catalog()


def start(client, pid="p-patel"):
    return client.post("/api/sessions", json={"patient_id": pid, "language": "en"}).json()


def tap(client, s, kind, tap_id, option_id=None):
    body = {"kind": kind, "tap_id": tap_id} | ({"option_id": option_id} if option_id else {})
    return client.post(f"/api/sessions/{s['session_id']}/tap", json=body).json()


def test_every_area_option_sends_a_known_feeling():
    feelings = set(cat.feeling_labels)
    for area, spec in cat.raw["area_options"].items():
        assert area in cat.area_labels and spec["prompt"]
        assert all(o["feeling"] in feelings for o in spec["options"])
        assert len({o["id"] for o in spec["options"]}) == len(spec["options"])


def test_head_options_are_tailored_and_something_else_holds_the_rest():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = tap(client, start(client), "area", "head")
        assert s["status"] == "feeling"
        o = s["options"]
        assert o["prompt"] == "What's wrong with your head?" and o["source"] == "engine"
        ids = [x["id"] for x in o["predicted"]] + [x["id"] for x in o["more"]]
        assert all(i.startswith("head.") for i in ids)
        assert not any(x["feeling"] == "need_toilet" for x in o["predicted"] + o["more"])
        assert len(o["predicted"]) == 4                                 # 5 options -> top 4 shown
        assert [x["label"] for x in o["more"]][-1] == "None of these"   # plus what's left
        assert len(ids) == 5 + 1


def test_high_risk_options_are_always_shown():
    order = ["whole_body.hot", "whole_body.cold", "whole_body.position", "whole_body.wet", "whole_body.sick",
             "whole_body.breathe"]
    chosen = opts.choose(cat, "whole_body", order, "gemini")
    shown = [x["id"] for x in chosen["predicted"]]
    assert shown[:4] == order[:4] and "whole_body.breathe" in shown      # ranked last, still pinned
    assert "whole_body.breathe" not in [x["id"] for x in chosen["more"]]


def test_gemini_ranking_is_limited_to_the_areas_options():
    spec = opts.area_spec(cat, "belly")["options"]
    fallback = [o["id"] for o in spec]
    order = opts.merge_order(spec, ["belly.hungry", "made.up", "head.hurts", "belly.hungry"], fallback)
    assert order[0] == "belly.hungry" and sorted(order) == sorted(fallback)


def test_washroom_area_sends_straight_away():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = tap(client, start(client), "area", "toilet")
        assert s["status"] == "sent" and s["questions_asked"] == 0
        alert = next(a for a in client.get("/api/alerts").json() if a["id"] == s["alert_id"])
        assert alert["priority"] == "routine" and "Sent straight away" in alert["reason"]


def test_pain_medicine_option_sends_straight_away_and_alert_names_the_choice():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = tap(client, start(client), "area", "back")
        meds = next(x for x in s["options"]["predicted"] + s["options"]["more"] if x["id"] == "back.meds")
        s = tap(client, s, "feeling", "medicine", meds["id"])
        assert s["status"] == "sent" and s["questions_asked"] == 0
        assert s["choice"]["label"] == "Need pain medicine"
        alert = next(a for a in client.get("/api/alerts").json() if a["id"] == s["alert_id"])
        assert alert["choice"]["id"] == "back.meds"
        assert "Need pain medicine" in alert["sbar"]["situation"] + alert["sbar"]["assessment"]


def test_option_must_match_what_was_offered():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = tap(client, start(client), "area", "head")
        r = client.post(f"/api/sessions/{s['session_id']}/tap",
                        json={"kind": "feeling", "tap_id": "pain", "option_id": "chest.hurts"})
        assert r.status_code == 409


def test_chest_still_escalates_and_offers_detail_options():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = tap(client, start(client, "p-chen"), "area", "chest")
        assert s["status"] == "escalated" and s["questions_asked"] == 0
        shown = {x["id"] for x in s["options"]["predicted"]}
        assert {"chest.hurts", "chest.breathe"} <= shown


class FakeGemini(Gemini):
    def __init__(self):
        super().__init__(api_key=None)

    @property
    def enabled(self):
        return True

    async def rank_area_options(self, facts, areas):
        self.facts = facts
        return {"head": [{"option_id": "head.meds", "reason": "Analgesic overdue on chart"},
                         {"option_id": "head.worried", "reason": "Anxious in the evenings"}]}


def test_session_uses_gemini_ranking_once_ready_and_never_waits_for_it():
    store, hub, fake = MemoryStore(), Hub(), FakeGemini()
    preds = PredictionService(cat, store, fake)
    svc = SessionService(cat, settings.engine, store, hub, Gemini(api_key=None), ConformalPredictor(), None, preds)

    async def run():
        first = await svc.start("p-chen", "en")             # ranking starts in the background
        assert preds.get("p-chen") is None
        await asyncio.gather(*preds.inflight.values())
        assert "analgesic_overdue" in fake.facts["chart"] and fake.facts["notes"]
        s = await svc.tap((await svc.start("p-chen", "en"))["session_id"], "area", "head")
        o = s["options"]
        assert o["source"] == "gemini"
        assert [x["id"] for x in o["predicted"]][:2] == ["head.meds", "head.worried"]
        assert o["predicted"][0]["reason"] == "Analgesic overdue on chart"
        assert len(o["predicted"]) + len(o["more"]) == 6     # missing options filled in, plus "None of these"
        assert first["options"] is None                      # area step: no second-step options yet
    asyncio.run(run())


# ---- Back ------------------------------------------------------------------------------------------

def back(client, s):
    return client.post(f"/api/sessions/{s['session_id']}/back")


def test_back_from_second_step_returns_to_where_is_it():
    with TestClient(app) as client:
        login_as_nurse(client)
        s0 = start(client)
        assert s0["can_go_back"] is False
        s = tap(client, s0, "area", "head")
        assert s["can_go_back"] is True
        r = back(client, s)
        assert r.status_code == 200
        b = r.json()
        assert b["status"] == "area" and b["taps"] == 0 and b["options"] is None
        assert [x["need"] for x in b["belief"]] == [x["need"] for x in s0["belief"]]   # belief restored
        s = tap(client, b, "area", "belly")                                           # and it carries on
        assert s["options"]["area"] == "belly"


def test_back_from_a_question_restores_the_previous_step_and_choice():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = tap(client, start(client), "area", "mouth_throat")
        opt = next(x for x in s["options"]["predicted"] + s["options"]["more"] if x["id"] == "mouth_throat.thirsty")
        q = tap(client, s, "feeling", "thirsty", opt["id"])
        if q["status"] != "question":
            return   # the engine was sure enough to send; nothing to go back to
        b = back(client, q).json()
        assert b["status"] == "feeling" and b["choice"] is None and b["options"]["area"] == "mouth_throat"


def test_back_is_refused_once_something_was_sent():
    with TestClient(app) as client:
        login_as_nurse(client)
        s = tap(client, start(client), "area", "toilet")
        assert s["status"] == "sent" and s["can_go_back"] is False
        assert back(client, s).status_code == 409
        c = tap(client, start(client, "p-chen"), "area", "chest")    # escalated: the alert stays
        assert c["status"] == "escalated" and back(client, c).status_code == 409
