"""Gemini is used for language only: SBAR summaries, translation, simplifying caregiver questions and
wording research hypotheses. It never decides whether to escalate. Every function has a deterministic
template fallback, used when no API key is set or a call fails or times out.
"""
import asyncio
import json
import logging

from pydantic import BaseModel

from ..config import settings

log = logging.getLogger(__name__)
TIMEOUT_S = 12

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


class Gemini:
    def __init__(self, api_key: str | None = settings.gemini_api_key, model: str = settings.gemini_model):
        self.model = model
        self.client = None
        self._cache: dict[tuple[str, str], str] = {}
        if api_key:
            try:
                from google import genai
                self.client = genai.Client(api_key=api_key)
            except Exception:
                log.exception("Gemini client unavailable; using templates")

    @property
    def enabled(self) -> bool:
        return self.client is not None

    async def _json(self, prompt: str, schema: type[BaseModel]) -> BaseModel | None:
        if not self.client:
            return None
        from google.genai import types
        try:
            resp = await asyncio.wait_for(self.client.aio.models.generate_content(
                model=self.model, contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                                   temperature=0.2)), TIMEOUT_S)
            return schema.model_validate(json.loads(resp.text))
        except Exception:
            log.exception("Gemini call failed; falling back to template")
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
