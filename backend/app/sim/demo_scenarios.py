"""Scripted demo scenarios: one definition, run offline (the engine alone) or live (the real session service,
so the alert and case packet reach the nurse screen exactly as a real request would).

    python -m app.sim.demo_scenarios          offline: print each step, the case packet and the SBAR

ambiguous-evening
    Wei Chen, 19:00. He taps Belly, then "Feel sick" (the nearest belly option to vague discomfort). He
    answers "Not sure" to each question; fatigue rises and the tablet switches to large tiles. Once his
    answers are too inconsistent to use, the engine stops asking him and asks his daughter Lin, who is not
    sure either, and it hands the request to the nurse with a case packet: stop reason FATIGUE_HIGH.

Synthetic patient and chart. The live run only scripts the inputs; every decision is the engine's own.
"""
import asyncio
from dataclasses import asdict, dataclass

from ..catalog import Catalog, get_catalog
from ..config import EngineConfig, settings
from ..data.patients import PATIENT_BY_ID
from ..engine.belief import PriorContext, context_prior
from ..engine.decision import Consultant
from ..engine.dialogue import Dialogue
from ..services.case_packet import build_case_packet, template_case_sbar


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    patient_id: str
    hour: int                   # local time of day the scenario is set at
    area: str
    feeling: str
    option_id: str | None       # the tailored second-step option the patient picks (engine/options.py)
    answer: str                 # to every question
    consult_answer: str         # from every person consulted: a need id, None ("something else") or "unsure"
    description: str


AMBIGUOUS_EVENING = Scenario(
    id="ambiguous-evening", title="Unclear request in the evening", patient_id="p-chen", hour=19,
    area="belly", feeling="sick", option_id="belly.sick", answer="unsure", consult_answer="unsure",
    description="Wei Chen taps Belly, then “Feel sick”, and answers “Not sure” to each question. Fatigue "
                "rises, the engine stops asking him, his daughter Lin isn't sure either, and the nurse gets "
                "a case packet.")
SCENARIOS = {s.id: s for s in (AMBIGUOUS_EVENING,)}


def _clip(r: float) -> float:   # as sessions.clip
    return min(max(r, 0.55), 0.97)


# ---- offline: the engine alone --------------------------------------------------------------------

def run_offline(sc: Scenario, cat: Catalog | None = None, cfg: EngineConfig | None = None) -> dict:
    """The scenario on a bare Dialogue: evening prior, the patient's chart flags and people, no store."""
    cat, cfg = cat or get_catalog(), cfg or settings.engine
    p = PATIENT_BY_ID[sc.patient_id]
    prior, _ = context_prior(cat, PriorContext(hour=sc.hour, days_since_surgery=p["days_since_surgery"]))
    people = [Consultant(x["id"], x["name"], x["relation"], _clip(x["a"] / (x["a"] + x["b"]))) for x in p["people"]]
    d = Dialogue(cat, cfg, prior, _clip(p["signal"]["a"] / (p["signal"]["a"] + p["signal"]["b"])), people,
                 {k: v["flag"] for k, v in p["chart"].items()})
    steps = []

    def log(text: str, decision):
        steps.append({"text": text, "next": decision.chosen.kind, "fatigue": round(d.fatigue(), 2),
                      "can_answer": d.patient_can_answer})

    d.apply_tap("area", sc.area)
    dec = d.step()
    log(f"Tapped {cat.area_labels[sc.area]}", dec)
    d.apply_tap("feeling", sc.feeling)
    dec = d.step()
    log(f"Tapped {cat.feeling_labels[sc.feeling]}", dec)
    for _ in range(12):
        if dec.chosen.kind == "ask":
            q = cat.question_by_id[dec.chosen.id]
            d.apply_answer(q.id, sc.answer)
            dec = d.step()
            log(f"{q.text} → {sc.answer}", dec)
        elif dec.chosen.kind == "consult":
            person = next(c for c in people if c.id == dec.chosen.id)
            options = d.consult_options()
            d.mark_consulted(person.id)
            d.apply_consult(person, options, sc.consult_answer)
            dec = d.step()
            log(f"Asked {person.name}: {sc.consult_answer}", dec)
        else:
            break
    from ..engine.conformal import ConformalPredictor
    cp = ConformalPredictor()
    cp.qhat = 0.955   # the app's calibrated value (sim.simulator.calibrate)
    status = "escalated" if dec.chosen.kind == "escalate" else "sent"
    pkt = build_case_packet(cat, cfg, d, session_id=f"offline-{sc.id}", patient_id=sc.patient_id,
                            prediction_set=cp.predict_set(cat.need_ids, d.belief), decision=dec, status=status,
                            chart=p["chart"]).public()
    return {"scenario": asdict(sc), "steps": steps, "packet": pkt, "sbar": template_case_sbar(pkt, p)}


# ---- live: the real session service ---------------------------------------------------------------

async def run_live(svc, sc: Scenario, pause_s: float = 0.0) -> dict:
    """Drive the scenario through SessionService: the alert and case packet go to the nurse as usual."""
    st = await svc.start(sc.patient_id, "en", "grid", hour=sc.hour)
    sid = st["session_id"]
    steps = [{"text": f"Session at {sc.hour:02d}:00 (scripted time)", "status": st["status"],
              "fatigue": st["fatigue"], "mode": st["mode"]}]

    def log(text: str, st: dict):
        steps.append({"text": text, "status": st["status"], "fatigue": st["fatigue"], "mode": st["mode"]})

    async def pause():
        if pause_s:
            await asyncio.sleep(pause_s)

    st = await svc.tap(sid, "area", sc.area)
    log(f"Tapped {svc.cat.area_labels[sc.area]}", st)
    await pause()
    try:
        st = await svc.tap(sid, "feeling", sc.feeling, sc.option_id)
    except ValueError:   # the option wasn't offered this time: send the same feeling tap without it
        st = await svc.tap(sid, "feeling", sc.feeling)
    log(f"Tapped {(svc.sessions[sid].choice or {}).get('label') or svc.cat.feeling_labels[sc.feeling]}", st)
    for _ in range(12):
        await pause()
        if st["status"] == "question":
            q = st["question"]
            st = await svc.answer(sid, q["id"], sc.answer)
            log(f"{q['text']} → {sc.answer}", st)
        elif st["status"] == "waiting_consult":
            c = st["consult"]
            await svc.answer_consult(c["id"], sc.consult_answer)
            st = await svc.state(svc.sessions[sid])
            log(f"Asked {c['person_name']} ({c['relation']}): {sc.consult_answer}", st)
        else:
            break
    return {"scenario": asdict(sc), "session_id": sid, "alert_id": st["alert_id"], "status": st["status"],
            "steps": steps}


def main():
    for sc in SCENARIOS.values():
        out = run_offline(sc)
        print(f"SYNTHETIC DEMO: {sc.title} ({sc.id})\n{sc.description}\n")
        for s in out["steps"]:
            print(f"  {s['text']:70} next: {s['next']:8} fatigue {s['fatigue']:.2f}"
                  + ("" if s["can_answer"] else "  (answers no longer reliable)"))
        p = out["packet"]
        print(f"\nStop reason: {p['stop_reason']['code']}. {p['stop_reason']['text']}")
        print(f"Uncertainty: {p['uncertainty']['text']}")
        print(f"Next step:   {p['next_step']['text']}\n\nSBAR (template):")
        for k, v in out["sbar"].items():
            print(f"  {k[0].upper()}: {v}")


if __name__ == "__main__":
    main()
