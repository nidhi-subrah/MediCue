"""Gemini is used for language only: SBAR summaries, translation, simplifying caregiver questions,
wording research hypotheses, shift-summary lines, and reading chart notes and nurse observations into
patient-profile items (which engine/profile.py validates and bounds). It never decides whether to
escalate. Every function has a deterministic fallback, used when no API key is set or a call fails or
times out.
"""
import asyncio
import json
import logging
import re
import time
from typing import Literal

from pydantic import BaseModel

from ..config import settings

log = logging.getLogger(__name__)
TIMEOUT_S = 12
LONG_TIMEOUT_S = 40   # profile extraction and shift summaries are longer requests
MAX_RETRY_WAIT_S = 60


def _retry_delay(err) -> float | None:
    """Seconds Gemini asks us to wait in a 429 response, if it says."""
    m = re.search(r"retry in ([\d.]+)s", str(err)) or re.search(r"'retryDelay': '(\d+)s'", str(err))
    return float(m.group(1)) if m else None

LANGUAGE_NAMES = {"en": "English", "fr": "French", "es": "Spanish", "zh": "Simplified Chinese",
                  "pa": "Punjabi (Gurmukhi)", "ar": "Arabic", "tl": "Tagalog"}


class SBARModel(BaseModel):
    situation: str
    background: str
    assessment: str
    recommendation: str


class Translations(BaseModel):
    translations: list[str]


class TextModel(BaseModel):
    text: str


class ProfileItemModel(BaseModel):
    kind: Literal["need", "fatigue", "person_trust", "person_available", "person_preferred", "access", "signal",
                  "note"]
    target: str          # need id or person id, "" if the kind has none
    value: str
    start_hour: int      # -1 = no time window
    end_hour: int
    evidence: str        # exact quote from the source text


class ProfileItemsModel(BaseModel):
    items: list[ProfileItemModel]


class PatientItemsModel(BaseModel):
    patient_id: str
    items: list[ProfileItemModel]


class UnitProfilesModel(BaseModel):
    patients: list[PatientItemsModel]


class HandoffLine(BaseModel):
    patient_id: str
    headline: str
    watch_for: str


class HandoffModel(BaseModel):
    patients: list[HandoffLine]


PROFILE_RULES = """Item kinds (use only these):
- need: target = a need id from the list; value = raise_slight | raise_moderate | raise_strong | lower_slight | lower_moderate | lower_strong. A need that is more or less likely for this patient. Use start_hour/end_hour (0-24, local time, end exclusive) if the text names a time of day.
- fatigue: value = elevated | high. The patient tires quickly. Optional hours.
- person_trust: target = a person id; value = higher | lower. How well that person interprets the patient.
- person_available: target = a person id; value = ""; start_hour/end_hour REQUIRED. When that person can be reached.
- person_preferred: target = a person id; value = "". Ask this person first. Optional hours.
- access: value = large | scan. The input mode the patient prefers when tired (scan = switch scanning).
- signal: value = higher | lower. The patient's own taps are more or less reliable than usual.
- note: value = a short communication note for nurses (no engine effect).

Rules:
- Use ONLY what the text says. Do not infer diagnoses or add clinical knowledge.
- evidence MUST be an exact, word-for-word quote copied from the text (a phrase is fine).
- Use only the need ids and person ids listed. Use start_hour = -1 and end_hour = -1 when there is no time window.
- Never make a high-risk need less likely.
- If nothing applies, return an empty list."""


