"""Clinician copilot case packet (app/services/case_packet.py)."""
import copy
import itertools
import re

import pytest

from app.catalog import get_catalog
from app.config import settings
from app.engine.conformal import ConformalPredictor
from app.engine.decision import Action, Consultant, Decision
from app.engine.dialogue import Dialogue
from app.services.case_packet import NEXT_STEPS, PACKET, STOP_TEXT, build_case_packet

cat = get_catalog()
cfg = settings.engine
CP = ConformalPredictor()
CP.qhat = 0.955                       # the value the app calibrates to at startup
LIN = Consultant("fam-lin", "Lin Chen", "daughter", 0.85)
PRIYA = Consultant("rn-priya", "Priya S.", "regular nurse", 0.9)
BANNED = re.compile(r"\b(ruled out|rule out|diagnos\w*|medicat\w*|dose|dosage|mg|give|administer|prescri\w*|treat\w*|"
                    r"analgesic|opioid|antibiotic|tylenol|acetaminophen|morphine)\b", re.I)


def dialogue(flags: dict | None = None, people=(LIN, PRIYA), reliability=0.85) -> Dialogue:
    return Dialogue(cat, cfg, list(cat.base_prior), reliability, list(people),
                    flags if flags is not None else {lk.id: False for lk in cat.lookups})


def packet(d: Dialogue, decision=None, status="sent", consult=None, chart=None):
    return build_case_packet(cat, cfg, d, session_id="s1", patient_id="p-test",
                             prediction_set=CP.predict_set(cat.need_ids, d.belief), decision=decision,
                             status=status, chart=chart, consult=consult, now=0).public()


def run(d: Dialogue, area: str, feeling: str, answer="no", max_steps=8):
    """Drive a dialogue like the session service does (answers only; no consults)."""
    d.apply_tap("area", area)
    dec = d.step()
    if dec.chosen.kind == "tap":
        d.apply_tap("feeling", feeling)
        dec = d.step()
    for _ in range(max_steps):
        if dec.chosen.kind != "ask":
            break
        d.apply_answer(dec.chosen.id, answer)
        dec = d.step()
    return dec


def ambiguous(d: Dialogue):
    """Belly + 'uncomfortable', no questions yet: several needs are still plausible."""
    d.apply_tap("area", "belly")
    d.apply_tap("feeling", "uncomfortable")
    assert max(d.belief) < PACKET.resolved_p
    return d


SEND = Decision(Action("send", "send", "Send", 0.0, 0.0, {}), [], "No action is worth its cost any more.")


# ---- every stop reason ----------------------------------------------------------------------------

def test_resolved():
    d = dialogue()
    dec = run(d, "mouth_throat", "thirsty", answer="yes")
    p = packet(d, dec)
    assert p["stop_reason"]["code"] == "RESOLVED" and p["top_needs"][0]["need"] == "thirsty"
    assert p["top_needs"][0]["p"] >= PACKET.resolved_p
    assert p["next_step"]["code"] == "ASK_YES_NO" and "drink" in p["next_step"]["text"].lower()


@pytest.mark.parametrize("area,feeling", [("chest", "pain"), ("chest", "hard_to_breathe"), ("mouth_throat", "hard_to_breathe")])
def test_safety_floor(area, feeling):
    d = dialogue()
    dec = run(d, area, feeling)
    assert dec.chosen.kind == "escalate"
    p = packet(d, dec, status="escalated")
    assert p["stop_reason"]["code"] == "SAFETY_FLOOR"
    focus = p["next_step"]["need"]
    assert cat.by_id[focus]["risk"] == "high"                       # confirm the high-risk need first
    assert p["next_step"]["code"] == "ASK_YES_NO" and cat.question_by_id[f"need:{focus}"].text in p["next_step"]["text"]


def test_patient_timeout_from_mode_a():
    d = ambiguous(dialogue())
    dec = Decision(Action("escalate", "unresponsive", "Patient stopped responding mid-request", 0.0, 0.0, {}), [], "")
    p = packet(d, dec, status="escalated")
    assert p["stop_reason"]["code"] == "PATIENT_TIMEOUT" and p["next_step"]["code"] == "WATCH_FOR_GESTURES"


def test_patient_timeout_for_an_abandoned_episode():
    d = dialogue()
    d.apply_tap("area", "belly")
    assert packet(d, None, status="feeling")["stop_reason"]["code"] == "PATIENT_TIMEOUT"


def test_consult_pending_while_waiting():
    d = ambiguous(dialogue())
    d.mark_consulted("fam-lin")
    c = {"person_name": "Lin Chen", "relation": "daughter", "status": "pending"}
    p = packet(d, None, status="waiting_consult", consult=c)
    assert p["stop_reason"]["code"] == "CONSULT_PENDING" and "Lin Chen" in p["stop_reason"]["text"]
    assert p["next_step"]["code"] == "ASK_CONTACT"
    assert p["next_step"]["text"] == (f"Ask a trusted contact, Lin Chen (daughter), about the "
                                      f"“{cat.area_labels['belly']}” and “{cat.feeling_labels['uncomfortable']}” taps")


