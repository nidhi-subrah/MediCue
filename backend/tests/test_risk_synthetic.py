import asyncio
from collections import Counter
from datetime import date

from app.catalog import get_catalog
from app.risk.store import make_risk_store
from app.risk.synthetic import COHORT, SOURCE, daily_summary, generate, holdout_ids, tuning_ids, window_mean, windows
from app.store.memory import MemoryStore

cat = get_catalog()
END = date(2026, 3, 15)        # fixed calendar; the 14 days span the 8 March DST change in Toronto
cohort = generate(cat, END)
SPEC = {s.id: s for s in COHORT}


def test_same_seed_same_data():
    again = generate(cat, END)
    assert again.events == cohort.events
    assert again.chart_events == cohort.chart_events
    assert again.outcomes == cohort.outcomes and again.patients == cohort.patients
    assert generate(cat, END, seed=1).events != cohort.events


def test_cohort_shape_and_holdout():
    stories = Counter(s.storyline for s in COHORT)
    assert len(COHORT) == 22 and stories["control"] == 9
    assert {k for k in stories if k != "control"} == {"fall", "dehydration", "delirium"}
    test = [SPEC[i] for i in holdout_ids()]
    assert sum(s.storyline != "control" for s in test) == 4 and sum(s.storyline == "control" for s in test) == 3
    train = Counter(SPEC[i].storyline for i in tuning_ids())
    assert train == {"fall": 3, "dehydration": 3, "delirium": 3, "control": 6}
    assert not set(tuning_ids()) & set(holdout_ids())
    assert {p["split"] for p in cohort.patients if p["id"] in holdout_ids()} == {"test"}


def test_everything_is_synthetic_and_inside_the_window():
    assert all(p["synthetic"] and p["id"].startswith("syn-") for p in cohort.patients)
    for row in cohort.events + cohort.chart_events:
        assert row["patient_id"].startswith("syn-") and row["payload"]["source"] == SOURCE
        assert cohort.start <= row["time"] < cohort.end
    assert all(o["synthetic"] for o in cohort.outcomes)


def test_one_outcome_per_storyline_and_nothing_after_it():
    by_patient = {o["patient_id"]: o for o in cohort.outcomes}
    assert set(by_patient) == {s.id for s in COHORT if s.storyline != "control"}
    for pid, o in by_patient.items():
        assert 3 <= (o["time"] - o["onset"]).days <= 5
        last = max(r["time"] for r in cohort.events + cohort.chart_events if r["patient_id"] == pid)
        assert last < o["time"]


def test_storylines_move_their_signals():
    def change(pid, key):
        rows = daily_summary(cohort, pid)
        base, late = windows(cohort, pid)
        return window_mean(rows, base, key), window_mean(rows, late, key)

    for s in COHORT:
        if s.storyline == "fall":
            b, l = change(s.id, "night_toilet")
            assert l >= b + 1, s.id
        elif s.storyline == "dehydration":
            b, l = change(s.id, "fluid_ml")
            assert l <= 0.8 * b, s.id
        elif s.storyline == "delirium":
            b, l = change(s.id, "mistap_rate")
            assert l >= 1.8 * b, s.id
        if s.storyline != "control":
            b, l = change(s.id, "fatigue")
            assert l >= b + 0.25, s.id


def test_controls_have_no_sustained_fatigue_rise():
    for s in COHORT:
        if s.storyline == "control":
            rows = daily_summary(cohort, s.id)
            base, late = windows(cohort, s.id)
            assert window_mean(rows, late, "fatigue") < window_mean(rows, base, "fatigue") + 0.15, s.id


def test_memory_store_replace_is_idempotent_and_keeps_other_patients():
    async def run():
        main = MemoryStore()
        await main.log_event(cohort.start, "p-chen", None, "tap", {"kind": "area", "tap": "chest"})
        risk = make_risk_store(main)
        await risk.init()
        assert not await risk.is_seeded()
        await risk.replace_cohort(cohort)
        await risk.replace_cohort(cohort)
        assert await risk.is_seeded()
        assert len(main.events) == len(cohort.events) + 1
        assert len(await risk.outcome_events()) == len(cohort.outcomes)
        assert await risk.chart_events("syn-01")
    asyncio.run(run())
