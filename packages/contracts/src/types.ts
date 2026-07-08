/**
 * Core shared TypeScript types for the f1-decision-platform.
 *
 * All timestamps are ISO-8601 UTC strings (e.g. "2026-07-07T12:00:00.000Z").
 */

/** A single piece of evidence gathered during a decision run. */
export interface Evidence {
  /** Origin of the evidence, e.g. "kalshi", "jolpica", "open-meteo". */
  source: string;
  /** Kind/category of the evidence, e.g. "market", "standings", "weather". */
  kind: string;
  /** ISO-8601 UTC timestamp of when the evidence was fetched. */
  fetchedAt: string;
  /** Whether the fetch succeeded. */
  ok: boolean;
  /** Raw payload as returned by the source (validated separately via Zod). */
  payload: unknown;
}

/** Input bundle handed to the decision pipeline for a single run. */
export interface DecisionInput {
  runId: string;
  domain: string;
  subject: string;
  evidence: Evidence[];
  context?: Record<string, unknown>;
}

/** Output of an LLM agent's assessment of a subject. */
export interface AgentAssessment {
  subject: string;
  probability: number;
  reasoning: string;
  keyFactors: string[];
  modelId: string;
}

/** Action recommended by the edge-computation step. */
export type EdgeAction = 'BUY' | 'PASS' | 'HOLD';

/** Result of comparing a model probability against a market probability. */
export interface EdgeResult {
  marketTicker: string;
  subject: string;
  modelProb: number;
  marketProb: number;
  edge: number;
  action: EdgeAction;
  sizeUsd: number;
  kellyFraction?: number;
}

/** Verdict issued by the LLM-judge step. */
export type JudgeVerdict = 'pass' | 'revise' | 'reject';

/** Score produced by the LLM-judge step. */
export interface JudgeScore {
  overall: number;
  criteria: Record<string, number>;
  verdict: JudgeVerdict;
  critique: string;
}

/** Result of applying the policy engine's guardrails. */
export interface PolicyDecision {
  approved: boolean;
  violations: string[];
  appliedPolicies: string[];
}

/** Final status of a persisted decision record. */
export type DecisionStatus = 'approved' | 'rejected';

/** A fully resolved decision, ready for persistence to the decision ledger. */
export interface DecisionRecord {
  id: string;
  runId: string;
  domain: string;
  subject: string;
  createdAt: string;
  assessment: AgentAssessment;
  edge?: EdgeResult;
  judge: JudgeScore;
  policy: PolicyDecision;
  action: EdgeAction;
  rationale: string;
  status: DecisionStatus;
  modelIds: string[];
}