def test_consult_pending_after_it_expired():
    d = ambiguous(dialogue())
    p = packet(d, SEND, consult={"person_name": "Lin Chen", "relation": "daughter", "status": "expired"})
    assert p["stop_reason"]["code"] == "CONSULT_PENDING"


def test_max_questions():
    d = ambiguous(dialogue(people=(PRIYA,)))       # only staff on the list: no trusted contact to suggest
    d.questions_asked = cfg.max_questions
    p = packet(d, SEND)
    assert p["stop_reason"]["code"] == "MAX_QUESTIONS" and str(cfg.max_questions) in p["stop_reason"]["text"]
    assert p["next_step"]["code"] in ("ASK_YES_NO", "SHOW_PAIN_SCALE")


def test_max_questions_suggests_the_trusted_contact():
    d = ambiguous(dialogue())
    d.questions_asked = cfg.max_questions
    p = packet(d, SEND)
    assert p["next_step"]["code"] == "ASK_CONTACT" and "Lin Chen" in p["next_step"]["text"]
    assert "Priya" not in p["next_step"]["text"]                    # staff are not "trusted contacts"


def test_fatigue_high_low_risk_rests_and_rechecks():
    d = ambiguous(dialogue())
    d.inconsistencies = cfg.max_inconsistent_answers                 # patient can no longer answer reliably
    p = packet(d, SEND)
    assert p["stop_reason"]["code"] == "FATIGUE_HIGH"
    assert p["uncertainty"]["p_high"] < PACKET.low_risk_p_high
    assert p["next_step"] == {"code": "RECHECK_LATER", "text": f"Re-check in {PACKET.recheck_minutes} minutes",
                              "need": p["top_needs"][0]["need"]}


def test_fatigue_high_with_risk_asks_the_contact():
    d = ambiguous(dialogue())
    d.inconsistencies = cfg.max_inconsistent_answers
    pc = type(PACKET)(low_risk_p_high=0.0)                           # treat any risk as not low
    p = build_case_packet(cat, cfg, d, session_id="s", patient_id="p", prediction_set=CP.predict_set(cat.need_ids, d.belief),
                          decision=SEND, status="sent", pc=pc).public()
    assert p["stop_reason"]["code"] == "FATIGUE_HIGH" and p["next_step"]["code"] == "ASK_CONTACT"


def test_info_gain_below_cost():
    d = ambiguous(dialogue())
    p = packet(d, SEND)
    assert p["stop_reason"]["code"] == "INFO_GAIN_BELOW_COST"
    assert p["next_step"]["code"] in ("ASK_YES_NO", "SHOW_PAIN_SCALE")


def test_info_gain_below_cost_on_a_pain_need_shows_the_pain_scale():
    d = dialogue()
    d.apply_tap("area", "belly")
    d.apply_tap("feeling", "not_sure")
    p = packet(d, SEND)
    assert p["stop_reason"]["code"] == "INFO_GAIN_BELOW_COST" and p["top_needs"][0]["need"] == "pain_abdomen"
    assert p["next_step"] == {"code": "SHOW_PAIN_SCALE", "text": "Show the pain-scale card", "need": "pain_abdomen"}


def test_every_stop_reason_is_covered():
    seen = {"RESOLVED", "SAFETY_FLOOR", "PATIENT_TIMEOUT", "CONSULT_PENDING", "MAX_QUESTIONS", "FATIGUE_HIGH",
            "INFO_GAIN_BELOW_COST"}
    assert seen == set(STOP_TEXT)


# ---- content rules --------------------------------------------------------------------------------

def test_less_likely_names_the_answer_that_caused_it():
    d = dialogue()
    d.apply_tap("area", "belly")
    d.apply_tap("feeling", "uncomfortable")
    d.apply_answer("group:toileting", "no")
    p = packet(d, SEND)
    urinate = next(x for x in p["less_likely"] if x["need"] == "urinate")
    assert urinate["to_p"] < urinate["from_p"]
    assert urinate["cause"] == {"kind": "answer", "text": "Is it about the washroom? → no", "t": urinate["cause"]["t"]}


def test_chart_context_lists_only_fields_that_moved_a_probability():
    flags = {lk.id: lk.id == "void_overdue" for lk in cat.lookups}
    d = dialogue(flags)
    d.apply_tap("area", "belly")
    d.apply_tap("feeling", "uncomfortable")
    d.apply_lookup("void_overdue")
    d.attach_context()                                             # display-only fields: no effect on belief
    p = packet(d, SEND, chart={"void_overdue": {"value": "Last void 5 h ago", "flag": True}})
    assert [c["lookup"] for c in p["chart_context"]] == ["void_overdue"]
    c = p["chart_context"][0]
    assert c["flagged"] and c["value"] == "Last void 5 h ago" and c["direction"] == "up"
    assert abs(c["to_p"] - c["from_p"]) >= PACKET.chart_min_change


