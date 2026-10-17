"""Clinician copilot: a compact case packet for an episode that ended without a confident answer.

Pure and deterministic: every field is read from the finished (or abandoned) Dialogue and the engine's
own numbers. Nothing here calls Gemini, and nothing here feeds back into the belief or the decision, so
escalation and the safety floor behave exactly as before. Gemini may later rephrase the packet's text,
never its content.

The next step is always one of NEXT_STEPS: communication actions only. No treatment, medication or
diagnosis appears anywhere. A need whose probability fell is "less likely given answers", never
"ruled out": the system cannot rule anything out.
"""
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from ..catalog import Catalog
from ..config import EngineConfig
from ..engine.belief import p_high_risk
from ..engine.decision import Consultant, Decision
from ..engine.dialogue import Dialogue

STOP_TEXT = {
    "RESOLVED": "The most likely need was clear enough to send to the nurse.",
    "SAFETY_FLOOR": "A high-risk need was possible, so it went to the nurse at once instead of asking more questions.",
    "FATIGUE_HIGH": "The patient was tiring or their answers stopped being consistent, so it stopped asking.",
    "INFO_GAIN_BELOW_COST": "No further question was likely to help enough to be worth the patient's effort.",
    "PATIENT_TIMEOUT": "The patient stopped responding partway through the request.",
    "MAX_QUESTIONS": "It reached the limit of {n} questions for one request.",
    "CONSULT_PENDING": "It asked {name} ({relation}), who has not answered yet.",
}

# The only next steps the copilot can suggest. Slots are filled from the catalog, the patient's people
# and their taps; nothing else.
NEXT_STEPS = {
    "ASK_YES_NO": "Ask in person with yes/no cards: “{question}”",
    "SHOW_PAIN_SCALE": "Show the pain-scale card",
    "ASK_CONTACT": "Ask a trusted contact, {name} ({relation}), about {gesture}",
    "RECHECK_LATER": "Re-check in {minutes} minutes",
    "WATCH_FOR_GESTURES": "Go to the bedside and watch for pointing or gestures",
}

STAFF_WORDS = ("nurse", "psw", "staff", "doctor", "physician")
WAITING_ON_PATIENT = ("area", "feeling", "question")


@dataclass(frozen=True)
class PacketConfig:
    resolved_p: float = 0.6          # top need at least this likely: RESOLVED
    fatigue_high: float = 2.0        # the same fatigue at which the tablet switches to larger targets
    top_k: int = 3
    contender_p: float = 0.10        # a need must have reached this to count as "less likely" later ...
    drop_abs: float = 0.08           # ... and lost at least this much ...
    drop_ratio: float = 0.5          # ... ending at no more than half its peak
    max_less_likely: int = 4
    chart_min_change: float = 0.05   # a chart field "changed a probability" if it moved one need this much
    sbar_chart_items: int = 2        # the template SBAR names only the biggest chart changes
    low_risk_p_high: float = 0.10    # below this P(high-risk need), a tired patient can rest and be re-checked
    recheck_minutes: int = 15


PACKET = PacketConfig()


@dataclass
class CaseSelection:
    t: str
    kind: str          # tap_area | tap_feeling | answer
    text: str


@dataclass
class CaseNeed:
    need: str
    label: str
    p: float
    in_set: bool
    risk: str


@dataclass
class LessLikelyNeed:
    need: str
    label: str
    from_p: float
    to_p: float
    cause: dict        # {kind: tap | answer | consult | chart, text, t}


@dataclass
class ChartChange:
    lookup: str
    label: str
    value: str | None
    flagged: bool
    need: str
    need_label: str
    from_p: float
    to_p: float
    direction: str     # up | down


@dataclass
class CasePacket:
    session_id: str
    patient_id: str
    created_at: str
    variant: str       # full | light (high-risk escalation: no less_likely or chart_context)
    selections: list[CaseSelection]
    top_needs: list[CaseNeed]
    less_likely: list[LessLikelyNeed]
    chart_context: list[ChartChange]
    stop_reason: dict  # {code, text}
    uncertainty: dict  # {set_size, top_p, p_high, text}
    next_step: dict    # {code, text, need}

    def public(self) -> dict:
        return asdict(self)


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def _pct(p: float) -> str:
    return f"{round(p * 100)}%"


