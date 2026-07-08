/**
 * End-to-end F1 decision pipeline: gather evidence, estimate win
 * probabilities, compute a betting edge per Kalshi market, run each market
 * through the `@f1/core` agent/judge decision loop, and persist the result.
 */
import type {
  DecisionInput,
  DecisionRecord,
  EdgeResult,
  JolpicaDriverStanding,
  JudgeRubric,
  KalshiMarket,
  PolicyConfig,
} from '@f1/contracts';
import { computeEdge, estimateWinProbabilities } from '@f1/f1model';
import { runDecision, type LLM } from '@f1/core';
import type { KalshiMode } from '@f1/kalshi';
import { gatherEvidence } from './evidence.js';
import type { DecisionStore } from './persist.js';

export const F1_DOMAIN = 'f1-championship-winner';

export interface RunF1PipelineParams {
  mode: KalshiMode;
  llm: LLM;
  policy: PolicyConfig;
  rubric: JudgeRubric;
  store: DecisionStore;
  runId: string;
  makeId: (i: number) => string;
  createdAt: string;
  /** Maximum number of Kalshi markets to process. Defaults to 8. */
  limit?: number;
  /** Fixture/repo root override, forwarded to `gatherEvidence`. */
  root?: string;
}

/**
 * Matches a Kalshi "Will <driver> win the F1 Drivers Championship?" market
 * to a driver from the championship standings by looking for the driver's
 * full name (preferred) or family name alone (fallback) in the market
 * title. Returns `undefined` when no standing matches.
 */
export function matchDriver(
  market: KalshiMarket,
  standings: JolpicaDriverStanding[],
): JolpicaDriverStanding | undefined {
  const title = market.title.toLowerCase();
  const fullNameMatch = standings.find(
    (s) => title.includes(s.Driver.givenName.toLowerCase()) && title.includes(s.Driver.familyName.toLowerCase()),
  );
  if (fullNameMatch) return fullNameMatch;
  return standings.find((s) => title.includes(s.Driver.familyName.toLowerCase()));
}

/**
 * `@f1/f1model`'s `computeEdge` intentionally returns `marketProb: NaN` to
 * signal "no usable market price" for a HOLD action (see
 * `packages/f1model/src/edge.ts`). But `@f1/contracts`' `EdgeResultSchema`
 * validates `marketProb` with zod's `z.number()`, which — unlike plain JS
 * `typeof x === 'number'` — rejects `NaN`. Left as-is, that HOLD result
 * would make `DecisionRecordSchema.parse` (called inside `runDecision`)
 * throw instead of producing the graceful HOLD record this pipeline
 * requires. Substitute a schema-safe `0` for a non-finite `marketProb`
 * before handing the edge to `runDecision`; `action`/`edge`/`sizeUsd` are
 * already `'HOLD'`/`0`/`0` in that case, so this changes nothing
 * observable about the decision, only its schema-validity.
 */
function withSchemaSafeMarketProb(edge: EdgeResult): EdgeResult {
  if (Number.isFinite(edge.marketProb)) return edge;
  return { ...edge, marketProb: 0 };
}

/**
 * Runs the full F1 decision pipeline: gathers evidence once, estimates a
 * win-probability distribution over the field, then walks up to `limit`
 * Kalshi markets — matching each to a driver, computing a betting edge, and
 * running it through `@f1/core`'s agent -> judge -> policy decision loop.
 * Markets with no driver match or a non-finite market price still produce a
 * decision record (PASS/HOLD) rather than being skipped or throwing.
 * Persists the run, its evidence, and every record via `store`.
 */
export async function runF1Pipeline(params: RunF1PipelineParams): Promise<DecisionRecord[]> {
  const { mode, llm, policy, rubric, store, runId, makeId, createdAt, limit = 8, root } = params;

  const subjectLabel = 'F1 Drivers Championship winner';

  await store.saveRun({
    id: runId,
    domain: F1_DOMAIN,
    subject: subjectLabel,
    startedAt: createdAt,
    status: 'running',
  });

  const gathered = await gatherEvidence(mode, { root });
  await store.saveEvidence(runId, gathered.evidence);

  const probs = estimateWinProbabilities({
    standings: gathered.standings,
    weatherRisk: gathered.weatherRisk,
    newsSentiment: gathered.newsSentiment,
  });
  const probByDriverId = new Map(probs.map((p) => [p.driverId, p.probability]));

  const marketsToProcess = gathered.markets.slice(0, Math.max(0, limit));
  const records: DecisionRecord[] = [];

  for (const [i, market] of marketsToProcess.entries()) {
    const matched = matchDriver(market, gathered.standings);
    const modelProb = matched ? (probByDriverId.get(matched.Driver.driverId) ?? 0) : 0;
    const edgeResult = withSchemaSafeMarketProb(computeEdge(modelProb, market));

    const input: DecisionInput = {
      runId,
      domain: F1_DOMAIN,
      subject: market.title,
      evidence: gathered.evidence,
      context: {
        marketTicker: market.ticker,
        driverId: matched?.Driver.driverId ?? null,
        modelProb,
      },
    };

    // Awaited sequentially (not Promise.all) so StubLLM/real-LLM call
    // scripting stays deterministic and ordered across markets.
    const record = await runDecision(input, {
      llm,
      rubric,
      policy,
      computeEdge: (assessment) => {
        void assessment; // the edge is derived from the model's win-probability estimate, not the LLM assessment
        return edgeResult;
      },
      id: makeId(i),
      createdAt,
      maxRevise: 1,
    });

    records.push(record);
    await store.saveRecord(record);
  }

  await store.saveRun({
    id: runId,
    domain: F1_DOMAIN,
    subject: subjectLabel,
    startedAt: createdAt,
    finishedAt: createdAt,
    status: 'completed',
  });

  return records;
}
