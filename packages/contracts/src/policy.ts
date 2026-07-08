/**
 * Decision-policy configuration and env loader.
 *
 * Defaults mirror the values documented in the repo root `.env.example`.
 */

export interface PolicyConfig {
  /** Maximum total exposure (USD) allowed across open positions. */
  maxExposureUsd: number;
  /** Minimum agent-assessment confidence required to act. */
  minConfidence: number;
  /** Minimum edge (model prob - market prob) required to act. */
  minEdge: number;
  /** Maximum size (USD) of any single position. */
  maxSizeUsd: number;
  /** Market tickers that are never allowed to be traded. */
  bannedMarkets: string[];
  /** Above this size (USD), a human must approve before execution. */
  requireHumanApprovalAboveUsd: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Loads the decision policy from environment variables, falling back to
 * sane defaults matching `.env.example` for anything unset.
 */
export function loadPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): PolicyConfig {
  return {
    maxExposureUsd: parseNumber(env.POLICY_MAX_EXPOSURE_USD, 1000),
    minConfidence: parseNumber(env.POLICY_MIN_CONFIDENCE, 0.55),
    minEdge: parseNumber(env.POLICY_MIN_EDGE, 0.05),
    maxSizeUsd: parseNumber(env.POLICY_MAX_SIZE_USD, 100),
    bannedMarkets: parseList(env.POLICY_BANNED_MARKETS),
    requireHumanApprovalAboveUsd: parseNumber(env.POLICY_REQUIRE_HUMAN_APPROVAL_ABOVE_USD, 500),
  };
}
