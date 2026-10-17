"""Patient profiles, the fatigue upgrade, nurse-note suggestions and the shift summary. No network:
Gemini is replaced by a fake that returns fixed items."""
import asyncio

from fastapi.testclient import TestClient

from app.catalog import get_catalog
from app.config import settings
from app.engine import profile as prof
from app.engine.conformal import ConformalPredictor
from app.engine.decision import Consultant, decide
from app.engine.dialogue import Dialogue
from app.main import app
from app.services.gemini import Gemini
from app.services.hub import Hub
from app.services.profiles import ProfileService
from app.services.sessions import SessionService
from app.store.memory import MemoryStore

cat = get_catalog()
cfg = settings.engine
NO_FLAGS = {lk.id: False for lk in cat.lookups}
NOTES = "Tires quickly. Daughter Lin visits daily and reads his gestures well."


def item(kind, target="", value="", evidence="Tires quickly", start=-1, end=-1):
    return {"kind": kind, "target": target, "value": value, "evidence": evidence,
            "start_hour": start, "end_hour": end}


class FakeGemini(Gemini):
    def __init__(self, profile_items=None, note_items=None):
        super().__init__(api_key=None)
        self.profile_items, self.note_items = profile_items or {}, note_items or []

    @property
    def enabled(self):
        return True

    async def extract_profiles(self, patients, needs, people):
        return {p["id"]: self.profile_items.get(p["id"], []) for p in patients}

    async def extract_profile(self, patient, needs, people):
        return self.profile_items.get(patient["id"], [])

    async def items_from_nurse_note(self, patient, note, confirmed_label, needs, people, current):
        return self.note_items

    async def handoff_lines(self, patients):
        return None


# ---- validation -----------------------------------------------------------------------------------

def test_items_need_an_exact_quote_and_known_ids():
    kept, dropped = prof.validate_items([
        item("fatigue", value="elevated", evidence="Tires quickly"),
        item("fatigue", value="high", evidence="He is exhausted all the time"),          # not in the notes
        item("need", target="not_a_need", value="raise_slight", evidence="Tires quickly"),
        item("person_trust", target="fam-nobody", value="higher", evidence="reads his gestures well"),
        item("teleport", value="x"),
        item("person_trust", target="fam-lin", value="higher", evidence="reads his gestures WELL."),
    ], NOTES, cat, {"fam-lin"})
    assert [(i.kind, i.value) for i in kept] == [("fatigue", "elevated"), ("person_trust", "higher")]
    reasons = " ".join(d["reason"] for d in dropped)
    assert "quote not found" in reasons and "unknown need" in reasons and "unknown person" in reasons


def test_high_risk_needs_cannot_be_lowered():
    kept, dropped = prof.validate_items(
        [item("need", target="pain_chest", value="lower_strong", evidence="Tires quickly")], NOTES, cat, set())
    assert kept == []
    assert dropped[0]["status"] == "blocked"


def test_availability_needs_hours_and_windows_wrap_midnight():
    _, dropped = prof.validate_items([item("person_available", target="fam-lin")], NOTES, cat, {"fam-lin"})
    assert "time window" in dropped[0]["reason"]
    assert prof.hours_window(22, 6) == (22, 23, 0, 1, 2, 3, 4, 5)
    assert prof.hours_window(-1, -1) is None
    # Trust has no time of day; a stray window must not make it look like a different item.
    kept, _ = prof.validate_items([item("person_trust", "fam-lin", "higher", "reads his gestures well", 20, 24)],
                                  NOTES, cat, {"fam-lin"})
    assert kept[0].hours is None


# ---- effects --------------------------------------------------------------------------------------

