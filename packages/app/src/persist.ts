/**
 * Persistence layer for the F1 decision pipeline: a small `DecisionStore`
 * interface plus an in-memory implementation (used by tests and CLI
 * dry-runs) and a thin Postgres-backed implementation matching
 * `db/schema.sql`'s `decision_runs` / `evidence_snapshots` / `decision_ledger`
 * tables (used by real runs, via the CLI's `--db-url` flag).
 */
import pg from 'pg';
import type { Pool } from 'pg';
import type { DecisionRecord, Evidence } from '@dop/contracts';

const { Pool: PgPool } = pg;

/** One row of `decision_runs`. */
export interface RunInfo {
  id: string;
  domain: string;
  subject: string;
  startedAt: string;
  finishedAt?: string;
  status?: string;
}

export interface DecisionStore {
  saveRun(run: RunInfo): Promise<string>;
  saveRecord(record: DecisionRecord): Promise<void>;
  saveEvidence(runId: string, evidence: Evidence[]): Promise<void>;
}

/**
 * In-memory `DecisionStore`. Used by unit tests (no DB/network) and by the
 * CLI when no `--db-url` is supplied (dry-run mode, results printed instead
 * of persisted).
 */
export class InMemoryDecisionStore implements DecisionStore {
  readonly runs: RunInfo[] = [];
  readonly records: DecisionRecord[] = [];
  readonly evidenceByRun: Array<{ runId: string; evidence: Evidence[] }> = [];

  async saveRun(run: RunInfo): Promise<string> {
    this.runs.push(run);
    return run.id;
  }

  async saveRecord(record: DecisionRecord): Promise<void> {
    this.records.push(record);
  }

  async saveEvidence(runId: string, evidence: Evidence[]): Promise<void> {
    this.evidenceByRun.push({ runId, evidence });
  }
}

/**
 * Thin Postgres-backed `DecisionStore`, persisting into the
 * `decision_runs` / `evidence_snapshots` / `decision_ledger` tables defined
 * by `db/schema.sql`. Exercised at runtime (via the CLI's `--db-url` flag),
 * not covered by unit tests — kept intentionally free of business logic.
 *
 * `decision_runs.id` / `decision_ledger.id` are `uuid` columns, so callers
 * driving a real Postgres run should pass real UUIDs as `run.id` /
 * `record.id` (the CLI does this automatically whenever `--db-url` is set).
 */
export class PgDecisionStore implements DecisionStore {
  private readonly pool: Pool;

  constructor(poolOrConnectionString: Pool | string) {
    this.pool =
      typeof poolOrConnectionString === 'string'
        ? new PgPool({ connectionString: poolOrConnectionString })
        : poolOrConnectionString;
  }

  async saveRun(run: RunInfo): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO decision_runs (id, domain, subject, started_at, finished_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET finished_at = EXCLUDED.finished_at, status = EXCLUDED.status
       RETURNING id`,
      [run.id, run.domain, run.subject, run.startedAt, run.finishedAt ?? null, run.status ?? null],
    );
    return result.rows[0]?.id ?? run.id;
  }

  async saveEvidence(runId: string, evidence: Evidence[]): Promise<void> {
    for (const e of evidence) {
      await this.pool.query(
        `INSERT INTO evidence_snapshots (run_id, source, kind, fetched_at, ok, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [runId, e.source, e.kind, e.fetchedAt, e.ok, JSON.stringify(e.payload)],
      );
    }
  }

  async saveRecord(record: DecisionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO decision_ledger (
         id, run_id, domain, subject, created_at, market_ticker, model_prob, market_prob,
         edge, action, size_usd, judge_overall, judge_verdict, policy_approved,
         policy_violations, rationale, model_ids, raw
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        record.id,
        record.runId,
        record.domain,
        record.subject,
        record.createdAt,
        record.edge?.marketTicker ?? null,
        record.edge?.modelProb ?? record.assessment.probability,
        record.edge?.marketProb ?? null,
        record.edge?.edge ?? null,
        record.action,
        record.edge?.sizeUsd ?? 0,
        record.judge.overall,
        record.judge.verdict,
        record.policy.approved,
        JSON.stringify(record.policy.violations),
        record.rationale,
        record.modelIds,
        JSON.stringify(record),
      ],
    );
  }
}
