"""Unit insights, Care forecast and the unit patients' generated history. In-memory store, no network."""
import asyncio
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.catalog import get_catalog
from app.data import seed
from app.data.unit_history import SOURCE, STORIES, ensure_unit_history
from app.main import app
from app.risk import start as start_risk
from app.services.gemini import Gemini
from app.services.nurse_views import MULTIPLIER, UNIT, NurseViews, holt
from app.store.memory import MemoryStore
from tests.conftest import login_as_nurse, login_as_patient

cat = get_catalog()


async def _stores():
    store = MemoryStore()
    rows, events = seed.generate(cat)
    await store.bulk_seed(rows, events)
    risk = await start_risk(store)
    return store, risk


# ---- unit history -----------------------------------------------------------------------------------

def test_unit_history_fills_in_every_unit_patient_without_touching_other_rows():
    async def run():
        store, risk = await _stores()
        before = [e for e in store.events if (e.get("payload") or {}).get("source") != SOURCE]
        assert await ensure_unit_history(store, risk, cat)
        mine = [e for e in store.events if (e.get("payload") or {}).get("source") == SOURCE]
        assert {e["patient_id"] for e in mine} == set(STORIES)
        # one session per seeded request, ending in the same confirmed need
        confirmed = [e for e in mine if e["event_type"] == "nurse_confirmed"]
        assert len(confirmed) == len([r for r in store.rows if r["patient_id"] in STORIES])
        assert not await ensure_unit_history(store, risk, cat)            # fresh: nothing regenerated
        assert await ensure_unit_history(store, risk, cat, force=True)    # regenerating replaces, never duplicates
        assert len([e for e in store.events if (e.get("payload") or {}).get("source") == SOURCE]) == len(mine)
        assert [e for e in store.events if (e.get("payload") or {}).get("source") != SOURCE] == before
        assert len(await risk.list_cohort()) == 22                        # the early-warning cohort is unchanged
        assert any(c["payload"].get("label", "").startswith("Gabapentin") for c in risk.chart if c["patient_id"] == "p-chen")
        assert await risk.latest_scores("p-alvarez")                      # scored by the unchanged risk engine
    asyncio.run(run())


# ---- routes -------------------------------------------------------------------------------------------

def test_insights_routes_cover_every_unit_patient_and_are_nurse_only():
    with TestClient(app) as client:
        login_as_patient(client)
        assert client.get("/api/nurse/insights").status_code == 403
        login_as_nurse(client)
        for rng, cols in (("24h", 24), ("7d", 7), ("14d", 14)):
            b = client.get(f"/api/nurse/insights?range={rng}").json()
            assert len(b["heatmap"]["columns"]) == cols
            assert [p["patient_id"] for p in b["heatmap"]["patients"]] == UNIT
            assert all(len(p["cells"]) == cols for p in b["heatmap"]["patients"])   # empty buckets kept
        assert client.get("/api/nurse/insights?range=1y").status_code == 422
        g = b["gauges"]
        assert {x["patient_id"] for x in g} == set(UNIT)
        assert all(x["tap_speed"]["level"] in ("green", "amber", "red", "unknown") for x in g)
        assert any(m["label"].startswith("Gabapentin") for m in b["needs_by_type"]["markers"])
        p = next(p for p in b["heatmap"]["patients"] if p["total"])
        cell = next(c for c in p["cells"] if c["requests"])
        detail = client.get("/api/nurse/insights/cell",
                            params={"patient_id": p["patient_id"], "start": cell["start"], "bucket": "1 day"}).json()
        assert len(detail["items"]) == cell["requests"]


def test_forecast_route_is_planning_only():
    with TestClient(app) as client:
        login_as_nurse(client)
        risk = app.state.risk
        before = asyncio.run(_latest(risk))
        f = client.get("/api/nurse/forecast").json()
        assert f["source"] == "base" and "not diagnoses" in f["notice"]
        assert len(f["hours"]) == 12 and [p["patient_id"] for p in f["patients"]] == UNIT
        for i, u in enumerate(f["unit"]):     # busy hours = the sum of every patient's forecast
            assert abs(u["expected"] - sum(p["hours"][i]["expected"] for p in f["patients"] if p["hours"])) < 0.05
        for p in f["patients"]:
            for h in p["hours"]:
                assert h["low"] <= h["expected"] + 1e-9 <= h["high"] + 1e-9
            for r in p["risk"]:
                assert len(r["ahead"]) == 4 and all(0 <= a["low"] <= a["score"] <= a["high"] <= 1 for a in r["ahead"])
        assert asyncio.run(_latest(risk)) == before       # projecting never changes the risk engine's levels
        flags = [fl for p in f["patients"] for fl in p["flags"]]
        assert flags and all(fl["level"] in ("amber", "red") for fl in flags)   # the unit patients' own flags
        assert {p["patient_id"] for p in f["patients"] if p["flags"]} <= set(UNIT)


async def _latest(risk):
    return {(r["patient_id"], r["risk"]): r["level"] for r in await risk.latest_scores()}


# ---- forecast adjustments ------------------------------------------------------------------------------

class FakeGemini(Gemini):
    def __init__(self, adjustments):
        super().__init__(api_key=None)
        self.adjustments = adjustments

    @property
    def enabled(self):
        return True

    async def forecast_adjustments(self, patients, groups):
        self.seen = patients
        return self.adjustments


def test_adjustments_must_quote_a_given_fact_and_use_fixed_multipliers():
    async def run():
        store, risk = await _stores()
        await ensure_unit_history(store, risk, cat)
        fake = FakeGemini([
            {"patient_id": "p-chen", "group": "Pain", "label": "much higher", "reason": "Pain medicine is overdue.",
             "evidence": "Acetaminophen 1 g, 5.5 h ago"},                     # quotes his chart; type by display name
            {"patient_id": "p-chen", "group": "comfort", "label": "higher", "reason": "Feels cold.",
             "evidence": "the heating is broken"},                                          # not a fact: dropped
            {"patient_id": "p-nobody", "group": "pain", "label": "higher", "reason": "x", "evidence": "x"},
            {"patient_id": "p-alvarez", "group": "flying", "label": "higher", "reason": "x", "evidence": "ALS"},
        ])
        views = NurseViews(cat, store, risk, fake)
        first = await views.forecast()
        assert first["source"] == "pending"          # never waits for Gemini
        await views._adjust_task
        second = await views.forecast()
        assert second["source"] == "gemini"
        chen = next(p for p in second["patients"] if p["patient_id"] == "p-chen")
        assert [(a["group"], a["multiplier"]) for a in chen["adjustments"]] == [("pain", MULTIPLIER["much_higher"])]
        base = next(p for p in first["patients"] if p["patient_id"] == "p-chen")
        for b, a in zip(base["hours"], chen["hours"]):
            assert abs(a["by_group"]["pain"] - b["by_group"]["pain"] * 1.6) < 1e-6
            assert a["by_group"]["comfort"] == b["by_group"]["comfort"]
        assert all("facts" in p for p in fake.seen)
    asyncio.run(run())


def test_holt_projects_a_rising_series_upward_within_bounds():
    proj = holt([0.1, 0.15, 0.2, 0.25, 0.3], 4)
    assert proj[0][0] < proj[-1][0] <= 1.0
    assert all(lo <= v <= hi for v, lo, hi in proj)
    assert all(0.0 <= lo and hi <= 1.0 for _, lo, hi in holt([0.95, 0.97, 0.99, 1.0], 4))
