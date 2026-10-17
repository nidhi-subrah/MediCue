"""Clinician copilot on the synthetic simulator.

    python -m app.sim.copilot_report                  (from backend/)
    python -m app.sim.copilot_report --n 1000 --seed 3
    python -m app.sim.copilot_report --gemini 20      also send 20 packets to Gemini (needs GEMINI_API_KEY)

Runs the noisy synthetic patient population through the real engine (sim/simulator.py), builds the case
packet each episode would get, and reports:
  * how many episodes ended ambiguous (any stop_reason but RESOLVED), by stop reason
  * how often the suggested next step pointed at the true need's category: the step's focus need is in
    the same group (pain, breathing, toileting, comfort, emotional) as the need the simulated patient
    really had, which stands in for what the nurse would confirm
  * Gemini: how many SBARs failed validation and fell back to the template, and how many got no reply.
    Only real calls are counted; without a key or --gemini, it says so instead of guessing.

Synthetic patients that follow the engine's own likelihood model: a regression check, not evidence of
clinical benefit.
"""
import argparse
import asyncio
import random
from collections import Counter

from ..catalog import get_catalog
from ..config import settings
from ..services.case_packet import build_case_packet
from ..services.gemini import Gemini
from .simulator import calibrate, run_dialogue

SIM_PATIENT = {"name": "Synthetic patient", "room": "SIM-1", "diagnosis": "", "chart": {}}


def episodes(n: int, seed: int) -> list[dict]:
    cat, cfg = get_catalog(), settings.engine
    conformal = calibrate(cat, cfg)                       # the same calibration the app does at startup
    rng = random.Random(seed)
    out = []
    for i in range(n):
        r = run_dialogue(cat, cfg, rng)
        status = "escalated" if r.outcome == "escalate" else "sent"
        pkt = build_case_packet(cat, cfg, r.dialogue, session_id=f"sim-{i}", patient_id="sim",
                                prediction_set=conformal.predict_set(cat.need_ids, r.dialogue.belief),
                                decision=r.decision, status=status, now=0).public()
        focus = pkt["next_step"]["need"]
        out.append({
            "true_need": r.true_need, "packet": pkt,
            "ambiguous": pkt["stop_reason"]["code"] != "RESOLVED",
            "category_match": bool(focus) and cat.by_id[focus]["group"] == cat.by_id[r.true_need]["group"],
            "true_in_top3": r.true_need in {n["need"] for n in pkt["top_needs"]},
            "true_called_less_likely": r.true_need in {x["need"] for x in pkt["less_likely"]},
        })
    return out


async def gemini_outcomes(packets: list[dict], limit: int) -> tuple[Counter, Counter]:
    g, cat = Gemini(), get_catalog()
    outcomes, problems = Counter(), Counter()
    for p in packets[:limit]:
        _, _, outcome, why = await g.case_sbar_detail(p, SIM_PATIENT, cat)
        outcomes[outcome] += 1
        problems.update(x.split(":")[0] for x in why)
    return outcomes, problems


def pct(a: int, b: int) -> str:
    return f"{a}/{b} ({a / b:.0%})" if b else "0/0"


def main():
    ap = argparse.ArgumentParser(description="Clinician copilot on the synthetic simulator.")
    ap.add_argument("--n", type=int, default=400)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--gemini", type=int, default=0, help="send this many ambiguous packets to Gemini")
    args = ap.parse_args()

    eps = episodes(args.n, args.seed)
    amb = [e for e in eps if e["ambiguous"]]
    print(f"SYNTHETIC DATA. {args.n} simulated episodes (seed {args.seed}).\n")

    print(f"Ended ambiguous (stop_reason not RESOLVED): {pct(len(amb), len(eps))}")
    by_stop = Counter(e["packet"]["stop_reason"]["code"] for e in eps)
    for code, n in by_stop.most_common():
        print(f"  {code:22} {n:5}")

    print("\nNext step pointed at the true need's category (ambiguous episodes):")
    print(f"  overall                {pct(sum(e['category_match'] for e in amb), len(amb))}")
    for code in sorted({e["packet"]["next_step"]["code"] for e in amb}):
        group = [e for e in amb if e["packet"]["next_step"]["code"] == code]
        print(f"  {code:22} {pct(sum(e['category_match'] for e in group), len(group))}")
    print("  by stop reason (SAFETY_FLOOR steps confirm the high-risk need on purpose, not the most likely one):")
    for code in sorted({e["packet"]["stop_reason"]["code"] for e in amb}):
        group = [e for e in amb if e["packet"]["stop_reason"]["code"] == code]
        print(f"    {code:20} {pct(sum(e['category_match'] for e in group), len(group))}")
    full = [e for e in amb if e["packet"]["variant"] == "full"]
    print(f"\nTrue need in the packet's top 3:              {pct(sum(e['true_in_top3'] for e in amb), len(amb))}")
    print(f"True need listed as 'less likely' (misleading): {pct(sum(e['true_called_less_likely'] for e in full), len(full))}"
          "  (full packets)")

    print("\nGemini SBARs:")
    if args.gemini <= 0:
        print("  not run (pass --gemini N to send N ambiguous packets to Gemini).")
    elif not settings.gemini_api_key:
        print(f"  not run: GEMINI_API_KEY is not set, so all {len(amb)} ambiguous episodes would use the "
              "template SBAR. 0 Gemini outputs, 0 failed validation.")
    else:
        outcomes, problems = asyncio.run(gemini_outcomes([e["packet"] for e in amb], args.gemini))
        sent = sum(outcomes.values())
        print(f"  sent                   {sent}")
        print(f"  passed validation      {pct(outcomes['gemini'], sent)}")
        print(f"  failed validation      {pct(outcomes['rejected'], sent)}  -> template")
        print(f"  no reply (error/quota) {pct(outcomes['no_reply'], sent)}  -> template")
        for why, n in problems.most_common(5):
            print(f"    rejected for: {why} ({n})")


if __name__ == "__main__":
    main()
