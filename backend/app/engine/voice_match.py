"""Free, local matching of a voice transcript onto the patient's current on-screen step - no external
API call, no quota, nothing to pause or exhaust. Works off the catalog's own option labels plus a short
list of how patients actually phrase things, so the only thing a match can ever suggest is a choice the
patient could have tapped anyway (services/sessions.py still requires an explicit confirm before anything
is applied). Deliberately simple and auditable rather than a model call - see services/sessions.py
voice_utterance() for how this fits into the voice-input pipeline.
"""
import re
from difflib import SequenceMatcher
from typing import Literal

STOPWORDS = {"i", "a", "an", "the", "is", "it", "im", "i'm", "my", "me", "to", "and", "or", "in", "on",
            "at", "of", "for", "really", "very", "please", "so", "just", "am", "are", "was", "were",
            "feel", "feeling", "feels", "have", "has", "that", "this", "need", "needs", "want", "wants",
            "get", "got", "some", "can", "could", "would", "like", "bit", "little", "something",
            "somebody", "think", "help"}

# Keyed by option id (an area id for the first step, an area-option id for the second, or "yes"/"no"/
# "unsure" for a yes/no question) - common ways a patient might say the same thing, beyond the label
# itself. Not exhaustive; easy to extend without touching any matching logic.
SYNONYMS: dict[str, list[str]] = {
    "head": ["headache"], "chest": ["breast", "heart", "lungs", "ribs"],
    "belly": ["stomach", "tummy", "abdomen", "gut"], "back": ["backache", "spine"],
    "arms_legs": ["arm", "arms", "leg", "legs", "limb", "limbs", "hand", "hands", "foot", "feet", "knee",
                  "ankle", "shoulder", "hip", "wrist", "elbow"],
    "surgical_site": ["surgery", "incision", "wound", "stitches", "surgical", "scar"],
    "mouth_throat": ["face", "eye", "eyes", "ear", "ears", "nose", "nosebleed", "sinus", "mouth", "throat",
                     "tongue", "teeth", "tooth", "jaw", "swallow"],   # the "Face" area (id kept for the engine) "whole_body": ["body", "everywhere", "all over"],
    "toilet": ["washroom", "bathroom", "toilet", "pee", "urinate", "restroom", "poop"],
    "people": ["someone", "family", "visitor"],

    "head.hurts": ["hurt", "hurts", "pain", "ache", "aches", "sore"],
    "head.dizzy": ["dizzy", "lightheaded", "woozy", "nauseous"],
    "head.worried": ["worried", "confused", "scared", "anxious"],
    "head.hot": ["hot", "fever", "feverish", "warm"],
    "head.meds": ["medicine", "medication", "pills", "painkiller"],

    "chest.hurts": ["hurt", "hurts", "pain", "pressure", "tight", "tightness"],
    "chest.breathe": ["breathe", "breathing", "cant breathe", "can't breathe", "short of breath", "suffocating"],
    "chest.racing": ["racing", "pounding", "scared", "anxious"],
    "chest.sick": ["sick", "nauseous", "nausea"],
    "belly.hurts": ["hurt", "hurts", "pain", "ache", "cramps"],
    "belly.sick": ["sick", "nauseous", "vomit", "throw up"],
    "belly.washroom": ["washroom", "bathroom", "toilet", "pee", "poop", "urinate"],
    "belly.hungry": ["hungry", "food", "eat", "starving"],
    "back.hurts": ["hurt", "hurts", "pain", "ache", "sore"],
    "back.move": ["move", "turn", "shift", "reposition"],
    "back.meds": ["medicine", "medication", "pills", "painkiller"],
    "arms_legs.hurts": ["hurt", "hurts", "pain", "ache", "sore"],
    "arms_legs.stiff": ["stiff", "cramped", "numb"],
    "arms_legs.cold": ["cold", "chilly", "freezing"],
    "arms_legs.meds": ["medicine", "medication", "pills", "painkiller"],
    "surgical_site.hurts": ["hurt", "hurts", "pain", "sore"],
    "surgical_site.meds": ["medicine", "medication", "pills", "painkiller"],
    "surgical_site.sick": ["sick", "nauseous"],
    "surgical_site.move": ["move", "shift", "reposition", "uncomfortable"],
    "mouth_throat.thirsty": ["thirsty", "water", "drink", "dry mouth", "mouth is dry", "dry"],
    "mouth_throat.hungry": ["hungry", "food", "eat"],
    "mouth_throat.eyes": ["eye", "eyes", "vision", "blurry", "can't see", "cant see"],
    "mouth_throat.nose": ["nose", "nosebleed", "sinus", "stuffy", "blocked", "runny"],
    "mouth_throat.ears": ["ear", "ears", "hearing", "can't hear", "cant hear", "ringing"],
    "mouth_throat.mouth": ["throat", "sore throat", "swallow", "swallowing", "tongue", "teeth", "tooth", "jaw"],
    "mouth_throat.choking": ["choking", "cant breathe", "can't breathe", "stuck"],
    "mouth_throat.sick": ["sick", "nauseous"],
    "whole_body.hot": ["hot", "warm", "feverish"],
    "whole_body.cold": ["cold", "chilly", "freezing"],
    "whole_body.position": ["move", "reposition", "shift", "turn"],
    "whole_body.wet": ["wet", "soiled", "need changing", "diaper"],
    "whole_body.sick": ["sick", "nauseous"],
    "whole_body.breathe": ["breathe", "breathing", "short of breath"],
    "people.scared": ["scared", "worried", "anxious", "afraid"],
    "people.someone": ["someone", "company", "visit"],
    "people.lonely": ["lonely", "alone"],
    "people.meds": ["medicine", "medication", "question about medicine"],

    "yes": ["yeah", "yep", "correct", "that's right"],
    "no": ["nope", "not really", "negative"],
    "unsure": ["not sure", "i don't know", "dont know", "maybe"],
}