def _is_staff(relation: str) -> bool:
    return any(w in relation.lower() for w in STAFF_WORDS)


# ---- pieces ---------------------------------------------------------------------------------------

def selections(cat: Catalog, d: Dialogue) -> list[CaseSelection]:
    out = []
    for st in d.trace:
        if st.kind == "tap":
            out.append(CaseSelection(_iso(st.t), "tap_area" if st.detail in cat.area_labels else "tap_feeling", st.label))
        elif st.kind == "answer":
            out.append(CaseSelection(_iso(st.t), "answer", st.label))
    return out


def _steps(d: Dialogue):
    """(trace step, belief before, belief after) for every evidence step that changed the belief."""
    snaps = [st for st in d.trace if st.belief]
    return [(cur, prev.belief, cur.belief) for prev, cur in zip(snaps, snaps[1:])]


def less_likely(cat: Catalog, d: Dialogue, keep_out: set[str], pc: PacketConfig) -> list[LessLikelyNeed]:
    snaps = [st.belief for st in d.trace if st.belief]
    if len(snaps) < 2:
        return []
    steps = _steps(d)
    out = []
    for i, nid in enumerate(cat.need_ids):
        peak, final = max(b[i] for b in snaps), d.belief[i]
        if nid in keep_out or peak < pc.contender_p or peak - final < pc.drop_abs or final > peak * pc.drop_ratio:
            continue
        cause, _, _ = min(steps, key=lambda s: s[2][i] - s[1][i])   # the step that cut it most
        kind = {"tap": "tap", "answer": "answer", "consult": "consult", "lookup": "chart"}.get(cause.kind, cause.kind)
        out.append(LessLikelyNeed(nid, cat.by_id[nid]["label"], round(peak, 3), round(final, 3),
                                  {"kind": kind, "text": cause.label, "t": _iso(cause.t)}))
    out.sort(key=lambda x: x.to_p - x.from_p)
    return out[:pc.max_less_likely]


def chart_context(cat: Catalog, d: Dialogue, chart: dict | None, pc: PacketConfig) -> list[ChartChange]:
    """Chart fields read during the dialogue that moved a probability. Fields only shown to the nurse after
    an escalation (Dialogue.attach_context) have no trace step: they changed nothing, so they're left out."""
    flags = {lid: flag for lid, _, flag in d.lookup_results}
    out = []
    for st, before, after in _steps(d):
        if st.kind != "lookup":
            continue
        i = max(range(cat.n), key=lambda k: abs(after[k] - before[k]))
        if abs(after[i] - before[i]) < pc.chart_min_change:
            continue
        lid = st.detail
        out.append(ChartChange(lid, cat.lookup_by_id[lid].label, (chart or {}).get(lid, {}).get("value"),
                               bool(flags.get(lid)), cat.need_ids[i], cat.by_id[cat.need_ids[i]]["label"],
                               round(before[i], 3), round(after[i], 3), "up" if after[i] > before[i] else "down"))
    return out


def stop_reason(cat: Catalog, cfg: EngineConfig, d: Dialogue, decision: Decision | None, status: str,
                consult: dict | None, pc: PacketConfig) -> str:
    """One code, from structured state only, checked in this order."""
    if (decision and decision.chosen.id == "unresponsive") or status in WAITING_ON_PATIENT:
        return "PATIENT_TIMEOUT"
    p_safety = max(d.p_high(), p_high_risk(cat, d.signal_belief))
    if decision and decision.chosen.kind == "escalate" and p_safety >= cfg.escalate_threshold:
        return "SAFETY_FLOOR"
    if status == "waiting_consult":
        return "CONSULT_PENDING"
    if max(d.belief) >= pc.resolved_p:
        return "RESOLVED"
    if consult and consult.get("status") in ("pending", "expired"):
        return "CONSULT_PENDING"
    if d.questions_asked >= cfg.max_questions:
        return "MAX_QUESTIONS"
    if not d.patient_can_answer or d.fatigue() >= pc.fatigue_high:
        return "FATIGUE_HIGH"
    return "INFO_GAIN_BELOW_COST"


