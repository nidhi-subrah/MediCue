"""Patient profiles and nurse-note suggestions: the I/O side of engine/profile.py.

* At startup every patient's chart notes are sent to Gemini in the background, in a single request for
  the whole unit (the free tier allows only a few requests a minute). The returned items are
  validated (quotes must appear in the notes, ids and values must be known, high-risk needs can't be
  lowered), cached in memory and saved to the store. A profile is only re-extracted when the notes change
  (tracked by a hash of the notes).
* Sessions read the cached profile synchronously and never wait for Gemini.
* When a nurse confirms a request with a note, Gemini suggests profile items from that note. Each
  suggestion is ``pending`` (a nurse decides), ``duplicate`` (already in the profile) or ``blocked``
  (a safety rule stopped it). Approved suggestions join the profile with ``origin="nurse"`` and survive
  later re-extractions from the chart notes.

See engine/profile.py for the full feature summary.
"""
import hashlib
import logging
import uuid
from dataclasses import replace
from datetime import datetime, timezone

from ..catalog import Catalog
from ..data.patients import PATIENT_BY_ID, PATIENTS
from ..engine.profile import (PatientProfile, ProfileItem, effect_text, merge, public_items, validate_items)
from .gemini import Gemini
from .hub import Hub

log = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def notes_hash(notes: str) -> str:
    return hashlib.sha1(notes.strip().encode()).hexdigest()[:12]