class Gemini:
    def __init__(self, api_key: str | None = settings.gemini_api_key, model: str = settings.gemini_model):
        self.model = model
        self.client = None
        self._cache: dict[tuple[str, str], str] = {}
        self._paused_until = 0.0
        if api_key:
            try:
                from google import genai
                self.client = genai.Client(api_key=api_key)
            except Exception:
                log.exception("Gemini client unavailable; using templates")

    @property
    def enabled(self) -> bool:
        return self.client is not None

    @property
    def paused_for(self) -> float:
        """Seconds until Gemini is tried again after a quota error (0 = not paused)."""
        return max(0.0, self._paused_until - time.time())

    async def _json(self, prompt: str, schema: type[BaseModel], timeout: float = TIMEOUT_S) -> BaseModel | None:
        if not self.client or self.paused_for > 0:
            return None
        from google.genai import errors, types
        for attempt in range(2):
            try:
                resp = await asyncio.wait_for(self.client.aio.models.generate_content(
                    model=self.model, contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                                       temperature=0.2)), timeout)
                return schema.model_validate(json.loads(resp.text))
            except errors.ClientError as e:
                # Rate limited (the free tier allows a few requests a minute): wait as asked, retry once.
                delay = _retry_delay(e)
                if e.code == 429 and attempt == 0 and delay is not None and delay <= MAX_RETRY_WAIT_S:
                    log.warning("Gemini rate limited; retrying in %.0f s", delay)
                    await asyncio.sleep(delay + 1)
                    continue
                if e.code == 429 and delay and delay > MAX_RETRY_WAIT_S:
                    # Quota used up (e.g. the free tier's daily limit): stop calling until it resets,
                    # instead of failing every request. Templates are used meanwhile.
                    self._paused_until = time.time() + delay
                    log.warning("Gemini quota exhausted; using templates for the next %.0f min", delay / 60)
                    return None
                log.warning("Gemini call failed (%s); falling back to template", e.code)
                return None
            except TimeoutError:   # (a subclass of OSError, so caught first) don't wait twice
                log.warning("Gemini timed out after %.0f s; falling back to template", timeout)
                return None
            except (ConnectionError, OSError) as e:
                if attempt == 0:   # dropped connection: one quick retry
                    log.warning("Gemini connection dropped (%s); retrying", type(e).__name__)
                    continue
                log.warning("Gemini unreachable; falling back to template")
                return None
            except Exception:
                log.exception("Gemini call failed; falling back to template")
                return None
        return None

    # ---- SBAR ------------------------------------------------------------------------------------

    async def sbar(self, ctx: dict) -> tuple[dict, str]:
        prompt = (
            "You write SBAR handoff notes for bedside nurses from a patient communication aid.\n"
            "Rules: describe only what the patient signalled and what the chart shows. Do not diagnose or "
            "recommend treatment. Quote probabilities exactly as given. Each field at most 2 short sentences. "
            "Write in English.\n\n"
            f"Data (JSON):\n{json.dumps(ctx, default=str)}"
        )
        out = await self._json(prompt, SBARModel)
        if out:
            return out.model_dump(), "gemini"
        return template_sbar(ctx), "template"

    # ---- case packet SBAR (clinician copilot) -----------------------------------------------------

    async def case_sbar(self, packet: dict, patient: dict, cat, timeout: float = TIMEOUT_S) -> tuple[dict, str]:
        """SBAR handoff for an unclear request, written from a CasePacket (services/case_packet.py).

        Gemini only rewords the packet. Its output is checked: every number, need name and chart field
        must come from the packet, no treatment/diagnosis/certainty language, uncertainty kept. The
        recommendation is always the packet's next step, word for word. Any failure, timeout, missing
        key or failed check returns the template SBAR built from the same packet.
        """
        from .case_packet import case_facts, check_case_sbar, finalize_case_sbar, template_case_sbar
        fallback = template_case_sbar(packet, patient)
        if not self.enabled:
            return fallback, "template"
        prompt = (
            "You write an SBAR handoff for a bedside nurse about a request from a patient who cannot speak, "
            "where the communication aid could not tell for sure what the patient needs.\n"
            "Rules:\n"
            "- Use ONLY the facts in the JSON. Add no new facts, numbers, needs or chart details.\n"
            "- Do not diagnose, name conditions, or suggest treatment or medication.\n"
            "- Keep every percentage exactly as written, and keep the uncertainty: say what is likely or "
            "possible, never that something is certain, confirmed or ruled out.\n"
            "- recommendation: restate next_step and nothing else.\n"
            "- Each field at most 2 short sentences, plain English.\n\n"
            f"Facts (JSON):\n{json.dumps(case_facts(packet, patient), ensure_ascii=False)}")
        out = await self._json(prompt, SBARModel, timeout)
        if not out:
            return fallback, "template"
        sbar = out.model_dump()
        problems = check_case_sbar(sbar, packet, patient, cat)
        if problems:
            log.warning("Gemini case SBAR rejected (%s); using template", "; ".join(problems[:5]))
            return fallback, "template"
        return finalize_case_sbar(sbar, packet), "gemini"

    # ---- translation -----------------------------------------------------------------------------

    async def translate(self, texts: list[str], lang: str) -> list[str]:
        if lang == "en" or not texts:
            return texts
        missing = [t for t in dict.fromkeys(texts) if (lang, t) not in self._cache]
        if missing and self.client:
            prompt = (
                f"Translate each string into {LANGUAGE_NAMES.get(lang, lang)} for a hospital patient who cannot "
                "speak. Use very plain, kind, short wording. Keep the same order and count. Return JSON.\n\n"
                f"{json.dumps(missing, ensure_ascii=False)}")
            out = await self._json(prompt, Translations)
            if out and len(out.translations) == len(missing):
                for src, dst in zip(missing, out.translations):
                    self._cache[(lang, src)] = dst
        return [self._cache.get((lang, t), t) for t in texts]

    # ---- caregiver question ----------------------------------------------------------------------

    async def family_question(self, patient_name: str, relation: str, top_labels: list[str], taps: list[str]) -> str:
        fallback = (f"{patient_name.split()[0]} is trying to tell the care team something. "
                    f"They tapped: {', '.join(taps) or 'nothing yet'}. Which of these do you think they mean?")
        prompt = (
            f"Write one short, friendly question (max 35 words) to a patient's {relation}, asking which of these "
            f"needs the patient most likely means. The patient tapped: {taps}. Candidate needs: {top_labels}. "
            f"Patient first name: {patient_name.split()[0]}. Plain language, no medical jargon, no diagnosis.")
        out = await self._json(prompt, TextModel)
        return out.text if out else fallback

    # ---- patient profiles (engine/profile.py validates everything returned here) -------------------

    @staticmethod
    def _profile_context(patient: dict, needs: list[dict], people: list[dict]) -> str:
        need_list = "\n".join(f"- {n['id']}: {n['label']}{' (HIGH RISK)' if n['risk'] == 'high' else ''}"
                              for n in needs)
        people_list = "\n".join(f"- {p['id']}: {p['name']} ({p['relation']})" for p in people) or "- none"
        return (f"Patient: {patient['name']}, {patient['age']}. {patient['diagnosis']}\n\n"
                f"Need ids:\n{need_list}\n\nPerson ids:\n{people_list}\n\n{PROFILE_RULES}")

    async def extract_profile(self, patient: dict, needs: list[dict], people: list[dict]) -> list[dict] | None:
        """Chart notes → profile items. None when Gemini is off or the call fails."""
        prompt = ("You turn a patient's free-text chart notes into structured profile items for a bedside "
                  "communication aid used by patients who cannot speak.\n\n"
                  f"{self._profile_context(patient, needs, people)}\n\nChart notes:\n\"\"\"{patient['notes']}\"\"\"")
        out = await self._json(prompt, ProfileItemsModel, LONG_TIMEOUT_S)
        return [i.model_dump() for i in out.items] if out else None

    async def extract_profiles(self, patients: list[dict], needs: list[dict],
                               people: dict[str, list[dict]]) -> dict[str, list[dict]] | None:
        """Several patients' notes in one request (startup), to stay inside free-tier rate limits."""
        need_list = "\n".join(f"- {n['id']}: {n['label']}{' (HIGH RISK)' if n['risk'] == 'high' else ''}"
                              for n in needs)
        blocks = []
        for p in patients:
            plist = ", ".join(f"{x['id']} = {x['name']} ({x['relation']})" for x in people[p["id"]]) or "none"
            blocks.append(f"### patient_id: {p['id']}\n{p['name']}, {p['age']}. {p['diagnosis']}\n"
                          f"Person ids: {plist}\nChart notes: \"\"\"{p['notes']}\"\"\"")
        prompt = ("You turn patients' free-text chart notes into structured profile items for a bedside "
                  "communication aid used by patients who cannot speak. Return one entry per patient_id; "
                  "each patient's evidence must quote that patient's own notes.\n\n"
                  f"Need ids:\n{need_list}\n\n{PROFILE_RULES}\n\n" + "\n\n".join(blocks))
        out = await self._json(prompt, UnitProfilesModel, LONG_TIMEOUT_S)
        if not out:
            return None
        return {p.patient_id: [i.model_dump() for i in p.items] for p in out.patients}

    async def items_from_nurse_note(self, patient: dict, note: str, confirmed_label: str | None,
                                    needs: list[dict], people: list[dict],
                                    current: list[str]) -> list[dict] | None:
        """A nurse's observation at confirmation time → suggested profile items (a nurse approves them)."""
        prompt = ("A nurse just confirmed a request from a patient who cannot speak and wrote an observation. "
                  "Suggest profile items that would help next time. Only suggest what the nurse's note "
                  "supports; quote the nurse's note as evidence.\n\n"
                  f"{self._profile_context(patient, needs, people)}\n\n"
                  f"Confirmed need: {confirmed_label or 'not given'}\n"
                  f"Current profile: {json.dumps(current) if current else 'empty'}\n\n"
                  f"Nurse's note:\n\"\"\"{note}\"\"\"")
        out = await self._json(prompt, ProfileItemsModel, LONG_TIMEOUT_S)
        return [i.model_dump() for i in out.items] if out else None

    # ---- shift summary ---------------------------------------------------------------------------

    async def handoff_lines(self, patients: list[dict]) -> dict[str, dict] | None:
        """One headline and one 'watch for' sentence per patient, from facts the backend computed."""
        prompt = (
            "You write a nursing shift-handoff summary for a unit using a communication aid for patients who "
            "cannot speak. For each patient, write a headline (max 15 words) and a 'watch for' sentence "
            "(max 25 words). Use ONLY the facts given; keep numbers exactly as given; do not diagnose or "
            "recommend treatment. If nothing stands out, watch_for may be an empty string.\n\n"
            f"Facts (JSON):\n{json.dumps(patients, default=str)}")
        out = await self._json(prompt, HandoffModel, LONG_TIMEOUT_S)
        if not out:
            return None
        return {p.patient_id: {"headline": p.headline, "watch_for": p.watch_for} for p in out.patients}

    # ---- research hypothesis ---------------------------------------------------------------------

    async def hypothesis(self, finding: dict) -> tuple[str, str]:
        prompt = (
            "You help a clinical lead review patterns found in synthetic patient-communication data. Write a "
            "cautious, testable hypothesis (max 60 words) explaining the pattern, then one suggested check a "
            "clinician could do. Do not claim causation or diagnose.\n\n"
            f"Pattern: {finding['title']}\nEvidence: {finding['evidence']}")
        out = await self._json(prompt, TextModel)
        if out:
            return out.text, "gemini"
        return finding.get("template_hypothesis", finding["title"]), "template"


    # ---- research agent --------------------------------------------------------------------------

    async def observation_spec(self, text: str, patients: dict, cat) -> dict | None:
        """Free-text clinician observation → test spec. The caller validates every field."""
        prompt = (
            "Turn a clinician's observation about a patient into a test spec for a research agent. "
            "Return JSON only. Use only these ids.\n"
            f"Patients: {[{'id': k, 'name': v['name'], 'chart_events': v['chart_events']} for k, v in patients.items()]}\n"
            f"Need ids: {cat.need_ids}\n"
            "type is one of: after_event (need rises after family visits end; set window_h), time_window "
            "(need concentrated in local hours; set hours as integers 0-23), rate_change (need rises after a chart "
            "event; copy its time to event_time and label to event_label), trend (patient taking longer per tap).\n"
            f"Observation: {text}")
        out = await self._json(prompt, ObservationSpec)
        if not out:
            return None
        spec = {k: v for k, v in out.model_dump().items() if v not in (None, [])}
        return spec

    async def research_digest(self, facts: dict) -> tuple[str | None, str]:
        prompt = (
            "Write a 2-4 sentence shift digest for a clinical lead about a research agent's hypotheses. Plain, "
            "factual, no causal claims, no diagnosis. Use these counts exactly.\n" + json.dumps(facts))
        out = await self._json(prompt, TextModel)
        return (out.text, "gemini") if out else (None, "template")