def _contact(d: Dialogue, consult: dict | None) -> dict | None:
    if consult and consult.get("status") in ("pending", "expired"):
        return {"name": consult["person_name"], "relation": consult["relation"]}
    free = [c for c in d.consultants if c.id not in d.consulted and not _is_staff(c.relation)]
    best: Consultant | None = min(free, key=lambda c: (-c.reliability, c.id), default=None)
    return {"name": best.name, "relation": best.relation} if best else None


def _gesture(cat: Catalog, d: Dialogue) -> str:
    taps = [f"“{cat.area_labels[d.area]}”" if d.area else None, f"“{cat.feeling_labels[d.feeling]}”" if d.feeling else None]
    taps = [t for t in taps if t]
    if not taps:
        return "what they are trying to say"
    return f"the {' and '.join(taps)} tap{'s' if len(taps) > 1 else ''}"


def next_step(cat: Catalog, d: Dialogue, code: str, focus: str, contact: dict | None, p_high: float,
              pc: PacketConfig) -> dict:
    """Deterministic from the stop reason and the focus need; always a NEXT_STEPS entry."""
    def make(kind: str, **slots) -> dict:
        return {"code": kind, "text": NEXT_STEPS[kind].format(**slots), "need": focus}

    def ask() -> dict:
        return make("ASK_YES_NO", question=cat.question_by_id[f"need:{focus}"].text)

    def ask_contact() -> dict:
        return make("ASK_CONTACT", name=contact["name"], relation=contact["relation"], gesture=_gesture(cat, d))

    if code == "PATIENT_TIMEOUT":
        return make("WATCH_FOR_GESTURES")
    if code == "CONSULT_PENDING" and contact:
        return ask_contact()
    if code == "FATIGUE_HIGH":
        if p_high < pc.low_risk_p_high:
            return make("RECHECK_LATER", minutes=pc.recheck_minutes)
        return ask_contact() if contact else ask()
    if code == "MAX_QUESTIONS" and contact:
        return ask_contact()
    if code in ("INFO_GAIN_BELOW_COST", "MAX_QUESTIONS") and cat.by_id[focus]["group"] == "pain":
        return make("SHOW_PAIN_SCALE")
    return ask()


def uncertainty(cat: Catalog, d: Dialogue, pset: list[str], pc: PacketConfig) -> dict:
    top = max(range(cat.n), key=lambda i: d.belief[i])
    # Rounded exactly like top_needs, so the sentence and the bars never disagree by a point.
    lead, p_top, p_high = cat.by_id[cat.need_ids[top]]["label"], round(d.belief[top], 3), round(d.p_high(), 3)
    if len(pset) == 1:
        text = f"Only one need is in the 90% set: {lead} ({_pct(p_top)})."
    else:
        text = f"{len(pset)} needs are in the 90% set; the most likely, {lead}, is at {_pct(p_top)}."
    if p_high >= pc.low_risk_p_high:
        text += f" A high-risk need is still possible ({_pct(p_high)})."
    return {"set_size": len(pset), "top_p": round(p_top, 3), "p_high": round(p_high, 3), "text": text}


# ---- packet ---------------------------------------------------------------------------------------

