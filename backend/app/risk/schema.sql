-- Early-warning risk module tables. Applied idempotently by app/risk/store.py at startup.
-- The core schema (events, belief_snapshots, confirmations, ...) is app/store/schema.sql and is not changed here.

-- Mock chart activity: meals, fluids, medication rounds, medication changes, vitals.
CREATE TABLE IF NOT EXISTS chart_events (
    time        TIMESTAMPTZ NOT NULL,
    patient_id  TEXT        NOT NULL,
    kind        TEXT        NOT NULL,       -- meal | fluid | med_round | med_change | vitals
    value       DOUBLE PRECISION,           -- meal: percent eaten, fluid: mL taken, otherwise NULL
    payload     JSONB       NOT NULL DEFAULT '{}'
);
SELECT create_hypertable('chart_events', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS chart_events_patient_time ON chart_events (patient_id, time DESC);

-- Labelled outcomes: ground truth for evaluation only, never an input to a risk score.
CREATE TABLE IF NOT EXISTS outcome_events (
    id          TEXT PRIMARY KEY,
    time        TIMESTAMPTZ NOT NULL,
    patient_id  TEXT        NOT NULL,
    outcome     TEXT        NOT NULL,       -- fall | dehydration | delirium_infection_concern
    onset       TIMESTAMPTZ,                -- when the storyline started building
    description TEXT        NOT NULL,
    synthetic   BOOLEAN     NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS outcome_events_patient_time ON outcome_events (patient_id, time);

-- Synthetic cohort: storyline, baseline profile and train/test split per patient.
CREATE TABLE IF NOT EXISTS risk_cohort (
    patient_id  TEXT PRIMARY KEY,
    name        TEXT    NOT NULL,
    room        TEXT    NOT NULL,
    age         INT     NOT NULL,
    storyline   TEXT    NOT NULL,           -- control | fall | dehydration | delirium
    split       TEXT    NOT NULL CHECK (split IN ('train', 'test')),
    confounder  TEXT,
    profile     JSONB   NOT NULL,
    seed        BIGINT  NOT NULL,
    synthetic   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Hourly risk scores per patient and risk, with the full explanation and the hysteresis state.
CREATE TABLE IF NOT EXISTS risk_scores (
    time           TIMESTAMPTZ NOT NULL,
    patient_id     TEXT        NOT NULL,
    risk           TEXT        NOT NULL,       -- fall | dehydration | delirium
    score          DOUBLE PRECISION NOT NULL,  -- 0-1
    raw_level      TEXT        NOT NULL,       -- after hysteresis, before the hold
    level          TEXT        NOT NULL,       -- low | watch | elevated, held for hold_hours
    flag           TEXT,                       -- set on the row where the level rose (watch | elevated)
    enough_data    BOOLEAN     NOT NULL,
    contributors   JSONB       NOT NULL,       -- every scored signal: value, baseline, z, direction, log-odds
    missing        JSONB       NOT NULL,       -- signals without enough data
    reason         TEXT        NOT NULL,
    state          JSONB       NOT NULL,       -- hysteresis and hold timers, to continue from this row
    config_version TEXT        NOT NULL
);
SELECT create_hypertable('risk_scores', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS risk_scores_patient_risk_time ON risk_scores (patient_id, risk, time DESC);

-- 6-hourly trend per patient and risk. Real-time aggregation on, so the newest bucket is included.
CREATE MATERIALIZED VIEW IF NOT EXISTS risk_scores_6h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('6 hours', time)                       AS bucket,
       patient_id,
       risk,
       avg(score)                                         AS mean_score,
       max(score)                                         AS max_score,
       count(*) FILTER (WHERE level = 'watch')            AS watch_hours,
       count(*) FILTER (WHERE level = 'elevated')         AS elevated_hours,
       count(*) FILTER (WHERE flag IS NOT NULL)           AS flags,
       count(*)                                           AS n
FROM risk_scores
GROUP BY bucket, patient_id, risk
WITH NO DATA;

SELECT add_continuous_aggregate_policy('risk_scores_6h',
    start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

-- Silence detection audit trail: every ladder transition and acknowledgement, and every mode A escalation.
CREATE TABLE IF NOT EXISTS silence_audit (
    time        TIMESTAMPTZ NOT NULL,
    patient_id  TEXT        NOT NULL,
    ladder_id   TEXT,                       -- NULL for mode A
    mode        TEXT        NOT NULL,       -- A (mid-dialogue) | B (inactivity ladder)
    event       TEXT        NOT NULL,       -- ladder_started | step_started | step_timed_out | nurse_reminder | ...
    step        TEXT,                       -- tablet | contact | nurse
    role        TEXT,                       -- who acknowledged: patient | contact | nurse
    actor       TEXT,
    detail      JSONB       NOT NULL DEFAULT '{}'
);
SELECT create_hypertable('silence_audit', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS silence_audit_patient_time ON silence_audit (patient_id, time DESC);
