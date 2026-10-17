# SilentSignal — Product Requirements Document

Oct 16, 2026 · @Anni

## Overview

SilentSignal turns a few taps from a patient who cannot speak into a precise, structured clinical message, and states how certain it is. Behind the interface, a decision engine chooses the best next move each time: ask the patient a question, look up their chart, consult someone who knows them, or escalate to a nurse immediately.

**Problem.** Patients after a stroke, with ALS, intubated or recovering from surgery, or with significant communication barriers often cannot say what they need. Picture boards and AAC apps make them assemble words slowly, and nurses are left guessing. Misread needs mean unmanaged pain, missed deterioration, falls while trying to reach the washroom alone, and distress.

**What is new.** SilentSignal treats communication as inference under uncertainty, not typing:

- A Bayesian belief model keeps probabilities over possible needs and updates them with every tap and every piece of context.
- A decision engine weighs the value of more information against patient fatigue, delay and clinical risk, so a likely cardiac problem is escalated at once while a likely washroom request is clarified first.
- The system learns how reliable each source is: the patient's own signals, each family member, each nurse.
- Patterns confirmed across patients feed a human-in-the-loop research loop, where an agent proposes findings and clinicians validate them.

**Target users.** Patients with limited speech (primary), bedside nurses and personal support workers in hospitals and long-term care (primary), family caregivers (secondary), and clinical leads who review patterns across a unit (secondary).

**Hackathon setting.** Built for Hack the Valley as a working prototype with synthetic patient data. It is a communication aid, not a diagnostic device.

## Goals, non-goals and success metrics

**Goals**

1. Let a patient communicate a specific need in 5 taps or fewer, including clarifying questions.
2. Escalate high-risk needs (for example chest pain, breathing difficulty) without waiting for clarification.
3. Give the care team calibrated uncertainty, not a single confident guess.
4. Reduce the patient's effort as they tire, by drawing on chart context and people who know them.
5. Turn confirmed interpretations into patterns the care team can review and validate over time.

**Non-goals**

- Diagnosing conditions or recommending treatment.
- Replacing nurse assessment, call bells or existing emergency systems.
- Real EHR integration during the hackathon (chart data is mocked).
- Full eye-gaze tracking (taps first, gaze as a stretch goal).

**Success metrics for the demo** (measured on synthetic scenarios)

| Metric | Target |
| --- | --- |
| Correct top need after the dialogue | 85% or more |
| True need inside the conformal prediction set | 90% coverage |
| Patient taps per resolved need | 5 or fewer on average |
| High-risk scenarios escalated without a clarifying question | 100% |
| Questions saved vs. a fixed question tree | 40% or more |
| Time from first tap to nurse alert, high-risk case | under 10 seconds |

## Personas and user stories

| Persona | Situation | What they need from SilentSignal |
| --- | --- | --- |
| Mr. Chen, 74, patient | 2 days after a stroke, right-side weakness, cannot speak clearly, tires quickly | Be understood with minimal effort; get help fast when something is wrong |
| Priya, RN | Night shift, 6 residents, interrupted constantly | Know what the patient needs, how sure the system is, and how urgent it is, at a glance |
| Lin, daughter | Visits daily, understands her father's gestures better than staff | Help interpret from her phone when the system is unsure |
| Dr. Okafor, clinical lead | Reviews quality and safety across the unit | See recurring patterns (for example pain reports rising after a medication change) and validate them |

**User stories**

- As a patient, I tap a body area and a feeling, and the system asks me at most one or two yes/no questions before help is on the way.
- As a patient who is tired, I am asked fewer questions as my taps slow down.
- As a nurse, I get an alert in a standard handoff format with the top needs, their probabilities, what was asked, and relevant chart context.
- As a nurse, I confirm or correct what the patient actually needed in one tap, so the system learns.
- As a family member, I receive a short question about my relative's gesture and answer it from my phone.
- As a clinical lead, I review patterns the system has surfaced and mark each one validated, rejected or needing more data.
- As a patient who does not speak English, my message reaches the nurse in English and the system's questions reach me in my language.

## Core system

The intelligence lives in two engines the team builds itself. Gemini is used only for language: writing messages, translating and reading free-text notes. It never makes the escalation decision.

### 1. Belief engine

Keeps a probability distribution over about 20 needs in 5 groups: pain (with body location), breathing, toileting, comfort (temperature, position, thirst), and emotional or other (anxiety, family, medication timing).

- **Prior:** set from context such as days since surgery, current medications, time since last pain medication, time of day and the patient's own history.
- **Likelihoods:** how probable each tap is given each need, adjusted by the patient's signal reliability.
- **Update:** Bayes' rule after every tap, chart lookup and answer from a consulted person.
- **Calibrated output:** conformal prediction produces the smallest set of needs that contains the true need 90% of the time on calibration data.

