"""Autonomous research agent (human in the loop).

    observation (clinician) or detector (system)
      → uncertain hypothesis, confidence 0.5
      → research decision engine picks CHECK_DATA / ASK_CLINICIAN / WAIT
      → evidence → Bayesian confidence update → repeat
      → crosses a threshold → SUPPORTED_ / REJECTED_PENDING_REVIEW
      → clinical lead validates, rejects or asks for more data (always required)
      → validated hypotheses with a prior effect feed the patient belief engine

Every action, evidence item and status change is appended to the hypothesis timeline and never deleted.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from ..catalog import Catalog
from ..data.patients import PATIENT_BY_ID, STAFF, STAFF_BY_ID
from ..engine.research_decision import (ActionScore, Clinician, ResearchConfig, clinician_log_lr, data_log_lr,
                                        score_actions, update)
from .gemini import Gemini
from .research_data import (build_claim, detect, evaluate, evidence_weight, expected_per_day, parse_observation,
                            validate_test)

log = logging.getLogger(__name__)

ACTIVE = {"INVESTIGATING", "INCONCLUSIVE"}
PENDING_REVIEW = {"SUPPORTED_PENDING_REVIEW", "REJECTED_PENDING_REVIEW"}
DONE = {"VALIDATED", "REJECTED"}
SHIFT = timedelta(hours=12)
DEMO_OBSERVATION = ("rn-priya", "p-chen", "Mr. Chen seems more anxious after his daughter leaves.")


def now() -> datetime:
    return datetime.now(timezone.utc)


class ResearchAgent:
    def __init__(self, cat: Catalog, store, gemini: Gemini, hub, cfg: ResearchConfig = ResearchConfig()):
        self.cat, self.store, self.gemini, self.hub, self.cfg = cat, store, gemini, hub, cfg
        self.lock = asyncio.Lock()
        self._digest_cache: tuple[str, dict] | None = None

    # ---- data access -----------------------------------------------------------------------------

    async def _data(self):
        since = now() - timedelta(days=30)
        return await self.store.confirmations(since), await self.store.events_of_type("family_visit", since)

    async def hypotheses(self) -> list[dict]:
        return await self.store.list_hypotheses()

    async def inquiries(self, status: str | None = None) -> list[dict]:
        return [i for i in await self.store.list_inquiries() if status is None or i["status"] == status]

    async def _save(self, h: dict):
        h["updated_at"] = now().isoformat()
        await self.store.upsert_hypothesis(h)

    async def _publish(self):
        self._digest_cache = None
        await self.hub.publish("research", {"type": "research_updated"})

    def _timeline(self, h: dict, kind: str, text: str, **extra):
        h["timeline"].append({"t": now().isoformat(), "kind": kind, "text": text, **extra})

    async def _log(self, h: dict, action: str, payload: dict):
        try:
            await self.store.log_event(now(), h["patient_id"] or "unit", None, "research_action",
                                       {"hypothesis_id": h["id"], "action": action, **payload})
        except Exception:
            log.exception("research event log failed")

    async def _clinicians(self, h: dict) -> list[Clinician]:
        pending: dict[str, int] = {}
        for i in await self.inquiries("pending"):
            pending[i["clinician_id"]] = pending.get(i["clinician_id"], 0) + 1
        out = []
        for s in STAFF:
            a, b = await self.store.get_reliability(f"clinician:{s['id']}") or (s["a"], s["b"])
            r = a / (a + b)
            if h["patient_id"] and h["patient_id"] not in s["patients"]:
                continue  # only ask people who know the patient
            out.append(Clinician(s["id"], s["name"], s["role"], min(r, 0.97), pending.get(s["id"], 0),
                                 originator=s["id"] == h.get("origin_id")))
        return out

    # ---- creation --------------------------------------------------------------------------------

    def _new(self, *, hid: str, claim: str, origin: str, origin_detail: str, origin_id: str | None,
             patient_id: str | None, test: dict | None, split: str, cursor: datetime, observation_text: str | None,
             discovery: str | None, prior_effect: dict | None) -> dict:
        p = PATIENT_BY_ID.get(patient_id) if patient_id else None
        h = {
            "id": hid, "created_at": now().isoformat(), "updated_at": now().isoformat(),
            "statement": claim + ".", "claim": claim, "observation_text": observation_text,
            "origin": origin, "origin_detail": origin_detail, "origin_id": origin_id,
            "patient_id": patient_id, "cohort": f"{p['name']} · {p['room']}" if p else "Unit",
            "test": test, "split": split, "data_cursor": cursor.isoformat(), "discovery": discovery,
            "confidence": 0.5, "status": "INVESTIGATING", "evidence": [], "timeline": [],
            "asked": [], "last_action": None, "next_action": None, "decision_trace": None,
            "thresholds": {"support": self.cfg.support_threshold, "reject": self.cfg.reject_threshold},
            "prior_effect": prior_effect, "reviewer": None, "note": None, "reviewed_at": None,
        }
        self._timeline(h, "created", "Hypothesis created from " + (
            f"{origin_detail}'s observation" if origin == "clinician" else f"the {origin_detail}"), confidence=0.5)
        if not test:
            self._timeline(h, "note", "Could not turn this into a data test; the agent can only ask clinicians.")
        return h

    async def add_observation(self, text: str, clinician_id: str, patient_id: str | None) -> dict:
        staff = STAFF_BY_ID.get(clinician_id)
        if not staff:
            raise KeyError(clinician_id)
        if patient_id and patient_id not in PATIENT_BY_ID:
            raise KeyError(patient_id)
        parsed = await self._parse(text, patient_id)
        pe = None
        if parsed["test"] and parsed["test"]["type"] in ("time_window", "after_event"):
            pe = {"patient_id": parsed["patient_id"], "need_ids": parsed["need_ids"], "multiplier": 1.6}
            if parsed["test"]["type"] == "time_window":
                pe["hours"] = parsed["test"]["hours"]
            else:
                pe["after_visit_h"] = parsed["test"]["window_h"]
        h = self._new(hid="h-" + uuid.uuid4().hex[:10], claim=parsed["claim"], origin="clinician",
                      origin_detail=f"{staff['name']} ({staff['role']})", origin_id=clinician_id,
                      patient_id=parsed["patient_id"], test=parsed["test"], split="all",
                      cursor=now() - timedelta(days=30), observation_text=text, discovery=None, prior_effect=pe)
        await self._log(h, "created", {"origin": "clinician", "text": text})
        async with self.lock:
            rows, events = await self._data()
            await self._step(h, rows, events)
            await self._save(h)
        await self._publish()
        return h

    async def _parse(self, text: str, patient_id: str | None) -> dict:
        parsed = parse_observation(self.cat, text, PATIENT_BY_ID, patient_id)
        if self.gemini.enabled and not parsed["test"]:
            spec = await self.gemini.observation_spec(text, PATIENT_BY_ID, self.cat)
            test = validate_test(self.cat, spec, PATIENT_BY_ID) if spec else None
            if test:
                p = PATIENT_BY_ID[test["patient_id"]]
                parsed = {"patient_id": test["patient_id"], "need_ids": test.get("need_ids", []), "test": test,
                          "claim": build_claim(self.cat, p, test.get("need_ids", []), test)}
        return parsed

    async def ensure_demo_observation(self):
        if not await self.store.list_hypotheses():
            clinician, pid, text = DEMO_OBSERVATION
            await self.add_observation(text, clinician, pid)

    # ---- the loop --------------------------------------------------------------------------------

    async def cycle(self) -> list[dict]:
        """Run detectors (propose new system hypotheses), then advance every active hypothesis."""
        async with self.lock:
            rows, events = await self._data()
            existing = {h["id"]: h for h in await self.store.list_hypotheses()}
            for cand in detect(self.cat, rows, PATIENT_BY_ID, now()):
                if cand["id"] in existing:
                    continue  # never re-propose: a rejected hypothesis stays rejected
                h = self._new(hid=cand["id"], claim=cand["claim"], origin="system", origin_detail=cand["origin_detail"],
                              origin_id=None, patient_id=cand["patient_id"], test=cand["test"], split="confirm",
                              cursor=now() - timedelta(days=30), observation_text=None, discovery=cand["discovery"],
                              prior_effect=cand["prior_effect"])
                h["rationale"], h["rationale_source"] = await self.gemini.hypothesis(
                    {"title": cand["claim"], "evidence": cand["discovery"], "template_hypothesis":
                     "Detected automatically; the agent is testing it on held-out episodes before anyone reviews it."})
                self._timeline(h, "note", cand["discovery"] + " Testing on the held-out half.")
                existing[h["id"]] = h
                await self._log(h, "created", {"origin": "system"})
            for h in existing.values():
                if h["status"] in ACTIVE:
                    await self._step(h, rows, events)
                await self._save(h)
        await self._publish()
        return list(existing.values())

    async def _step(self, h: dict, rows: list[dict], events: list[dict]):
        for _ in range(self.cfg.max_actions_per_cycle):
            if h["status"] not in ACTIVE:
                break
            scores, result = await self._score(h, rows, events)
            best = scores[0]
            h["decision_trace"] = {"t": now().isoformat(), "confidence": round(h["confidence"], 3),
                                   "ranked": [a.public() for a in scores], "selected": best.kind,
                                   "selected_label": best.label}
            if best.score < self.cfg.min_score:
                if h["status"] != "INCONCLUSIVE":
                    h["status"] = "INCONCLUSIVE"
                    self._timeline(h, "status", "No action is worth its cost right now → INCONCLUSIVE (still watching)")
                h["last_action"] = "WAIT"
                break
            if best.kind == "CHECK_DATA":
                self._timeline(h, "action", "CHECK_DATA selected", score=round(best.score, 3))
                self._apply_data(h, result)
                h["last_action"] = "CHECK_DATA"
                await self._log(h, "CHECK_DATA", {"n": result.n, "k": result.k, "confidence": h["confidence"]})
            elif best.kind == "ASK_CLINICIAN":
                await self._ask(h, best)
                break
            else:
                if h["last_action"] != "WAIT":
                    self._timeline(h, "action", f"WAIT selected: about {best.detail['expected_new_episodes_24h']} "
                                                "new episode(s) expected in 24 h", score=round(best.score, 3))
                    await self._log(h, "WAIT", {})
                h["last_action"] = "WAIT"
                if h["status"] == "INCONCLUSIVE":
                    h["status"] = "INVESTIGATING"
                break
        await self._recommend(h, rows, events)

    async def _score(self, h: dict, rows, events) -> tuple[list[ActionScore], object]:
        result = None
        if h["test"]:
            result = evaluate(self.cat, h["test"], rows, events, datetime.fromisoformat(h["data_cursor"]), now(), h["split"])
        return score_actions(
            h["confidence"], n_new=result.n if result else 0, p1=result.p1 if result else None,
            p0=result.p0 if result else None, data_weight=evidence_weight(h["test"]) if h["test"] else 0.0,
            expected_new_24h=expected_per_day(h["test"], rows, h["split"], now()) if h["test"] else 0.0,
            clinicians=await self._clinicians(h), asked=set(h["asked"]), cfg=self.cfg), result

    def _apply_data(self, h: dict, r):
        before = h["confidence"]
        llr = data_log_lr(r.k, r.n, r.p1, r.p0, evidence_weight(h["test"]))
        h["confidence"] = update(before, llr)
        h["data_cursor"] = now().isoformat()
        h["evidence"].append({
            "id": uuid.uuid4().hex[:10], "t": now().isoformat(), "source": "data", "supports": r.k,
            "contradicts": r.n - r.k, "summary": r.summary, "log_lr": round(llr, 3),
            "confidence_before": round(before, 3), "confidence_after": round(h["confidence"], 3),
            "episodes": r.episodes})
        self._timeline(h, "evidence", f"Data check: {r.summary}")
        self._confidence_moved(h, before)

    def _confidence_moved(self, h: dict, before: float):
        self._timeline(h, "confidence", f"Confidence {before:.2f} → {h['confidence']:.2f}", confidence=round(h["confidence"], 3))
        th = h["thresholds"]
        if h["confidence"] >= th["support"]:
            h["status"] = "SUPPORTED_PENDING_REVIEW"
        elif h["confidence"] <= th["reject"]:
            h["status"] = "REJECTED_PENDING_REVIEW"
        else:
            return
        self._timeline(h, "status", f"Status → {h['status']}")

    async def _ask(self, h: dict, action: ActionScore):
        staff = STAFF_BY_ID[action.target]
        claim = h["claim"][0].lower() + h["claim"][1:] if h["claim"].startswith("Patients") else h["claim"]
        inquiry = {
            "id": uuid.uuid4().hex[:10], "hypothesis_id": h["id"], "clinician_id": staff["id"],
            "clinician_name": staff["name"], "clinician_role": staff["role"],
            "question": f"We are investigating whether {claim}. Does this match what you have observed?",
            "reliability": action.detail["clinician_reliability"], "status": "pending",
            "created_at": now().isoformat(), "response": None, "note": None, "answered_at": None,
        }
        await self.store.upsert_inquiry(inquiry)
        h["asked"].append(staff["id"])
        h["status"], h["last_action"] = "WAITING_FOR_CLINICIAN", "ASK_CLINICIAN"
        self._timeline(h, "action", f"ASK_CLINICIAN selected: {staff['name']} ({staff['role']})", score=round(action.score, 3))
        await self._log(h, "ASK_CLINICIAN", {"clinician": staff["id"]})

    async def _recommend(self, h: dict, rows, events):
        if h["status"] == "WAITING_FOR_CLINICIAN":
            name = STAFF_BY_ID[h["asked"][-1]]["name"]
            h["next_action"] = {"kind": "ASK_CLINICIAN", "label": f"Awaiting answer from {name}"}
        elif h["status"] in PENDING_REVIEW:
            h["next_action"] = {"kind": "REVIEW", "label": "Clinical lead review"}
        elif h["status"] in DONE:
            h["next_action"] = None
        else:
            scores, _ = await self._score(h, rows, events)
            h["next_action"] = {"kind": scores[0].kind, "label": scores[0].label}

    # ---- human input -----------------------------------------------------------------------------

    async def answer_inquiry(self, iid: str, response: str, note: str | None) -> dict:
        if response not in ("agree", "disagree", "unsure"):
            raise ValueError("response must be agree, disagree or unsure")
        async with self.lock:
            inquiry = next((i for i in await self.store.list_inquiries() if i["id"] == iid), None)
            if not inquiry:
                raise KeyError(iid)
            if inquiry["status"] != "pending":
                raise ValueError("inquiry already answered")
            h = next(x for x in await self.store.list_hypotheses() if x["id"] == inquiry["hypothesis_id"])
            inquiry.update(status="answered", response=response, note=note, answered_at=now().isoformat())
            await self.store.upsert_inquiry(inquiry)

            before = h["confidence"]
            llr = clinician_log_lr(response, inquiry["reliability"], self.cfg.clinician_weight)
            h["confidence"] = update(before, llr)
            h["evidence"].append({
                "id": uuid.uuid4().hex[:10], "t": now().isoformat(), "source": "clinician",
                "supports": int(response == "agree"), "contradicts": int(response == "disagree"),
                "summary": f"{inquiry['clinician_name']} answered {response}" + (f": “{note}”" if note else ""),
                "clinician_id": inquiry["clinician_id"], "response": response, "note": note,
                "log_lr": round(llr, 3), "confidence_before": round(before, 3),
                "confidence_after": round(h["confidence"], 3)})
            verb = {"agree": "agreed", "disagree": "disagreed", "unsure": "was unsure"}[response]
            self._timeline(h, "evidence", f"{inquiry['clinician_name']} {verb}" + (f": “{note}”" if note else ""))
            h["status"] = "INVESTIGATING"
            if response != "unsure":
                self._confidence_moved(h, before)
            await self._log(h, "clinician_response", {"response": response, "confidence": h["confidence"]})
            rows, events = await self._data()
            await self._step(h, rows, events)
            await self._save(h)
        await self._publish()
        return h

    async def review(self, hid: str, decision: str, reviewer: str, note: str | None) -> dict:
        if decision not in ("validated", "rejected", "needs_more_data"):
            raise ValueError("bad decision")
        async with self.lock:
            h = next((x for x in await self.store.list_hypotheses() if x["id"] == hid), None)
            if not h:
                raise KeyError(hid)
            if h["status"] in DONE:
                raise ValueError("hypothesis already reviewed")
            h.update(reviewer=reviewer, note=note, reviewed_at=now().isoformat())
            if decision == "needs_more_data":
                h["status"] = "INVESTIGATING"
                h["thresholds"] = {"support": 0.95, "reject": 0.05}
                self._timeline(h, "review", f"{reviewer}: needs more data" + (f" (“{note}”)" if note else "")
                               + ". Review thresholds tightened to 0.95 / 0.05.")
                rows, events = await self._data()
                await self._step(h, rows, events)
            else:
                h["status"] = "VALIDATED" if decision == "validated" else "REJECTED"
                self._timeline(h, "review", f"{reviewer}: {h['status'].lower()}" + (f" (“{note}”)" if note else ""))
                if h["status"] == "VALIDATED" and h["prior_effect"]:
                    self._timeline(h, "note", "Now shapes this patient's prior in the belief engine.")
                await self._credit_clinicians(h)
                h["next_action"] = None
            await self._log(h, "review", {"decision": decision, "reviewer": reviewer})
            await self._save(h)
        await self._publish()
        return h

    async def _credit_clinicians(self, h: dict):
        """Clinicians whose answer matched the lead's decision become more trusted, and vice versa."""
        truth = h["status"] == "VALIDATED"
        for ev in h["evidence"]:
            if ev["source"] != "clinician" or ev["response"] == "unsure":
                continue
            s = STAFF_BY_ID[ev["clinician_id"]]
            a, b = await self.store.get_reliability(f"clinician:{s['id']}") or (s["a"], s["b"])
            right = (ev["response"] == "agree") == truth
            await self.store.set_reliability(f"clinician:{s['id']}", a + right, b + (not right))

    # ---- digest ----------------------------------------------------------------------------------

    async def digest(self) -> dict:
        hs = await self.store.list_hypotheses()
        since = now() - SHIFT

        def moved(h):
            return sum(e["confidence_after"] - e["confidence_before"] for e in h["evidence"]
                       if datetime.fromisoformat(e["t"]) >= since)

        changed = [h for h in hs if abs(moved(h)) > 0.01 or any(
            t["kind"] in ("status", "review") and datetime.fromisoformat(t["t"]) >= since for t in h["timeline"])]
        facts = {
            "changed": len(changed),
            "clinician_gained": sum(1 for h in hs if h["origin"] == "clinician" and moved(h) > 0.01),
            "system_inconclusive": sum(1 for h in hs if h["origin"] == "system" and (
                h["status"] == "INCONCLUSIVE" or (h["status"] in ACTIVE and 0.35 < h["confidence"] < 0.65))),
            "pending_review": sum(1 for h in hs if h["status"] in PENDING_REVIEW),
            "waiting_clinician": len(await self.inquiries("pending")),
            "statements": [h["statement"] for h in changed][:4],
        }
        key = repr(sorted((k, v) for k, v in facts.items() if k != "statements"))
        if self._digest_cache and self._digest_cache[0] == key:
            return self._digest_cache[1]
        text, source = await self.gemini.research_digest(facts)
        if not text:
            text, source = template_digest(facts), "template"
        out = {"text": text, "source": source, "facts": facts}
        self._digest_cache = (key, out)
        return out