def test_prior_multipliers_are_bounded_and_keep_high_risk_floor():
    p = prof.PatientProfile("p", [prof.ProfileItem("need", "anxious", "raise_strong", evidence="x"),
                                  prof.ProfileItem("need", "anxious", "raise_strong", evidence="y", origin="nurse"),
                                  prof.ProfileItem("need", "thirsty", "lower_strong", evidence="z")])
    mult = prof.prior_multipliers(p, cat, hour=12)
    assert mult["anxious"] == prof.MULT_MAX and mult["thirsty"] == prof.MULT_MIN

    prior = list(cat.base_prior)
    new = prof.apply_to_prior(prior, mult, cat)
    assert abs(sum(new) - 1) < 1e-9
    for n, p0, high in zip(new, prior, cat.high_risk):
        if high:
            assert n >= p0 - 1e-12        # raising anxiety never shaves probability off chest pain
    assert new[cat.index["anxious"]] > prior[cat.index["anxious"]]


def test_time_windows_and_people():
    p = prof.PatientProfile("p", [
        prof.ProfileItem("need", "anxious", "raise_moderate", (16, 17, 18), "x"),
        prof.ProfileItem("person_available", "fam-miguel", "", (18, 19, 20, 21, 22, 23), "y"),
        prof.ProfileItem("person_preferred", "fam-lin", "", None, "z"),
        prof.ProfileItem("person_trust", "fam-lin", "higher", None, "w"),
    ])
    assert prof.prior_multipliers(p, cat, hour=10) == {}
    assert prof.prior_multipliers(p, cat, hour=17) == {"anxious": 1.5}
    assert not prof.person_adjustment(p, "fam-miguel", 9, 2, hour=10).available
    assert prof.person_adjustment(p, "fam-miguel", 9, 2, hour=19).available
    lin = prof.person_adjustment(p, "fam-lin", 8, 2, hour=10)
    assert lin.a == 8 + prof.TRUST_PSEUDO_COUNTS and lin.cost_factor == prof.PREFERRED_COST_FACTOR


def test_profile_round_trips_through_storage_format():
    p = prof.PatientProfile("p", [prof.ProfileItem("access", "", "scan", None, "q")], [], "gemini", "h", "t")
    assert prof.PatientProfile.from_dict(p.to_dict()) == p
    assert prof.mode_when_tired(p) == "scan"
    assert prof.mode_when_tired(prof.PatientProfile("q")) == "large"


# ---- fatigue and the decision engine --------------------------------------------------------------

def dialogue(**kw):
    return Dialogue(cat, cfg, list(cat.base_prior), 0.85, chart_flags=NO_FLAGS, **kw)


def test_fatigue_uses_the_patients_own_baseline_and_sensitivity():
    slow_patient = dialogue(baseline_interval=8.0)
    slow_patient.apply_tap("area", "belly", 0.0)
    slow_patient.apply_tap("feeling", "need_toilet", 8.0)      # their normal pace
    assert slow_patient.fatigue() == 1.0

    tiring = dialogue(baseline_interval=3.0, fatigue_sensitivity=1.3)
    tiring.apply_tap("area", "belly", 0.0)
    tiring.apply_tap("feeling", "need_toilet", 9.0)            # 3× their usual gap
    assert abs(tiring.fatigue() - 3.0 * 1.3) < 1e-9


def test_inconsistent_answers_raise_fatigue_and_stop_questions():
    d = dialogue()
    d.apply_tap("area", "toilet", 0.0)
    d.apply_tap("feeling", "need_toilet", 3.0)
    before = d.fatigue()
    d.apply_answer("group:toileting", "no", 6.0)               # contradicts what they just signalled
    assert d.inconsistencies == 1 and d.fatigue() > before
    d.apply_answer("need:urinate", "unsure", 9.0)
    d.apply_answer("need:bowel", "unsure", 12.0)
    assert not d.patient_can_answer
    assert all(a.kind != "ask" for a in decide(cat, cfg, d.decision_input()).ranked)


def test_unavailable_people_are_not_consulted():
    d = Dialogue(cat, cfg, list(cat.base_prior), 0.85,
                 [Consultant("fam-miguel", "Miguel", "husband", 0.9, available=False)], NO_FLAGS)
    d.apply_tap("area", "people", 0.0)
    d.apply_tap("feeling", "not_sure", 3.0)
    assert all(a.kind != "consult" for a in decide(cat, cfg, d.decision_input()).ranked)


