# backend/

FastAPI service with the two engines the team owns (belief + decision), live sessions, the
"Catch It Early" trend view, the research loop and the welfare-check extension.

## Run

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --env-file .env      # .env optional, see .env.example
.venv/bin/python -m pytest -q                                 # tests
.venv/bin/python -m app.sim.evaluate                          # PRD metrics on synthetic scenarios
```

With no environment variables it runs fully in memory with template text, seeded with 8 days of synthetic history.

## Layout

| Path | What |
|---|---|
| `app/engine/belief.py` | Bayes updates, tap/answer/consult likelihoods, context prior |
| `app/engine/decision.py` | Ask / Look up / Consult / Escalate / Send scoring + safety floor |
| `app/engine/conformal.py` | Split conformal prediction sets (90%) |
| `app/engine/dialogue.py` | One dialogue's state and decision loop, no I/O (shared by live sessions and the simulator) |
| `app/sim/` | Synthetic patients, conformal calibration, `evaluate.py` metrics |
| `app/services/sessions.py` | Live sessions, alerts, consults, learning from nurse confirmations, welfare checks |
| `app/services/gemini.py` | SBAR, translation, caregiver questions, hypotheses, each with a template fallback |
| `app/services/trends.py` | Last 24 h vs each patient's own baseline |
| `app/services/research.py` | Pattern detectors → Gemini hypotheses → clinician review → prior multipliers |
| `app/store/` | `MemoryStore` (default) and `TimescaleStore` (`DATABASE_URL` set), `schema.sql` |

## Safety rules (deterministic, no network)

1. If P(any high-risk need) ≥ 0.25, escalate with no further questions.
2. That check also runs on a belief built only from patient and caregiver signals, so chart data can raise urgency but never cancel a patient-signalled emergency.
3. Patient history may raise a high-risk need's prior but never lower it.
4. Chart fields pulled after an escalation are shown to the nurse but don't change the belief.
5. The nurse alert is pushed before any logging or Gemini call. Gemini only rewrites the SBAR text afterwards.

## Current metrics (`python -m app.sim.evaluate`)

| Metric | Scripted scenarios | Noisy population |
|---|---|---|
| Top-1 accuracy | 0.96 | 0.77 |
| High-risk escalated with no question | 1.00 | 0.93 |
| Patient inputs per need | 2.9 | 3.5 |
| Questions saved vs 3-question tree | 70% | 50% |
| Conformal coverage (target 0.90) | n/a | 0.92 |

These are synthetic: the simulated patients follow the engine's own likelihood model, plus noise. They work as a
regression suite, not as evidence of clinical benefit.

## Tuning knobs (`app/config.py → EngineConfig`)

- `lambda_their_time` sets how often family is consulted. At 5, ~60% of noisy simulated dialogues consult; at 10 it drops to 40%, but coverage falls below 90%.
- `escalate_threshold`, `false_alarm_cost` trade missed escalations against false alarms.
- `info_weight` (μ) is how much information gain counts beyond one-step loss reduction. Without it the engine never asks confirming questions.