def test_selections_are_ordered_with_timestamps():
    d = dialogue()
    dec = run(d, "belly", "uncomfortable")
    sel = packet(d, dec)["selections"]
    assert [s["kind"] for s in sel[:2]] == ["tap_area", "tap_feeling"]
    assert all(s["kind"] == "answer" for s in sel[2:]) and len(sel) == 2 + d.questions_asked
    assert [s["t"] for s in sel] == sorted(s["t"] for s in sel)


# Catalog wording (need labels, question texts, tap labels) is the patient's own vocabulary, e.g. the need
# "Question about medication". The rule is about what the copilot itself suggests, so that vocabulary is
# removed before scanning; everything left is the copilot's fixed wording.
CATALOG_TEXT = sorted({n["label"] for n in cat.needs} | {q.text for q in cat.questions}
                      | set(cat.area_labels.values()) | set(cat.feeling_labels.values()), key=len, reverse=True)


def test_the_word_check_catches_treatment_advice():
    assert BANNED.search(own_words("Give 1 g acetaminophen now")) and BANNED.search("Pain ruled out")


def own_words(text: str) -> str:
    for phrase in CATALOG_TEXT:
        text = text.replace(phrase, "")
    return text


TEMPLATES = [re.compile("^" + re.escape(t).replace(r"\{question\}", ".+").replace(r"\{name\}", ".+")
                        .replace(r"\{relation\}", ".+").replace(r"\{gesture\}", ".+")
                        .replace(r"\{minutes\}", r"\d+") + "$") for t in NEXT_STEPS.values()]


@pytest.mark.parametrize("answer", ["yes", "no", "unsure"])
def test_every_packet_follows_the_rules(answer):
    """Every tap pair the patient can make: whitelisted next step, no treatment words, honest wording."""
    areas = [a["id"] for a in cat.raw["areas"]]
    feelings = [f["id"] for f in cat.raw["feelings"]]
    for area, feeling in itertools.product(areas, feelings):
        d = dialogue()
        dec = run(d, area, feeling, answer)
        p = packet(d, dec, status="escalated" if dec.chosen.kind == "escalate" else "sent")
        step = p["next_step"]
        assert step["code"] in NEXT_STEPS and any(t.match(step["text"]) for t in TEMPLATES), step
        for text in (step["text"], p["stop_reason"]["text"], p["uncertainty"]["text"]):
            assert not BANNED.search(own_words(text)), text
        assert len(p["top_needs"]) == 3 and p["top_needs"] == sorted(p["top_needs"], key=lambda n: -n["p"])
        top_ids = {n["need"] for n in p["top_needs"]}
        for x in p["less_likely"]:
            assert x["to_p"] < x["from_p"] and x["need"] not in top_ids
        for c in p["chart_context"]:
            assert abs(c["to_p"] - c["from_p"]) >= PACKET.chart_min_change


# ---- the escalation path is unchanged -------------------------------------------------------------

def _state(d: Dialogue):
    return (list(d.belief), list(d.signal_belief), d.questions_asked, sorted(d.asked), list(d.answers),
            list(d.lookup_results), d.inconsistencies, len(d.trace), d.escalated)


@pytest.mark.parametrize("reliability", [0.55, 0.7, 0.85, 0.97])
@pytest.mark.parametrize("area,feeling", [("chest", "pain"), ("chest", "hard_to_breathe"),
                                          ("mouth_throat", "hard_to_breathe"), ("belly", "pain"), ("head", "sick")])
def test_building_packets_never_changes_a_decision(reliability, area, feeling):
    """Two identical dialogues; one builds a packet after every step. Decisions, reasons and beliefs match,
    and high-risk taps escalate on the safety floor exactly as before."""
    plain, watched = dialogue(reliability=reliability), dialogue(reliability=reliability)
    trail = {"plain": [], "watched": []}
    for d, key in ((plain, "plain"), (watched, "watched")):
        d.apply_tap("area", area)
        steps = [("feeling", feeling)] + [("answer", None)] * 6
        while True:
            if key == "watched":
                before = copy.deepcopy(_state(d))
                packet(d, None, status="feeling")
                assert _state(d) == before                                  # read-only
            dec = d.step()
            trail[key].append((dec.chosen.kind, dec.chosen.id, dec.reason, round(d.p_high(), 9)))
            if not steps or dec.chosen.kind in ("escalate", "send", "consult"):
                break
            kind, value = steps.pop(0)
            if dec.chosen.kind == "tap":
                d.apply_tap("feeling", feeling)
            elif dec.chosen.kind == "ask":
                d.apply_answer(dec.chosen.id, "no")
    assert trail["plain"] == trail["watched"]
    assert plain.belief == watched.belief
    if cat.by_id.get(next((n["need"] for n in plain.top(1)), ""), {}).get("risk") == "high" and area == "chest":
        assert trail["plain"][-1][0] == "escalate" and trail["plain"][-1][2].startswith("Safety floor")


def test_trace_public_view_is_unchanged():
    d = dialogue()
    d.apply_tap("area", "chest")
    assert set(d.trace[-1].public()) == {"t", "kind", "label", "detail", "top", "entropy", "p_high"}
