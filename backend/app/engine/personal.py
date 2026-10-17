"""Per-patient gesture learning: what *this* patient's taps mean, learned from nurse confirmations.

The catalog says what a tap usually means (P(tap | need), the same for everyone). Some patients have their
own vocabulary: after a stroke Wei Chen may touch his head to mean "move my pillow". Every time a nurse
confirms what the patient actually needed, we count the taps that preceded it, and the patient's
likelihoods become

    P_patient(tap | need) = (α · P_catalog(tap | need) + count(tap, need)) / (α + count(need))

a Dirichlet update with the catalog as α pseudo-observations. With no history it is exactly the catalog;
after a few consistent confirmations the patient's own pattern dominates.

Safety: these likelihoods only feed the engine's decision belief (which question to ask, what label to
send). The safety floor keeps reading taps with the catalog likelihoods, so learning can make a patient
faster to understand but can never talk the engine out of escalating a high-risk signal.
"""
from collections import defaultdict
from dataclasses import dataclass, field

from ..catalog import Catalog
from .belief import mix_reliability

ALPHA = 4.0          # how many confirmations the catalog's general meaning is worth
SHOW_MIN_COUNT = 2   # a gesture appears as "learned" after this many matching confirmations


@dataclass
class PersonalModel:
    alpha: float = ALPHA
    tap_need: dict[tuple[str, str], dict[str, int]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    need_kind: dict[tuple[str, str], int] = field(default_factory=lambda: defaultdict(int))
    pairs: dict[tuple[str, str], dict[str, int]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    n: int = 0

    @classmethod
    def from_rows(cls, rows: list[dict], alpha: float = ALPHA) -> "PersonalModel":
        m = cls(alpha=alpha)
        for r in rows:
            m.add(r.get("area"), r.get("feeling"), r["confirmed_need"])
        return m

    def add(self, area: str | None, feeling: str | None, need: str):
        if not area and not feeling:
            return
        for kind, tap in (("area", area), ("feeling", feeling)):
            if tap:
                self.tap_need[(kind, tap)][need] += 1
                self.need_kind[(kind, need)] += 1
        if area and feeling:
            self.pairs[(area, feeling)][need] += 1
        self.n += 1

    def likelihood(self, cat: Catalog, kind: str, tap_id: str, reliability: float) -> list[float]:
        table = cat.area_lik if kind == "area" else cat.feeling_lik
        base = table[tap_id]
        counts = self.tap_need.get((kind, tap_id), {})
        p = [(self.alpha * base[i] + counts.get(nid, 0)) / (self.alpha + self.need_kind.get((kind, nid), 0))
             for i, nid in enumerate(cat.need_ids)]
        return mix_reliability(p, reliability, 1.0 / len(table))

    def learned_signals(self, cat: Catalog) -> list[dict]:
        """Gestures (area + feeling) that have consistently meant the same need for this patient."""
        out = []
        for (area, feeling), needs in self.pairs.items():
            total = sum(needs.values())
            need, count = max(needs.items(), key=lambda kv: kv[1])
            if count < SHOW_MIN_COUNT:
                continue
            usual = _usual_reading(cat, area, feeling)
            out.append({
                "area": area, "area_label": cat.area_labels[area],
                "feeling": feeling, "feeling_label": cat.feeling_labels[feeling],
                "need": need, "need_label": cat.by_id[need]["label"], "count": count, "of": total,
                "usual_need": usual, "usual_label": cat.by_id[usual]["label"],
                "personal": usual != need,   # differs from what the gesture means for most patients
            })
        return sorted(out, key=lambda s: (-s["personal"], -s["count"]))


def _usual_reading(cat: Catalog, area: str, feeling: str) -> str:
    """The need the catalog alone would pick for this gesture (base prior × both tap likelihoods)."""
    scores = [cat.base_prior[i] * cat.area_lik[area][i] * cat.feeling_lik[feeling][i] for i in range(cat.n)]
    return cat.need_ids[max(range(cat.n), key=scores.__getitem__)]
