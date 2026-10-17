"""Synthetic 14-day cohort for the early-warning risk module. No real patient data anywhere.

22 synthetic residents (ids `syn-*`), each with a personal baseline and day-to-day noise:
  * 13 deterioration storylines that build over 3-5 days before a labelled outcome event
    (fall, dehydration, delirium/infection concern)
  * 9 stable controls, most with a benign confounder (a medication change with no effect, one bad
    night, one transient bad day, slow communication, a small appetite) so false flags can be measured

Split: `train` = 3 storylines per risk + 6 controls; `test` = 4 storylines + 3 controls (`syn-h*`).
Anything that tunes thresholds or weights must use `tuning_ids()` and never read test patients.
syn-04..07 and syn-11..13 were the first held-out set. They were evaluated once, which spent them,
so they moved to training and the fresh `syn-h*` patients replaced them.

What is written where:
  events          (existing hypertable)  session_started, tap (latency_ms, mistap), fatigue, nurse_confirmed
  chart_events    (new hypertable)       meal, fluid, med_round, med_change, vitals
  outcome_events  (new table)            one labelled outcome per storyline patient
  risk_cohort     (new table)            storyline, split and baseline profile per synthetic patient

Need reports are `nurse_confirmed` events, the same event the live app logs, not `confirmations` rows:
the research loop expects every patient in `confirmations` to be one of the demo patients.

Storyline patients' data stops at their outcome (they are transferred or clinically managed), so
nothing after the label can leak into features. Generation is deterministic for a given seed; the
calendar position comes from `end` (default: today, unit time zone).

    python -m app.risk.synthetic            per-patient summary: baseline vs the last 2 days
    python -m app.risk.synthetic --write    replace the synthetic cohort in Tiger Data (DATABASE_URL)
"""
import argparse
import asyncio
import math
import random
import statistics
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from ..catalog import Catalog, get_catalog
from ..config import settings
from .signals import DISCOMFORT, NIGHT_HOURS, TOILET

SEED = 20261017
DAYS = 14
SOURCE = "synthetic"
NURSE = "rn-synthetic"

MEALS = (("breakfast", 8, 0), ("lunch", 12, 30), ("dinner", 17, 30))
FLUID_HOURS = (7, 10, 12, 14, 17, 19, 21)
FLUID_OFFERED_ML = 300
MED_ROUNDS = (8, 12, 17, 21)
VITALS_HOURS = (8, 20)



@dataclass(frozen=True)
class Spec:
    id: str
    storyline: str              # control | fall | dehydration | delirium
    split: str                  # train | test
    confounder: str | None = None


COHORT = (
    Spec("syn-01", "fall", "train"),
    Spec("syn-02", "dehydration", "train"),
    Spec("syn-03", "delirium", "train"),
    Spec("syn-04", "fall", "train"),
    Spec("syn-05", "fall", "train"),
    Spec("syn-06", "dehydration", "train"),
    Spec("syn-07", "delirium", "train"),
    Spec("syn-08", "control", "train"),
    Spec("syn-09", "control", "train", "med_change"),
    Spec("syn-10", "control", "train", "bad_night"),
    Spec("syn-11", "control", "train", "slow_communicator"),
    Spec("syn-12", "control", "train", "low_appetite"),
    Spec("syn-13", "control", "train", "bad_day"),
    Spec("syn-14", "dehydration", "train"),
    Spec("syn-15", "delirium", "train"),
    # Held out. Fresh patient ids, so their random streams have never been generated or looked at.
    Spec("syn-h1", "fall", "test"),
    Spec("syn-h2", "dehydration", "test"),
    Spec("syn-h3", "delirium", "test"),
    Spec("syn-h4", "fall", "test"),
    Spec("syn-h5", "control", "test", "low_appetite"),
    Spec("syn-h6", "control", "test", "bad_day"),
    Spec("syn-h7", "control", "test", "med_change"),
)

OUTCOMES = {
    "fall": ("fall", "Unwitnessed fall on the way to the bathroom; found beside the bed."),
    "dehydration": ("dehydration", "Clinician-assessed dehydration (raised sodium and urea, dry mucosa); "
                                   "IV fluids started."),
    "delirium": ("delirium_infection_concern", "Acute confusion (CAM positive); urinary infection suspected, "
                                               "urine culture sent."),
}