def _n(k: int, one: str, many: str) -> str:
    return f"{k} {one if k == 1 else many}"


def template_digest(f: dict) -> str:
    lines = [f"{_n(f['changed'], 'hypothesis', 'hypotheses')} changed this shift."]
    if f["clinician_gained"]:
        lines.append(f"{_n(f['clinician_gained'], 'clinician observation', 'clinician observations')} gained support.")
    if f["system_inconclusive"]:
        lines.append(f"{_n(f['system_inconclusive'], 'system-generated hypothesis remains', 'system-generated hypotheses remain')} inconclusive.")
    if f["waiting_clinician"]:
        lines.append(f"{_n(f['waiting_clinician'], 'question is', 'questions are')} waiting for a clinician.")
    if f["pending_review"]:
        lines.append(f"{_n(f['pending_review'], 'hypothesis is', 'hypotheses are')} waiting for clinical lead review.")
    return " ".join(lines)


async def prior_multipliers(store, patient_id: str, hour: int, recent_visit_end: datetime | None = None) -> dict[str, float]:
    """Validated hypotheses for this patient that apply right now, as need → prior multiplier."""
    mult: dict[str, float] = {}
    for h in await store.list_hypotheses():
        eff = h.get("prior_effect")
        if h["status"] != "VALIDATED" or not eff or eff["patient_id"] != patient_id:
            continue
        if eff.get("hours") and hour not in eff["hours"]:
            continue
        if eff.get("after_visit_h"):
            if not recent_visit_end or now() - recent_visit_end > timedelta(hours=eff["after_visit_h"]):
                continue
        for nid in eff["need_ids"]:
            mult[nid] = mult.get(nid, 1.0) * eff["multiplier"]
    return mult