### 2. Decision engine (Ask, Look Up, Consult, Escalate)

After each update, the engine scores four kinds of action and executes the best one.

| Action | What it does | Main cost |
| --- | --- | --- |
| Ask the patient | The single yes/no question with the highest expected information gain | Patient effort and fatigue, time |
| Look up | Pull a chart field (last analgesic, vitals trend, allergies) | Near zero |
| Consult | Message the person most likely to know (family member, regular nurse) | Their time, waiting for a reply |
| Escalate | Alert the nurse now with the current belief | False alarm cost, but no delay |

Each action is scored by the risk-weighted value of the information it brings, minus its costs:

```latex
\text{score}(a) = \mathbb{E}\left[\Delta \text{expected loss} \mid a\right] - \lambda_F \cdot \text{fatigue}(a) - \lambda_D \cdot \text{delay}(a) \cdot \text{risk}(b)
```

The loss is asymmetric: missing a cardiac or breathing problem costs far more than confusing thirst with feeling cold. As a result, when the probability of any high-risk need passes a threshold, the cost of delay outweighs any further questions and the engine escalates immediately.

### 3. Fatigue model

Tracks response latency, tap accuracy and inconsistency across the session. As fatigue rises, each patient question becomes more costly, and the engine shifts toward chart lookups and consulting others. It also stops asking entirely and escalates with uncertainty when the patient can no longer respond reliably.

### 4. Source reliability

Every source has a reliability score that starts neutral and updates when a nurse confirms the true need:

- the patient's own tap patterns (for example "a double-tap on the abdomen usually means nausea")
- each family member and caregiver who answers consults
- each chart field's predictive value for this patient

Reliability is modelled as a Beta distribution per source, so new sources are treated cautiously and trusted sources gain weight in both the belief update and the choice of whom to consult.

### 5. Output

When the engine escalates or resolves a need, Gemini turns the structured belief into a short SBAR-style message (Situation, Background, Assessment, Recommendation) for the nurse, and into plain language in the patient's preferred language for confirmation.

## Research loop: humans and agents discovering patterns together

Every confirmed interpretation is a small data point about how non-verbal patients communicate and what precedes their needs. The research loop is an agent that mines these data points for patterns, decides when to test a pattern on the data and when to ask a clinician, and keeps the care team informed. This is the same Ask-or-Run logic as the bedside engine, applied one level up.

**How it works**

1. **Builds on what the team already knows.** Clinicians record their own observations and the guidance they rely on (for example a unit's pain protocol, notes on a resident's habits). The agent treats these as prior beliefs instead of starting from zero.
2. **Proposes hypotheses.** It scans Tiger Data for recurring patterns, for example "pain reports in the lower back rise on day 2 to 3 after a specific mobility change" or "this patient's nausea reports cluster 1 hour after a medication round."
3. **Decides: test or ask.** For each hypothesis it estimates whether running a check on existing data or asking a specific clinician is more informative. It asks the person whose expertise and past answers make them most likely to resolve it, and learns whose input has proven reliable.
4. **Keeps humans informed.** A weekly digest, and an immediate note when a finding contradicts something a clinician previously recorded, sent to that clinician.
5. **Feeds back to the bedside.** Validated patterns update the belief engine's priors for that patient or unit. Rejected patterns are kept with the reason so they are not re-proposed.

**Example finding card**

> Hypothesis: Mr. Chen's "abdomen + discomfort" taps between 18:00 and 20:00 usually mean he needs the washroom, not pain (7 of 9 confirmed). Checked against chart: no GI medications. Asked: Priya (regular evening nurse). Status: awaiting validation.

**Scope for the hackathon:** hypothesis generation from synthetic data, the test-or-ask decision, and the finding cards with validate and reject buttons. Literature search is a stretch goal.

## Feature requirements

P0 is required for the demo, P1 strengthens judging, P2 is a stretch goal.

