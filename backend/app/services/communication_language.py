"""CommunicationLanguageService: the words the tablet shows, for the current communication mode and language.

The Adaptation Policy (engine/communication/policy.py) decides HOW to ask. This service only supplies the
text for that: simpler wording, the yes/no form, and translations. Internal ids, answer options and evidence
never change; only presentation text does.

Sources, in order
-----------------
1. Gemini (``services/gemini.py``), when enabled: structured requests per question / label
   (id, semantic intent, original text, target complexity, allowed answers). Every string is validated here
   and rejected if it is empty, too long, no longer a question, or mentions a clinical term (body part,
   symptom, need) the original didn't. Accepted text is cached; nothing waits on Gemini.
2. Deterministic fallback: the catalog's own wording (``shared/catalog.json``): ``question`` for standard and
   simplified, ``short`` for yes/no; tile and option labels as they are. Fixed UI strings have built-in
   translations for the languages the tablet offers.

Gemini never chooses answer options (they are always the catalog's, or yes / no / not sure), never changes a
mode or a probability, and never infers a language: the patient or a caregiver picks it.
"""
from __future__ import annotations

import logging
import re

from ..catalog import Catalog
from ..engine.communication.policy import MESSAGES, OFFER_ASSISTED, OFFER_AUDIO, SIMPLE_WORDING, Mode
from .gemini import Gemini

log = logging.getLogger(__name__)

MAX_WORDS = {"simple": 8, "binary": 5}
LANGUAGES = {"en": "English", "es": "Español", "fr": "Français", "zh": "中文"}
STOP = {"your", "about", "feel", "feeling", "something", "with", "want", "need", "there", "have", "does", "that",
        "this", "what", "where", "which", "like", "else", "more", "other", "none", "these", "someone"}

# Fixed tablet strings with built-in translations, so a language switch works without Gemini.
UI = {
    "en": {"where": "Where is it?", "yes": "Yes", "no": "No", "unsure": "Not sure", "something_else": "Something else",
           "somewhere_else": "Somewhere else", "back": "Back", "confirm": "Is that right?", "change": "Change",
           "get_nurse": "Get nurse", "ask_caregiver": "Ask someone I know", "keep_trying": "Keep trying",
           "read_aloud_yes": "Yes, read aloud", "no_thanks": "No, thanks", "replay": "Read again",
           "selected": "You selected"},
    "es": {"where": "¿Dónde es?", "yes": "Sí", "no": "No", "unsure": "No estoy seguro", "something_else": "Otra cosa",
           "somewhere_else": "En otro lugar", "back": "Atrás", "confirm": "¿Es correcto?", "change": "Cambiar",
           "get_nurse": "Llamar a la enfermera", "ask_caregiver": "Preguntar a alguien que conozco",
           "keep_trying": "Seguir intentando", "read_aloud_yes": "Sí, leer en voz alta", "no_thanks": "No, gracias",
           "replay": "Leer otra vez", "selected": "Usted eligió"},
    "fr": {"where": "Où est-ce ?", "yes": "Oui", "no": "Non", "unsure": "Je ne sais pas", "something_else": "Autre chose",
           "somewhere_else": "Ailleurs", "back": "Retour", "confirm": "Est-ce correct ?", "change": "Changer",
           "get_nurse": "Appeler l'infirmière", "ask_caregiver": "Demander à un proche", "keep_trying": "Continuer",
           "read_aloud_yes": "Oui, lire à voix haute", "no_thanks": "Non, merci", "replay": "Relire",
           "selected": "Vous avez choisi"},
    "zh": {"where": "在哪里？", "yes": "是", "no": "不是", "unsure": "不确定", "something_else": "其他", "somewhere_else": "其他地方",
           "back": "返回", "confirm": "对吗？", "change": "更改", "get_nurse": "叫护士", "ask_caregiver": "问认识的人",
           "keep_trying": "继续试", "read_aloud_yes": "好，读出来", "no_thanks": "不用，谢谢", "replay": "再读一遍",
           "selected": "您选择了"},
}
MESSAGE_TEXT = {
    "es": {MESSAGES[Mode.SIMPLIFIED]: "He simplificado las opciones.",
           MESSAGES[Mode.BINARY]: "Le haré preguntas sencillas de sí o no.",
           MESSAGES["up"]: "Mostrando más opciones otra vez.",
           MESSAGES["precision"]: "Haré que las opciones sean más fáciles de elegir.",
           MESSAGES["wording"]: "Se lo preguntaré de forma más sencilla.",
           MESSAGES[OFFER_AUDIO]: "¿Quiere que lea las preguntas y opciones en voz alta?",
           MESSAGES[OFFER_ASSISTED]: "¿Quiere que alguien le ayude a comunicarse?"},
    "fr": {MESSAGES[Mode.SIMPLIFIED]: "J'ai simplifié les choix.",
           MESSAGES[Mode.BINARY]: "Je vais poser des questions simples, oui ou non.",
           MESSAGES["up"]: "Plus de choix à nouveau.",
           MESSAGES["precision"]: "Je vais rendre les choix plus faciles à sélectionner.",
           MESSAGES["wording"]: "Je vais le demander plus simplement.",
           MESSAGES[OFFER_AUDIO]: "Voulez-vous que je lise les questions et les choix à voix haute ?",
           MESSAGES[OFFER_ASSISTED]: "Voulez-vous que quelqu'un vous aide à communiquer ?"},
    "zh": {MESSAGES[Mode.SIMPLIFIED]: "我已简化选项。", MESSAGES[Mode.BINARY]: "我会问简单的是或否问题。",
           MESSAGES["up"]: "重新显示更多选项。", MESSAGES["precision"]: "我会让选项更容易点选。",
           MESSAGES["wording"]: "我换个更简单的问法。", MESSAGES[OFFER_AUDIO]: "需要我把问题和选项读出来吗？",
           MESSAGES[OFFER_ASSISTED]: "需要有人帮您沟通吗？"},
}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= 4 and w not in STOP}


