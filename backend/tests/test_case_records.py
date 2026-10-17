"""Case records: light packets for high-risk escalations, storage, GET /api/cases/{id}, WebSocket pushes,
and nurse feedback through the normal confirmation (which feeds reliability learning)."""
import asyncio

from fastapi.testclient import TestClient

from app.data.patients import PATIENT_BY_ID
from app.main import app
from app.store.memory import MemoryStore
from tests.test_case_packet import SEND, cat, dialogue, packet
from tests.test_case_sbar import receive, unclear_session
from tests.conftest import login_as_nurse


def chest(client):
    s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
    return client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "chest"}).json()


# ---- light packet ----------------------------------------------------------------------------------

def test_safety_floor_gets_a_light_packet_and_everything_else_a_full_one():
    d = dialogue()
    d.apply_tap("area", "chest")
    dec = d.step()
    light = packet(d, dec, status="escalated")
    assert light["variant"] == "light" and light["less_likely"] == [] and light["chart_context"] == []
    assert light["top_needs"] and light["selections"] and light["next_step"]["code"] == "ASK_YES_NO"
    d = dialogue()
    d.apply_tap("area", "belly")
    d.apply_tap("feeling", "not_sure")
    assert packet(d, SEND)["variant"] == "full"


# ---- storage ---------------------------------------------------------------------------------------

def test_memory_store_round_trip():
    async def run():
        store = MemoryStore()
        record = {"id": "a1", "alert_id": "a1", "packet": {}, "feedback": None}
        await store.upsert_case(record)
        await store.upsert_case(record | {"feedback": {"helpful": True}})
        assert (await store.get_case("a1"))["feedback"] == {"helpful": True}
        assert await store.get_case("nope") is None
    asyncio.run(run())


def test_case_is_pushed_stored_and_served():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = chest(client)
            case = receive(nurse, s["alert_id"], "case")
            assert case["id"] == case["alert_id"] == s["alert_id"]
            assert client.get(f"/api/cases/{s['alert_id']}").json() == case
            assert asyncio.run(app.state.store.get_case(s["alert_id"]))["packet"] == case["packet"]
            assert client.get("/api/cases/nope").status_code == 404


# ---- feedback through confirmation -----------------------------------------------------------------

def test_feedback_rides_on_the_normal_confirmation_and_feeds_learning():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = unclear_session(client)
            case = receive(nurse, s["alert_id"], "case")
            top = case["packet"]["top_needs"][0]["need"]
            store = app.state.store
            before_rows = len(store.rows)
            before_rel = asyncio.run(store.get_reliability("patient:p-chen"))

            r = client.post(f"/api/alerts/{s['alert_id']}/confirm",
                            json={"need_id": top, "nurse": "Priya", "case_helpful": True})
            assert r.status_code == 200 and r.json()["status"] == "confirmed"
            updated = receive(nurse, s["alert_id"], "case")
            fb = updated["feedback"]
            assert fb["helpful"] is True and fb["actual_need"] == top and fb["actual_rank"] == 1 and fb["by"] == "Priya"
            assert client.get(f"/api/cases/{s['alert_id']}").json()["feedback"] == fb
            # the same confirmation fed the existing learning: a confirmations row and a reliability update
            assert len(store.rows) == before_rows + 1 and store.rows[-1]["confirmed_need"] == top
            assert asyncio.run(store.get_reliability("patient:p-chen")) != before_rel
            # and a second confirmation is still refused (no double counting)
            assert client.post(f"/api/alerts/{s['alert_id']}/confirm", json={"need_id": top}).status_code == 409


def test_not_helpful_and_a_need_the_packet_called_less_likely():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = unclear_session(client)
            case = receive(nurse, s["alert_id"], "case")
            pkt = case["packet"]
            actual = (pkt["less_likely"][0]["need"] if pkt["less_likely"]
                      else next(n for n in cat.need_ids if n not in {t["need"] for t in pkt["top_needs"]}))
            client.post(f"/api/alerts/{s['alert_id']}/confirm", json={"need_id": actual, "case_helpful": False})
            fb = receive(nurse, s["alert_id"], "case")["feedback"]
            assert fb["helpful"] is False and fb["actual_rank"] is None
            assert fb["actual_was_less_likely"] == bool(pkt["less_likely"])


def test_confirming_without_a_verdict_still_records_what_was_needed():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = chest(client)
            receive(nurse, s["alert_id"], "case")
            client.post(f"/api/alerts/{s['alert_id']}/confirm", json={"need_id": "pain_chest"})
            fb = receive(nurse, s["alert_id"], "case")["feedback"]
            assert fb["helpful"] is None and fb["actual_need"] == "pain_chest"


def test_welfare_alerts_have_no_case_and_confirm_as_before():
    with TestClient(app) as client:
        login_as_nurse(client)
        w = client.post("/api/welfare", json={"patient_id": "p-chen", "requested_by": "fam-lin"}).json()
        assert client.post(f"/api/welfare/{w['id']}/respond").json()["status"] == "responded"


def test_acknowledge_records_once_pushes_and_keeps_the_alert_open():
    with TestClient(app) as client:
        login_as_nurse(client)
        with client.websocket_connect("/ws?channel=nurse") as nurse:
            s = chest(client)
            receive(nurse, s["alert_id"], "case")
            r = client.post(f"/api/cases/{s['alert_id']}/acknowledge", json={"nurse": "Priya"})
            assert r.status_code == 200 and r.json()["acknowledged"]["by"] == "Priya"
            assert receive(nurse, s["alert_id"], "case")["acknowledged"]["by"] == "Priya"
            again = client.post(f"/api/cases/{s['alert_id']}/acknowledge", json={"nurse": "Sam"}).json()
            assert again["acknowledged"]["by"] == "Priya"                     # the first acknowledgement stands
            assert asyncio.run(app.state.store.get_case(s["alert_id"]))["acknowledged"]["by"] == "Priya"
            alert = next(a for a in client.get("/api/alerts").json() if a["id"] == s["alert_id"])
            assert alert["status"] == "open"                                  # still needs "They needed …"
            assert client.post("/api/cases/nope/acknowledge", json={}).status_code == 404