# ---- services -------------------------------------------------------------------------------------

def services(fake: FakeGemini):
    store, hub = MemoryStore(), Hub()
    profiles = ProfileService(cat, store, fake, hub)
    svc = SessionService(cat, cfg, store, hub, Gemini(api_key=None), ConformalPredictor(), profiles)
    return store, profiles, svc


def test_session_applies_profile_and_safety_floor_still_holds():
    fake = FakeGemini({"p-chen": [
        item("fatigue", value="high", evidence="Tires quickly"),
        item("need", target="anxious", value="raise_strong", evidence="Tires quickly"),
    ], "p-alvarez": [item("access", value="scan", evidence="Prefers switch scanning when tired")]})
    store, profiles, svc = services(fake)

    async def run():
        await profiles.warm()
        chen = await svc.start("p-chen", "en")
        assert {i["kind"] for i in chen["profile"]} == {"fatigue", "need"}
        assert "patient profile" in chen["prior_reasons"]
        assert svc.sessions[chen["session_id"]].dialogue.fatigue_sensitivity == 1.6
        chest = await svc.tap(chen["session_id"], "area", "chest")
        assert chest["status"] == "escalated" and chest["questions_asked"] == 0
        alvarez = await svc.start("p-alvarez", "en")
        assert svc.sessions[alvarez["session_id"]].tired_mode == "scan"
    asyncio.run(run())


def test_nurse_note_suggestions_need_approval():
    fake = FakeGemini(
        {"p-chen": [item("person_trust", "fam-lin", "higher", "reads his gestures well")]},
        [item("person_preferred", "fam-lin", "", "ask Lin after 8pm", 20, 24),
         item("person_trust", "fam-lin", "higher", "Lin reads him best"),
         item("need", "pain_chest", "lower_moderate", "not cardiac")])
    store, profiles, svc = services(fake)

    async def run():
        await profiles.warm()
        note = "Easier to ask Lin after 8pm, Lin reads him best. It was the drain, not cardiac."
        out = await profiles.suggest("p-chen", None, note, "urinate", "Priya")
        status = {s["item"]["kind"]: s["status"] for s in out}
        assert status == {"person_preferred": "pending", "person_trust": "duplicate", "need": "blocked"}
        assert len(profiles.get("p-chen").items) == 1          # nothing applied yet
        pending = next(s for s in out if s["status"] == "pending")
        await profiles.review(pending["id"], True, "Priya")
        items = profiles.get("p-chen").items
        assert any(i.kind == "person_preferred" and i.origin == "nurse" for i in items)
        await profiles.extract("p-chen")                         # re-reading the notes keeps nurse items
        assert any(i.origin == "nurse" for i in profiles.get("p-chen").items)
    asyncio.run(run())


def test_profile_routes_and_shift_summary_without_gemini():
    with TestClient(app) as client:
        p = client.get("/api/patients/p-chen/profile").json()
        assert p["source"] == "none" and p["items"] == []
        h = client.get("/api/handoff").json()
        assert h["source"] == "template" and h["window_hours"] == 12
        assert len(h["patients"]) + len(h["stable"]) == 6
        for f in h["patients"]:
            assert f["status"] in ("attention", "watch") and f["headline"]
        s = client.post("/api/sessions", json={"patient_id": "p-chen", "language": "en"}).json()
        s = client.post(f"/api/sessions/{s['session_id']}/tap", json={"kind": "area", "tap_id": "chest"}).json()
        r = client.post(f"/api/alerts/{s['alert_id']}/confirm",
                        json={"need_id": "pain_chest", "note": "Settled after reassurance."}).json()
        assert r["nurse_note"] == "Settled after reassurance."
        assert client.get("/api/suggestions").json() == []         # Gemini off: note kept, nothing suggested
