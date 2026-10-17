"""Patient profiles: what the care team knows about a patient, turned into bounded engine adjustments.

Overview
========
Every synthetic patient has free-text chart notes ("Tires quickly. Daughter Lin visits daily and reads his
gestures well."). Gemini reads those notes once and proposes a *patient profile*: a list of small,
typed items. This module validates the items and is the only place that turns them into numbers the
engines use. Gemini never sets a probability, never sees a score and never touches the escalation
decision. The rule is **Gemini proposes, the engine enforces.**

Where the items come from
-------------------------
* ``origin="notes"``: extracted from the patient's chart notes (``services/profiles.py``, at startup and
  whenever the notes are edited).
* ``origin="nurse"``: proposed by Gemini from a nurse's free-text note at confirmation time, then
  approved by a nurse (feature B, "profile suggestions"). Nothing a nurse writes changes the engine
  until a nurse approves it.

Item kinds and what each one does
---------------------------------
=================  ==========================  ==============================================================
kind               value                       effect
=================  ==========================  ==============================================================
need               raise_/lower_ + slight,     Prior for that need × 1.25 / 1.5 / 2.0 (lower: ÷ the same).
                   moderate, strong            Optional hours window (e.g. 15:00-23:00 only).
fatigue            elevated, high              Fatigue × 1.3 / 1.6, so questions get costly sooner.
                                               Optional hours window.
person_trust       higher, lower               That person's Beta reliability prior gets +3 hits / +3 misses.
                                               Confirmations keep updating it as before.
person_available   (hours required)            The engine only consults them inside those hours.
person_preferred   (hours optional)            Their consult cost is halved (inside the hours, if given).
access             large, scan                 The mode the tablet switches to when the patient tires
                                               (default: large tiles).
start_level        simplified, yes_no          Communication ladder level the tablet starts at
                                               (engine/ladder.py). Optional hours window.
signal             higher, lower               Patient's own tap reliability ± 0.05 (before the usual clip).
note               free text                   Display only: shown to nurses, no engine effect.
=================  ==========================  ==============================================================

Safety rules (enforced here, not in the prompt)
-----------------------------------------------
1. **Grounded.** Every item carries ``evidence``, an exact quote. Items whose quote is not found in the
   source text (chart notes, or the nurse's note) are dropped and listed in ``dropped`` with the reason.
2. **Labels, not numbers.** The model picks a label from a fixed list; the multipliers above are
   constants in this file. Unknown kinds, values, needs or people are dropped.
3. **Bounded.** Combined profile multipliers for one need stay within [0.5, 2.0].
4. **High-risk needs never go down.** A ``lower_*`` item on a high-risk need (chest pain, shortness of
   breath, ...) is dropped as "blocked". And when other needs are raised, ``apply_to_prior`` pins every
   high-risk need at no less than its probability before the profile, so renormalising can't shrink it
   either. This mirrors the history-prior rule in ``engine/belief.py``.
5. **No waiting.** Sessions use whatever profile is cached; extraction happens in the background.
6. **Off means off.** With no Gemini key the profile is empty and the engine behaves exactly as before.

Fatigue model (``engine/dialogue.py``)
--------------------------------------
``fatigue = (1 + 0.35·questions) × slowdown × (1 + 0.3·inconsistencies) × sensitivity``

* ``slowdown``: the latest gap between inputs ÷ the patient's *own* usual gap (median
  ``mean_tap_interval`` over their last 14 days of confirmations), clipped to [1, 3]. Without enough
  history it falls back to the old within-session ratio (latest gap ÷ first gap).
* ``inconsistencies``: answers the current belief gave less than a 20% chance (a "no" to something the
  patient had strongly signalled), plus 0.5 for each "not sure".
* ``sensitivity``: from a ``fatigue`` profile item, 1.0 if none.
* After ``max_inconsistent_answers`` (2) the engine stops asking the patient and consults or sends.
* Fatigue sensitivity also scales the communication ladder's strain points (``engine/ladder.py``), so a
  patient who tires quickly gets a simpler screen sooner. From ladder level 2 the tablet uses the
  profile's ``access`` mode (or large tiles).

Related features
----------------
* **Profile suggestions (B)**, ``services/profiles.py``: nurse note → Gemini items → validated against
  the note → each marked ``pending``, ``duplicate`` (already in the profile) or ``blocked`` (rule 4) →
  nurse approves or rejects → approved items join the profile with ``origin="nurse"``.
* **Shift summary (A)**, ``services/handoff.py``: per-patient facts (requests, tap speed vs baseline,
  inconsistent answers, mode changes, trend flags, the quotes behind the profile) computed by the
  backend; Gemini only writes the one-line headline and "watch for" sentence, with a template fallback.

Gemini usage and quota
----------------------
Startup costs one request (all patients' notes in one batch). Each nurse note costs one, each shift
summary one, plus the existing SBAR rewrite per alert. ``services/gemini.py`` retries once when asked to
wait up to 60 s, and when the quota is used up (a 429 asking for a longer wait, e.g. the free tier's
daily limit) it pauses Gemini until then and everything falls back to templates.

This module is pure: no I/O, no network. ``services/profiles.py`` does the Gemini calls and storage.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field, replace

from ..catalog import Catalog

STRENGTH = {"slight": 1.25, "moderate": 1.5, "strong": 2.0}
NEED_VALUES = {f"{d}_{s}" for d in ("raise", "lower") for s in STRENGTH}
FATIGUE_SENSITIVITY = {"elevated": 1.3, "high": 1.6}
TRUST_PSEUDO_COUNTS = 3.0
PREFERRED_COST_FACTOR = 0.5
SIGNAL_SHIFT = 0.05
MULT_MIN, MULT_MAX = 0.5, 2.0

VALUES: dict[str, set[str] | None] = {
    "need": NEED_VALUES,
    "fatigue": set(FATIGUE_SENSITIVITY),
    "person_trust": {"higher", "lower"},
    "person_available": None,       # value unused; hours carry the meaning
    "person_preferred": None,
    "access": {"large", "scan"},
    "start_level": {"simplified", "yes_no"},
    "signal": {"higher", "lower"},
    "note": None,                   # value is the display text
}
KINDS = tuple(VALUES)
TIMED_KINDS = {"need", "fatigue", "person_available", "person_preferred", "start_level"}   # others ignore hours


@dataclass(frozen=True)
class ProfileItem:
    kind: str
    target: str = ""                 # need id or person id where the kind needs one
    value: str = ""
    hours: tuple[int, ...] | None = None
    evidence: str = ""
    origin: str = "notes"            # "notes" | "nurse"

    def key(self) -> tuple:
        """Identity for duplicate detection (evidence and origin don't make an item different)."""
        return (self.kind, self.target, self.value, self.hours)

    def active(self, hour: int | None) -> bool:
        return self.hours is None or hour is None or hour in self.hours


@dataclass
class PatientProfile:
    patient_id: str
    items: list[ProfileItem] = field(default_factory=list)
    dropped: list[dict] = field(default_factory=list)     # {"evidence", "reason", ...}
    source: str = "none"             # "gemini" | "none" (no key or extraction failed)
    notes_hash: str = ""
    updated_at: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["items"] = [asdict(i) | {"hours": list(i.hours) if i.hours else None} for i in self.items]
        return d

    @classmethod
    def from_dict(cls, d: dict) -> PatientProfile:
        items = [ProfileItem(**(i | {"hours": tuple(i["hours"]) if i.get("hours") else None}))
                 for i in d.get("items", [])]
        return cls(d["patient_id"], items, d.get("dropped", []), d.get("source", "none"),
                   d.get("notes_hash", ""), d.get("updated_at"))


# ---- validation -----------------------------------------------------------------------------------

def _norm(text: str) -> str:
    text = text.lower().replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip(" .,;:!\"'")


def quote_found(evidence: str, source: str) -> bool:
    q = _norm(evidence)
    return len(q) >= 3 and q in _norm(source)


def hours_window(start: int | None, end: int | None) -> tuple[int, ...] | None:
    """[start, end) in local hours, wrapping past midnight (22 → 6 is 22..5). -1 or None = no window."""
    if start is None or end is None or start < 0 or end < 0 or start > 23 or end > 24 or start == end % 24:
        return None
    end %= 24
    return tuple(range(start, end)) if start < end else tuple(range(start, 24)) + tuple(range(0, end))


def validate_items(raw_items: list[dict], source_text: str, cat: Catalog, person_ids: set[str],
                   origin: str = "notes") -> tuple[list[ProfileItem], list[dict]]:
    """Turn model output into ProfileItems, dropping anything ungrounded, unknown or unsafe."""
    kept: list[ProfileItem] = []
    dropped: list[dict] = []
    seen: set[tuple] = set()

    def drop(r: dict, reason: str, status: str = "dropped"):
        dropped.append({"kind": r.get("kind"), "target": r.get("target"), "value": r.get("value"),
                        "evidence": r.get("evidence", ""), "reason": reason, "status": status})

    for r in raw_items:
        kind, target, value = r.get("kind", ""), (r.get("target") or "").strip(), (r.get("value") or "").strip()
        evidence = (r.get("evidence") or "").strip()
        if kind not in VALUES:
            drop(r, f"unknown kind '{kind}'")
            continue
        if not quote_found(evidence, source_text):
            drop(r, "quote not found in the source text")
            continue
        allowed = VALUES[kind]
        if allowed is not None and value not in allowed:
            drop(r, f"unknown value '{value}' for {kind}")
            continue
        if kind == "need":
            if target not in cat.index:
                drop(r, f"unknown need '{target}'")
                continue
            if value.startswith("lower") and cat.high_risk[cat.index[target]]:
                drop(r, f"{cat.by_id[target]['label']} is a high-risk need and can't be made less likely",
                     status="blocked")
                continue
        if kind.startswith("person_") and target not in person_ids:
            drop(r, f"unknown person '{target}'")
            continue
        if kind == "note" and not value:
            value = evidence
        hours = hours_window(r.get("start_hour"), r.get("end_hour")) if kind in TIMED_KINDS else None
        if kind == "person_available" and hours is None:
            drop(r, "availability needs a time window")
            continue
        item = ProfileItem(kind, target if kind in ("need",) or kind.startswith("person_") else "",
                           value if allowed is not None or kind == "note" else "", hours, evidence, origin)
        if item.key() in seen:
            continue
        seen.add(item.key())
        kept.append(item)
    return kept, dropped


def merge(profile: PatientProfile, items: list[ProfileItem]) -> PatientProfile:
    existing = {i.key() for i in profile.items}
    return replace(profile, items=profile.items + [i for i in items if i.key() not in existing])


# ---- effects --------------------------------------------------------------------------------------

def need_multiplier(value: str) -> float:
    direction, strength = value.split("_", 1)
    m = STRENGTH[strength]
    return m if direction == "raise" else 1 / m


def prior_multipliers(profile: PatientProfile, cat: Catalog, hour: int | None) -> dict[str, float]:
    mult: dict[str, float] = {}
    for i in profile.items:
        if i.kind == "need" and i.active(hour):
            mult[i.target] = mult.get(i.target, 1.0) * need_multiplier(i.value)
    out = {}
    for nid, m in mult.items():
        m = min(max(m, MULT_MIN), MULT_MAX)
        if cat.high_risk[cat.index[nid]]:
            m = max(m, 1.0)
        out[nid] = m
    return out


def apply_to_prior(prior: list[float], mult: dict[str, float], cat: Catalog) -> list[float]:
    """Scale the prior and renormalise, without letting any high-risk need end up less likely than before.

    Raising a low-risk need and renormalising would otherwise shave probability off chest pain and the
    like; their share is pinned back and only the low-risk needs absorb the difference.
    """
    if not mult:
        return list(prior)
    scaled = [p * mult.get(nid, 1.0) for p, nid in zip(prior, cat.need_ids)]
    z = sum(scaled)
    new = [x / z for x in scaled]
    high = [max(n, p) if h else n for n, p, h in zip(new, prior, cat.high_risk)]
    high_mass = sum(x for x, h in zip(high, cat.high_risk) if h)
    low_mass = sum(x for x, h in zip(high, cat.high_risk) if not h)
    k = (1 - high_mass) / low_mass if low_mass > 0 else 1.0
    return [x if h else x * k for x, h in zip(high, cat.high_risk)]


def fatigue_sensitivity(profile: PatientProfile, hour: int | None) -> float:
    return max((FATIGUE_SENSITIVITY[i.value] for i in profile.items if i.kind == "fatigue" and i.active(hour)),
               default=1.0)


def mode_when_tired(profile: PatientProfile) -> str:
    modes = [i.value for i in profile.items if i.kind == "access"]
    return "scan" if "scan" in modes else (modes[0] if modes else "large")


START_LEVEL = {"simplified": 2, "yes_no": 3}


def start_level(profile: PatientProfile, hour: int | None) -> tuple[int, str]:
    """Communication ladder level to start at, and the note it came from (level 1 and "" if none)."""
    items = [i for i in profile.items if i.kind == "start_level" and i.active(hour)]
    if not items:
        return 1, ""
    best = max(items, key=lambda i: START_LEVEL[i.value])
    return START_LEVEL[best.value], best.evidence


def signal_reliability(profile: PatientProfile, r: float) -> float:
    for i in profile.items:
        if i.kind == "signal":
            r += SIGNAL_SHIFT if i.value == "higher" else -SIGNAL_SHIFT
    return r


@dataclass(frozen=True)
class PersonAdjustment:
    a: float
    b: float
    available: bool = True
    cost_factor: float = 1.0


def person_adjustment(profile: PatientProfile, person_id: str, a: float, b: float,
                      hour: int | None) -> PersonAdjustment:
    available, cost = True, 1.0
    windows = [i for i in profile.items if i.kind == "person_available" and i.target == person_id]
    if windows and hour is not None:
        available = any(hour in (i.hours or ()) for i in windows)
    for i in profile.items:
        if i.target != person_id:
            continue
        if i.kind == "person_trust":
            if i.value == "higher":
                a += TRUST_PSEUDO_COUNTS
            else:
                b += TRUST_PSEUDO_COUNTS
        elif i.kind == "person_preferred" and i.active(hour):
            cost = PREFERRED_COST_FACTOR
    return PersonAdjustment(a, b, available, cost)


# ---- display --------------------------------------------------------------------------------------

def _window_text(hours: tuple[int, ...] | None) -> str:
    if not hours:
        return ""
    return f", {hours[0]:02d}:00–{(hours[-1] + 1) % 24:02d}:00"


def effect_text(item: ProfileItem, cat: Catalog, people: dict[str, str]) -> str:
    """One plain sentence describing what the item does to the engine."""
    w = _window_text(item.hours)
    who = people.get(item.target, item.target)
    if item.kind == "need":
        m = need_multiplier(item.value)
        label = cat.by_id[item.target]["label"]
        return (f"{label} starts {m:g}× more likely{w}" if m > 1
                else f"{label} starts {1 / m:g}× less likely{w}")
    if item.kind == "fatigue":
        return f"Tires faster: fatigue × {FATIGUE_SENSITIVITY[item.value]:g}{w}"
    if item.kind == "person_trust":
        return f"{who} starts as a {'more' if item.value == 'higher' else 'less'} reliable interpreter"
    if item.kind == "person_available":
        return f"Only consult {who}{w}"
    if item.kind == "person_preferred":
        return f"Consult {who} first{w}"
    if item.kind == "access":
        return f"Switch to {'switch scanning' if item.value == 'scan' else 'large tiles'} when tired"
    if item.kind == "start_level":
        return f"Tablet starts at {'simplified choices' if item.value == 'simplified' else 'yes/no questions'}{w}"
    if item.kind == "signal":
        return f"Patient's taps treated as {'more' if item.value == 'higher' else 'less'} reliable"
    return item.value


def public_items(profile: PatientProfile, cat: Catalog, people: dict[str, str]) -> list[dict]:
    return [{"kind": i.kind, "target": i.target, "value": i.value,
             "hours": list(i.hours) if i.hours else None, "evidence": i.evidence, "origin": i.origin,
             "effect": effect_text(i, cat, people)} for i in profile.items]


def prior_reasons(profile: PatientProfile, hour: int | None) -> list[str]:
    reasons = []
    if any(i.kind == "need" and i.active(hour) for i in profile.items):
        reasons.append("patient profile")
    return reasons
