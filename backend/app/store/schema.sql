-- SilentSignal schema for Tiger Data (TimescaleDB). Applied idempotently at backend startup.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Every patient input, question, lookup, consult, mode change, escalation and confirmation.
CREATE TABLE IF NOT EXISTS events (
    time        TIMESTAMPTZ NOT NULL,
    patient_id  TEXT        NOT NULL,
    session_id  TEXT,
    event_type  TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}'
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'live_demo';
SELECT create_hypertable('events', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS events_patient_time ON events (patient_id, time DESC);
CREATE INDEX IF NOT EXISTS events_type_time ON events (event_type, time DESC);

-- Belief after every update, long format (one row per need) so it can be aggregated per need.
CREATE TABLE IF NOT EXISTS belief_snapshots (
    time        TIMESTAMPTZ NOT NULL,
    patient_id  TEXT        NOT NULL,
    session_id  TEXT        NOT NULL,
    step        INT         NOT NULL,
    need_id     TEXT        NOT NULL,
    prob        DOUBLE PRECISION NOT NULL
);
ALTER TABLE belief_snapshots ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'live_demo';
SELECT create_hypertable('belief_snapshots', 'time', if_not_exists => TRUE);

-- One row per nurse-confirmed need: the ground truth the system learns from.
CREATE TABLE IF NOT EXISTS confirmations (
    time              TIMESTAMPTZ NOT NULL,
    patient_id        TEXT        NOT NULL,
    session_id        TEXT        NOT NULL,
    predicted_need    TEXT        NOT NULL,
    confirmed_need    TEXT        NOT NULL,
    confirmed_group   TEXT        NOT NULL,
    risk              TEXT        NOT NULL,
    correct           BOOLEAN     NOT NULL,
    escalated         BOOLEAN     NOT NULL,
    taps              INT         NOT NULL,
    questions         INT         NOT NULL,
    resolve_seconds   DOUBLE PRECISION NOT NULL,
    mean_tap_interval DOUBLE PRECISION NOT NULL,
    mode              TEXT        NOT NULL
);
ALTER TABLE confirmations ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'live_demo';
SELECT create_hypertable('confirmations', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS confirmations_patient_time ON confirmations (patient_id, time DESC);

-- Every candidate action the decision engine scored at each decision cycle, not just the one it chose.
-- Lets the research agent and a nurse-facing "decision trace" reconstruct *why* an action was picked.
-- decision_cycle groups one decide() call's candidates (unique per session). kind is one of
-- ask/lookup/consult/escalate/send/tap. action_id is e.g. a question id, lookup id or person id.
-- eig (expected information gain, bits) and the cost fields are NULL where not applicable to that
-- kind. rank 0 is the top-ranked candidate that cycle; other_costs holds any remaining named costs
-- (e.g. their_time, false_alarm) not broken out into their own column.
CREATE TABLE IF NOT EXISTS decision_actions (
    time             TIMESTAMPTZ NOT NULL,
    patient_id       TEXT        NOT NULL,
    session_id       TEXT        NOT NULL,
    decision_cycle   TEXT        NOT NULL,
    kind             TEXT        NOT NULL,
    action_id        TEXT        NOT NULL,
    label            TEXT        NOT NULL,
    eig              DOUBLE PRECISION,
    fatigue_cost     DOUBLE PRECISION,
    delay_cost       DOUBLE PRECISION,
    other_costs      JSONB       NOT NULL DEFAULT '{}',
    value            DOUBLE PRECISION NOT NULL,
    score            DOUBLE PRECISION NOT NULL,
    selected         BOOLEAN     NOT NULL,
    rank             INT         NOT NULL,
    origin           TEXT        NOT NULL DEFAULT 'live_demo'
);
SELECT create_hypertable('decision_actions', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS decision_actions_session_time ON decision_actions (session_id, time);
CREATE INDEX IF NOT EXISTS decision_actions_cycle ON decision_actions (session_id, decision_cycle);

-- Hourly rollup of candidate actions evaluated vs. selected, and their score distribution by kind.
CREATE MATERIALIZED VIEW IF NOT EXISTS decision_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', time) AS bucket,
       kind,
       count(*)                           AS candidates,
       count(*) FILTER (WHERE selected)   AS selected_count,
       avg(score)                         AS avg_score,
       avg(eig)                           AS avg_eig
FROM decision_actions
GROUP BY bucket, kind
WITH NO DATA;

SELECT add_continuous_aggregate_policy('decision_hourly',
    start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

-- Hourly per-patient signals. Stores sums and counts (not averages) so any window can be re-aggregated
-- exactly. Real-time aggregation is on, so the newest hour is always included.
CREATE MATERIALIZED VIEW IF NOT EXISTS patient_hourly_signals
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', time)                       AS bucket,
       patient_id,
       count(*)                                          AS needs,
       count(*) FILTER (WHERE confirmed_group = 'pain')  AS pain_needs,
       count(*) FILTER (WHERE risk = 'high')             AS high_risk,
       count(*) FILTER (WHERE escalated)                 AS escalations,
       sum(taps)                                         AS taps_sum,
       sum(mean_tap_interval)                            AS interval_sum,
       count(*) FILTER (WHERE correct)                   AS correct_count,
       count(*) FILTER (WHERE mode = 'scan')             AS scan_count
FROM confirmations
GROUP BY bucket, patient_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('patient_hourly_signals',
    start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

-- Hourly communication events (taps, mode changes, escalations) per patient.
CREATE MATERIALIZED VIEW IF NOT EXISTS communication_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', time) AS bucket, patient_id, event_type, count(*) AS n
FROM events
GROUP BY bucket, patient_id, event_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('communication_hourly',
    start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

-- Learned reliability of each signal source (patient taps, each family member, each nurse): Beta(a, b).
CREATE TABLE IF NOT EXISTS source_reliability (
    key        TEXT PRIMARY KEY,
    a          DOUBLE PRECISION NOT NULL,
    b          DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Research agent: hypotheses (with their full evidence trail and timeline in body) and clinician inquiries.
-- Every agent action is also appended to the events hypertable as event_type = 'research_action'.
CREATE TABLE IF NOT EXISTS research_hypotheses (
    id         TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    status     TEXT NOT NULL,
    body       JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS research_inquiries (
    id         TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    status     TEXT NOT NULL,
    body       JSONB NOT NULL
);
