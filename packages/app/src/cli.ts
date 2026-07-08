#!/usr/bin/env node
/**
 * `f1-decision` CLI — runs the end-to-end F1 decision pipeline locally.
 *
 * This is a runtime entrypoint, not a library module: it is the one place
 * in `@dop/app` allowed to read the wall clock (`new Date().toISOString()`)
 * and generate random ids, since every other module stays deterministic
 * and test-friendly.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_F1_RUBRIC, loadPolicyFromEnv, type DecisionRecord } from '@dop/contracts';
import { OllamaClient, StubLLM, type LLM } from '@dop/core';
import type { KalshiMode } from '@dop/kalshi';
import { InMemoryDecisionStore, PgDecisionStore, type DecisionStore } from './persist.js';
import { runF1Pipeline } from './pipeline.js';

const DEFAULT_MODEL = 'qwen2.5:14b-instruct';

interface CliOptions {
  mode: KalshiMode;
  limit: number;
  stub: boolean;
  ollamaUrl?: string;
  model: string;
  dbUrl?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'fixture',
    limit: 8,
    stub: false,
    model: DEFAULT_MODEL,
    json: false,
  };

  const take = (i: number, flag: string): string => {
    const value = argv[i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--mode': {
        const value = take(++i, '--mode');
        if (value !== 'fixture' && value !== 'live') {
          throw new Error(`--mode must be "fixture" or "live", got "${value}"`);
        }
        options.mode = value;
        break;
      }
      case '--limit': {
        const raw = take(++i, '--limit');
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`--limit must be a positive number, got "${raw}"`);
        }
        options.limit = value;
        break;
      }
      case '--stub':
        options.stub = true;
        break;
      case '--ollama-url':
        options.ollamaUrl = take(++i, '--ollama-url');
        break;
      case '--model':
        options.model = take(++i, '--model');
        break;
      case '--db-url':
        options.dbUrl = take(++i, '--db-url');
        break;
      case '--json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }

  return options;
}

/** Canned assess/judge responses for `--stub` runs — no model required. */
function stubChat(req: { system?: string; user: string; json?: boolean }): string {
  if (req.system?.toLowerCase().includes('impartial judge')) {
    return JSON.stringify({
      evidence_grounded: 0.8,
      calibrated_confidence: 0.7,
      policy_compliant: 0.9,
      reasoning_quality: 0.75,
      critique: 'Stubbed judge: assessment is consistent with the gathered evidence.',
    });
  }
  return JSON.stringify({
    probability: 0.55,
    reasoning: 'Stubbed analyst assessment derived from championship standings and recent form.',
    keyFactors: ['championship standing', 'recent form'],
  });
}

function buildLLM(options: CliOptions): LLM {
  if (options.stub) return new StubLLM(stubChat);
  return new OllamaClient(options.model, options.ollamaUrl);
}

function buildStore(options: CliOptions): DecisionStore {
  if (options.dbUrl) return new PgDecisionStore(options.dbUrl);
  return new InMemoryDecisionStore();
}

function formatRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
}

function printSummary(records: DecisionRecord[]): void {
  const headers = ['SUBJECT', 'MODEL', 'MARKET', 'EDGE', 'ACTION', 'JUDGE', 'STATUS'];
  const rows = records.map((r) => {
    const modelProb = r.edge ? r.edge.modelProb.toFixed(3) : r.assessment.probability.toFixed(3);
    const marketProb = r.edge && Number.isFinite(r.edge.marketProb) ? r.edge.marketProb.toFixed(3) : 'n/a';
    const edge = r.edge && Number.isFinite(r.edge.edge) ? r.edge.edge.toFixed(3) : 'n/a';
    return [r.subject, modelProb, marketProb, edge, r.action, r.judge.verdict, r.status];
  });

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)));

  console.log(formatRow(headers, widths));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(formatRow(row, widths));
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const llm = buildLLM(options);
  const store = buildStore(options);
  const policy = loadPolicyFromEnv();
  const rubric = DEFAULT_F1_RUBRIC;

  // Runtime entrypoint only: reading the wall clock here is fine (library
  // code under src/evidence.ts, src/pipeline.ts, src/persist.ts never does).
  const createdAt = process.env.F1_CREATED_AT ?? new Date().toISOString();
  const runId = options.dbUrl ? randomUUID() : `run-${createdAt}`;

  const records = await runF1Pipeline({
    mode: options.mode,
    llm,
    policy,
    rubric,
    store,
    runId,
    makeId: (i) => (options.dbUrl ? randomUUID() : `dec_${runId}_${i}`),
    createdAt,
    limit: options.limit,
  });

  if (options.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  printSummary(records);

  if (options.dbUrl) {
    console.log(`\n(${records.length} decision(s) persisted to the decision ledger)`);
  } else {
    console.log(`\n(${records.length} decision(s) — dry-run, not persisted; pass --db-url to persist)`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});
