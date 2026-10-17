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
from ..engine import options as opts
from ..engine import profile as prof
from ..engine.belief import PriorContext, context_prior, entropy, tap_likelihood
from ..engine.conformal import ConformalPredictor
from ..engine.decision import Action, Consultant, Decision
from ..engine.dialogue import Dialogue
from ..engine.personal import PersonalModel
from ..sim.learning import learning_curve
from .case_packet import build_case_packet, case_feedback, template_case_sbar
from .gemini import Gemini, template_sbar
from .hub import Hub
from .research import prior_multipliers

log = logging.getLogger(__name__)

LEARN_DAYS = 60

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
    prompted_at: float = field(default_factory=time.time)   # when the current prompt was shown (tap latency)
    belief_step: int = 0
    consult_answers: list[tuple[str, str | None]] = field(default_factory=list)  # (person id, need id)
    tired_mode: str = "large"        # where the tablet goes when the patient tires (patient profile)
    auto_switched: bool = False
    options: dict | None = None      # tailored second-step options, fixed once shown (engine/options.py)
    choice: dict | None = None       # the option the patient picked: label, predicted or "something else"


class SessionService:
    def __init__(self, cat: Catalog, cfg: EngineConfig, store, hub: Hub, gemini: Gemini, conformal: ConformalPredictor,
                 profiles=None, predictions=None):
        self.cat, self.cfg, self.store, self.hub, self.gemini, self.conformal = cat, cfg, store, hub, gemini, conformal
        self.profiles = profiles   # services.profiles.ProfileService; None = no profiles
        self.predictions = predictions   # services.predictions.PredictionService; None = engine ranking only
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

        # Patient profile (engine/profile.py): bounded adjustments from chart notes and approved nurse notes.
        profile = self.profiles.get(patient_id) if self.profiles else prof.PatientProfile(patient_id)
        pmult = prof.prior_multipliers(profile, self.cat, local_hour)
        prior = prof.apply_to_prior(prior, pmult, self.cat)
        reasons += prof.prior_reasons(profile, local_hour)
        consultants = []
        for person in p["people"]:
            a, b = await self.reliability(f"person:{person['id']}", (person["a"], person["b"]))
            adj = prof.person_adjustment(profile, person["id"], a, b, local_hour)
            consultants.append(Consultant(person["id"], person["name"], person["relation"],
                                          clip(adj.a / (adj.a + adj.b)), adj.available, adj.cost_factor))
        try:
            baseline = await self.store.tap_baseline(patient_id)
        except Exception:
            log.exception("tap baseline lookup failed")
            baseline = None
        personal = await self.personal_model(patient_id)
        if personal.n:
            reasons.append(f"{personal.n} nurse-confirmed gesture{'s' if personal.n != 1 else ''} of theirs")
        d = Dialogue(self.cat, self.cfg, prior, clip(prof.signal_reliability(profile, view["signal_reliability"])),
                     consultants, {k: v["flag"] for k, v in p["chart"].items()},
                     baseline_interval=baseline, fatigue_sensitivity=prof.fatigue_sensitivity(profile, local_hour),
                     personal=personal)
        s = Session(uuid.uuid4().hex[:12], p, d, mode, language or p["language"], reasons,
                    tired_mode=prof.mode_when_tired(profile))
        self.sessions[s.id] = s
        if self.predictions:   # Gemini ranks every area's options in the background; never waited on
            self.predictions.refresh(patient_id, personal.learned_signals(self.cat))
        await self._event(s, "session_started", {"mode": mode, "language": s.language, "prior_reasons": reasons})
        await self._log_belief(s)
        out = await self.state(s)
        s.prompted_at = time.time()
        return out

    async def personal_model(self, patient_id: str) -> PersonalModel:
        """This patient's learned gesture meanings, from nurse-confirmed needs in the last LEARN_DAYS days."""
        try:
            rows = await self.store.confirmations(now() - timedelta(days=LEARN_DAYS), patient_id)
        except Exception:
            log.exception("confirmation lookup failed; no personal model")
            rows = []
        return PersonalModel.from_rows(rows)

    async def learning(self, patient_id: str) -> dict:
        model = await self.personal_model(patient_id)
        return {"patient_id": patient_id, "confirmations": model.n, "alpha": model.alpha,
                "signals": model.learned_signals(self.cat)}

    async def learning_demo(self, patient_id: str, area: str, feeling: str, need: str, sessions: int) -> dict:
        """Replay one gesture over several sessions from a blank slate, with this patient's prior and chart.
        Runs in memory only; nothing is stored."""
        p = PATIENT_BY_ID[patient_id]
        if area not in self.cat.area_lik or feeling not in self.cat.feeling_lik or need not in self.cat.index:
            raise ValueError("unknown area, feeling or need")
        view = await self.patient_view(patient_id)
        local_hour = now().astimezone(settings.unit_tz).hour
        prior, _ = context_prior(self.cat, PriorContext(hour=local_hour, days_since_surgery=p["days_since_surgery"]))
        curve = learning_curve(self.cat, self.cfg, prior, clip(view["signal_reliability"]),
                               {k: v["flag"] for k, v in p["chart"].items()}, area, feeling, need,
                               min(max(sessions, 2), 10))
        return {"patient_id": patient_id, "area": area, "feeling": feeling, "need": need,
                "need_label": self.cat.by_id[need]["label"], "high_risk": self.cat.high_risk[self.cat.index[need]],
                "sessions": curve}

    @staticmethod
    def _latency_ms(s: Session) -> int:
        return round((time.time() - s.prompted_at) * 1000)

    async def tap(self, sid: str, kind: str, tap_id: str, option_id: str | None = None) -> dict:
        s = self.sessions[sid]
        refining = s.status == "escalated" and kind == "feeling" and s.dialogue.feeling is None
        if not refining and s.status != kind:
            raise ValueError(f"expected a {s.status} input, got {kind} tap")
        finish = None
        if kind == "feeling" and option_id:
            s.choice = self._pick_option(s, option_id, tap_id)
            if s.choice["send_now"]:
                finish = f"Sent straight away: “{s.choice['label']}” needs no follow-up question."
        elif kind == "area" and opts.area_sends_now(self.cat, tap_id):
            finish = f"Sent straight away: “{self.cat.area_labels[tap_id]}” needs no follow-up question."
        latency = self._latency_ms(s)
        s.dialogue.apply_tap(kind, tap_id)
        await self._event(s, "tap", {"kind": kind, "tap": tap_id, "latency_ms": latency,
                                     "option": s.choice if kind == "feeling" else None})
        await self._log_belief(s)
        if refining:
            await self._refresh_alert(s)
            out = await self.state(s, publish=True)
            s.prompted_at = time.time()
            return out
        return await self._advance(s, finish)

    async def answer(self, sid: str, question_id: str, answer: str) -> dict:
        s = self.sessions[sid]
        if s.status != "question" or s.question_id != question_id:
            raise ValueError("no such open question")
        latency = self._latency_ms(s)
        s.dialogue.apply_answer(question_id, answer)
        await self._event(s, "answer", {"question": question_id, "answer": answer, "latency_ms": latency})
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

    async def _advance(self, s: Session, finish: str | None = None) -> dict:
        """`finish`: send to the nurse now with no follow-up question (washroom, pain medicine), unless the
        safety floor escalates. The value is the plain-language reason shown on the alert."""
        before = len(s.dialogue.lookup_results)
        d = s.dialogue.step()
        for lid, label, flag in s.dialogue.lookup_results[before:]:
            await self._event(s, "lookup", {"lookup": lid, "flag": flag})
        if finish and d.chosen.kind != "escalate":
            d = Decision(Action("send", "send", "Send message to nurse", 0.0, 0.0, {}), d.ranked, finish)
        s.decision = d
        self._spawn(self._log_decision(s, d))
        kind = d.chosen.kind
        s.question_id = None
        if (not s.auto_switched and s.mode == "grid" and s.mode != s.tired_mode
                and s.dialogue.fatigue() >= FATIGUE_SWITCH and kind in ("ask", "tap")):
            # Adaptive access: tiring patients get larger, fewer targets, or the mode their profile prefers.
            await self._event(s, "mode_changed", {"from": s.mode, "to": s.tired_mode, "reason": "fatigue"})
            s.mode, s.auto_switched = s.tired_mode, True
        if kind == "escalate":
            s.status = "escalated"
            s.dialogue.attach_context()
            if s.dialogue.feeling is None and s.options is None:
                s.options = self._build_options(s)   # the patient can still add detail to the open alert
            await self._create_alert(s, "urgent")
        elif kind == "send":
            s.status = "sent"
            await self._create_alert(s, "routine")
        elif kind == "tap":
            s.status = "feeling" if s.dialogue.area else "area"
            if s.status == "feeling" and s.options is None:
                s.options = self._build_options(s)
        elif kind == "ask":
            s.status, s.question_id = "question", d.chosen.id
        elif kind == "consult":
            s.status = "waiting_consult"
            await self._create_consult(s, d.chosen.id)
        await self._event(s, "decision", {"chosen": d.chosen.public(), "reason": d.reason,
                                          "ranked": [a.public() for a in d.ranked[:5]]})
        await self._event(s, "fatigue", {"score": round(s.dialogue.fatigue(), 2)})
        if len(s.dialogue.lookup_results) > before:
            await self._log_belief(s)
        out = await self.state(s, publish=True)
        s.prompted_at = time.time()
        return out

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
            "prior_reasons": s.prior_reasons, "inconsistencies": d.inconsistencies,
            "baseline_interval": d.baseline_interval, "profile": self._profile_items(s.patient["id"]),
            "options": s.options if s.status == "feeling" or (s.status == "escalated" and d.feeling is None) else None,
            "choice": s.choice,
        }
        if publish:
            await self.hub.publish(f"patient:{s.patient['id']}", {"type": "session", "session": out})
        return out

    def _profile_items(self, pid: str) -> list[dict]:
        return self.profiles.public(pid)["items"] if self.profiles else []

    # ---- tailored second-step options (engine/options.py) ------------------------------------------

    def _build_options(self, s: Session) -> dict | None:
        d, area = s.dialogue, s.dialogue.area
        spec = opts.area_spec(self.cat, area) if area else None
        if not spec:
            return None

        def feeling_lik(feeling: str) -> list[float]:
            if d.personal and d.personal.n:   # this patient's learned meaning of the tap
                return d.personal.likelihood(self.cat, "feeling", feeling, d.reliability)
            return tap_likelihood(self.cat, "feeling", feeling, d.reliability)

        fallback = opts.engine_order(spec["options"], d.belief, feeling_lik)
        ranked = self.predictions.ranking(s.patient["id"], area) if self.predictions else None
        if ranked:
            return opts.choose(self.cat, area, opts.merge_order(spec["options"], ranked[0], fallback), "gemini",
                               ranked[1])
        return opts.choose(self.cat, area, fallback, "engine")

    def _pick_option(self, s: Session, option_id: str, feeling: str) -> dict:
        o = s.options or {}
        predicted = next((x for x in o.get("predicted", []) if x["id"] == option_id), None)
        picked = predicted or next((x for x in o.get("more", []) if x["id"] == option_id), None)
        if not picked or picked["feeling"] != feeling:
            raise ValueError(f"option {option_id} isn't offered for this step")
        return {"id": picked["id"], "label": picked["label"], "predicted": predicted is not None,
                "source": o.get("source"), "send_now": picked["send_now"]}

    # ---- alerts ----------------------------------------------------------------------------------

    def _alert_context(self, s: Session, priority: str) -> dict:
        d, p = s.dialogue, s.patient
        pset = self.conformal.predict_set(self.cat.need_ids, d.belief)
        return {
            "patient_name": p["name"], "room": p["room"], "diagnosis": p["diagnosis"], "priority": priority,
            "top": d.top(5), "prediction_set": pset,
            "prediction_set_labels": [self.cat.by_id[n]["label"] for n in pset],
            "p_high": round(d.p_high(), 4),
            "taps": [self.cat.area_labels.get(d.area, "-"),
                     s.choice["label"] if s.choice else self.cat.feeling_labels.get(d.feeling, "-")],
            "asked": [{"question": q, "answer": a} for q, a in d.answers],
            "lookups": [{"label": label, "value": p["chart"][lid]["value"], "flag": flag}
                        for lid, label, flag in d.lookup_results],
            "consults": [{"person": who, "answer": ans} for who, ans in d.consult_answers],
            "language": s.language,
            "profile": [i["effect"] for i in self._profile_items(p["id"])],
        }

    @staticmethod
    def _labelled(alert: dict, sbar: dict) -> dict:
        label = alert.get("label")
        return sbar | {"situation": f"{label}. {sbar['situation']}"} if label else sbar

    async def _create_alert(self, s: Session, priority: str, label: str | None = None):
        ctx = self._alert_context(s, priority)
        first_tap = s.dialogue.tap_times[0] if s.dialogue.tap_times else s.started
        alert = {
            "id": uuid.uuid4().hex[:12], "patient_id": s.patient["id"], "patient_name": s.patient["name"],
            "room": s.patient["room"], "session_id": s.id, "kind": "need", "priority": priority,
            "created_at": now().isoformat(), "status": "open",
            "top": ctx["top"], "prediction_set": ctx["prediction_set"], "p_high": ctx["p_high"],
            "asked": ctx["asked"], "lookups": ctx["lookups"], "consults": ctx["consults"],
            "label": label, "sbar": None, "sbar_source": "template", "confirmed_need": None,
            "seconds_to_alert": round(time.time() - first_tap, 1),
            "reason": s.decision.reason if s.decision else "",
            "profile": self._profile_items(s.patient["id"]), "nurse_note": None,
            "case": None,
            "choice": s.choice,
        }
        alert["sbar"] = self._labelled(alert, template_sbar(ctx))
        s.alert_id = alert["id"]
        self.alerts[alert["id"]] = alert
        await self.hub.publish("nurse", {"type": "alert", "alert": alert})   # nurse first, always
        await self._event(s, "escalated" if priority == "urgent" else "notified",
                          {"alert_id": alert["id"], "top": ctx["top"][:3], "p_high": ctx["p_high"]})
        self._spawn(self._enrich(alert["id"], ctx))
        self._spawn(self._attach_case_packet(alert["id"], s))   # after the nurse push; never delays it

    async def _refresh_alert(self, s: Session):
        alert = self.alerts.get(s.alert_id or "")
        if not alert:
            return
        ctx = self._alert_context(s, alert["priority"])
        alert.update({k: ctx[k] for k in ("top", "prediction_set", "p_high", "lookups")})
        alert["choice"] = s.choice
        alert["sbar"], alert["sbar_source"] = self._labelled(alert, template_sbar(ctx)), "template"
        await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})
        self._spawn(self._enrich(alert["id"], ctx))
        self._spawn(self._attach_case_packet(alert["id"], s))

    async def _enrich(self, alert_id: str, ctx: dict):
        if not self.gemini.enabled:
            return
        sbar, source = await self.gemini.sbar(ctx)
        alert = self.alerts.get(alert_id)
        if alert and source == "gemini":
            alert["sbar"], alert["sbar_source"] = self._labelled(alert, sbar), source
            await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})

    async def _attach_case_packet(self, alert_id: str, s: Session):
        """Clinician copilot: once the alert is with the nurse, attach a case record: a full packet if the
        request ended without a confident answer, a light one for a safety-floor escalation. It is pushed as a
        `case` message, stored, and later updated with Gemini's checked wording and the nurse's feedback.
        Failures are logged and never touch the alert itself."""
        try:
            alert = self.alerts.get(alert_id)
            if not alert:
                return
            pkt = build_case_packet(
                self.cat, self.cfg, s.dialogue, session_id=s.id, patient_id=s.patient["id"],
                prediction_set=self.conformal.predict_set(self.cat.need_ids, s.dialogue.belief),
                decision=s.decision, status=s.status, chart=s.patient.get("chart"),
                consult=self.consults.get(s.consult_id or "")).public()
            if pkt["stop_reason"]["code"] == "RESOLVED":
                if alert.get("case"):   # a later tap made it clear
                    alert["case"] = None
                    await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})
                return
            record = {"id": alert_id, "alert_id": alert_id, "patient_id": s.patient["id"], "session_id": s.id,
                      "created_at": alert["created_at"], "packet": pkt,
                      "sbar": template_case_sbar(pkt, s.patient), "sbar_source": "template",
                      "feedback": (alert.get("case") or {}).get("feedback"),
                      "acknowledged": (alert.get("case") or {}).get("acknowledged")}
            alert["case"] = record
            await self.hub.publish("nurse", {"type": "case", "case": record})
            await self._safe(self.store.upsert_case(record))
            await self._event(s, "case_packet", {"alert_id": alert_id, "variant": pkt["variant"],
                                                 "stop_reason": pkt["stop_reason"]["code"],
                                                 "next_step": pkt["next_step"]["code"]})
            if not self.gemini.enabled:
                return
            sbar, source = await self.gemini.case_sbar(pkt, s.patient, self.cat)
            if source == "gemini" and alert.get("case") is record:   # still the latest packet
                record["sbar"], record["sbar_source"] = sbar, source
                await self.hub.publish("nurse", {"type": "case", "case": record})
                await self._safe(self.store.upsert_case(record))
        except Exception:
            log.exception("case packet failed (the alert itself is unaffected)")

    async def acknowledge_case(self, case_id: str, nurse: str = "nurse") -> dict:
        """The nurse has read the case packet and is acting on it. Does not close the alert: what the patient
        actually needed is still confirmed afterwards. Repeating it keeps the first acknowledgement."""
        case = (self.alerts.get(case_id) or {}).get("case")
        if not case:
            raise KeyError(case_id)
        if not case.get("acknowledged"):
            case["acknowledged"] = {"by": nurse, "at": now().isoformat()}
            await self.hub.publish("nurse", {"type": "case", "case": case})
            await self._safe(self.store.upsert_case(case))
            await self._event(case["patient_id"], "case_acknowledged", {"alert_id": case_id, "nurse": nurse})
        return case

    async def confirm(self, alert_id: str, need_id: str | None, nurse: str = "nurse", note: str | None = None,
                      case_helpful: bool | None = None) -> dict:
        """`case_helpful`: the nurse's verdict on the alert's case packet, if it has one. What the patient actually
        needed is `need_id`, which feeds reliability learning exactly as for any confirmation."""
        alert = self.alerts[alert_id]
        if alert["status"] != "open":
            # A second confirm (double tap, two dashboards) must not count twice in reliability or logs.
            raise ValueError("alert is already confirmed")
        alert["status"], alert["confirmed_need"], alert["confirmed_by"] = "confirmed", need_id, nurse
        note = (note or "").strip() or None
        alert["nurse_note"] = note
        if self.predictions and need_id:
            self.predictions.invalidate(alert["patient_id"])   # new history: re-rank options next session
        if note and self.profiles:
            # Feature B: Gemini suggests profile changes from the note; a nurse approves each one.
            self._spawn(self._suggest(alert["patient_id"], alert_id, note, need_id, nurse))
        s = self.sessions.get(alert["session_id"] or "")
        if s and need_id:
            await self._learn(s, alert, need_id)
        await self._event(s or alert["patient_id"], "nurse_confirmed",
                          {"alert_id": alert_id, "need": need_id, "nurse": nurse,
                           "predicted": alert["top"][0]["need"] if alert["top"] else None})
        await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})
        case = alert.get("case")
        if case:
            case["feedback"] = case_feedback(case["packet"], need_id, case_helpful, nurse, self.cat)
            await self.hub.publish("nurse", {"type": "case", "case": case})
            await self._safe(self.store.upsert_case(case))
            await self._event(s or alert["patient_id"], "case_feedback",
                              {"alert_id": alert_id, "helpful": case_helpful, "need": need_id,
                               "rank": case["feedback"]["actual_rank"]})
        return alert

    async def _suggest(self, pid: str, alert_id: str, note: str, need_id: str | None, nurse: str):
        try:
            await self.profiles.suggest(pid, alert_id, note, need_id, nurse)
        except Exception:
            log.exception("profile suggestion failed (note kept on the alert)")

    async def _learn(self, s: Session, alert: dict, need_id: str):
        d, pid, i = s.dialogue, s.patient["id"], self.cat.index[need_id]
        gaps = [b - a for a, b in zip(d.tap_times, d.tap_times[1:])]
        row = {
            "time": now(), "patient_id": pid, "session_id": s.id, "predicted_need": alert["top"][0]["need"],
            "confirmed_need": need_id, "confirmed_group": self.cat.group[i], "risk": self.cat.risk[i],
            "correct": alert["top"][0]["need"] == need_id, "escalated": alert["priority"] == "urgent",
            "taps": d.taps, "questions": d.questions_asked, "resolve_seconds": alert["seconds_to_alert"],
            "mean_tap_interval": round(sum(gaps) / len(gaps), 2) if gaps else 0.0, "mode": s.mode,
            "area": d.area, "feeling": d.feeling,   # the gesture, so the patient's own meanings can be learned
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
        options = [o["need"] for o in c["options"]]
        if answer not in (None, "unsure") and answer not in options:
            raise ValueError("answer must be one of the offered options")  # before any state changes
        c["status"], c["answer"] = "answered", answer
        s = self.sessions.get(c["session_id"])
        if s and s.status not in ("escalated", "sent"):
            person = next(x for x in s.dialogue.consultants if x.id == c["person_id"])
            s.dialogue.apply_consult(person, options, answer)
            s.consult_answers.append((person.id, answer))
            await self._event(s, "consult_answered", {"consult_id": cid, "answer": answer})
            await self._log_belief(s)
            if s.status == "waiting_consult" and s.consult_id == cid:
                await self._advance(s)
            else:
                # The patient moved on (skipped or timed out). Keep the evidence, but don't replace
                # whatever question they are answering now.
                await self.state(s, publish=True)
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

    # ---- silence detection hooks (app/risk/silence_monitor.py) ----------------------------------

    async def escalate_unresponsive(self, sid: str, idle_s: float, timeout_s: float) -> dict | None:
        """Mode A: the patient stopped responding mid-request. Escalate the current belief now.

        Re-checks on the event loop, so a tap that landed while the monitor was deciding wins.
        """
        s = self.sessions.get(sid)
        if not s or s.status not in ("feeling", "question") or time.time() - s.prompted_at < timeout_s:
            return None
        label = "Patient stopped responding mid-request"
        reason = (f"{label}: no input for {idle_s:.0f} s (limit {timeout_s:.0f} s, from this patient's usual "
                  "response time). The needs below are uncertain; check in person.")
        s.status, s.question_id = "escalated", None
        s.decision = Decision(Action("escalate", "unresponsive", label, 0.0, 0.0, {}), [], reason)
        s.dialogue.attach_context()
        await self._create_alert(s, "urgent", label)
        await self._event(s, "unresponsive_escalated", {"alert_id": s.alert_id, "idle_s": round(idle_s, 1),
                                                         "timeout_s": round(timeout_s, 1)})
        await self.state(s, publish=True)
        return self.alerts[s.alert_id]

    async def raise_alert(self, alert: dict):
        """Add (or re-send, which re-sounds it) an alert built elsewhere, e.g. a silence-ladder nurse alert."""
        self.alerts[alert["id"]] = alert
        await self.hub.publish("nurse", {"type": "alert", "alert": alert})
