-- =============================================================================
-- f1-decision-platform — decision ledger schema
--
-- This is a SEPARATE schema/set of tables from n8n's own internal tables
-- (workflows, executions, credentials, etc.), which n8n manages itself in
-- the same Postgres instance. These tables record the platform's own
-- decision-making process: what evidence was gathered, what was decided,
-- and why.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One row per decision-pipeline invocation (e.g. one n8n workflow run).
CREATE TABLE IF NOT EXISTS decision_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain       text NOT NULL,
  subject      text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text
);

-- One row per piece of evidence gathered during a run (Kalshi market
-- snapshot, standings, weather, news, etc.).
CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid REFERENCES decision_runs(id),
  source     text NOT NULL,
  kind       text NOT NULL,
  fetched_at timestamptz NOT NULL,
  ok         boolean NOT NULL,
  payload    jsonb
);

-- One row per finalized decision, ready for audit/replay.
CREATE TABLE IF NOT EXISTS decision_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid REFERENCES decision_runs(id),
  domain             text NOT NULL,
  subject            text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  market_ticker      text,
  model_prob         numeric,
  market_prob        numeric,
  edge               numeric,
  action             text,
  size_usd           numeric,
  judge_overall      numeric,
  judge_verdict      text,
  policy_approved    boolean,
  policy_violations  jsonb,
  rationale          text,
  model_ids          text[],
  raw                jsonb
);

CREATE INDEX IF NOT EXISTS idx_decision_ledger_created_at ON decision_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_decision_ledger_subject ON decision_ledger (subject);
CREATE INDEX IF NOT EXISTS idx_decision_ledger_action ON decision_ledger (action);
