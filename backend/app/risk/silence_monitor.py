"""Silence detection runtime: feeds the pure state machines in silence.py with time and events, and carries
out their effects (tablet prompt, message to the trusted contact, nurse alert, audit rows).

Safety ordering: anything that reaches a person (alert, prompt, message) is sent before its audit row is
written, and a failed audit write is logged, never raised. A failing tick is logged and the loop keeps
running. Nothing here calls Gemini or any network service.

Ladder state lives in memory, like the core alerts; the audit trail is persisted (silence_audit).
"""
import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..data.patients import PATIENT_BY_ID, PATIENTS, PERSON_BY_ID
from . import silence as sm
from .silence import Ladder, SilenceConfig

log = logging.getLogger(__name__)

INTERACTIONS = ("tap", "answer", "silence_check_answered")   # things only the patient does
TICK_S = 1.0
INACTIVITY_EVERY_S = 30.0


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def trusted_contact(patient_id: str) -> str | None:
    """The first non-staff person on the patient's list (pre-authorised, as for welfare checks)."""
    return next((p["id"] for p in PATIENT_BY_ID[patient_id]["people"] if "nurse" not in p["relation"]), None)


class SilenceMonitor:
    def __init__(self, svc, risk_store, cfg: SilenceConfig = SilenceConfig()):
        self.svc, self.hub, self.store, self.cfg = svc, svc.hub, risk_store, cfg
        self.started = utcnow()
        self.ladders: dict[str, Ladder] = {}
        self.alert_for: dict[str, str] = {}             # ladder id -> nurse alert id
        self.closed_at: dict[str, datetime] = {}        # patient id -> when their last ladder closed
        self.assessments: dict[str, sm.Inactivity] = {}
        self.audit: list[dict] = []                     # every row, kept even if the store write fails
        self._timeouts: dict[tuple[str, float, int], float] = {}
        self._fired: set[tuple[str, float, int]] = set()
        self._idle_stepped: set[tuple[str, float]] = set()   # prompts the ladder already stepped down on
        self._next_inactivity = self.started
        self._task: asyncio.Task | None = None

    # ---- loop ------------------------------------------------------------------------------------

    def start(self):
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _run(self):
        while True:
            try:
                await self.tick(utcnow())
            except Exception:
                log.exception("silence tick failed (continuing)")
            await asyncio.sleep(TICK_S)

    async def tick(self, now: datetime):
        await self.check_mid_dialogue(now)
        if now >= self._next_inactivity:
            self._next_inactivity = now + timedelta(seconds=INACTIVITY_EVERY_S)
            await self.check_inactivity(now)
        await self._sync_nurse_acks(now)
        for lad in list(self.ladders.values()):
            if lad.active:
                await self._apply(*sm.tick(lad, now, self.cfg), now)

    # ---- mode A ----------------------------------------------------------------------------------

    async def _latencies(self, patient_id: str) -> list[float]:
        try:
            return await self.store.recent_latencies(patient_id, self.cfg.mid_recent_taps)
        except Exception:
            log.exception("latency lookup failed; using the floor timeout")   # shorter timeout: safe side
            return []

    async def check_mid_dialogue(self, now: datetime):
        live = set()
        for s in list(self.svc.sessions.values()):
            if s.status not in sm.MID_DIALOGUE:
                continue
            key = (s.id, s.prompted_at, s.ladder.level)   # a new level can shorten the timeout
            live.add(key)
            if key in self._fired:
                continue
            if key not in self._timeouts:
                self._timeouts[key] = sm.mid_dialogue_timeout(
                    await self._latencies(s.patient["id"]), s.dialogue.fatigue(), self.cfg, s.ladder.level)
            timeout, idle = self._timeouts[key], now.timestamp() - s.prompted_at
            prompt = (s.id, s.prompted_at)
            if idle >= timeout * self.cfg.mid_idle_step_fraction and prompt not in self._idle_stepped:
                # Communication ladder: try an easier screen first. One step per prompt; the timer keeps
                # running from the same prompt, so this never delays the escalation below.
                self._idle_stepped.add(prompt)
                await self.svc.idle_step_down(s.id, idle)
                if s.status not in sm.MID_DIALOGUE:
                    continue
            if not sm.mid_dialogue_stalled(s.status, idle, timeout):
                continue
            self._fired.add(key)
            status = s.status
            alert = await self.svc.escalate_unresponsive(s.id, idle, timeout)
            if alert:
                await self._audit({"time": now, "patient_id": s.patient["id"], "ladder_id": None, "mode": "A",
                                   "event": "mid_dialogue_escalated", "step": None, "role": None, "actor": None,
                                   "detail": {"session_id": s.id, "alert_id": alert["id"], "status": status,
                                              "idle_s": round(idle, 1), "timeout_s": round(timeout, 1)}})
        self._timeouts = {k: v for k, v in self._timeouts.items() if k in live}
        self._fired &= live
        self._idle_stepped &= {k[:2] for k in live}

    # ---- mode B ----------------------------------------------------------------------------------

    async def check_inactivity(self, now: datetime):
        for p in PATIENTS:   # live patients only; the synthetic cohort is history, not a ward
            pid = p["id"]
            try:
                since = now - timedelta(days=self.cfg.baseline_days + 1)
                times = await self.store.interactions(pid, since, INTERACTIONS)
                a = sm.assess_inactivity(times, now, settings.unit_tz, self.cfg, self.started)
                self.assessments[pid] = a
                active = any(lad.active and lad.patient_id == pid for lad in self.ladders.values())
                if sm.should_start_ladder(a, active, self.closed_at.get(pid), times[-1] if times else None,
                                          now, self.cfg):
                    await self.start_ladder(pid, now, a.reason)
            except Exception:
                log.exception("inactivity check failed for %s", pid)

    async def start_ladder(self, patient_id: str, now: datetime, reason: str) -> Ladder:
        lad, effects = sm.start_ladder(uuid.uuid4().hex[:12], patient_id, trusted_contact(patient_id), now,
                                       reason, self.cfg)
        await self._apply(lad, effects, now)
        return lad

    async def acknowledge(self, ladder_id: str, step: str, role: str, actor: str, outcome: str = "ok",
                          note: str | None = None, now: datetime | None = None) -> dict:
        now = now or utcnow()
        lad, effects = sm.acknowledge(self.ladders[ladder_id], step, role, actor, now, self.cfg, outcome, note)
        if role == "patient":
            await self._log_event(lad.patient_id, "silence_check_answered", {"ladder_id": ladder_id})
        await self._apply(lad, effects, now)
        return self.public(lad)

    async def _sync_nurse_acks(self, now: datetime):
        """The nurse's Acknowledge button on the alert card confirms the alert; that closes the ladder."""
        for lid, aid in list(self.alert_for.items()):
            lad, alert = self.ladders.get(lid), self.svc.alerts.get(aid)
            if lad and lad.active and alert and alert["status"] == "confirmed":
                nurse = alert.get("confirmed_by") or "nurse"
                await self._apply(*sm.acknowledge(lad, "nurse", "nurse", nurse, now, self.cfg), now)

    # ---- effects ---------------------------------------------------------------------------------

    async def _apply(self, lad: Ladder, effects: list[dict], now: datetime):
        self.ladders[lad.id] = lad
        for e in effects:
            if e["type"] != "audit":
                try:
                    await self._effect(lad, e, now)
                except Exception:
                    log.exception("silence effect %s failed for ladder %s", e["type"], lad.id)
        if effects:
            msg = {"type": "silence_check", "ladder": self.public(lad)}
            await self.hub.publish("nurse", msg)
            if lad.contact_id and lad.step("contact"):
                await self.hub.publish(f"family:{lad.contact_id}", msg)
        for e in effects:
            if e["type"] == "audit":
                await self._audit(e)

    async def _effect(self, lad: Ladder, e: dict, now: datetime):
        pid, kind = lad.patient_id, e["type"]
        if kind == "tablet_check":
            await self.hub.publish(f"patient:{pid}", {
                "type": "welfare_check", "id": lad.id, "patient_id": pid,
                "requested_by": "SilentSignal (no recent activity)", "expires_in": self.cfg.tablet_timeout_s,
                "respond_path": f"/api/risk/silence/ladders/{lad.id}/patient_ok"})
        elif kind == "nurse_alert":
            alert = self._nurse_alert(lad, now)
            self.alert_for[lad.id] = alert["id"]
            await self.svc.raise_alert(alert)
        elif kind == "nurse_reminder":
            alert = self.svc.alerts.get(self.alert_for.get(lad.id, ""))
            if alert and alert["status"] == "open":
                alert["reason"] = f"Reminder {e['reminders']}: not acknowledged yet. {lad.reason}"
                await self.svc.raise_alert(alert)    # re-sent, so the dashboard sounds again
        elif kind == "ladder_closed":
            self.closed_at[pid] = lad.closed_at
            await self.hub.publish(f"patient:{pid}", {"type": "welfare_resolved", "id": lad.id, "patient_id": pid,
                                                      "outcome": "responded"})
            alert = self.svc.alerts.get(self.alert_for.get(lad.id, ""))
            if alert and alert["status"] == "open":   # closed by a nurse through the silence API
                await self.svc.confirm(alert["id"], None, lad.current.ack_by or "nurse")
        # message_contact needs nothing extra: _apply pushes the ladder to the contact's channel.

    def _nurse_alert(self, lad: Ladder, now: datetime) -> dict:
        p = PATIENT_BY_ID[lad.patient_id]
        contact, step = PERSON_BY_ID.get(lad.contact_id or ""), lad.step("contact")
        if not contact:
            who = "No trusted contact is on file."
        elif step and step.outcome == "concern":
            who = f"{contact['name']} ({contact['relation']}) reported a concern."
        else:
            who = f"{contact['name']} ({contact['relation']}) did not confirm they are okay in time."
        return {
            "id": uuid.uuid4().hex[:12], "patient_id": p["id"], "patient_name": p["name"], "room": p["room"],
            "session_id": None, "kind": "welfare", "priority": "urgent", "created_at": now.isoformat(),
            "status": "open", "top": [], "prediction_set": [], "p_high": 0.0, "asked": [], "lookups": [],
            "consults": [], "confirmed_need": None,
            "seconds_to_alert": round((now - lad.started_at).total_seconds()),
            "label": "No response to an inactivity check",
            "sbar": {
                "situation": f"{p['name']} (room {p['room']}) has been inactive for longer than usual and did not "
                             f"answer the tablet check. {who}",
                "background": p["diagnosis"],
                "assessment": f"{lad.reason} This notices missing interaction only; it cannot tell why.",
                "recommendation": "Check on the patient in person, then acknowledge.",
            },
            "sbar_source": "template", "reason": lad.reason,
        }

    async def _audit(self, row: dict):
        row = {k: row[k] for k in ("time", "patient_id", "ladder_id", "mode", "event", "step", "role", "actor",
                                   "detail")}
        self.audit.append(row)
        try:
            await self.store.log_silence(row)
        except Exception:
            log.exception("silence audit write failed (row kept in memory)")

    async def _log_event(self, patient_id: str, event_type: str, payload: dict):
        try:
            await self.svc.store.log_event(utcnow(), patient_id, None, event_type, payload)
        except Exception:
            log.exception("event write failed (continuing)")

    # ---- views -----------------------------------------------------------------------------------

    def public(self, lad: Ladder) -> dict:
        contact = PERSON_BY_ID.get(lad.contact_id or "")
        return lad.public() | {"patient_name": PATIENT_BY_ID[lad.patient_id]["name"],
                               "room": PATIENT_BY_ID[lad.patient_id]["room"],
                               "contact_name": contact["name"] if contact else None,
                               "alert_id": self.alert_for.get(lad.id)}

    def ladders_view(self, patient_id: str | None = None, person_id: str | None = None,
                     active: bool | None = None) -> list[dict]:
        out = [self.public(lad) for lad in self.ladders.values()
               if (patient_id is None or lad.patient_id == patient_id)
               and (person_id is None or (lad.contact_id == person_id and lad.step("contact")))
               and (active is None or lad.active == active)]
        return sorted(out, key=lambda x: x["started_at"], reverse=True)

    def status(self) -> list[dict]:
        return [{"patient_id": pid, "name": PATIENT_BY_ID[pid]["name"], "room": PATIENT_BY_ID[pid]["room"],
                 "gap_s": round(a.gap_s), "threshold_s": round(a.threshold_s), "abnormal": a.abnormal,
                 "quiet": a.quiet, "usual_s": [round(x) for x in a.usual_s], "reason": a.reason}
                for pid, a in self.assessments.items()]


def start_silence(svc, risk_store) -> SilenceMonitor | None:
    """Start the monitor. Never raises; without a risk store it reads the core store directly."""
    try:
        if risk_store is None:
            from .store import make_risk_store
            risk_store = make_risk_store(svc.store)
        monitor = SilenceMonitor(svc, risk_store)
        monitor.start()
        return monitor
    except Exception:
        log.exception("silence monitor failed to start")
        return None