| ID | Feature | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| F1 | Bedside tap interface | P0 | Body map plus feeling and intensity icons; targets at least 80 px; usable with one hand; yes/no answers as two large buttons |
| F2 | Belief engine | P0 | Updates after every input in under 200 ms; shows top 3 needs with probabilities |
| F3 | Decision engine | P0 | Chooses among ask, look up, consult and escalate using the scoring rule; high-risk scenarios escalate without questions |
| F4 | Expected-information-gain question selection | P0 | Picks the question that most reduces uncertainty; fewer questions than a fixed tree on test scenarios |
| F5 | Nurse dashboard and alerts | P0 | Real-time alert with SBAR message, probabilities, actions taken and chart context; one-tap confirm or correct |
| F6 | Fatigue model | P0 | Fatigue score from latency and inconsistency; visibly changes the chosen action in the demo |
| F7 | Gemini message generation | P0 | Structured JSON in, SBAR text out; patient-facing confirmation in plain language |
| F8 | Tiger Data storage | P0 | Events, beliefs and confirmations stored as time series; dashboard trends from continuous aggregates |
| F9 | Consult flow | P1 | Family or nurse receives a yes/no question on their phone; answer updates the belief |
| F10 | Source reliability learning | P1 | Beta reliability per source, updated on confirmation; visible on the dashboard |
| F11 | Conformal prediction sets | P1 | Coverage of at least 90% on held-out synthetic scenarios |
| F12 | Translation | P1 | Patient questions in their language; nurse output in English |
| F13 | Research loop agent | P1 | Generates finding cards from stored data; test-or-ask decision; validate and reject buttons |
| F14 | Trend view for the care team | P1 | Per-patient chart of reported needs over days (for example rising pain reports) |
| F15 | Gaze input | P2 | MediaPipe face mesh dwell selection as an alternative to taps |
| F16 | Single-muscle switch input | P2 | ESP32 plus EMG sensor or a button switch mapped to scanning selection |
| F17 | Literature-aware research loop | P2 | Agent cites published guidance when proposing or questioning a pattern |

## Architecture and tech stack

All decisions are made in a Python core the team writes; Tiger Data stores every signal over time, and Gemini only turns structured results into language.

[Embedded diagram: SilentSignal architecture · inputs, core engines, outputs, storage]

Inputs flow into the core, the decision engine picks the next action, and outputs go to the nurse and, through Gemini, into words. The research loop reads from Tiger Data and sends validated patterns back as new priors.

### Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Bedside, family and nurse interfaces | Next.js + Tailwind, deployed on Vercel | One codebase for tablet, phone and laptop views |
| Realtime | WebSockets (FastAPI) | Sub-second alerts and live belief bars |
| Core engines | Python, FastAPI, NumPy, SciPy | Bayesian updates, information gain and scoring stay fast and explainable |
| Calibrated uncertainty | MAPIE (conformal prediction) | Coverage guarantee on prediction sets |
| Time-series storage | Tiger Data (PostgreSQL with hypertables, continuous aggregates) | Every tap, belief and confirmation is time-stamped; trends without extra infrastructure |
| Language | Gemini API with structured JSON output | SBAR messages, translation, note extraction, finding cards |
| Synthetic data | Synthea plus scripted scenarios | Realistic charts without real patient data |
| Domain | GoDaddy Registry domain | Public demo URL for judges |
| Stretch inputs | MediaPipe face mesh; ESP32 with button or EMG sensor | Gaze or single-muscle selection |

### Tiger Data schema

| Table | Type | Key columns |
| --- | --- | --- |
| tap\_events | Hypertable | time, patient\_id, session\_id, input\_type, value, latency\_ms |
| belief\_snapshots | Hypertable | time, patient\_id, need, probability, in\_conformal\_set |
| actions | Hypertable | time, patient\_id, action\_type, target, score, outcome |
| confirmations | Hypertable | time, patient\_id, confirmed\_need, confirmed\_by |
| source\_reliability | Regular table | source\_id, patient\_id, alpha, beta, updated\_at |
| findings | Regular table | id, hypothesis, evidence\_query, asked\_person, status, reason |
| daily\_needs\_by\_patient | Continuous aggregate | day, patient\_id, need, count, mean\_probability |

### Where Gemini is used

- **SBAR message** from the structured belief state, for the nurse alert.
- **Patient-facing text** in plain language and the patient's preferred language.
- **Note extraction:** turns free-text chart notes into structured context for the priors.
- **Finding cards:** writes the research loop's hypotheses and questions to clinicians in readable form.

Gemini receives structured JSON and returns structured JSON or text. It never sees the escalation decision as an open question, so a language-model error cannot suppress an alert.

## Prize track alignment

SilentSignal targets six tracks. PointClickCare and Healthcare are the strongest fits; Papiers is the one to argue carefully, through the research loop.

| Track | Fit | What to show judges |
| --- | --- | --- |
| PointClickCare: Catch It Early | Strong | A care-team tool: the trend view and research loop catch rising pain, toileting patterns or new distress days earlier in residents who cannot report it themselves |
| Best Healthcare & Well-being Hack | Strong | Non-verbal patients get understood faster with less effort; unmet needs, falls and distress drop |
| Papiers: Autoresearch Challenge | Moderate, argue it explicitly | The research loop builds on what clinicians already know, combines knowledge across several people, asks the right expert, and keeps humans informed |
| \[MLH\] Best Use of Tiger Data | Strong | Hypertables for every tap, belief and confirmation; continuous aggregates power live trends; the research agent queries patterns across time |
| \[MLH\] Best Use of Gemini API | Good | SBAR message generation, translation, extracting structured context from free-text chart notes, writing finding cards |
| \[MLH\] Best Domain Name from GoDaddy Registry | Easy | Register a short, memorable domain and host the demo on it |
| Best AI for Social Impact Hack (optional extra) | Strong | The decision engine and calibrated uncertainty are the AI story |