def build_case_packet(cat: Catalog, cfg: EngineConfig, d: Dialogue, *, session_id: str, patient_id: str,
                      prediction_set: list[str], decision: Decision | None, status: str,
                      chart: dict | None = None, consult: dict | None = None, now: float | None = None,
                      variant: str = "auto", pc: PacketConfig = PACKET) -> CasePacket:
    """Read-only over `d`: it never changes the belief, the trace or anything a decision uses.

    consult: the session's latest consult request ({person_name, relation, status}), if any.
    variant: "full", "light", or "auto" = light for a safety-floor escalation (the nurse is already on the
    way; they need the top needs, the inputs and what to ask first, not the full working).
    """
    pset = set(prediction_set)
    top = d.top(pc.top_k)
    code = stop_reason(cat, cfg, d, decision, status, consult, pc)
    if code == "SAFETY_FLOOR":   # focus on confirming the high-risk need
        focus = max((i for i in range(cat.n) if cat.high_risk[i]), key=lambda i: d.belief[i])
        focus = cat.need_ids[focus]
    else:
        focus = top[0]["need"]
    contact = _contact(d, consult)
    if variant == "auto":
        variant = "light" if code == "SAFETY_FLOOR" else "full"
    light = variant == "light"
    stop_text = STOP_TEXT[code].format(n=cfg.max_questions, name=(contact or {}).get("name", "a contact"),
                                       relation=(contact or {}).get("relation", ""))
    return CasePacket(
        session_id=session_id, patient_id=patient_id,
        created_at=_iso(now if now is not None else datetime.now(timezone.utc).timestamp()),
        variant=variant,
        selections=selections(cat, d),
        top_needs=[CaseNeed(t["need"], t["label"], round(t["p"], 3), t["need"] in pset, t["risk"]) for t in top],
        less_likely=[] if light else less_likely(cat, d, pset | {t["need"] for t in top}, pc),
        chart_context=[] if light else chart_context(cat, d, chart, pc),
        stop_reason={"code": code, "text": stop_text},
        uncertainty=uncertainty(cat, d, prediction_set, pc),
        next_step=next_step(cat, d, code, focus, contact, d.p_high(), pc),
    )


# ---- SBAR handoff from a packet (template, and the checks Gemini's wording must pass) --------------

# Treatment, medication, diagnosis and false-certainty language. Checked on Gemini's wording after the
# packet's own phrases (need labels, questions, chart fields, the patient's chart diagnosis) are removed.
BANNED_TERMS = re.compile(
    r"\b(diagnos\w*|treat\w*|therap\w*|medicat\w*|medicine|drug|dose|dosage|mg|mcg|administer\w*|prescri\w*|"
    r"give|giving|start|stop|increase|decrease|titrat\w*|analgesi\w*|opioid\w*|antibiotic\w*|morphine|"
    r"acetaminophen|paracetamol|ibuprofen|tylenol|infection|sepsis|stroke|delirium|dehydrated|"
    r"definitely|certainly|confirmed|clearly|obviously|ruled out|rules out|rule out|excluded|no doubt)\b", re.I)
CERTAINTY = re.compile(r"definitely|certainly|confirmed|clearly|obviously|ruled out|rules out|rule out|excluded|no doubt")
HEDGES = re.compile(r"\b(likely|possible|possibly|unclear|uncertain|unsure|may|might|not clear|not sure)\b", re.I)
NUMBER = re.compile(r"\d+(?:\.\d+)?")
LABEL_STOP_WORDS = {"or", "to", "a", "at", "the", "needs", "wants", "about", "of", "in", "over", "no", "last", "h",
                    "since", "below", "above", "recorded"}
# Ways a chart field gets described besides its label. Matching is deliberately broad: a false match only
# means the template is used instead of Gemini's wording.
CHART_KEYWORDS = {
    "analgesic_overdue": ["pain medication", "analgesic", "painkiller", "pain relief"],
    "void_overdue": ["void", "urinated", "peed"],
    "spo2_dropping": ["spo2", "oxygen", "saturation", "sats"],
    "febrile": ["temperature", "fever", "febrile"],
    "low_fluid_intake": ["fluid intake", "fluids", "intake"],
    "meal_missed": ["meal"],
    "reposition_overdue": ["reposition", "turned"],
    "recent_med_change": ["medication change", "medication changed", "med change", "changed medication"],
    "bp_elevated": ["blood pressure", "bp"],
}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _names(label: str, text: str) -> bool:
    """True if `text` names `label`, allowing other word forms ("shortness of breath" names "Short of breath")."""
    if label.lower() in text.lower():
        return True
    stems = [w[:5] for w in _tokens(label) if w not in LABEL_STOP_WORDS and len(w) > 1]
    toks = _tokens(text)
    return bool(stems) and all(any(t.startswith(st) for t in toks) for st in stems)


def _names_keyword(keyword: str, text: str) -> bool:
    if " " in keyword:
        return keyword in text.lower()
    return any(t.startswith(keyword) for t in _tokens(text))
MAX_FIELD_CHARS = 450


