"""Adaptive communication inside a live session: collects interactions, runs the two engine layers, applies
their decisions and logs them. Mixed into ``SessionService`` (services/sessions.py).

    patient input ──► record Interaction ──► signals.detect ──► policy.decide ──► apply + log + publish
                          (layer 1 input)       (layer 1)           (layer 2)         (here)
                                                                                         │
    tablet ◄── session["communication"] (mode, modifiers, wording, options, offer) ◄─────┘   (layer 3 renders)

What this never does: change the belief, the decision engine's choice, or escalation. A mode change only
changes presentation; the yes/no level reuses the engine's own questions (``Dialogue.open_yes_no``) and the
area's tailored options, so the same answer is the same evidence at every level. The policy is not run while
the engine is escalating, and a mode change never restarts the silence timer.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

from ..data.patients import PATIENT_BY_ID
from ..engine import options as opts
from ..engine.belief import p_high_risk
from ..engine.communication import policy as P
from ..engine.communication.signals import (CORRECTION, MISS, MISSED_RESPONSE, READ_ALOUD, RESPONSE, Interaction,
                                            InteractionSignals, detect)
from .communication_language import complexity

MID_DIALOGUE = ("feeling", "question")   # waiting on the patient after their first input (risk/silence.py)
SIGNAL_KINDS = {"miss": MISS, "correction": CORRECTION, "deletion": CORRECTION, "read_aloud": READ_ALOUD}
ASSIST_CHOICES = ("get_nurse", "ask_caregiver", "keep_trying")
MODIFIER_WORDS = {P.LARGE_TARGETS: "Bigger buttons", P.EXTRA_SPACING: "more space", P.CONFIRM_SELECTIONS: "confirm choices",
                  P.SIMPLE_WORDING: "Simpler words", P.AUDIO: "Read aloud"}
CHANGE_EVENTS = ("communication_mode_changed", "communication_presentation_changed",
                 "audio_mode_enabled", "assisted_communication_started")


def presentation(st: P.CommunicationState) -> dict:
    """What the renderer should do for a state. Layer 3 draws it; the nurse trace shows it."""
    return {"option_count": P.MAX_OPTIONS[st.mode],
            "button_size": "huge" if st.mode >= P.Mode.BINARY else "large" if (
                st.mode == P.Mode.SIMPLIFIED or P.LARGE_TARGETS in st.modifiers) else "regular",
            "spacing": "extra" if P.EXTRA_SPACING in st.modifiers or st.mode >= P.Mode.SIMPLIFIED else "normal",
            "wording": complexity(st.mode, st.modifiers), "confirm_selections": P.CONFIRM_SELECTIONS in st.modifiers,
            "audio": P.AUDIO in st.modifiers}


class CommunicationMixin:
    # ---- layer 1 input -------------------------------------------------------------------------

    def _record(self, s, kind: str, latency_ms: int | None = None, unsure: bool = False, surprising: bool = False,
                idle_s: float | None = None):
        s.interactions.append(Interaction(kind, time.time(), latency_ms / 1000 if latency_ms is not None else None,
                                          unsure, surprising, idle_s))

    def _signals(self, s) -> InteractionSignals:
        return detect(s.interactions, s.comm_since, s.baseline, s.dialogue.fatigue(), s.comm_mode_changes)

    def _escalating(self, s) -> bool:
        d = s.dialogue
        return s.status == "escalated" or max(d.p_high(), p_high_risk(self.cat, d.signal_belief)) >= \
            self.cfg.escalate_threshold

    def _context(self, s) -> P.PolicyContext:
        people = any(c.available and c.id not in s.dialogue.consulted for c in s.dialogue.consultants)
        return P.PolicyContext(escalating=self._escalating(s), caregiver_available=people)

    async def _observe(self, s, latency_ms: int | None = None, surprising: bool = False, unsure: bool = False,
                       kind: str = RESPONSE, idle_s: float | None = None) -> bool:
        """Record what the patient did and let the policy react. True when the mode changed."""
        self._record(s, kind, latency_ms, unsure, surprising, idle_s)
        sig = self._signals(s)
        d = P.decide(sig, s.comm, self._context(s))
        return await self._adapt(s, d, sig, "auto") if d.should_adapt else False

    # ---- applying a decision -------------------------------------------------------------------

    async def _adapt(self, s, d: P.AdaptationDecision, sig: InteractionSignals, source: str,
                     accepted: bool = True) -> bool:
        if source == "auto":
            await self._event(s, "communication_difficulty_detected",
                              {"decision": d.public(), "signals": sig.public(), "mode": s.comm.mode.name})
        if d.requires_patient_confirmation and source == "auto":
            s.comm_offer = {"offer": d.offer, "decision": d, "signals": sig.public(), "id": uuid.uuid4().hex[:8]}
            await self._event(s, "communication_offer", {"offer": d.offer, "reason": d.reason,
                                                         "explanation": d.explanation})
            return False
        before = s.comm
        s.comm = P.apply(before, d, accepted)
        s.comm_since = len(s.interactions)
        if s.comm == before:
            return False
        mode_changed = s.comm.mode != before.mode
        change = {
            "id": uuid.uuid4().hex[:12], "at": datetime.now(timezone.utc).isoformat(), "t": time.time(), "source": source,
            "from": int(before.mode), "to": int(s.comm.mode), "from_mode": before.mode.name,
            "to_mode": s.comm.mode.name, "from_label": P.LABEL[before.mode], "to_label": P.LABEL[s.comm.mode],
            "reason": d.reason, "severity": d.severity, "explanation": d.explanation,
            "added": sorted(s.comm.modifiers - before.modifiers), "removed": sorted(before.modifiers - s.comm.modifiers),
            "slowdown_ratio": round(sig.slowdown_ratio, 2) if sig.slowdown_ratio else None,
            "fatigue_score": round(sig.fatigue_score, 2), "baseline_status": sig.baseline_status,
            "signals": sig.public(), "decision": d.public(),
            "renderer": {"before": presentation(before), "after": presentation(s.comm)},
            "message": d.patient_message, "note": None,
        }
        s.comm_changes.append(change)
        # An accepted offer was already a question on screen; don't announce it again.
        text = None if d.offer else d.patient_message
        s.comm_message = {"id": change["id"], "text": text} if text else None
        if mode_changed:
            s.comm_mode_changes += 1
            await self._event(s, "communication_mode_changed", change)
            backend_mode = "grid" if s.comm.mode == P.Mode.STANDARD else s.tired_mode
            if backend_mode != s.mode:
                await self._event(s, "mode_changed", {"from": s.mode, "to": backend_mode,
                                                      "reason": f"communication {s.comm.mode.name}"})
                s.mode = backend_mode
        if change["added"] or change["removed"]:
            await self._event(s, "communication_presentation_changed", change)
        if P.SIMPLE_WORDING in change["added"] or (mode_changed and d.reason == P.REPEATED_UNCERTAINTY):
            await self._event(s, "question_simplified", {"question": s.question_id, "to": change["renderer"]["after"]["wording"]})
        if P.AUDIO in change["added"]:
            await self._event(s, "audio_mode_enabled", {"by": source})
        await self.hub.publish("nurse", {"type": "communication_changed", "patient_id": s.patient["id"],
                                         "change": self._public_change(change)})
        if source == "auto" and mode_changed and self.gemini.enabled:
            self._spawn(self._explain(s, change))
        return mode_changed

    async def _explain(self, s, change: dict):
        facts = {k: change[k] for k in ("from_label", "to_label", "explanation")}
        text = await self.gemini.level_explanation(s.patient["name"], facts)
        if text:
            change["note"] = text
            self.level_notes[change["id"]] = text
            await self.hub.publish("nurse", {"type": "communication_changed", "patient_id": s.patient["id"],
                                             "change": self._public_change(change)})

    @staticmethod
    def _public_change(c: dict) -> dict:
        return {k: c[k] for k in ("id", "at", "source", "from", "to", "from_mode", "to_mode", "from_label", "to_label",
                                  "reason", "severity", "explanation", "added", "removed", "slowdown_ratio",
                                  "baseline_status", "signals", "decision", "renderer", "note")}

    async def _after_change(self, s, changed: bool) -> dict:
        """After a change that didn't come with a patient answer: re-ask in the new form if needed. Mid-request
        the silence timer keeps counting from the last real prompt."""
        if changed and s.comm.mode < P.Mode.BINARY and (s.question_id or "").startswith("option:"):
            s.status, s.question_id = "feeling", None   # back from yes/no: the options as a grid again
        elif changed and s.comm.mode >= P.Mode.BINARY and s.status in ("area", "feeling"):
            return await self._advance(s, keep_clock=s.status in MID_DIALOGUE)
        return await self.state(s, publish=True)

    # ---- inputs that aren't answers --------------------------------------------------------------

    async def signal(self, sid: str, kind: str) -> dict:
        """A missed tap, a correction or a "read aloud" press reported by the tablet."""
        s = self.sessions[sid]
        if kind not in SIGNAL_KINDS:
            raise ValueError(f"unknown signal {kind!r}")
        if s.status not in ("area", "feeling", "question"):
            return await self.state(s)
        await self._event(s, "answer_corrected" if SIGNAL_KINDS[kind] == CORRECTION else "ui_signal", {"kind": kind})
        return await self._after_change(s, await self._observe(s, kind=SIGNAL_KINDS[kind]))

    async def idle_step_down(self, sid: str, idle_s: float) -> dict | None:
        """Silence monitor: quiet for half the silence timeout mid-request. Counted as a missed response."""
        s = self.sessions.get(sid)
        if not s or s.status not in MID_DIALOGUE:
            return None
        await self._event(s, "interaction_unresolved", {"idle_s": round(idle_s, 1), "mode": s.comm.mode.name})
        return await self._after_change(s, await self._observe(s, kind=MISSED_RESPONSE, idle_s=idle_s))

    # ---- explicit requests -----------------------------------------------------------------------

    async def set_level(self, sid: str, level: int, by: str = "patient") -> dict:
        s = self._by(sid, by)
        if level >= P.Mode.ASSISTED and by == "patient" and s.comm.mode < P.Mode.ASSISTED:
            # The patient asking for help gets the same choice as the policy's offer: who should help, or not.
            sig = self._signals(s)
            d = P.AdaptationDecision(True, P.EXPLICIT_REQUEST, 4, P.Mode.ASSISTED, requires_patient_confirmation=True,
                                     offer=P.OFFER_ASSISTED, patient_message=P.MESSAGES[P.OFFER_ASSISTED],
                                     explanation="Patient asked for help communicating.")
            s.comm_offer = {"offer": d.offer, "decision": d, "signals": sig.public(), "id": uuid.uuid4().hex[:8]}
            return await self.state(s, publish=True)
        changed = await self._adapt(s, P.request(s.comm, "mode", level, by), self._signals(s), by)
        if changed and s.comm.mode == P.Mode.ASSISTED:
            s.assist_help = "nurse_present"   # a nurse set it: they are the help
            await self._event(s, "assisted_communication_started", {"by": by, "summary": self.summary(s)})
        return await self._after_change(s, changed)

    async def set_audio(self, sid: str, enabled: bool, by: str = "patient") -> dict:
        s = self._by(sid, by)
        await self._adapt(s, P.request(s.comm, "audio", enabled, by), self._signals(s), by)
        return await self.state(s, publish=True)

    async def respond_offer(self, sid: str, offer: str, choice: str) -> dict:
        """The patient's answer to an offer: audio-first (accept / decline) or help communicating
        (get_nurse / ask_caregiver / keep_trying). Declining is remembered so it isn't asked again soon."""
        s = self.sessions[sid]
        pending = s.comm_offer
        if not pending or pending["offer"] != offer:
            raise ValueError("no such offer")
        d: P.AdaptationDecision = pending["decision"]
        s.comm_offer = None
        accepted = choice in ("accept", "get_nurse", "ask_caregiver")
        if offer == P.OFFER_ASSISTED and choice not in ASSIST_CHOICES:
            raise ValueError(f"choice must be one of {ASSIST_CHOICES}")
        await self._event(s, "communication_offer_answered", {"offer": offer, "choice": choice})
        changed = await self._adapt(s, d, self._signals(s), "patient", accepted=accepted)
        if offer == P.OFFER_ASSISTED and accepted:
            await self._start_assisted(s, "nurse" if choice == "get_nurse" else "caregiver")
        return await self._after_change(s, changed)

    def _by(self, sid: str, by: str):
        if by not in ("patient", "nurse"):
            raise ValueError("by must be 'patient' or 'nurse'")
        return self.sessions[sid]

    # ---- assisted communication ------------------------------------------------------------------

    async def _start_assisted(self, s, who: str):
        s.assist_help = who
        summary = self.summary(s)
        await self._event(s, "assisted_communication_started", {"by": "patient", "help": who, "summary": summary})
        if s.status not in ("area", "feeling", "question"):
            return
        if who == "caregiver":
            if await self._assist_consult(s):
                return
            s.assist_help = "nurse"   # nobody they know can be reached right now: ask a nurse instead
        # A nurse is asked to come and help: a routine request carrying what is and isn't known yet.
        reason = "Patient was unable to complete communication. Confirmed information preserved."
        await self._create_alert(s, "routine", "Needs help communicating")
        alert = self.alerts[s.alert_id]
        alert["reason"], alert["communication"] = reason, summary
        await self.hub.publish("nurse", {"type": "alert_updated", "alert": alert})

    async def _assist_consult(self, s) -> bool:
        """Ask the best available person who knows the patient. The patient's screen stays on the question
        (status unchanged), so the silence timer keeps running. False when nobody can be reached."""
        s.assist_consult = True
        people = [c for c in s.dialogue.consultants if c.available and c.id not in s.dialogue.consulted]
        if not people:
            return False
        person = max(people, key=lambda c: c.reliability)
        status, question = s.status, s.question_id
        await self._create_consult(s, person.id)
        s.status, s.question_id = status, question
        return True

    def summary(self, s) -> dict:
        """What is confirmed, what isn't, and the current belief: shown in assisted mode and to the nurse.
        Unresolved items are never filled in."""
        d = s.dialogue
        confirmed, unresolved = [], []
        if d.area:
            confirmed.append({"field": "Where", "value": self.cat.area_labels[d.area]})
        if d.feeling:
            confirmed.append({"field": "What it's like",
                              "value": s.choice["label"] if s.choice else self.cat.feeling_labels[d.feeling]})
        for q, a in d.answers:
            (unresolved if a == "unsure" else confirmed).append(
                {"field": q, "value": {"yes": "Yes", "no": "No", "unsure": "Not sure"}.get(a, a)})
        if not d.area and not d.yes_no:
            unresolved.append({"field": "Where it is", "value": None})
        if not d.feeling:
            unresolved.append({"field": "What it's like", "value": None})
        top = d.top(3)
        if not top or top[0]["p"] < 0.6:
            unresolved.append({"field": "Exactly what is needed", "value": None})
        other = max(0.0, 1 - sum(t["p"] for t in top))
        return {"confirmed": confirmed, "unresolved": unresolved,
                "belief": [{"label": t["label"], "p": round(t["p"], 2)} for t in top] + [{"label": "Other", "p": round(other, 2)}]}

    # ---- yes/no walk through the area's tailored options (engine/options.py) ----------------------
    # From BINARY on, after a body-area tap: the area's options one at a time, high-risk first, then in the
    # order Gemini or the engine ranked them. A "yes" is exactly that option's tap; "no" / "not sure" move on
    # without evidence. With every option declined, the engine's own yes/no questions take over.

    def _walking(self, s) -> bool:
        d = s.dialogue
        if d.area is None or d.feeling is not None or d.yes_no or not s.options:
            return False
        if s.option_walk is None:
            ranked = [o for o in [*s.options["predicted"], *s.options["more"]] if o["feeling"] != opts.NONE_OF_THESE]
            s.option_walk = [o["id"] for o in sorted(ranked, key=lambda o: not o["high_risk"])]
        return bool(s.option_walk)

    def _option(self, s, option_id: str) -> dict:
        o = s.options or {}
        return next(x for x in [*o.get("predicted", []), *o.get("more", [])] if x["id"] == option_id)

    async def _answer_option(self, s, option_id: str, answer: str, via: str | None = None) -> dict:
        latency = self._latency_ms(s)
        self._remember(s)
        await self._event(s, "answer", {"question": f"option:{option_id}", "answer": answer, "latency_ms": latency,
                                        "via": via})
        s.option_walk = [i for i in (s.option_walk or []) if i != option_id]
        if answer != "yes":
            await self._observe(s, latency, unsure=answer == "unsure")
            return await self._advance(s)
        o = self._option(s, option_id)
        s.choice = self._pick_option(s, option_id, o["feeling"])
        s.dialogue.apply_tap("feeling", o["feeling"])
        await self._event(s, "tap", {"kind": "feeling", "tap": o["feeling"], "latency_ms": latency,
                                     "option": s.choice, "via": via or "yes_no"})
        if via == "voice":
            await self._confirm_voice(s)
        await self._log_belief(s)
        await self._observe(s, latency)
        finish = f"Sent straight away: “{s.choice['label']}” needs no follow-up question." if s.choice["send_now"] else None
        return await self._advance(s, finish)

    # ---- what the tablet renders (layer 3 input) ---------------------------------------------------

    def _presented_options(self, s) -> dict:
        """Which choices are on screen at this mode. High-risk choices are never hidden."""
        st, d = s.comm, s.dialogue
        out: dict = {"area": None, "feeling": None}
        if st.mode == P.Mode.SIMPLIFIED:
            out["area"] = opts.likely_taps(self.cat.area_lik, d.belief, self.cat.high_risk, k=3)
        if s.options:
            predicted = s.options["predicted"]
            if st.mode == P.Mode.SIMPLIFIED:
                keep = [o for o in predicted if not o["high_risk"]][:2] + [o for o in predicted if o["high_risk"]]
                out["feeling"] = [o["id"] for o in keep]
            else:
                out["feeling"] = [o["id"] for o in predicted]
        return out

    def _text(self, s) -> dict[str, str]:
        """Every on-screen string for the current wording level, keyed as the tablet looks it up."""
        level = complexity(s.comm.mode, s.comm.modifiers)
        text = self.lang.ui()
        text |= {f"area:{k}": self.lang.label(v, level) for k, v in self.cat.area_labels.items()}
        if s.options:
            spec = opts.area_spec(self.cat, s.options["area"]) or {}
            text[f"prompt:{s.options['area']}"] = self.lang.label(spec.get("prompt", s.options["prompt"]), level)
            text |= {f"option:{o['id']}": self.lang.label(o["label"], level)
                     for o in [*s.options["predicted"], *s.options["more"]]}
        return text

    async def communication_view(self, s) -> dict:
        st = s.comm
        sig = self._signals(s)
        last = s.comm_changes[-1] if s.comm_changes else None
        offer = None
        if s.comm_offer:
            o = s.comm_offer
            offer = {"id": o["id"], "offer": o["offer"],
                     "message": o["decision"].patient_message,
                     "choices": (["get_nurse", "ask_caregiver", "keep_trying"] if o["offer"] == P.OFFER_ASSISTED
                                 else ["accept", "decline"])}
        assist = None
        if st.mode == P.Mode.ASSISTED:
            c = self.consults.get(s.consult_id or "")
            assist = {"help": s.assist_help, "person_name": c["person_name"] if c else None,
                      "relation": c["relation"] if c else None, "status": c["status"] if c else None}
        return st.public() | {
            "levels": {int(m): P.LABEL[m] for m in P.Mode},
            "presentation": presentation(st), "wording": complexity(st.mode, st.modifiers),
            "reason": last["reason"] if last else None, "severity": last["severity"] if last else 0,
            "explanation": last["explanation"] if last else None,
            "message": s.comm_message,
            "offer": offer, "signals": sig.public(), "baseline_status": sig.baseline_status,
            "options": self._presented_options(s), "text": self._text(s),
            "summary": self.summary(s), "assist": assist,
            "changes": [self._public_change(c) for c in s.comm_changes[-12:]],
        }

    # ---- nurse station ---------------------------------------------------------------------------

    async def communication_overview(self, hours: int = 12) -> list[dict]:
        """Each patient's current communication mode, why it changed, and this shift's changes (newest last)."""
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        events = []
        for kind in CHANGE_EVENTS:
            try:
                events += await self.store.events_of_type(kind, since)
            except Exception:
                pass
        events = [e for e in events if (e.get("payload") or {}).get("source") != "unit_history"
                  # audio has its own event; its presentation-change twin would repeat it
                  and not (e["event_type"] == "communication_presentation_changed"
                           and (e.get("payload") or {}).get("reason") == P.AUDIO_PREFERENCE)]
        events.sort(key=lambda e: e["time"])
        latest: dict = {}
        for s in self.sessions.values():
            if s.patient["id"] not in latest or s.started > latest[s.patient["id"]].started:
                latest[s.patient["id"]] = s
        out = []
        for pid, p in PATIENT_BY_ID.items():
            s = latest.get(pid)
            changes = [self._history_item(e) for e in events if e["patient_id"] == pid]
            if not changes and not s:
                continue
            row = {"patient_id": pid, "patient_name": p["name"], "room": p["room"],
                   "session_id": s.id if s else None, "changes": changes,
                   "active": bool(s and s.status in ("area", "feeling", "question", "waiting_consult"))}
            if s:
                last = s.comm_changes[-1] if s.comm_changes else None
                row |= {"mode": s.comm.public(), "level": int(s.comm.mode), "label": P.LABEL[s.comm.mode],
                        "signals": self._signals(s).public(), "presentation": presentation(s.comm),
                        "last_change": self._public_change(last) if last else None,
                        "summary": self.summary(s) if s.comm.mode == P.Mode.ASSISTED else None}
            out.append(row)
        return out

    def _history_item(self, e: dict) -> dict:
        p = e.get("payload") or {}
        item = {"event": e["event_type"], "at": e["time"].isoformat() if hasattr(e["time"], "isoformat") else e["time"],
                "session_id": e.get("session_id")}
        if e["event_type"] in ("communication_mode_changed", "communication_presentation_changed"):
            item |= {k: p.get(k) for k in ("id", "from_label", "to_label", "reason", "explanation", "added", "source")}
            item["note"] = self.level_notes.get(p.get("id", ""))
            if e["event_type"] == "communication_presentation_changed":
                item["from_label"] = None
                item["to_label"] = ", ".join(MODIFIER_WORDS.get(m, m) for m in p.get("added") or []) or "Presentation changed"
        elif e["event_type"] == "audio_mode_enabled":
            item |= {"to_label": "Read aloud on", "reason": "AUDIO_PREFERENCE"}
        else:
            item |= {"to_label": "Help communicating", "reason": "REPEATED_INTERACTION_FAILURE",
                     "explanation": "Confirmed information preserved."}
        return item