class ProfileService:
    def __init__(self, cat: Catalog, store, gemini: Gemini, hub: Hub):
        self.cat, self.store, self.gemini, self.hub = cat, store, gemini, hub
        self.profiles: dict[str, PatientProfile] = {}
        self.extracting: set[str] = set()
        self._needs = [{"id": n["id"], "label": n["label"], "risk": n["risk"]} for n in cat.needs]

    # ---- helpers ---------------------------------------------------------------------------------

    @staticmethod
    def _people(pid: str) -> list[dict]:
        return [{"id": x["id"], "name": x["name"], "relation": x["relation"]} for x in PATIENT_BY_ID[pid]["people"]]

    def _names(self, pid: str) -> dict[str, str]:
        return {x["id"]: x["name"] for x in self._people(pid)}

    async def _save(self, profile: PatientProfile):
        self.profiles[profile.patient_id] = profile
        try:
            await self.store.put_profile(profile.to_dict())
        except Exception:
            log.exception("saving profile failed (kept in memory)")
        await self.hub.publish("nurse", {"type": "profile", "profile": self.public(profile.patient_id)})

    # ---- profiles --------------------------------------------------------------------------------

    def get(self, pid: str) -> PatientProfile:
        return self.profiles.get(pid) or PatientProfile(pid)

    def public(self, pid: str) -> dict:
        p = self.get(pid)
        return {"patient_id": pid, "source": p.source, "items": public_items(p, self.cat, self._names(pid)),
                "dropped": p.dropped, "updated_at": p.updated_at, "notes": PATIENT_BY_ID[pid]["notes"],
                "extracting": pid in self.extracting}

    async def warm(self):
        """Load saved profiles; extract any whose notes changed (in the background, all in parallel)."""
        stale = []
        for patient in PATIENTS:
            pid = patient["id"]
            try:
                saved = await self.store.get_profile(pid)
            except Exception:
                log.exception("loading profile failed")
                saved = None
            if saved:
                self.profiles[pid] = PatientProfile.from_dict(saved)
            if not saved or saved.get("notes_hash") != notes_hash(patient["notes"]) or saved.get("source") != "gemini":
                stale.append(pid)
        if not stale or not self.gemini.enabled:
            return
        # One request for the whole unit keeps startup inside free-tier rate limits.
        self.extracting.update(stale)
        try:
            batch = await self.gemini.extract_profiles([PATIENT_BY_ID[pid] for pid in stale], self._needs,
                                                       {pid: self._people(pid) for pid in stale})
        finally:
            self.extracting.difference_update(stale)
        for pid in stale:
            if batch is not None and pid in batch:
                await self._build(pid, batch[pid])
            else:
                await self.extract(pid)   # missing from the batch: try on its own

    async def extract(self, pid: str) -> PatientProfile:
        self.extracting.add(pid)
        try:
            raw = await self.gemini.extract_profile(PATIENT_BY_ID[pid], self._needs, self._people(pid))
        finally:
            self.extracting.discard(pid)
        return await self._build(pid, raw)

    async def _build(self, pid: str, raw: list[dict] | None) -> PatientProfile:
        patient = PATIENT_BY_ID[pid]
        nurse_items = [i for i in self.get(pid).items if i.origin == "nurse"]
        if raw is None:
            profile = PatientProfile(pid, nurse_items, [], "none", notes_hash(patient["notes"]), _now())
        else:
            items, dropped = validate_items(raw, patient["notes"], self.cat, set(self._names(pid)))
            profile = merge(PatientProfile(pid, items, dropped, "gemini", notes_hash(patient["notes"]), _now()),
                            nurse_items)
            log.info("profile %s: %d items, %d dropped", pid, len(items), len(dropped))
        await self._save(profile)
        return profile

    async def set_notes(self, pid: str, notes: str) -> dict:
        PATIENT_BY_ID[pid]["notes"] = notes.strip()
        await self.extract(pid)
        return self.public(pid)

    # ---- nurse-note suggestions (feature B) ------------------------------------------------------

    async def suggest(self, pid: str, alert_id: str | None, note: str, confirmed_need: str | None,
                      nurse: str) -> list[dict]:
        patient = PATIENT_BY_ID[pid]
        profile = self.get(pid)
        names = self._names(pid)
        current = [effect_text(i, self.cat, names) for i in profile.items]
        label = self.cat.by_id[confirmed_need]["label"] if confirmed_need else None
        raw = await self.gemini.items_from_nurse_note(patient, note, label, self._needs, self._people(pid), current)
        if not raw:
            return []
        kept, dropped = validate_items(raw, note, self.cat, set(names), origin="nurse")
        existing = {i.key() for i in profile.items}
        base = {"patient_id": pid, "patient_name": patient["name"], "room": patient["room"], "alert_id": alert_id,
                "note": note, "nurse": nurse, "reviewer": None, "reviewed_at": None}
        out = []
        for item in kept:
            dup = item.key() in existing
            out.append(base | {"status": "duplicate" if dup else "pending",
                               "reason": "Already in the profile" if dup else None,
                               "item": public_items(PatientProfile(pid, [item]), self.cat, names)[0]})
        for d in dropped:
            if d["status"] != "blocked":
                continue
            item = ProfileItem(d["kind"], d["target"], d["value"], None, d["evidence"], "nurse")
            out.append(base | {"status": "blocked", "reason": d["reason"] + ". Saved as a note only.",
                               "item": public_items(PatientProfile(pid, [item]), self.cat, names)[0]})
        for s in out:
            s.update(id=uuid.uuid4().hex[:12], created_at=_now())
            try:
                await self.store.upsert_suggestion(s)
            except Exception:
                log.exception("saving suggestion failed")
        if out:
            await self.hub.publish("nurse", {"type": "suggestions", "patient_id": pid, "suggestions": out})
        return out

    async def list_suggestions(self) -> list[dict]:
        return await self.store.list_suggestions()

    async def review(self, sid: str, approve: bool, reviewer: str) -> dict:
        found = {s["id"]: s for s in await self.store.list_suggestions()}
        s = found[sid]
        if s["status"] != "pending":
            raise ValueError(f"suggestion is {s['status']}, not pending")
        s = s | {"status": "approved" if approve else "rejected", "reviewer": reviewer, "reviewed_at": _now()}
        await self.store.upsert_suggestion(s)
        if approve:
            i = s["item"]
            item = ProfileItem(i["kind"], i["target"], i["value"], tuple(i["hours"]) if i["hours"] else None,
                               i["evidence"], "nurse")
            profile = self.get(s["patient_id"])
            await self._save(replace(merge(profile, [item]), updated_at=_now()))
        await self.hub.publish("nurse", {"type": "suggestions", "patient_id": s["patient_id"], "suggestions": [s]})
        return s