def _local_hm(iso: str) -> str:
    from ..config import settings
    return datetime.fromisoformat(iso).astimezone(settings.unit_tz).strftime("%H:%M")


def case_facts(packet: dict, patient: dict) -> dict:
    """What Gemini sees: the packet's facts, with probabilities already written as percentages."""
    return {
        "patient": {"name": patient["name"], "room": patient["room"], "background": patient.get("diagnosis", "")},
        "why_it_stopped": packet["stop_reason"]["text"],
        "uncertainty": packet["uncertainty"]["text"],
        "selections": [f"{_local_hm(s['t'])} {s['text']}" for s in packet["selections"]],
        "most_likely": [f"{n['label']} {_pct(n['p'])}" + ("" if n["in_set"] else " (outside the 90% set)")
                        for n in packet["top_needs"]],
        "less_likely_given_answers": [f"{x['label']}: {_pct(x['from_p'])} to {_pct(x['to_p'])}, after {x['cause']['text']}"
                                      for x in packet["less_likely"]],
        "chart_that_changed_the_picture": [
            f"{c['label']}{' (' + c['value'] + ')' if c['value'] else ''}: {c['need_label']} "
            f"{_pct(c['from_p'])} to {_pct(c['to_p'])}" for c in packet["chart_context"]],
        "next_step": packet["next_step"]["text"],
    }


def _inputs_summary(packet: dict) -> str:
    taps = [s["text"].split(": ", 1)[-1] for s in packet["selections"] if s["kind"] != "answer"]
    answers = [s["text"].rsplit("→ ", 1)[-1] for s in packet["selections"] if s["kind"] == "answer"]
    out = f"Tapped {', then '.join(taps)}" if taps else "No taps"
    if answers:
        counts = {a: answers.count(a) for a in dict.fromkeys(answers)}
        out += "; answers: " + ", ".join(f"{n} {a}" for a, n in counts.items())
    return out


def template_case_sbar(packet: dict, patient: dict, pc: PacketConfig = PACKET) -> dict:
    f = case_facts(packet, patient)
    biggest = sorted(packet["chart_context"], key=lambda c: -abs(c["to_p"] - c["from_p"]))[:pc.sbar_chart_items]
    chart = "; ".join(f"{c['label']}: {c['need_label']} {_pct(c['from_p'])} to {_pct(c['to_p'])}" for c in biggest)
    less = "; ".join(f["less_likely_given_answers"][:2])
    return {
        "situation": f"{patient['name']} (room {patient['room']}) made a request that is not clear yet. "
                     f"{packet['stop_reason']['text']}",
        "background": (f"{patient.get('diagnosis', '')} {_inputs_summary(packet)}. "
                       f"Chart: {chart or 'no chart field changed the picture'}.").strip(),
        "assessment": f"{packet['uncertainty']['text']} Most likely: {', '.join(f['most_likely'])}."
                      + (f" Less likely given answers: {less}." if less else ""),
        "recommendation": packet["next_step"]["text"],
    }