# What a patient might be getting at, by feeling concept (an option's "feeling" in the catalog), and which
# concept to fall back to when the one they named isn't offered on this step - e.g. at the belly there is no
# "medicine" choice, but "Hurts" is what asking for medicine most plausibly means.
CONCEPT_WORDS: dict[str, list[str]] = {
    "pain": ["hurt", "hurts", "hurting", "pain", "painful", "ache", "aches", "aching", "sore", "cramp", "cramps",
             "stabbing", "throbbing", "burning"],
    "medicine": ["medicine", "medication", "meds", "pills", "pill", "painkiller", "painkillers", "drug", "dose"],
    "sick": ["sick", "nauseous", "nausea", "vomit", "vomiting", "throw up", "throwing up", "threw up", "queasy"],
    "need_toilet": ["washroom", "bathroom", "toilet", "pee", "poop", "urinate", "bowel", "restroom", "wet"],
    "hungry": ["hungry", "food", "eat", "starving"],
    "thirsty": ["thirsty", "water", "drink", "dry mouth"],
    "too_hot": ["hot", "fever", "feverish", "warm", "sweating"],
    "too_cold": ["cold", "chilly", "freezing", "shivering"],
    "uncomfortable": ["move", "turn", "shift", "reposition", "stiff", "uncomfortable", "position", "sit up", "lie down"],
    "scared": ["scared", "worried", "anxious", "afraid", "nervous", "panic", "confused"],
    "want_someone": ["someone", "nurse", "family", "lonely", "alone", "company", "visit"],
    "hard_to_breathe": ["breathe", "breathing", "breath", "choking"],
}
RELATED: dict[str, list[str]] = {
    "medicine": ["pain"], "scared": ["want_someone"], "want_someone": ["scared"],
    "need_toilet": ["uncomfortable"], "hungry": ["thirsty"], "thirsty": ["hungry"],
}

