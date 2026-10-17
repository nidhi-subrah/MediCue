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
| `app/engine/dialogue.py` | One dialogue's state and decision loop, no I/O (shared by live sessions and the simulator); fatigue model |
| `app/engine/profile.py` | Patient profiles: validation, caps and safety rules, effects on prior, fatigue, consults and access mode. **Full feature summary in its docstring** |
| `app/services/profiles.py` | Gemini reads chart notes into profiles; nurse-note suggestions and their approval |
| `app/services/handoff.py` | Shift summary: backend facts per patient, Gemini headline and "watch for" lines |
| `app/sim/` | Synthetic patients, conformal calibration, `evaluate.py` metrics |
| `app/services/sessions.py` | Live sessions, alerts, consults, learning from nurse confirmations, welfare checks |
| `app/services/gemini.py` | SBAR, translation, caregiver questions, hypotheses, each with a template fallback |
| `app/services/trends.py` | Last 24 h vs each patient's own baseline |
| `app/engine/research_decision.py` | Research decision engine: CHECK_DATA / ASK_CLINICIAN / WAIT scored by expected information gain − cost |
| `app/services/research_data.py` | Hypothesis data tests, the three detectors (now proposers), free-text observation parser |
| `app/services/research.py` | Research agent lifecycle: hypotheses, evidence, inquiries, lead review, digest, prior multipliers |
| `app/store/` | `MemoryStore` (default) and `TimescaleStore` (`DATABASE_URL` set), `schema.sql` |

## Safety rules (deterministic, no network)

1. If P(any high-risk need) ≥ 0.25, escalate with no further questions.
2. That check also runs on a belief built only from patient and caregiver signals, so chart data can raise urgency but never cancel a patient-signalled emergency.
3. Patient history may raise a high-risk need's prior but never lower it.
4. Chart fields pulled after an escalation are shown to the nurse but don't change the belief.
5. The nurse alert is pushed before any logging or Gemini call. Gemini only rewrites the SBAR text afterwards.
6. Patient profiles (from Gemini reading chart notes) are bounded: every item must quote the notes, multipliers are
   fixed constants capped at 2×, high-risk needs can never be made less likely (not even by renormalising), and
   sessions never wait for Gemini. Profile changes suggested from nurses' notes apply only after a nurse approves them.

## Patient profiles, shift summary and nurse-note suggestions

Gemini reads each patient's chart notes into a structured profile (`app/engine/profile.py` has the full summary):

| Notes say | Profile item | Engine effect |
|---|---|---|
| "Tires quickly" | fatigue: elevated | fatigue × 1.3, so fewer questions sooner |
| "Lin … reads his gestures well" | person_trust: higher | Lin's reliability prior +3 hits |
| "Husband Miguel present evenings" | person_available, evening hours | not consulted outside those hours |
| "Prefers switch scanning when tired" | access: scan | tablet switches to scanning (not large tiles) on fatigue |
| "Becomes anxious in late afternoon and evening" | need: anxious, raise, 16–24 h | prior × 1.5 in those hours |

Fatigue also uses each patient's own usual pace (median seconds per input over 14 days) and counts
inconsistent answers; after two the engine stops asking the patient.

| Route | What |
|---|---|
| `GET /api/patients/{id}/profile` | Profile items with their quotes and effects, plus anything dropped and why |
| `POST /api/patients/{id}/notes` | Edit the notes; Gemini re-reads them |
| `POST /api/alerts/{id}/confirm` | Now takes an optional `note`; Gemini suggests profile changes from it |
| `GET /api/suggestions`, `POST /api/suggestions/{id}/review` | Pending / duplicate / blocked suggestions; approve or reject |
| `GET /api/handoff?hours=12` | Shift summary |

**Gemini quota.** The free tier allows only a few requests a minute and a small daily total per model. Startup
uses one request (all notes in one batch); the first research run uses templates. On a 429 the client retries
once if asked to wait ≤ 60 s, otherwise it pauses Gemini until the quota resets and uses templates
(`/api/health` shows `gemini_paused_s`). If the default model's quota runs out, set `GEMINI_MODEL` to another
model the key can use (for example `gemini-flash-latest`): quotas are per model.

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

## Research agent

```
observation / detector → hypothesis (confidence 0.5)
  → CHECK_DATA | ASK_CLINICIAN | WAIT   (argmax of info gain − cost, every step logged with its scores)
  → evidence → Bayesian update → ... → ≥ 0.90 or ≤ 0.10 → pending review
  → clinical lead: validate | reject | needs more data (thresholds tighten to 0.95 / 0.05)
  → validated + prior effect → shapes the patient's prior in the belief engine
```

- **No double-dipping**: detectors look at a "discover" half of episodes (hash of session id). System hypotheses are
  tested only on the held-out "confirm" half. Clinician observations come from outside the data and use all of it.
- **Tempered evidence**: episodes from one patient are correlated, so data log-likelihood ratios are weighted
  (0.25 for episodes, 0.6 for daily aggregates). Clinician answers are weighted 0.7. No single source settles a hypothesis.
- **Who gets asked**: only staff who know the patient. The person who made the observation has their reliability
  discounted on their own idea, so the agent prefers a second opinion. Asking while a worthwhile free data check is
  pending carries an `unchecked_data` cost.
- **Learning**: when the lead validates or rejects, each clinician who answered gets a Beta update to their reliability.
- **Nothing is deleted**: evidence, timeline and decision traces are appended. Rejected hypotheses are never re-proposed.
- Background cycle every `RESEARCH_TICK_S` (default 300 s) re-checks active hypotheses as new confirmations arrive.

## Tuning knobs (`app/config.py → EngineConfig`)

- `lambda_their_time` sets how often family is consulted. At 5, ~60% of noisy simulated dialogues consult; at 10 it drops to 40%, but coverage falls below 90%.
- `escalate_threshold`, `false_alarm_cost` trade missed escalations against false alarms.
- `info_weight` (μ) is how much information gain counts beyond one-step loss reduction. Without it the engine never asks confirming questions.