def check_case_sbar(sbar: dict, packet: dict, patient: dict, cat: Catalog) -> list[str]:
    """Problems with an SBAR written from `packet`; empty means it adds nothing the packet doesn't say."""
    facts = case_facts(packet, patient)
    facts_text = json.dumps(facts, ensure_ascii=False)
    problems = []
    fields = ("situation", "background", "assessment", "recommendation")
    for k in fields:
        if not isinstance(sbar.get(k), str) or not sbar[k].strip() or len(sbar[k]) > MAX_FIELD_CHARS:
            problems.append(f"{k}: empty or too long")
    if problems:
        return problems
    text = " ".join(sbar[k] for k in fields)

    allowed_numbers = {float(n) for n in NUMBER.findall(facts_text)}
    for n in NUMBER.findall(text):
        if float(n) not in allowed_numbers:
            problems.append(f"number not in packet: {n}")

    packet_needs = ({n["label"] for n in packet["top_needs"]} | {x["label"] for x in packet["less_likely"]}
                    | {c["need_label"] for c in packet["chart_context"]})
    if packet["next_step"]["need"]:
        packet_needs.add(cat.by_id[packet["next_step"]["need"]]["label"])
    # The packet's own phrases (its needs, the patient's inputs, the next step) may be quoted freely; any
    # other need or chart field named in what is left was added by the model.
    rest = text
    for phrase in sorted(_packet_phrases(packet, patient, None), key=len, reverse=True):
        rest = re.sub(re.escape(phrase), " ", rest, flags=re.I)
    for n in cat.needs:
        if n["label"] not in packet_needs and _names(n["label"], rest):
            problems.append(f"need not in packet: {n['label']}")

    packet_lookups = {c["lookup"] for c in packet["chart_context"]}
    chart = patient.get("chart", {})
    for lk in cat.lookups:
        if lk.id in packet_lookups:
            continue
        value = chart.get(lk.id, {}).get("value")
        if (_names(lk.label, rest) or (value and value.lower() in rest.lower())
                or any(_names_keyword(k, rest) for k in CHART_KEYWORDS.get(lk.id, []))):
            problems.append(f"chart field not in packet: {lk.label}")

    own = text
    for phrase in sorted(_packet_phrases(packet, patient, cat), key=len, reverse=True):
        own = re.sub(re.escape(phrase), " ", own, flags=re.I)
    # A word the packet itself uses (e.g. "stroke" in the chart's diagnosis line, "medication" in the need
    # "Question about medication" when that need is in the packet) is a fact, not advice.
    packet_words = set(re.findall(r"[a-z]+", " ".join(_packet_phrases(packet, patient, None)).lower()))
    for m in BANNED_TERMS.finditer(own):
        term = m.group(0).lower()
        if term in packet_words and not CERTAINTY.fullmatch(term):
            continue
        problems.append(f"banned term: {m.group(0)}")
    if packet["stop_reason"]["code"] != "RESOLVED" and not HEDGES.search(sbar["assessment"]):
        problems.append("assessment drops the uncertainty")
    return problems


def _packet_phrases(packet: dict, patient: dict, cat: Catalog | None) -> set[str]:
    """Wording that comes from the packet or the chart itself, which the banned-terms check must not trip on
    (e.g. the need "Question about medication", or the chart's own diagnosis line). With cat=None, only
    this packet's own phrases (not the whole catalog)."""
    phrases = set()
    if cat is not None:
        phrases |= {n["label"] for n in cat.needs} | {q.text for q in cat.questions} | {lk.label for lk in cat.lookups}
        phrases |= set(cat.area_labels.values()) | set(cat.feeling_labels.values())
    phrases |= {n["label"] for n in packet["top_needs"]} | {x["label"] for x in packet["less_likely"]}
    phrases |= {c["label"] for c in packet["chart_context"]} | {c["need_label"] for c in packet["chart_context"]}
    phrases |= {x["cause"]["text"] for x in packet["less_likely"]}
    phrases |= {s["text"] for s in packet["selections"]} | {packet["next_step"]["text"], packet["stop_reason"]["text"]}
    phrases |= {c["value"] for c in packet["chart_context"] if c["value"]}
    if patient.get("diagnosis"):
        phrases.add(patient["diagnosis"])
    return {p for p in phrases if p}


def finalize_case_sbar(sbar: dict, packet: dict) -> dict:
    """The recommendation may only restate the packet's next step: it is replaced with it, word for word."""
    return {k: sbar[k] for k in ("situation", "background", "assessment")} | {"recommendation": packet["next_step"]["text"]}


# ---- nurse feedback ---------------------------------------------------------------------------------

def case_feedback(packet: dict, need_id: str | None, helpful: bool | None, nurse: str, cat: Catalog,
                  now: float | None = None) -> dict:
    """The nurse's verdict on a packet, given with the normal confirmation of what the patient needed."""
    ranked = [n["need"] for n in packet["top_needs"]]
    return {
        "helpful": helpful, "actual_need": need_id,
        "actual_label": cat.by_id[need_id]["label"] if need_id else None,
        "actual_rank": ranked.index(need_id) + 1 if need_id in ranked else None,
        "actual_was_less_likely": any(x["need"] == need_id for x in packet["less_likely"]),
        "by": nurse, "at": _iso(now if now is not None else datetime.now(timezone.utc).timestamp()),
    }
