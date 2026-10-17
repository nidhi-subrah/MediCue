"""Reproducible demo of MediCue's Adaptive Communication Engine against a running backend.

    python -m app.sim.communication_demo A        # from backend/, with the backend running on :8000
    python -m app.sim.communication_demo all --base http://localhost:8000

Open the patient's bedside tablet (/talk/<patient id>) and the nurse station (/nurse) first: the script plays the
patient's side with real timing (response times are measured by the backend from when each question appeared),
so the tablet visibly reshapes itself and the nurse station logs why. Nothing is faked server-side.

A  Slowdown       Mr. Chen answers in 2.4, 2.7, 2.6 s, then 5.8 and 6.4 s  ->  Standard to Simplified
B  Uncertainty    "Not sure" twice -> simpler wording; twice more -> one yes/no question at a time
C  Struggling     corrections, slower answers, then silence in yes/no -> help communicating
                  -> the patient taps "Get nurse"; confirmed information goes to the nurse
"""
import argparse
import http.cookiejar
import json
import sys
import time
import urllib.request

NURSE = {"email": "nurse@medicue.demo", "password": "nurse"}


class Client:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.post("/api/auth/login", NURSE)

    def post(self, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(self.base + path, json.dumps(body or {}).encode(),
                                     {"Content-Type": "application/json"})
        return json.load(self.http.open(req))

    def get(self, path: str) -> dict:
        return json.load(self.http.open(self.base + path))


def show(s: dict, what: str):
    c = s["communication"]
    q = (s.get("question") or {}).get("text", "")
    msg = f'  «{c["message"]["text"]}»' if c.get("message") else ""
    print(f"  {what:34s} {s['status']:9s} {c['label']:10s} {q}{msg}")


def wait(seconds: float):
    time.sleep(seconds)


def skip_consults(cl: Client, s: dict) -> dict:
    while s["status"] == "waiting_consult":
        s = cl.post(f"/api/sessions/{s['session_id']}/skip_consult")
    return s


def answer(cl: Client, s: dict, value: str, after: float) -> dict:
    s = skip_consults(cl, s)
    wait(after)
    return cl.post(f"/api/sessions/{s['session_id']}/answer", {"question_id": s["question"]["id"], "answer": value})


def demo_a(cl: Client):
    print("A · Slowdown: Wei Chen (open /talk/p-chen)")
    s = cl.post("/api/sessions", {"patient_id": "p-chen", "language": "en"})
    sid = s["session_id"]
    show(s, "start")
    wait(2.4)
    s = cl.post(f"/api/sessions/{sid}/tap", {"kind": "area", "tap_id": "whole_body"})
    show(s, "taps whole body (2.4 s)")
    opt = s["options"]["predicted"][0]
    wait(2.7)
    s = cl.post(f"/api/sessions/{sid}/tap", {"kind": "feeling", "tap_id": opt["feeling"], "option_id": opt["id"]})
    show(s, f"taps {opt['label']!r} (2.7 s)")
    for secs in (2.6, 5.8, 6.4):
        s = answer(cl, s, "no", secs)
        show(s, f"answers no ({secs} s)")
        if s["communication"]["level"] > 1:
            break
    last = s["communication"]["changes"][-1] if s["communication"]["changes"] else None
    if last:
        print(f"  nurse sees: {last['from_label']} → {last['to_label']}: {last['explanation']}")


def demo_b(cl: Client):
    print("B · Uncertainty: Meera Patel (open /talk/p-patel)")
    s = cl.post("/api/sessions", {"patient_id": "p-patel", "language": "en"})
    sid = s["session_id"]
    s = cl.post(f"/api/sessions/{sid}/level", {"level": 1})
    wait(2)
    s = cl.post(f"/api/sessions/{sid}/tap", {"kind": "area", "tap_id": "belly"})
    none = next(o for o in s["options"]["more"] if o["feeling"] == "not_sure")
    wait(2)
    s = cl.post(f"/api/sessions/{sid}/tap", {"kind": "feeling", "tap_id": none["feeling"], "option_id": none["id"]})
    show(s, "taps 'None of these'")
    for _ in range(4):
        s = skip_consults(cl, s)
        if s["status"] != "question":
            break
        s = answer(cl, s, "unsure", 2.5)
        show(s, "answers 'not sure'")


def demo_c(cl: Client):
    print("C · Repeated difficulty: Meera Patel (open /talk/p-patel and /nurse)")
    s = cl.post("/api/sessions", {"patient_id": "p-patel", "language": "en"})
    sid = s["session_id"]
    for _ in range(2):   # taps, then goes back: corrections
        wait(2)
        cl.post(f"/api/sessions/{sid}/tap", {"kind": "area", "tap_id": "head"})
        s = cl.post(f"/api/sessions/{sid}/back")
    show(s, "two corrections")
    for secs in (2.4, 2.6, 2.5):
        wait(secs)
        s = cl.post(f"/api/sessions/{sid}/tap", {"kind": "area", "tap_id": "belly"}) if s["status"] == "area" else s
        if s["status"] == "feeling":
            opt = s["options"]["predicted"][0]
            s = cl.post(f"/api/sessions/{sid}/tap", {"kind": "feeling", "tap_id": opt["feeling"], "option_id": opt["id"]})
    for secs in (2.5, 6.0, 6.5, 6.8, 7.0):
        s = skip_consults(cl, s)
        if s["status"] != "question" or s["communication"]["level"] >= 3:
            break
        s = answer(cl, s, "no", secs)
        show(s, f"answers no ({secs} s)")
    if s["communication"]["level"] < 3 and s["status"] == "question":
        s = cl.post(f"/api/sessions/{sid}/level", {"level": 3, "by": "nurse"})
        show(s, "(nurse makes it easier)")
    print("  ...no response in yes/no mode; the silence monitor counts a missed response at half its timeout")
    for _ in range(60):
        wait(1)
        s = cl.get(f"/api/sessions/{sid}")
        if s["communication"].get("offer") or s["status"] == "escalated":
            break
    if s["communication"].get("offer"):
        show(s, "offer: " + s["communication"]["offer"]["message"])
        s = cl.post(f"/api/sessions/{sid}/communication/offer", {"offer": "assisted", "choice": "get_nurse"})
        show(s, "patient taps 'Get nurse'")
        summ = s["communication"]["summary"]
        print("  confirmed:", [f"{c['field']}: {c['value']}" for c in summ["confirmed"]])
        print("  unresolved:", [u["field"] for u in summ["unresolved"]])


DEMOS = {"A": demo_a, "B": demo_b, "C": demo_c}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scenario", choices=[*DEMOS, "all"])
    ap.add_argument("--base", default="http://localhost:8000")
    args = ap.parse_args()
    client = Client(args.base)
    for key in (DEMOS if args.scenario == "all" else [args.scenario]):
        DEMOS[key](client)
        print()
    sys.exit(0)
