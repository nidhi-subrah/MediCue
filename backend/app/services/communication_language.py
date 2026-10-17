"""CommunicationLanguageService: the words the tablet shows for the current communication mode.

The Adaptation Policy (engine/communication/policy.py) decides HOW to ask. This service only supplies the
text for that: simpler wording and the yes/no form. Internal ids, answer options and evidence never change;
only presentation text does. The tablet is English only.

Sources, in order
-----------------
1. Gemini (``services/gemini.py``), when enabled: structured requests per question / label
   (id, semantic intent, original text, target complexity, allowed answers). Every string is validated here
   and rejected if it is empty, too long, no longer a question, or mentions a clinical term (body part,
   symptom, need) the original didn't. Accepted text is cached; nothing waits on Gemini.
2. Deterministic fallback: the catalog's own wording (``shared/catalog.json``): ``question`` for standard and
   simplified, ``short`` for yes/no; tile and option labels as they are.

Gemini never chooses answer options (they are always the catalog's, or yes / no / not sure), and never
changes a mode or a probability.
"""
from __future__ import annotations

import logging
import re

from ..catalog import Catalog
from ..engine.communication.policy import SIMPLE_WORDING, Mode
from .gemini import Gemini

log = logging.getLogger(__name__)

MAX_WORDS = {"simple": 8, "binary": 5}
STOP = {"your", "about", "feel", "feeling", "something", "with", "want", "need", "there", "have", "does", "that",
        "this", "what", "where", "which", "like", "else", "more", "other", "none", "these", "someone"}

# Fixed tablet strings.
UI = {"where": "Where is it?", "yes": "Yes", "no": "No", "unsure": "Not sure", "something_else": "Something else",
      "somewhere_else": "Somewhere else", "back": "Back", "confirm": "Is that right?", "change": "Change",
      "get_nurse": "Get nurse", "ask_caregiver": "Ask someone I know", "keep_trying": "Keep trying",
      "read_aloud_yes": "Yes, read aloud", "no_thanks": "No, thanks", "replay": "Read again",
      "selected": "You selected"}


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

    def ui(self) -> dict[str, str]:
        return dict(UI)
