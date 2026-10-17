"""Gemini's ranking of each area's second-step options for one patient (see engine/options.py).

One request per patient covers every area. It is made in the background when a session starts and the
cached ranking is older than CACHE_S (or was invalidated by a new nurse confirmation), so a patient never
waits for it: until it arrives, sessions rank options with the belief engine.
"""
import asyncio
import logging
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

from ..catalog import Catalog
from ..config import settings
from ..data.patients import PATIENT_BY_ID
from .gemini import Gemini

log = logging.getLogger(__name__)
CACHE_S = 15 * 60


class PredictionService:
    def __init__(self, cat: Catalog, store, gemini: Gemini, profiles=None):
        self.cat, self.store, self.gemini, self.profiles = cat, store, gemini, profiles
        self.cache: dict[str, dict] = {}         # patient id -> {"at", "rankings": {area: [{option_id, reason}]}}
        self.inflight: dict[str, asyncio.Task] = {}

    def get(self, pid: str) -> dict | None:
        c = self.cache.get(pid)
        return c if c and time.time() - c["at"] < CACHE_S else None

    def invalidate(self, pid: str):
        self.cache.pop(pid, None)

    def refresh(self, pid: str, learned: list[dict] | None = None):
        """Start a background ranking if there's no fresh one and none is running."""
        if not self.gemini.enabled or self.get(pid) or pid in self.inflight:
            return
        task = asyncio.create_task(self._rank(pid, learned or []))
        self.inflight[pid] = task
        task.add_done_callback(lambda _: self.inflight.pop(pid, None))

    async def _facts(self, pid: str, learned: list[dict]) -> dict:
        p = PATIENT_BY_ID[pid]
        now = datetime.now(timezone.utc)
        try:
            rows = await self.store.confirmations(now - timedelta(days=14), pid)
        except Exception:
            log.exception("confirmation lookup failed")
            rows = []
        label = lambda nid: self.cat.by_id[nid]["label"]   # noqa: E731
        recent = sorted(rows, key=lambda r: r["time"])[-5:]
        profile = self.profiles.public(pid)["items"] if self.profiles else []
        return {
            "patient": f"{p['name']}, {p['age']}. {p['diagnosis']}",
            "days_since_surgery": p["days_since_surgery"],
            "local_time": now.astimezone(settings.unit_tz).strftime("%H:%M"),
            "notes": p["notes"],
            "chart": {k: v["value"] + (" (flagged)" if v["flag"] else "") for k, v in p["chart"].items()},
            "confirmed_needs_last_14_days": dict(Counter(label(r["confirmed_need"]) for r in rows).most_common(8)),
            "most_recent_confirmed": [f"{r['time'].astimezone(settings.unit_tz):%a %H:%M} {label(r['confirmed_need'])}"
                                      for r in recent],
            "profile": [i["effect"] for i in profile],
            "learned_gestures": [f"{g['area_label']} + {g['feeling_label']} usually means {g['need_label']}"
                                 for g in learned],
        }

    async def _rank(self, pid: str, learned: list[dict]):
        areas = {a: spec["options"] for a, spec in self.cat.raw.get("area_options", {}).items()}
        try:
            rankings = await self.gemini.rank_area_options(await self._facts(pid, learned), areas)
        except Exception:
            log.exception("option ranking failed")
            rankings = None
        if rankings:
            self.cache[pid] = {"at": time.time(), "rankings": rankings}
            log.info("option ranking for %s: %d areas", pid, len(rankings))

    def ranking(self, pid: str, area: str) -> tuple[list[str], dict[str, str]] | None:
        """(ordered option ids, reasons) for one area, if a fresh Gemini ranking exists."""
        c = self.get(pid)
        if not c or area not in c["rankings"]:
            return None
        ranked = c["rankings"][area]
        return [r["option_id"] for r in ranked], {r["option_id"]: r["reason"] for r in ranked}