FALL_MED_CHANGES = ("Zopiclone 3.75 mg at bedtime started", "Furosemide 40 mg daily started")


def tuning_ids() -> list[str]:
    """The only patients that threshold or weight tuning may read."""
    return [s.id for s in COHORT if s.split == "train"]


def holdout_ids() -> list[str]:
    """Held out: used once, for the final evaluation."""
    return [s.id for s in COHORT if s.split == "test"]


@dataclass
class Cohort:
    seed: int
    start: datetime             # UTC; local midnight of the first day
    end: datetime               # UTC; local midnight after the last day
    patients: list[dict]
    events: list[dict]          # rows for the shared `events` hypertable
    chart_events: list[dict]
    outcomes: list[dict]


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _clip(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def _pick(rng: random.Random, weights: dict[str, float]) -> str:
    keys = [k for k, w in weights.items() if w > 0]
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def _profile(rng: random.Random, spec: Spec) -> dict:
    p = {
        "age": rng.randint(68, 92),
        "latency_ms": rng.uniform(1600, 3200),   # median time to a tap
        "latency_sigma": rng.uniform(0.25, 0.4),  # log-normal spread
        "mistap_rate": rng.uniform(0.03, 0.09),
        "night_toilet": rng.uniform(0.6, 1.5),    # mean bathroom requests per night
        "day_needs": rng.uniform(6, 9),           # other requests per day
        "pain_per_day": rng.uniform(0.4, 1.6),
        "fluid_ml": rng.uniform(1300, 1750),
        "meal_pct": rng.uniform(65, 90),
        "fatigue": rng.uniform(1.0, 1.3),         # same scale as the live engine (>= 1, large tiles at 2)
        "temp_c": rng.uniform(36.4, 36.9),
        "hr": rng.uniform(64, 82),
        "med_refusal": rng.uniform(0.01, 0.04),
    }
    if spec.confounder == "slow_communicator":
        p["latency_ms"] *= 1.8
    elif spec.confounder == "low_appetite":
        p["meal_pct"], p["fluid_ml"] = rng.uniform(45, 55), rng.uniform(1150, 1250)
    return p


def _effects(storyline: str, s: float) -> dict[str, float]:
    """How far a storyline has pushed each signal at severity s (0 = baseline, 1 = at the outcome)."""
    e = {"latency": 1.0, "latency_night": 1.0, "sigma": 0.0, "mistap": 1.0, "fatigue": 0.0,
         "night_toilet": 1.0, "day_toilet": 1.0, "night_restless": 0.0, "pain": 1.0, "fluid": 1.0,
         "meal_drop": 0.0, "meal_skip": 0.0, "fluid_skip": 0.0, "refusal": 0.0, "temp": 0.0, "hr": 0.0,
         "abdominal": 0.0}
    if s <= 0:
        return e
    if storyline == "fall":            # new night sedation or diuretic: urgency at night, slower, unsteady
        e.update(latency=1 + 0.3 * s, latency_night=1 + 0.9 * s, mistap=1 + 1.5 * s, fatigue=0.9 * s,
                 night_toilet=1 + 3.0 * s, night_restless=1.0 * s)
    elif storyline == "dehydration":   # drinking and eating less, less output, slower, tachycardic
        e.update(latency=1 + 0.5 * s, latency_night=1 + 0.5 * s, mistap=1 + 0.8 * s, fatigue=1.0 * s,
                 night_toilet=1 - 0.6 * s, day_toilet=1 - 0.7 * s, fluid=1 - 0.5 * s, fluid_skip=0.35 * s,
                 meal_drop=25 * s, meal_skip=0.45 * s, temp=0.2 * s, hr=16 * s)
    elif storyline == "delirium":      # inconsistent taps, restless nights, urinary/abdominal complaints, fever
        e.update(latency=1 + 0.3 * s, latency_night=1 + 0.6 * s, sigma=0.4 * s, mistap=1 + 4.0 * s,
                 fatigue=0.7 * s, night_toilet=1 + 1.0 * s, night_restless=3.0 * s, pain=1 + 2.0 * s,
                 abdominal=s, meal_drop=15 * s, meal_skip=0.25 * s, refusal=0.4 * s, temp=1.2 * s, hr=12 * s)
    return e


class _Sim:
    """One synthetic patient. Owns its own RNG so adding a patient never changes the others."""

    def __init__(self, cat: Catalog, spec: Spec, seed: int, first_day: date, end: datetime):
        self.cat, self.spec, self.first_day, self.end = cat, spec, first_day, end
        self.rng = rng = random.Random(f"{seed}:{spec.id}")
        self.profile = _profile(rng, spec)
        self.events: list[dict] = []
        self.chart: list[dict] = []
        self.sessions = 0
        self.areas = [a["id"] for a in cat.raw["areas"]]
        self.feelings = [f["id"] for f in cat.raw["feelings"] if f["id"] != "not_sure"]
        self.onset = self.outcome_time = None
        if spec.storyline != "control":
            day, ramp_days = rng.randint(10, 13), rng.randint(3, 5)
            hour = {"fall": rng.randint(1, 5), "dehydration": rng.randint(9, 16),
                    "delirium": rng.choice((20, 21, 22, 23))}[spec.storyline]
            self.outcome_time = self.at(day, hour, rng.randint(0, 59))
            self.onset = self.outcome_time - timedelta(days=ramp_days)
        self.cutoff = self.outcome_time or end

    def at(self, day: int, hour: int, minute: int = 0) -> datetime:
        d = self.first_day + timedelta(days=day)
        return datetime(d.year, d.month, d.day, hour, minute, tzinfo=settings.unit_tz).astimezone(timezone.utc)

    def severity(self, t: datetime) -> float:
        if not self.onset or t <= self.onset:
            return 0.0
        return min((t - self.onset) / (self.outcome_time - self.onset), 1.0)

    def effects(self, t: datetime) -> dict[str, float]:
        e = _effects(self.spec.storyline, self.severity(t))
        if self.spec.confounder == "bad_night" and self.at(9, 22) <= t < self.at(10, 6):
            e["night_toilet"] += 2.5
            e["latency_night"] *= 1.4
            e["fatigue"] += 0.4
        elif self.spec.confounder == "bad_day" and self.at(11, 6) <= t < self.at(12, 0):
            e["fatigue"] += 0.6
            e["fluid"] *= 0.7
            e["meal_skip"] += 0.5
        return e

    # ---- rows ------------------------------------------------------------------------------------

    def _event(self, t: datetime, session_id: str | None, event_type: str, payload: dict):
        if t < self.cutoff:
            self.events.append({"time": t, "patient_id": self.spec.id, "session_id": session_id,
                                "event_type": event_type, "payload": payload | {"source": SOURCE}})

    def _chart(self, t: datetime, kind: str, value: float | None, payload: dict):
        if t < self.cutoff:
            self.chart.append({"time": t, "patient_id": self.spec.id, "kind": kind, "value": value,
                               "payload": payload | {"source": SOURCE}})

    # ---- one request: open a session, tap area and feeling, nurse confirms -----------------------

    def _tap(self, clock: datetime, sid: str, kind: str, tap: str, e: dict, night: bool, mistap: bool) -> datetime:
        p = self.profile
        median = p["latency_ms"] * (e["latency_night"] * 1.15 if night else e["latency"])
        ms = min(median * self.rng.lognormvariate(0, p["latency_sigma"] + e["sigma"]), 60000)
        clock += timedelta(milliseconds=ms)
        self._event(clock, sid, "tap", {"kind": kind, "tap": tap, "latency_ms": round(ms), "mistap": mistap})
        return clock

    def episode(self, t: datetime, need: str):
        if t >= self.cutoff:
            return
        rng, p, e = self.rng, self.profile, self.effects(t)
        hour = t.astimezone(settings.unit_tz).hour
        night = hour in NIGHT_HOURS
        self.sessions += 1
        sid = f"{self.spec.id}-s{self.sessions:04d}"
        self._event(t, sid, "session_started", {"mode": "grid", "language": "en"})
        clock, mistaps = t, 0
        for kind, vocab in (("area", self.areas), ("feeling", self.feelings)):
            right = _pick(rng, {k: v for k, v in self.cat.by_id[need][kind + "s"].items() if k in vocab})
            if rng.random() < min(p["mistap_rate"] * e["mistap"] * (1.3 if night else 1.0), 0.6):
                clock = self._tap(clock, sid, kind, rng.choice([x for x in vocab if x != right]), e, night, True)
                mistaps += 1
            clock = self._tap(clock, sid, kind, right, e, night, False)
        circadian = 0.3 if night else 0.15 if hour >= 18 else 0.0
        fatigue = _clip(p["fatigue"] + circadian + e["fatigue"] + 0.2 * mistaps + rng.gauss(0, 0.12), 1.0, 3.5)
        self._event(clock, sid, "fatigue", {"score": round(fatigue, 2)})
        group = self.cat.by_id[need]["group"]
        alternatives = [n for n in self.cat.need_ids if self.cat.by_id[n]["group"] == group and n != need]
        correct = rng.random() < (0.9 if not mistaps else 0.72)
        predicted = need if correct or not alternatives else rng.choice(alternatives)
        self._event(clock + timedelta(seconds=rng.uniform(60, 600)), sid, "nurse_confirmed",
                    {"alert_id": None, "need": need, "predicted": predicted, "nurse": NURSE})

    # ---- one day ---------------------------------------------------------------------------------

    def _chart_day(self, day: int):
        rng, p = self.rng, self.profile
        for meal, h, m in MEALS:
            t = self.at(day, h, m)
            e = self.effects(t)
            pct = round(_clip(rng.gauss(p["meal_pct"] - e["meal_drop"], 12), 0, 100))
            if rng.random() < 0.02 + e["meal_skip"]:
                pct = round(rng.uniform(0, 15))
            self._chart(t, "meal", pct, {"meal": meal, "eaten_pct": pct, "missed": pct < 25})
        for h in FLUID_HOURS:
            t = self.at(day, h, rng.randint(0, 20))
            e = self.effects(t)
            mean = p["fluid_ml"] / len(FLUID_HOURS) * e["fluid"]
            ml = round(_clip(rng.gauss(mean, 60), 0, FLUID_OFFERED_ML))
            if rng.random() < 0.03 + e["fluid_skip"]:
                ml = round(rng.uniform(0, 40))
            self._chart(t, "fluid", ml, {"offered_ml": FLUID_OFFERED_ML, "taken_ml": ml, "missed": ml < 50})
        for h in MED_ROUNDS:
            delay = abs(rng.gauss(0, 12))
            t = self.at(day, h) + timedelta(minutes=delay)
            r, refuse = rng.random(), p["med_refusal"] + self.effects(t)["refusal"]
            status = "refused" if r < refuse else "held" if r < refuse + 0.015 else "given"
            self._chart(t, "med_round", None, {"round": f"{h:02d}:00", "status": status, "delay_min": round(delay)})
        for h in VITALS_HOURS:
            t = self.at(day, h, rng.randint(0, 30))
            e = self.effects(t)
            self._chart(t, "vitals", None, {"temp_c": round(rng.gauss(p["temp_c"] + e["temp"], 0.18), 1),
                                            "hr": round(rng.gauss(p["hr"] + e["hr"], 5))})

    def _day_need(self, e: dict) -> str:
        return _pick(self.rng, {
            "thirsty": 3, "urinate": 4 * e["day_toilet"], "bowel": 1.2 * e["day_toilet"],
            "soiled": 0.6 * e["day_toilet"], "reposition": 3, "hungry": 1.5, "too_cold": 1, "too_hot": 0.7,
            "want_family": 1.5, "medication_question": 0.8})

    def _pain_need(self, e: dict) -> str:
        return _pick(self.rng, {"pain_back": 3, "pain_limb": 3, "pain_head": 1.5, "nausea": 0.5,
                                "pain_abdomen": 0.3 + 5 * e["abdominal"]})

    def run(self) -> "_Sim":
        rng, p = self.rng, self.profile
        if self.spec.storyline == "fall":
            self._chart(self.onset, "med_change", None, {"label": rng.choice(FALL_MED_CHANGES)})
        if self.spec.confounder == "med_change":
            self._chart(self.at(7, 11), "med_change", None, {"label": "Bisacodyl 10 mg as needed added"})
        for day in range(DAYS):
            noise = rng.lognormvariate(0, 0.15)
            self._chart_day(day)
            e = self.effects(self.at(day, 14))
            for _ in range(_poisson(rng, p["day_needs"] * noise)):
                t = self.at(day, 6) + timedelta(hours=rng.uniform(0, 16))
                self.episode(t, self._day_need(self.effects(t)))
            for _ in range(_poisson(rng, p["pain_per_day"] * e["pain"] * noise)):
                t = self.at(day, 7) + timedelta(hours=rng.uniform(0, 15))
                self.episode(t, self._pain_need(self.effects(t)))
            # The night that starts at 22:00 on this day and ends at 06:00 the next morning.
            dusk = self.at(day, 22)
            e = self.effects(dusk + timedelta(hours=4))
            for _ in range(_poisson(rng, p["night_toilet"] * e["night_toilet"] * noise)):
                self.episode(dusk + timedelta(hours=rng.uniform(0, 8)),
                             "urinate" if rng.random() < 0.85 else rng.choice(("bowel", "soiled")))
            for _ in range(_poisson(rng, 0.2 + e["night_restless"])):
                self.episode(dusk + timedelta(hours=rng.uniform(0, 8)),
                             rng.choice(("anxious", "want_family", "reposition", "thirsty")))
        return self

    def patient(self, seed: int) -> dict:
        n = self.spec.id.split("-")[1]
        return {"id": self.spec.id, "name": f"Synthetic resident {n}", "room": f"SYN-{n}",
                "age": self.profile["age"], "storyline": self.spec.storyline, "split": self.spec.split,
                "confounder": self.spec.confounder, "seed": seed, "synthetic": True,
                "profile": {k: round(v, 3) for k, v in self.profile.items() if k != "age"}}

    def outcome(self) -> dict | None:
        if not self.outcome_time:
            return None
        kind, description = OUTCOMES[self.spec.storyline]
        return {"id": f"out-{self.spec.id}", "time": self.outcome_time, "patient_id": self.spec.id,
                "outcome": kind, "onset": self.onset, "description": description, "synthetic": True}


def generate(cat: Catalog, end: date | None = None, seed: int = SEED) -> Cohort:
    """14 local days ending at midnight before `end` (default: today in the unit's time zone)."""
    end = end or datetime.now(settings.unit_tz).date()
    first = end - timedelta(days=DAYS)
    end_utc = datetime(end.year, end.month, end.day, tzinfo=settings.unit_tz).astimezone(timezone.utc)
    sims = [_Sim(cat, spec, seed, first, end_utc).run() for spec in COHORT]
    order = lambda r: (r["time"], r["patient_id"])
    return Cohort(
        seed=seed, start=sims[0].at(0, 0), end=end_utc,
        patients=[s.patient(seed) for s in sims],
        events=sorted((e for s in sims for e in s.events), key=order),
        chart_events=sorted((c for s in sims for c in s.chart), key=order),
        outcomes=[o for s in sims if (o := s.outcome())],
    )


# ---- sanity view (not the risk engine) ------------------------------------------------------------

def daily_summary(cohort: Cohort, patient_id: str) -> list[dict]:
    """Per local day, the raw signals the storylines move. Used by the CLI and tests to check the data."""
    tz = settings.unit_tz
    first = cohort.start.astimezone(tz).date()
    rows = [{"day": d, "night_toilet": 0, "pain_reports": 0, "latency": [], "taps": 0, "mistaps": 0,
             "fatigue": [], "fluid_ml": 0, "missed_meals": 0, "refusals": 0, "max_temp": None}
            for d in range(DAYS)]

    def row(t: datetime) -> dict:
        return rows[(t.astimezone(tz).date() - first).days]

    started: dict[str, datetime] = {}
    for e in cohort.events:
        if e["patient_id"] != patient_id:
            continue
        t, p, kind = e["time"], e["payload"], e["event_type"]
        if kind == "session_started":
            started[e["session_id"]] = t
        elif kind == "tap":
            r = row(t)
            r["taps"] += 1
            r["mistaps"] += p["mistap"]
            r["latency"].append(p["latency_ms"])
        elif kind == "fatigue":
            row(t)["fatigue"].append(p["score"])
        elif kind == "nurse_confirmed":
            t0 = started.get(e["session_id"], t)  # count the request when it was made
            r = row(t0)
            r["night_toilet"] += p["need"] in TOILET and t0.astimezone(tz).hour in NIGHT_HOURS
            r["pain_reports"] += p["need"] in DISCOMFORT
    for c in cohort.chart_events:
        if c["patient_id"] != patient_id:
            continue
        r, p = row(c["time"]), c["payload"]
        if c["kind"] == "fluid":
            r["fluid_ml"] += p["taken_ml"]
        elif c["kind"] == "meal":
            r["missed_meals"] += p["missed"]
        elif c["kind"] == "med_round":
            r["refusals"] += p["status"] == "refused"
        elif c["kind"] == "vitals":
            r["max_temp"] = max(r["max_temp"] or 0, p["temp_c"])
    for r in rows:
        r["latency_ms"] = statistics.median(r.pop("latency")) if r["latency"] else None
        r["mistap_rate"] = r["mistaps"] / r["taps"] if r["taps"] else None
        r["fatigue"] = statistics.mean(r["fatigue"]) if r["fatigue"] else None
    return rows


def windows(cohort: Cohort, patient_id: str) -> tuple[range, range]:
    """(baseline days, last two full days before the outcome) as day indices; controls: days 0-9 vs 12-13."""
    out = next((o for o in cohort.outcomes if o["patient_id"] == patient_id), None)
    if not out:
        return range(0, 10), range(DAYS - 2, DAYS)
    tz = settings.unit_tz
    first = cohort.start.astimezone(tz).date()
    day = lambda t: (t.astimezone(tz).date() - first).days
    return range(0, day(out["onset"])), range(day(out["time"]) - 2, day(out["time"]))


SUMMARY_COLUMNS = (("night_toilet", "night WC", "{:.1f}"), ("latency_ms", "tap ms", "{:.0f}"),
                   ("mistap_rate", "mistap", "{:.0%}"), ("fatigue", "fatigue", "{:.2f}"),
                   ("pain_reports", "pain", "{:.1f}"), ("fluid_ml", "fluid mL", "{:.0f}"),
                   ("missed_meals", "missed meals", "{:.1f}"), ("refusals", "med refusals", "{:.1f}"),
                   ("max_temp", "max temp", "{:.1f}"))


def window_mean(rows: list[dict], days: range, key: str) -> float | None:
    vals = [rows[d][key] for d in days if rows[d][key] is not None]
    return statistics.mean(vals) if vals else None


def _print_summary(cohort: Cohort):
    print(f"SYNTHETIC DATA. seed {cohort.seed}, {cohort.start:%Y-%m-%d} to {cohort.end:%Y-%m-%d} UTC, "
          f"{len(cohort.events)} events, {len(cohort.chart_events)} chart events, {len(cohort.outcomes)} outcomes")
    print("Each cell: baseline mean per day -> mean per day over the last 2 full days before the outcome "
          "(controls: days 0-9 -> 12-13)\n")
    outcomes = {o["patient_id"]: o for o in cohort.outcomes}
    for p in cohort.patients:
        rows = daily_summary(cohort, p["id"])
        base, late = windows(cohort, p["id"])
        o = outcomes.get(p["id"])
        head = f"{p['id']}  {p['split']:5}  {p['storyline']:11} {p['confounder'] or '':17}"
        if o:
            ramp = (o["time"] - o["onset"]).total_seconds() / 86400
            head += f" outcome {o['outcome']} at day {late.stop} {o['time'].astimezone(settings.unit_tz):%H:%M}, " \
                    f"onset {ramp:.0f} days before"
        print(head)
        cells = []
        for key, label, fmt in SUMMARY_COLUMNS:
            a, b = window_mean(rows, base, key), window_mean(rows, late, key)
            f = lambda v: "-" if v is None else fmt.format(v)
            cells.append(f"{label} {f(a)}->{f(b)}")
        print("    " + " | ".join(cells))


async def _write(cohort: Cohort):
    from ..store import make_store
    from .store import make_risk_store
    if not settings.database_url:
        raise SystemExit("DATABASE_URL is not set; the in-memory store is seeded at app startup instead.")
    store = make_store()
    await store.init()
    try:
        risk_store = make_risk_store(store)
        await risk_store.init()
        await risk_store.replace_cohort(cohort)
    finally:
        await store.close()
    print(f"wrote synthetic cohort ({len(cohort.patients)} patients) to the database")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--end", type=date.fromisoformat, default=None, help="local date after the last day (YYYY-MM-DD)")
    ap.add_argument("--write", action="store_true", help="replace the synthetic cohort in DATABASE_URL")
    args = ap.parse_args()
    cohort = generate(get_catalog(), args.end, args.seed)
    _print_summary(cohort)
    if args.write:
        asyncio.run(_write(cohort))


if __name__ == "__main__":
    main()
