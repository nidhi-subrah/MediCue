"""Synthetic patients with mocked charts. No real patient data anywhere in this project.

`chart` keys match lookup ids in shared/catalog.json; `flag` is what the engine sees when it looks one up.
"""
from datetime import datetime, timedelta, timezone


def _ago(days: float = 0, hours: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).isoformat()


def _chart(**flags) -> dict:
    values = {
        "analgesic_overdue": ("Acetaminophen 1 g, 5.5 h ago", "Hydromorphone 1 mg, 1.5 h ago"),
        "void_overdue": ("Last void 5 h ago", "Last void 1 h ago"),
        "spo2_dropping": ("SpO2 96 → 92% over 2 h", "SpO2 steady at 97%"),
        "febrile": ("Temp 38.3 °C", "Temp 36.9 °C"),
        "low_fluid_intake": ("Intake 600 / 1500 mL today", "Intake 1300 / 1500 mL today"),
        "meal_missed": ("Last meal 6 h ago", "Last meal 2 h ago"),
        "reposition_overdue": ("Last turned 3 h ago", "Last turned 40 min ago"),
        "recent_med_change": ("Gabapentin reduced yesterday", "No changes in 7 days"),
        "bp_elevated": ("BP 168/94 (baseline 135/80)", "BP 128/78 (at baseline)"),
    }
    return {k: {"value": v[0] if flags.get(k) else v[1], "flag": bool(flags.get(k))} for k, v in values.items()}


PATIENTS = [
    {
        "id": "p-chen", "name": "Wei Chen", "age": 74, "room": "4B-12", "language": "zh",
        "diagnosis": "Left MCA ischemic stroke, day 2. Right-sided weakness, expressive aphasia.",
        "days_since_surgery": None, "notes": "Tires quickly. Daughter Lin visits daily and reads his gestures well.",
        "chart": _chart(analgesic_overdue=True, recent_med_change=True, reposition_overdue=True),
        "chart_events": [{"time": _ago(hours=26), "label": "Gabapentin reduced 300 → 100 mg"}],
        "people": [
            {"id": "fam-lin", "name": "Lin Chen", "relation": "daughter", "a": 8, "b": 2},
            {"id": "rn-priya", "name": "Priya S.", "relation": "regular nurse", "a": 6, "b": 2},
        ],
        "signal": {"a": 8, "b": 2},
    },
    {
        "id": "p-alvarez", "name": "Rosa Alvarez", "age": 61, "room": "4B-07", "language": "es",
        "diagnosis": "ALS, bulbar onset. Anarthric, limited hand function; uses switch access.",
        "days_since_surgery": None, "notes": "Prefers switch scanning when tired. Husband Miguel present evenings.",
        "chart": _chart(void_overdue=True, low_fluid_intake=True),
        "chart_events": [{"time": _ago(days=3), "label": "Switched to switch-scanning in evenings"}],
        "people": [{"id": "fam-miguel", "name": "Miguel Alvarez", "relation": "husband", "a": 9, "b": 2}],
        "signal": {"a": 9, "b": 1},
    },
    {
        "id": "p-okoye", "name": "Daniel Okoye", "age": 58, "room": "ICU-3", "language": "en",
        "diagnosis": "Post CABG day 1, intubated, awake and following commands.",
        "days_since_surgery": 1, "notes": "Writes poorly with left hand; uses tablet taps.",
        "chart": _chart(spo2_dropping=False, analgesic_overdue=False, bp_elevated=True),
        "chart_events": [{"time": _ago(days=1, hours=2), "label": "CABG x3"}],
        "people": [{"id": "fam-ada", "name": "Ada Okoye", "relation": "wife", "a": 6, "b": 3}],
        "signal": {"a": 7, "b": 2},
    },
    {
        "id": "p-patel", "name": "Meera Patel", "age": 82, "room": "3A-02", "language": "pa",
        "diagnosis": "Right hip hemiarthroplasty, day 3. Hard of hearing; Punjabi first language.",
        "days_since_surgery": 3, "notes": "Grandson Arjun answers messages during the day.",
        "chart": _chart(analgesic_overdue=True, void_overdue=True, meal_missed=True),
        "chart_events": [{"time": _ago(days=3), "label": "Hip hemiarthroplasty"}],
        "people": [{"id": "fam-arjun", "name": "Arjun Patel", "relation": "grandson", "a": 5, "b": 3}],
        "signal": {"a": 6, "b": 3},
    },
    {
        "id": "p-haddad", "name": "Samir Haddad", "age": 67, "room": "3A-09", "language": "ar",
        "diagnosis": "COPD exacerbation, on BiPAP overnight. Arabic speaker.",
        "days_since_surgery": None, "notes": "Mask makes speech hard to understand.",
        "chart": _chart(febrile=True, spo2_dropping=False),
        "chart_events": [],
        "people": [{"id": "fam-nadia", "name": "Nadia Haddad", "relation": "daughter", "a": 7, "b": 2}],
        "signal": {"a": 8, "b": 2},
    },
    {
        "id": "p-kowalski", "name": "Irena Kowalski", "age": 88, "room": "LTC-21", "language": "en",
        "diagnosis": "Moderate dementia, long-term care resident. Word-finding difficulty.",
        "days_since_surgery": None, "notes": "Becomes anxious in late afternoon and evening.",
        "chart": _chart(reposition_overdue=True, low_fluid_intake=True),
        "chart_events": [],
        "people": [{"id": "psw-joe", "name": "Joe M.", "relation": "regular PSW", "a": 8, "b": 2}],
        "signal": {"a": 5, "b": 3},
    },
]

PATIENT_BY_ID = {p["id"]: p for p in PATIENTS}
PERSON_BY_ID = {person["id"]: {**person, "patient_id": p["id"]} for p in PATIENTS for person in p["people"]}
