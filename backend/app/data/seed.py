"""Generates 8 days of synthetic confirmed-need history so trends and research have something to find.

Embedded patterns (what the dashboard and research loop should surface):
  * p-chen      pain requests jump in the last ~30 h, after a gabapentin reduction
  * p-alvarez   communication slowing: seconds per tap and taps per need climb; more switches to scan mode
  * p-kowalski  anxiety requests cluster in the late afternoon and evening, every day
  * p-chen      anxiety requests often follow the end of his daughter's afternoon visit (family_visit events)
  * others      stable
"""
import random
from datetime import datetime, timedelta, timezone

from ..catalog import Catalog
from ..config import settings

DAYS = 8
VISIT_SEED_OFFSET = 4


def _row(cat: Catalog, rng, t, patient_id, need, taps, interval, mode="grid", correct_p=0.88):
    i = cat.index[need]
    correct = rng.random() < correct_p
    predicted = need if correct else rng.choice([n for n in cat.need_ids if cat.group[cat.index[n]] == cat.group[i]] or [need])
    return {
        "time": t, "patient_id": patient_id, "session_id": f"seed-{rng.getrandbits(40):010x}",
        "predicted_need": predicted, "confirmed_need": need, "confirmed_group": cat.group[i], "risk": cat.risk[i],
        "correct": predicted == need, "escalated": cat.risk[i] == "high" or (cat.risk[i] == "medium" and rng.random() < 0.3),
        "taps": taps, "questions": max(taps - 2, 0), "resolve_seconds": round(taps * interval + rng.uniform(1, 4), 1),
        "mean_tap_interval": round(interval, 2), "mode": mode,
    }


def _hour(rng, need):
    if need == "anxious":
        return rng.choice([16, 17, 18, 19, 20, 21, 22, 15, 19, 20])
    if need in ("urinate", "bowel"):
        return rng.choice([1, 3, 5, 7, 9, 14, 22, 23])
    return rng.randint(7, 22)


def generate(cat: Catalog, now: datetime | None = None, seed: int = 42) -> tuple[list[dict], list[dict]]:
    rng = random.Random(seed)
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(days=DAYS)
    rows, events = [], []
    common = ["thirsty", "urinate", "reposition", "too_cold", "hungry", "bowel", "want_family", "pain_back"]

    def at(day: int, hour: int):
        local = (start + timedelta(days=day)).astimezone(settings.unit_tz)
        t = local.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59)).astimezone(timezone.utc)
        return min(t, now - timedelta(minutes=rng.randint(5, 60)))

    for day in range(DAYS + 1):

        # Wei Chen: baseline ~1 pain request a day, ~5-6 after the medication change
        for _ in range(rng.randint(4, 6)):
            need = rng.choice(common)
            rows.append(_row(cat, rng, at(day, _hour(rng, need)), "p-chen", need, rng.choice([3, 3, 4]), rng.uniform(3.5, 5)))
        if day < DAYS:
            for _ in range(rng.randint(0, 1)):
                need = rng.choice(["pain_limb", "pain_head", "pain_back"])
                rows.append(_row(cat, rng, at(day, rng.randint(6, 23)), "p-chen", need, 3, rng.uniform(4, 5.5)))

        # Rosa Alvarez: slowing communication (ALS progression), drifting into scan mode
        frac = day / DAYS
        for _ in range(rng.randint(4, 6)):
            need = rng.choice(common + ["reposition", "soiled"])
            interval = 3.0 + 4.5 * frac ** 1.5 + rng.uniform(-0.4, 0.4)
            mode = "scan" if rng.random() < 0.15 + 0.7 * frac ** 2 else "grid"
            rows.append(_row(cat, rng, at(day, _hour(rng, need)), "p-alvarez", need,
                             3 + (1 if rng.random() < frac else 0) + (1 if rng.random() < frac ** 2 else 0), interval, mode))
        for _ in range(rng.randint(2, 4) if day >= DAYS - 1 else (1 if rng.random() < 0.3 else 0)):
            events.append({"time": at(day, rng.randint(15, 22)), "patient_id": "p-alvarez", "session_id": None,
                           "event_type": "mode_changed", "payload": {"from": "grid", "to": "scan", "reason": "fatigue"}})

        # Irena Kowalski: evening anxiety (stable pattern, a research finding rather than a trend)
        for _ in range(rng.randint(3, 5)):
            need = rng.choice(["anxious", "anxious", "want_family", "thirsty", "reposition", "urinate"])
            rows.append(_row(cat, rng, at(day, _hour(rng, need)), "p-kowalski", need, rng.choice([3, 4, 4]),
                             rng.uniform(4, 6), correct_p=0.8))

        # Stable patients
        for pid, needs in (("p-patel", common + ["pain_surgical", "urinate"]),
                           ("p-haddad", common + ["short_of_breath", "secretions", "too_hot"])):
            if pid == "p-patel" and day < DAYS - 3:
                continue  # admitted 3 days ago
            for _ in range(rng.randint(3, 5)):
                need = rng.choice(needs)
                rows.append(_row(cat, rng, at(day, _hour(rng, need)), pid, need, rng.choice([2, 3, 3, 4]), rng.uniform(3, 4.5)))

        if day >= DAYS - 1:  # Daniel Okoye: post-op day 1, only recent data
            for _ in range(rng.randint(3, 4)):
                need = rng.choice(["pain_surgical", "thirsty", "secretions", "reposition", "anxious"])
                rows.append(_row(cat, rng, at(day, rng.randint(0, 23)), "p-okoye", need, rng.choice([2, 3]), rng.uniform(3, 5)))

    # Wei Chen: daughter Lin visits most afternoons; anxiety requests tend to follow her leaving.
    vr = random.Random(seed + VISIT_SEED_OFFSET)
    for day in range(DAYS + 1):
        if vr.random() < 0.1:
            continue
        visit_start = at(day, vr.choice([13, 14, 15]))
        end = visit_start + timedelta(minutes=vr.randint(60, 150))
        if end >= now:
            continue
        events.append({"time": visit_start, "patient_id": "p-chen", "session_id": None, "event_type": "family_visit",
                       "payload": {"visitor": "Lin Chen", "end": end.isoformat()}})
        if vr.random() < 0.75:
            t = end + timedelta(minutes=vr.randint(10, 100))
        else:
            t = at(day, vr.choice([9, 10, 20, 21]))
        if t < now:
            rows.append(_row(cat, vr, t, "p-chen", "anxious", 3, vr.uniform(4, 5)))

    # Wei Chen: pain requests jump after the gabapentin reduction ~26 h ago (see patients.py)
    for _ in range(6):
        need = rng.choice(["pain_limb", "pain_limb", "pain_head", "pain_back"])
        t = now - timedelta(hours=rng.uniform(0.5, 23.5))
        rows.append(_row(cat, rng, t, "p-chen", need, rng.choice([3, 4]), rng.uniform(4, 5.5)))

    rows.sort(key=lambda r: r["time"])
    return rows, events