**Domain candidates** (availability not checked yet): silentsignal.care, silentsignal.health, saysilent.ca, silentsig.net. Register one early on Saturday and point it at the Vercel deployment.

## Demo script (4 minutes)

Three devices: a tablet as the bedside screen, a laptop as the nurse dashboard, a phone as the daughter. Each scenario shows the engine making a different decision.

1. **Hook (30 s).** "Mr. Chen had a stroke two days ago. He knows exactly what he needs. He just can't say it."
2. **Scenario 1, low stakes: the engine asks (45 s).** Tap abdomen, then discomfort. The engine asks one question ("Do you need the washroom?"), the patient taps yes, and a routine request reaches the nurse. Point out the belief bars moving and that it chose the single most useful question.
3. **Scenario 2, high stakes: the engine escalates (45 s).** Tap chest, then pain, then worsening. No questions: the nurse dashboard lights up within seconds with probabilities and context (2 days post-op, on anticoagulants). Explain the asymmetric loss: waiting is the dangerous choice.
4. **Scenario 3, patient tiring: the engine consults (60 s).** Taps become slow and inconsistent; the fatigue meter rises. Instead of another question, the daughter's phone receives "Does a double tap on his stomach usually mean nausea?" She taps yes, the belief resolves, and her reliability score rises on the dashboard.
5. **Research loop (40 s).** Open a finding card generated from a week of synthetic data, show the agent's choice to ask Priya rather than run another check, and click validate. Show the patient's priors updating.
6. **Close (20 s).** Built-in engines, not a chatbot: Bayesian belief, information-gain questions, risk-weighted decisions, learned reliability, with Tiger Data storing every signal over time.

## Build plan, risks and open questions

### Build plan (about 36 hours)

1. **Hours 0 to 3: foundation.** Register the domain, set up Tiger Data, FastAPI and Next.js skeletons, and define the need list, tap vocabulary and synthetic patients.
2. **Hours 3 to 12: engines.** Belief engine with priors and likelihoods, information-gain question selection, decision scoring with asymmetric loss. Test on scripted scenarios in Python before any UI.
3. **Hours 12 to 20: interfaces.** Bedside tap screen, nurse dashboard with WebSocket alerts, Gemini SBAR output, confirm and correct flow.
4. **Hours 20 to 28: depth.** Fatigue model, consult flow on the phone, source reliability, conformal calibration, trend view from continuous aggregates.
5. **Hours 28 to 33: research loop.** Hypothesis generation over a week of synthetic data, test-or-ask decision, finding cards.
6. **Hours 33 to 36: polish.** Rehearse the three scenarios, fix edge cases, record a backup video, write the Devpost.

### Suggested roles for a team of four

| Role | Owns |
| --- | --- |
| AI engine lead | Belief engine, decision engine, conformal prediction, fatigue model |
| Backend and data | FastAPI, Tiger Data schema and aggregates, research loop queries, Gemini integration |
| Bedside and family frontend | Tap interface, consult phone view, accessibility, translation display |
| Nurse dashboard and demo | Dashboard, alerts, trend view, finding cards, pitch and demo script |

### Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Likelihood tables are guesses | Say so openly; show they are learned per patient from confirmations; cite that the method, not the numbers, is the contribution |
| Decision engine too slow or unstable | Small need space (about 20), precomputed likelihoods, cap the question pool |
| Live demo failure | Seeded scenarios with a replay mode; backup video |
| Judges see a "Gemini wrapper" | Show the belief bars and action scores live; Gemini output appears only at the end |
| Scope creep across conditions | Demo one patient type (post-stroke) and mention others as extensions |

### Safety and ethics

- A communication aid, never a diagnosis; every alert says what the system is unsure about.
- High-risk needs always escalate; the system can never decide not to alert.
- The nurse always confirms; the system never acts clinically on its own.
- Consent is required before family members are added as consult sources.
- Synthetic data only during the hackathon; no real patient information.
- Research findings are hypotheses until a clinician validates them.

### Open questions

- [ ] Final need list and tap vocabulary: which 20 needs, which icons?
- [ ] Escalation threshold for high-risk needs: what probability triggers immediate escalation?
- [ ] Which domain do we register?
- [ ] Do we pitch to PointClickCare as long-term care or hospital post-op?
- [ ] Is anyone on the team building the P2 switch or EMG input?
