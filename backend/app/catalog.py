"""Loads shared/catalog.json into the vectors and matrices the engines use.

All per-need vectors are lists indexed in `Catalog.need_ids` order.
"""
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .config import settings


SAFETY_QUESTION = "safety:urgent"


@dataclass
class Question:
    id: str
    text: str
    p_yes: list[float]          # P(yes | need), before patient-reliability mixing
    target: str | None = None   # need id or group id this question is about


@dataclass
class Lookup:
    id: str
    label: str
    p_true: list[float]         # P(chart field flagged | need)


class Catalog:
    def __init__(self, raw: dict, tap_background: float):
        self.raw = raw
        self.needs = raw["needs"]
        self.need_ids = [n["id"] for n in self.needs]
        self.index = {nid: i for i, nid in enumerate(self.need_ids)}
        self.by_id = {n["id"]: n for n in self.needs}
        self.n = len(self.needs)
        self.groups = {g["id"]: g for g in raw["groups"]}
        self.risk_levels = raw["risk_levels"]

        total = sum(n["prior"] for n in self.needs)
        self.base_prior = [n["prior"] / total for n in self.needs]
        self.risk = [n["risk"] for n in self.needs]
        self.group = [n["group"] for n in self.needs]
        self.miss_cost = [self.risk_levels[r]["miss_cost"] for r in self.risk]
        self.urgency = [self.risk_levels[r]["urgency"] for r in self.risk]
        self.high_risk = [r == "high" for r in self.risk]

        # cost[n][m]: cost of acting on m when the truth is n. Asymmetric: driven by the true need's
        # miss cost, discounted when the confusion stays inside the same group.
        self.cost = [[0.0 if n == m else self.miss_cost[n] * (0.75 if self.group[n] == self.group[m] else 1.0)
                      for m in range(self.n)] for n in range(self.n)]

        self.area_lik = self._tap_likelihoods("areas", raw["areas"], tap_background)
        self.feeling_lik = self._tap_likelihoods("feelings", raw["feelings"], tap_background)
        self.area_labels = {a["id"]: a["label"] for a in raw["areas"]}
        self.feeling_labels = {f["id"]: f["label"] for f in raw["feelings"]}
        self.questions = self._build_questions()
        self.question_by_id = {q.id: q for q in self.questions}
        self.lookups = [self._build_lookup(l) for l in raw["lookups"]]
        self.lookup_by_id = {l.id: l for l in self.lookups}

    def _tap_likelihoods(self, key: str, taps: list[dict], bg: float) -> dict[str, list[float]]:
        """P(tap | need), normalised over the tap vocabulary for each need. `not_sure` carries no information."""
        tap_ids = [t["id"] for t in taps]
        lik = {t: [0.0] * self.n for t in tap_ids}
        for i, need in enumerate(self.needs):
            aff = {t: need[key].get(t, bg) for t in tap_ids}
            if "not_sure" in aff:
                aff["not_sure"] = 0.3
            z = sum(aff.values())
            for t in tap_ids:
                lik[t][i] = aff[t] / z
        return lik

    def _build_questions(self) -> list[Question]:
        qs = []
        for g in self.raw["groups"]:
            qs.append(Question(f"group:{g['id']}", g["question"],
                               [0.9 if grp == g["id"] else 0.08 for grp in self.group], g["id"]))
        for i, need in enumerate(self.needs):
            p = [0.92 if j == i else (0.15 if self.group[j] == need["group"] else 0.05) for j in range(self.n)]
            qs.append(Question(f"need:{need['id']}", need["question"], p, need["id"]))
        for eq in self.raw.get("extra_questions", []):
            qs.append(Question(eq["id"], eq["text"], [eq["p_yes_by_risk"][r] for r in self.risk]))
        # Emergency screen: what the body map's chest tile and the "hard to breathe" feeling catch at once.
        # Yes/no-only dialogues (communication ladder level 3+) ask it first, since they have no taps.
        qs.append(Question(SAFETY_QUESTION, "Is it your chest or your breathing?",
                           [0.9 if high else 0.05 for high in self.high_risk]))
        return qs

    def _build_lookup(self, raw: dict) -> Lookup:
        p = []
        for nid, grp in zip(self.need_ids, self.group):
            p.append(raw["p_true"].get(nid, raw["p_true"].get(f"group:{grp}", raw["default"])))
        return Lookup(raw["id"], raw["label"], p)

    def public(self) -> dict:
        """What the frontend needs (no likelihood tables)."""
        keys = ("version", "groups", "areas", "feelings", "modes", "languages")
        out = {k: self.raw[k] for k in keys}
        out["needs"] = [{k: n[k] for k in ("id", "group", "risk", "prior", "label", "question")}
                        for n in self.needs]
        return out


def load_catalog(path: Path | None = None) -> Catalog:
    path = path or settings.shared_dir / "catalog.json"
    return Catalog(json.loads(Path(path).read_text(encoding="utf-8")), settings.engine.tap_background)


@lru_cache
def get_catalog() -> Catalog:
    return load_catalog()
