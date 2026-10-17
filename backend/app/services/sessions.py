"""Live sessions: wraps the pure Dialogue with I/O (alerts, consults, welfare checks, logging, pushes).

Ordering rule on the escalation path: build the alert from templates and push it to nurses first;
logging and Gemini enrichment happen afterwards and may fail without affecting the alert.
"""
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from ..catalog import Catalog
from ..config import EngineConfig, settings
from ..data.patients import PATIENT_BY_ID, PERSON_BY_ID
from ..engine.belief import PriorContext, context_prior, entropy
from ..engine.conformal import ConformalPredictor
from ..engine.decision import Consultant, Decision
from ..engine.dialogue import Dialogue
from .gemini import Gemini, template_sbar
from .hub import Hub
from .research import prior_multipliers

log = logging.getLogger(__name__)

FATIGUE_SWITCH = 2.0

PROMPTS = {
    "prompt:area": "Where is it?",
    "prompt:feeling": "What is it like?",
    "prompt:question": "Please answer",
    "yes": "Yes", "no": "No", "unsure": "Not sure",
    "help_coming": "Help is coming. A nurse has your message.",
    "sent": "Your nurse has your message.",
    "tell_more": "You can tell us more:",
    "asking": "Asking someone who knows you…",
    "keep_going": "Keep going myself",
    "welfare": "Are you okay? Tap anywhere.",
    "start_over": "Start again",
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def clip(r: float) -> float:
    return min(max(r, 0.55), 0.97)


@dataclass
class Session:
    id: str
    patient: dict
    dialogue: Dialogue
    mode: str
    language: str
    prior_reasons: list[str]
    status: str = "area"
    question_id: str | None = None
    consult_id: str | None = None
    alert_id: str | None = None
    decision: Decision | None = None
    started: float = field(default_factory=time.time)
    belief_step: int = 0
    consult_answers: list[tuple[str, str | None]] = field(default_factory=list)  # (person id, need id)


class SessionService:
    def __init__(self, cat: Catalog, cfg: EngineConfig, store, hub: Hub, gemini: Gemini, conformal: ConformalPredictor):
        self.cat, self.cfg, self.store, self.hub, self.gemini, self.conformal = cat, cfg, store, hub, gemini, conformal
        self.sessions: dict[str, Session] = {}
        self.alerts: dict[str, dict] = {}
        self.consults: dict[str, dict] = {}
        self.welfare: dict[str, dict] = {}
        self._ui_cache: dict[str, dict] = {}
        self._tasks: set[asyncio.Task] = set()

    # ---- helpers ---------------------------------------------------------------------------------

    def _spawn(self, coro):
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _safe(self, coro):
        try:
            await coro
        except Exception:
            log.exception("store write failed (continuing)")

    async def _event(self, s_or_pid, event_type: str, payload: dict):
        if isinstance(s_or_pid, Session):
            pid, sid = s_or_pid.patient["id"], s_or_pid.id
        else:
            pid, sid = s_or_pid, None
        await self._safe(self.store.log_event(now(), pid, sid, event_type, payload))

    async def _log_belief(self, s: Session):
        s.belief_step += 1
        belief = {nid: round(p, 5) for nid, p in zip(self.cat.need_ids, s.dialogue.belief)}
        await self._safe(self.store.log_belief(now(), s.patient["id"], s.id, s.belief_step, belief))

    async def _log_decision(self, s: Session, d: Decision):
        """Every candidate the decision engine scored this cycle, not just the one it chose — the raw
        material for a nurse-facing decision trace and for the research agent's CHECK_DATA queries."""
        cycle_id = uuid.uuid4().hex[:10]
        rows = []
        for rank, a in enumerate(d.ranked):
            pub = a.public()
            costs = dict(pub["costs"])
            rows.append({
                "time": now(), "patient_id": s.patient["id"], "session_id": s.id, "decision_cycle": cycle_id,
                "kind": a.kind, "action_id": a.id, "label": a.label, "eig": pub["eig"],
                "fatigue_cost": costs.pop("fatigue", None), "delay_cost": costs.pop("delay", None),
                "other_costs": costs, "value": pub["value"], "score": pub["score"],
                "selected": a is d.chosen, "rank": rank, "origin": "live_demo",
            })
        await self._safe(self.store.log_decision_actions(rows))

    async def reliability(self, key: str, default: tuple[float, float]) -> tuple[float, float]:
        try:
            return await self.store.get_reliability(key) or default
        except Exception:
            log.exception("reliability lookup failed")
            return default

    async def ui_text(self, lang: str) -> dict:
        if lang not in self._ui_cache:
            keys = list(PROMPTS) + [f"area:{a['id']}" for a in self.cat.raw["areas"]] + \
                   [f"feeling:{f['id']}" for f in self.cat.raw["feelings"]]
            english = list(PROMPTS.values()) + [a["label"] for a in self.cat.raw["areas"]] + \
                      [f["label"] for f in self.cat.raw["feelings"]]
            translated = await self.gemini.translate(english, lang)
            text = dict(zip(keys, translated))
            if lang != "en" and translated == english:
                return text  # translation unavailable; don't cache so we retry later
            self._ui_cache[lang] = text
        return self._ui_cache[lang]

    async def patient_view(self, pid: str) -> dict:
        p = PATIENT_BY_ID[pid]
        a, b = await self.reliability(f"patient:{pid}", (p["signal"]["a"], p["signal"]["b"]))
        people = []
        for person in p["people"]:
            pa, pb = await self.reliability(f"person:{person['id']}", (person["a"], person["b"]))
            people.append({"id": person["id"], "name": person["name"], "relation": person["relation"],
                           "reliability": round(pa / (pa + pb), 3), "patient_id": pid})
        return {k: p[k] for k in ("id", "name", "age", "room", "diagnosis", "language", "days_since_surgery",
                                  "notes", "chart", "chart_events")} | \
            {"people": people, "signal_reliability": round(a / (a + b), 3)}

    # ---- session lifecycle -----------------------------------------------------------------------

    async def start(self, patient_id: str, language: str | None = None, mode: str = "grid") -> dict:
        p = PATIENT_BY_ID[patient_id]
        view = await self.patient_view(patient_id)
        local_hour = now().astimezone(settings.unit_tz).hour
        try:
            history = await self.store.history_counts(patient_id)
            visits = await self.store.events_of_type("family_visit", now() - timedelta(hours=12), patient_id)
            last_end = max((datetime.fromisoformat(v["payload"]["end"]) for v in visits), default=None)
            mult = await prior_multipliers(self.store, patient_id, local_hour, last_end)
        except Exception:
            log.exception("context lookup failed; using base prior")
            history, mult = {}, {}
        prior, reasons = context_prior(self.cat, PriorContext(
            hour=local_hour, days_since_surgery=p["days_since_surgery"],
            history_counts=history, multipliers=mult))
        consultants = [Consultant(x["id"], x["name"], x["relation"], clip(x["reliability"])) for x in view["people"]]
        d = Dialogue(self.cat, self.cfg, prior, clip(view["signal_reliability"]), consultants,
                     {k: v["flag"] for k, v in p["chart"].items()})
        s = Session(uuid.uuid4().hex[:12], p, d, mode, language or p["language"], reasons)
        self.sessions[s.id] = s
        await self._event(s, "session_started", {"mode": mode, "language": s.language, "prior_reasons": reasons})
        await self._log_belief(s)
        return await self.state(s)

    async def tap(self, sid: str, kind: str, tap_id: str) -> dict:
        s = self.sessions[sid]
        refining = s.status == "escalated" and kind == "feeling" and s.dialogue.feeling is None
        if not refining and s.status != kind:
            raise ValueError(f"expected a {s.status} input, got {kind} tap")
        s.dialogue.apply_tap(kind, tap_id)
        await self._event(s, "tap", {"kind": kind, "tap": tap_id})
        await self._log_belief(s)
        if refining:
            await self._refresh_alert(s)
            return await self.state(s, publish=True)
        return await self._advance(s)

    async def answer(self, sid: str, question_id: str, answer: str) -> dict:
        s = self.sessions[sid]
        if s.status != "question" or s.question_id != question_id:
            raise ValueError("no such open question")
        s.dialogue.apply_answer(question_id, answer)
        await self._event(s, "answer", {"question": question_id, "answer": answer})
        await self._log_belief(s)
        return await self._advance(s)

    async def set_mode(self, sid: str, mode: str, reason: str = "user") -> dict:
        s = self.sessions[sid]
        if mode != s.mode:
            await self._event(s, "mode_changed", {"from": s.mode, "to": mode, "reason": reason})
            s.mode = mode
        return await self.state(s, publish=True)

    async def skip_consult(self, sid: str) -> dict:
        s = self.sessions[sid]
        if s.status != "waiting_consult":
            return await self.state(s)
        return await self._advance(s)

    async def _advance(self, s: Session) -> dict:
        before = len(s.dialogue.lookup_results)
        d = s.dialogue.step()
        for lid, label, flag in s.dialogue.lookup_results[before:]:
            await self._event(s, "lookup", {"lookup": lid, "flag": flag})
        s.decision = d
        self._spawn(self._log_decision(s, d))
        kind = d.chosen.kind
        s.question_id = None
        if s.mode == "grid" and s.dialogue.fatigue() >= FATIGUE_SWITCH and kind in ("ask", "tap"):
            # Adaptive access: tiring patients get larger, fewer targets.
            await self._event(s, "mode_changed", {"from": s.mode, "to": "large", "reason": "fatigue"})
            s.mode = "large"
        if kind == "escalate":
            s.status = "escalated"
            s.dialogue.attach_context()
            await self._create_alert(s, "urgent")
        elif kind == "send":
            s.status = "sent"
            await self._create_alert(s, "routine")
        elif kind == "tap":
            s.status = "feeling" if s.dialogue.area else "area"
        elif kind == "ask":
            s.status, s.question_id = "question", d.chosen.id
        elif kind == "consult":
            s.status = "waiting_consult"
            await self._create_consult(s, d.chosen.id)
        await self._event(s, "decision", {"chosen": d.chosen.public(), "reason": d.reason,
                                          "ranked": [a.public() for a in d.ranked[:5]]})
        if len(s.dialogue.lookup_results) > before:
            await self._log_belief(s)
        return await self.state(s, publish=True)

    async def state(self, s: Session, publish: bool = False) -> dict:
        d = s.dialogue
        question = None
        ui = await self.ui_text(s.language)
        if s.question_id:
            text = self.cat.question_by_id[s.question_id].text
            question = {"id": s.question_id, "text": text,
                        "text_local": (await self.gemini.translate([text], s.language))[0]}
        consult = None
        if s.consult_id and s.status == "waiting_consult":
            c = self.consults[s.consult_id]
            consult = {"id": c["id"], "person_name": c["person_name"], "relation": c["relation"]}
        out = {
            "session_id": s.id, "patient_id": s.patient["id"], "status": s.status, "mode": s.mode,
            "language": s.language, "question": question, "consult": consult,
            "belief": d.top(6), "prediction_set": self.conformal.predict_set(self.cat.need_ids, d.belief),
            "p_high": round(d.p_high(), 4), "entropy": round(entropy(d.belief), 3),
            "fatigue": round(d.fatigue(), 2), "taps": d.taps, "questions_asked": d.questions_asked,
            "last_decision": s.decision.public() if s.decision else None,
            "trace": [t.public() for t in d.trace], "alert_id": s.alert_id, "ui_text": ui,
            "prior_reasons": s.prior_reasons,
        }
        if publish:
            await self.hub.publish(f"patient:{s.patient['id']}", {"type": "session", "session": out})
        return out

    # ---- alerts ----------------------------------------------------------------------------------

    def _alert_context(self, s: Session, priority: str) -> dict:
        d, p = s.dialogue, s.patient
        pset = self.conformal.predict_set(self.cat.need_ids, d.belief)
        return {
            "patient_name": p["name"], "room": p["room"], "diagnosis": p["diagnosis"], "priority": priority,
            "top": d.top(5), "prediction_set": pset,
            "prediction_set_labels": [self.cat.by_id[n]["label"] for n in pset],
            "p_high": round(d.p_high(), 4),
            "taps": [self.cat.area_labels.get(d.area, "-"), self.cat.feeling_labels.get(d.feeling, "-")],
            "asked": [{"question": q, "answer": a} for q, a in d.answers],
            "lookups": [{"label": label, "value": p["chart"][lid]["value"], "flag": flag}
                        for lid, label, flag in d.lookup_results],
            "consults": [{"person": who, "answer": ans} for who, ans in d.consult_answers],
            "language": s.language,
        }

    async def _create_alert(self, s: Session, priority: str):
        ctx = self._alert_context(s, priority)
        first_tap = s.dialogue.tap_times[0] if s.dialogue.tap_times else s.started
        alert = {
            "id": uuid.uuid4().hex[:12], "patient_id": s.patient["id"], "patient_name": s.patient["name"],
            "room": s.patient["room"], "session_id": s.id, "kind": "need", "priority": priority,
            "created_at": now().isoformat(), "status": "open",
            "top": ctx["top"], "prediction_set": ctx["prediction_set"], "p_high": ctx["p_high"],
            "asked": ctx["asked"], "lookups": ctx["lookups"], "consults": ctx["consults"],
            "sbar": template_sbar(ctx), "sbar_source": "template", "confirmed_need": None,
            "seconds_to_alert": round(time.time() - first_tap, 1),
            "reason": s.decision.reason if s.decision else "",
        }
        s.alert_id = alert["id"]
        self.alerts[alert["id"]] = alert
        await self.hub.publish("nurse", {"type": "alert", "alert": alert})   # nurse first, always
        await self._event(s, "escalated" if priority == "urgent" else "notified",
                          {"alert_id": alert["id"], "top": ctx["top"][:3], "p_high": ctx["p_high"]})
        self._spawn(self._enrich(alert["id"], ctx))

    async def _refresh_alert(self, s: Session):
        alert = self.alerts.get(s.alert_id or "")
        if not alert:
            return
        ctx = self._alert_context(s, alert["priority"])
        alert.update({k: ctx[k] for k in ("top", "prediction_set", "p_high", "lookups")})
        alert["sbar"], alert["sbar_source"] = template_sbar(ctx), "template"
        await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})
        self._spawn(self._enrich(alert["id"], ctx))

    async def _enrich(self, alert_id: str, ctx: dict):
        if not self.gemini.enabled:
            return
        sbar, source = await self.gemini.sbar(ctx)
        alert = self.alerts.get(alert_id)
        if alert and source == "gemini":
            alert["sbar"], alert["sbar_source"] = sbar, source
            await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})

    async def confirm(self, alert_id: str, need_id: str | None, nurse: str = "nurse") -> dict:
        alert = self.alerts[alert_id]
        alert["status"], alert["confirmed_need"] = "confirmed", need_id
        s = self.sessions.get(alert["session_id"] or "")
        if s and need_id:
            await self._learn(s, alert, need_id)
        await self._event(alert["patient_id"], "nurse_confirmed",
                          {"alert_id": alert_id, "need": need_id, "nurse": nurse,
                           "predicted": alert["top"][0]["need"] if alert["top"] else None})
        await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})
        return alert

    async def _learn(self, s: Session, alert: dict, need_id: str):
        d, pid, i = s.dialogue, s.patient["id"], self.cat.index[need_id]
        gaps = [b - a for a, b in zip(d.tap_times, d.tap_times[1:])]
        row = {
            "time": now(), "patient_id": pid, "session_id": s.id, "predicted_need": alert["top"][0]["need"],
            "confirmed_need": need_id, "confirmed_group": self.cat.group[i], "risk": self.cat.risk[i],
            "correct": alert["top"][0]["need"] == need_id, "escalated": alert["priority"] == "urgent",
            "taps": d.taps, "questions": d.questions_asked, "resolve_seconds": alert["seconds_to_alert"],
            "mean_tap_interval": round(sum(gaps) / len(gaps), 2) if gaps else 0.0, "mode": s.mode,
        }
        await self._safe(self.store.log_confirmation(row))
        # Source reliability: Beta updates. The patient's signals count as reliable when the confirmed
        # need was inside the conformal set; a consulted person is right when they named it.
        p = s.patient
        a, b = await self.reliability(f"patient:{pid}", (p["signal"]["a"], p["signal"]["b"]))
        hit = need_id in alert["prediction_set"]
        await self._safe(self.store.set_reliability(f"patient:{pid}", a + hit, b + (not hit)))
        for person_id, said in s.consult_answers:
            if said == "unsure":
                continue
            person = PERSON_BY_ID[person_id]
            a, b = await self.reliability(f"person:{person_id}", (person["a"], person["b"]))
            right = said == need_id
            await self._safe(self.store.set_reliability(f"person:{person_id}", a + right, b + (not right)))

    # ---- consults --------------------------------------------------------------------------------

    async def _create_consult(self, s: Session, person_id: str):
        person = PERSON_BY_ID[person_id]
        options = s.dialogue.consult_options()
        s.dialogue.mark_consulted(person_id)
        labels = [self.cat.by_id[n]["label"] for n in options]
        taps = [self.cat.area_labels.get(s.dialogue.area, ""), self.cat.feeling_labels.get(s.dialogue.feeling, "")]
        c = {
            "id": uuid.uuid4().hex[:12], "session_id": s.id, "patient_id": s.patient["id"],
            "patient_name": s.patient["name"], "person_id": person_id, "person_name": person["name"],
            "relation": person["relation"],
            "question": f"{s.patient['name'].split()[0]} tapped: {', '.join(t for t in taps if t)}. "
                        "Which of these do you think they mean?",
            "options": [{"need": n, "label": l} for n, l in zip(options, labels)],
            "status": "pending", "created_at": now().isoformat(), "answer": None,
        }
        self.consults[c["id"]] = c
        s.consult_id = c["id"]
        await self.hub.publish(f"family:{person_id}", {"type": "consult", "consult": c})
        await self._event(s, "consult_requested", {"consult_id": c["id"], "person": person_id, "options": options})
        self._spawn(self._reword_consult(c, labels, taps))
        self._spawn(self._expire_consult(c["id"]))

    async def _reword_consult(self, c: dict, labels: list[str], taps: list[str]):
        if not self.gemini.enabled:
            return
        c["question"] = await self.gemini.family_question(c["patient_name"], c["relation"], labels, taps)
        if c["status"] == "pending":
            await self.hub.publish(f"family:{c['person_id']}", {"type": "consult", "consult": c})

    async def _expire_consult(self, cid: str):
        await asyncio.sleep(settings.consult_timeout_s)
        c = self.consults.get(cid)
        if c and c["status"] == "pending":
            c["status"] = "expired"
            s = self.sessions.get(c["session_id"])
            if s and s.status == "waiting_consult" and s.consult_id == cid:
                await self._advance(s)

    async def answer_consult(self, cid: str, answer: str | None) -> dict:
        """answer: a need id from the options, None for 'something else', or 'unsure'."""
        c = self.consults[cid]
        if c["status"] != "pending":
            raise ValueError("consult is no longer open")
        c["status"], c["answer"] = "answered", answer
        s = self.sessions.get(c["session_id"])
        if s and s.status not in ("escalated", "sent"):
            person = next(x for x in s.dialogue.consultants if x.id == c["person_id"])
            s.dialogue.apply_consult(person, [o["need"] for o in c["options"]], answer)
            s.consult_answers.append((person.id, answer))
            await self._event(s, "consult_answered", {"consult_id": cid, "answer": answer})
            await self._log_belief(s)
            if s.status in ("waiting_consult", "question"):
                await self._advance(s)
        return c

    def consults_for(self, person_id: str) -> list[dict]:
        return sorted((c for c in self.consults.values() if c["person_id"] == person_id),
                      key=lambda c: c["created_at"], reverse=True)

    # ---- welfare checks (KAZE extension) ---------------------------------------------------------

    async def start_welfare(self, patient_id: str, requested_by: str) -> dict:
        """A pre-authorised caregiver asks the patient to respond. No response in time → nurse alert.

        This detects *no response to a prompt*, nothing more; it does not detect unconsciousness.
        """
        person = PERSON_BY_ID.get(requested_by)
        if not person or person["patient_id"] != patient_id:
            raise PermissionError("only caregivers pre-authorised for this patient can request a welfare check")
        w = {"id": uuid.uuid4().hex[:12], "patient_id": patient_id, "requested_by": person["name"],
             "relation": person["relation"], "status": "pending", "created_at": now().isoformat(),
             "expires_in": settings.welfare_timeout_s, "person_id": requested_by}
        self.welfare[w["id"]] = w
        await self.hub.publish(f"patient:{patient_id}", {"type": "welfare_check", "id": w["id"],
                                                         "patient_id": patient_id, "requested_by": person["name"],
                                                         "expires_in": settings.welfare_timeout_s})
        await self._event(patient_id, "welfare_check_started", {"id": w["id"], "requested_by": requested_by})
        self._spawn(self._welfare_timeout(w["id"]))
        return w

    async def respond_welfare(self, wid: str) -> dict:
        w = self.welfare[wid]
        if w["status"] == "pending":
            w["status"] = "responded"
            await self._welfare_resolved(w)
        return w

    async def _welfare_timeout(self, wid: str):
        await asyncio.sleep(settings.welfare_timeout_s)
        w = self.welfare.get(wid)
        if not w or w["status"] != "pending":
            return
        w["status"] = "no_response"
        p = PATIENT_BY_ID[w["patient_id"]]
        alert = {
            "id": uuid.uuid4().hex[:12], "patient_id": p["id"], "patient_name": p["name"], "room": p["room"],
            "session_id": None, "kind": "welfare", "priority": "urgent", "created_at": now().isoformat(),
            "status": "open", "top": [], "prediction_set": [], "p_high": 0.0, "asked": [], "lookups": [],
            "consults": [], "confirmed_need": None, "seconds_to_alert": settings.welfare_timeout_s,
            "sbar": {
                "situation": f"{p['name']} (room {p['room']}) did not respond to a welfare check requested by "
                             f"{w['requested_by']} ({w['relation']}).",
                "background": p["diagnosis"],
                "assessment": f"No tap within {int(settings.welfare_timeout_s)} s of the prompt. Cause unknown; "
                              "this is not a detection of unconsciousness.",
                "recommendation": "Check on the patient in person.",
            },
            "sbar_source": "template", "reason": "Welfare check unanswered",
        }
        self.alerts[alert["id"]] = alert
        await self.hub.publish("nurse", {"type": "alert", "alert": alert})
        await self._welfare_resolved(w)

    async def _welfare_resolved(self, w: dict):
        msg = {"type": "welfare_resolved", "id": w["id"], "patient_id": w["patient_id"], "outcome": w["status"]}
        for channel in ("nurse", f"patient:{w['patient_id']}", f"family:{w['person_id']}"):
            await self.hub.publish(channel, msg)
        await self._event(w["patient_id"], "welfare_check_resolved", {"id": w["id"], "outcome": w["status"]})