# Explicit urgency / help-now wording only - never a diagnosis. Hearing one escalates straight to the nurse
# (services/sessions.py), without the patient having to answer anything first. Deliberately NOT here: plain
# "help me" ("can somebody help me get up" is a movement request), or fear ("I'm scared" has its own choice).
URGENT_PHRASES = [
    "urgent", "urgently", "emergency", "911", "nine one one",
    "can't breathe", "cant breathe", "cannot breathe", "trouble breathing", "hard to breathe",
    "difficulty breathing", "chest pain", "heart attack", "bleeding", "choking",
    "severe pain", "unbearable", "help me now", "need help now", "help now", "call a nurse now",
    "need a nurse now", "nurse now", "dying", "passing out", "fainting",
]

# Every area's second step ends with a "None of these" option (id "<area>.none", see engine/options.py).
NONE_PHRASES = ["none", "none of them", "none of these", "none of those", "neither", "nothing"]

CLARIFYING = {
    "area": "Which part of your body? You can also tap the picture below.",
    "feeling": "I'm not sure which one you mean. You can tap one of the choices below.",
    "question": "I'm not sure if that's a yes or no. You can tap Yes, No or Not sure below.",
}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z']+", text.lower()) if w not in STOPWORDS}


def _phrase_present(text: str, phrase: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", text) is not None


def detect_urgent(transcript: str) -> bool:
    low = transcript.lower()
    return any(_phrase_present(low, p) for p in URGENT_PHRASES)


def match_option(transcript: str, options: list[dict]) -> tuple[str | None, Literal["clear", "partial", "unclear"]]:
    """Best-matching option id for this transcript among `options` ({"id", "label"}). "clear" when one
    option is the unambiguous best match, "partial" when it's ahead but a near-tie, "unclear" (None) when
    nothing scores or two options tie for best."""
    low = transcript.lower()
    t_tokens = _tokens(transcript)
    if not t_tokens:
        return None, "unclear"
    scored: list[tuple[str, float]] = []
    for o in options:
        label_tokens = _tokens(o["label"])
        extra = NONE_PHRASES if o["id"].endswith(".none") else SYNONYMS.get(o["id"], [])
        candidates = {o["label"].lower(), *extra}
        hits = sum(1 for c in candidates if _phrase_present(low, c))
        overlap = len(t_tokens & label_tokens)
        fuzzy = 0.5 if not hits and not overlap and label_tokens and any(
            SequenceMatcher(None, tt, lt).ratio() > 0.82 for tt in t_tokens for lt in label_tokens) else 0.0
        scored.append((o["id"], hits * 2 + overlap + fuzzy))
    scored.sort(key=lambda x: -x[1])
    best_id, best_score = scored[0]
    second_score = scored[1][1] if len(scored) > 1 else 0.0
    if best_score <= 0:
        return _infer(low, options)
    if best_score > second_score + 1:
        return best_id, "clear"
    if best_score > second_score:
        return best_id, "partial"
    return None, "unclear"   # tied best guesses - genuinely ambiguous


def _infer(low: str, options: list[dict]) -> tuple[str | None, Literal["clear", "partial", "unclear"]]:
    """Nothing matched the option labels/synonyms: go by what the patient is getting at. An option whose
    feeling is what they said, or failing that the closest related feeling (RELATED), is applied as a clear
    match. Needs this step's options to carry feelings."""
    by_concept: dict[str, str] = {}
    for o in options:
        if o.get("concept"):
            by_concept.setdefault(o["concept"], o["id"])
    if not by_concept:
        return None, "unclear"
    said = [c for c, words in CONCEPT_WORDS.items() if any(_phrase_present(low, w) for w in words)]
    for concept in said:
        if concept in by_concept:
            return by_concept[concept], "clear"
    for concept in said:
        for related in RELATED.get(concept, []):
            if related in by_concept:
                return by_concept[related], "clear"
    return None, "unclear"