def complexity(mode: Mode, modifiers: frozenset[str]) -> str:
    """Which wording the current mode uses: standard, simple (shorter) or binary (shortest yes/no)."""
    if mode >= Mode.BINARY:
        return "binary"
    if mode == Mode.SIMPLIFIED or SIMPLE_WORDING in modifiers:
        return "simple"
    return "standard"


class CommunicationLanguageService:
    def __init__(self, cat: Catalog, gemini: Gemini):
        self.cat, self.gemini = cat, gemini
        # Clinical vocabulary: words naming a body part, symptom or need anywhere in the catalog. A rewrite may
        # use one only if the text it rewrites already did.
        words = [*self.cat.area_labels.values(), *self.cat.feeling_labels.values(),
                 *(n["label"] for n in self.cat.needs), *(q.text for q in self.cat.questions)]
        for spec in self.cat.raw.get("area_options", {}).values():
            words += [o["label"] for o in spec["options"]]
        self.clinical = set().union(*(_tokens(w) for w in words))
        self._rewrites: dict[tuple[str, str], str] = {}     # (complexity, original) -> accepted English rewrite

    # ---- validation (public for tests) -----------------------------------------------------------

    def valid_rewrite(self, original: str, new: str | None, max_words: int, intent: str = "") -> bool:
        if not new or not new.strip():
            return False
        new = new.strip()
        if len(new.split()) > max(max_words, len(original.split())):
            return False
        if original.rstrip().endswith("?") and not new.endswith(("?", "？")):
            return False
        # No clinical concept the original didn't have (no new body part, symptom or need).
        allowed = _tokens(original) | _tokens(intent)
        new_terms = (_tokens(new) & self.clinical) - allowed
        return not new_terms

    # ---- presentation text ---------------------------------------------------------------------

    def _items(self) -> list[dict]:
        out = []
        for q in self.cat.questions:
            intent = self.cat.by_id[q.target]["label"] if q.target in self.cat.by_id else (
                self.cat.groups[q.target]["label"] if q.target in self.cat.groups else q.text)
            out.append({"id": f"q:{q.id}", "original_text": q.text, "semantic_intent": f"ask whether it is: {intent}",
                        "allowed_answers": ["yes", "no", "unsure"]})
        for area, spec in self.cat.raw.get("area_options", {}).items():
            out.append({"id": f"prompt:{area}", "original_text": spec["prompt"],
                        "semantic_intent": f"ask what is happening in the {self.cat.area_labels[area]}",
                        "allowed_answers": [o["id"] for o in spec["options"]]})
            for o in spec["options"]:
                out.append({"id": f"option:{o['id']}", "original_text": o["label"], "semantic_intent": o["label"],
                            "allowed_answers": []})
        return out

    async def warm(self):
        """Gemini rewrites of every question, prompt and option label for 'simple' and 'binary' (one request
        each). Rejected or missing strings keep the deterministic fallback."""
        if not self.gemini.enabled:
            return
        items = self._items()
        for level in ("simple", "binary"):
            batch = [i | {"target_complexity": level, "max_words": MAX_WORDS[level]} for i in items]
            out = await self.gemini.simplify_questions(batch)
            if not out:
                continue
            kept = 0
            for i in items:
                new = out.get(i["id"])
                if self.valid_rewrite(i["original_text"], new, MAX_WORDS[level], i["semantic_intent"]):
                    self._rewrites[(level, i["original_text"])] = new.strip()
                    kept += 1
            log.info("adaptive wording (%s): kept %d of %d Gemini rewrites", level, kept, len(items))

    def question(self, question_id: str, level: str) -> str:
        """A catalog question at a complexity: Gemini's accepted rewrite, else the catalog's own wording."""
        q = self.cat.question_by_id[question_id]
        if level == "standard":
            return q.text
        if level == "binary":
            return self._rewrites.get(("binary", q.text)) or q.short or q.text
        return self._rewrites.get(("simple", q.text)) or q.text

    def label(self, text: str, level: str) -> str:
        return text if level == "standard" else self._rewrites.get((level, text), text)

    # ---- translation -------------------------------------------------------------------------------

    async def translate(self, texts: list[str], language: str) -> tuple[list[str], bool]:
        """Same count and order, or the English originals. Returns (texts, fully_translated)."""
        if language == "en" or not texts:
            return texts, True
        out = await self.gemini.translate(texts, language)
        if len(out) != len(texts) or not all(o and o.strip() for o in out):
            return texts, False   # a reply that doesn't line up with the originals is never used
        return out, out != texts

    def ui(self, language: str) -> dict[str, str]:
        return UI.get(language, UI["en"])

    def message(self, text: str | None, language: str) -> str | None:
        if not text or language == "en":
            return text
        return MESSAGE_TEXT.get(language, {}).get(text, text)