class ObservationSpec(BaseModel):
    type: str
    patient_id: str
    need_ids: list[str] = []
    hours: list[int] = []
    window_h: float | None = None
    event_time: str | None = None
    event_label: str | None = None


def _pct(p: float) -> str:
    return f"{round(p * 100)}%"


def template_sbar(ctx: dict) -> dict:
    top = ctx["top"]
    lead = top[0]
    alternatives = ", ".join(f"{t['label']} {_pct(t['p'])}" for t in top[1:3])
    asked = "; ".join(f"“{a['question']}” → {a['answer']}" for a in ctx.get("asked", [])) or "no questions asked"
    flagged = [l for l in ctx.get("lookups", []) if l["flag"]]
    chart = "; ".join(f"{l['label']} ({l['value']})" for l in flagged) or "no relevant chart flags"
    urgent = ctx["priority"] == "urgent"
    return {
        "situation": f"{ctx['patient_name']} (room {ctx['room']}) signalled a need via SilentSignal. "
                     f"Most likely: {lead['label']} ({_pct(lead['p'])}).",
        "background": f"{ctx['diagnosis']} Chart: {chart}.",
        "assessment": f"90% set: {', '.join(ctx['prediction_set_labels'])}. Other possibilities: {alternatives}. "
                      f"P(high-risk need) {_pct(ctx['p_high'])}. Patient answers: {asked}.",
        "recommendation": ("Bedside assessment now; high-risk need not excluded." if urgent
                           else f"Attend to {lead['label'].lower()} and confirm with the patient."),
    }
