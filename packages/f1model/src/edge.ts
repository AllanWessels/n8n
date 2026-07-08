/**
 * Betting-edge calculator: compares a model probability against a Kalshi
 * market's implied probability, decides an action, and sizes a position
 * with a fractional (half) Kelly criterion.
 */
import type { EdgeAction, EdgeResult, KalshiMarket, PolicyConfig } from '@f1/contracts';
import { kalshiImpliedProb } from '@f1/contracts';

/**
 * Default policy used internally by {@link computeEdge} when it needs to
 * derive a *default* action from `decideAction` (mirrors the documented
 * defaults in the repo root `.env.example` / `loadPolicyFromEnv`). Callers
 * that have a real confidence figure and a real policy should re-derive the
 * action themselves via {@link decideAction}.
 */
export const DEFAULT_EDGE_POLICY: PolicyConfig = {
  maxExposureUsd: 1000,
  minConfidence: 0.55,
  minEdge: 0.05,
  maxSizeUsd: 100,
  bannedMarkets: [],
  requireHumanApprovalAboveUsd: 500,
};

/** Confidence assumed by {@link computeEdge}'s default action derivation. */
export const DEFAULT_EDGE_CONFIDENCE = 1;

function hasValidPrice(m: Pick<KalshiMarket, 'yes_bid' | 'yes_ask'>): boolean {
  return Number.isFinite(m.yes_bid) && Number.isFinite(m.yes_ask);
}

/**
 * Compares a model win-probability against a Kalshi market's implied
 * probability and produces an {@link EdgeResult}.
 *
 * `sizeUsd` is always a `0` placeholder here — sizing is the caller's
 * responsibility via {@link kellySize} once a real confidence/policy is
 * available. If the market has no usable bid/ask (missing/invalid price),
 * the result is a forced `HOLD` with `edge` set to `0`.
 */
export function computeEdge(modelProb: number, market: KalshiMarket): EdgeResult {
  if (!hasValidPrice(market)) {
    return {
      marketTicker: market.ticker,
      subject: market.title,
      modelProb,
      marketProb: NaN,
      edge: 0,
      action: 'HOLD',
      sizeUsd: 0,
    };
  }

  const marketProb = kalshiImpliedProb(market);
  const edge = modelProb - marketProb;
  const action = decideAction({
    edge,
    confidence: DEFAULT_EDGE_CONFIDENCE,
    policy: DEFAULT_EDGE_POLICY,
  });

  return {
    marketTicker: market.ticker,
    subject: market.title,
    modelProb,
    marketProb,
    edge,
    action,
    sizeUsd: 0,
  };
}

/**
 * Decides an {@link EdgeAction} from an edge figure, an assessment
 * confidence, and the active {@link PolicyConfig}.
 *
 * - `HOLD` if `edge` isn't a finite number (i.e. the market had no usable
 *   price to compare against).
 * - `BUY` if the edge and confidence both clear the policy's minimums.
 * - `PASS` otherwise.
 */
export function decideAction({
  edge,
  confidence,
  policy,
}: {
  edge: number;
  confidence: number;
  policy: PolicyConfig;
}): EdgeAction {
  if (!Number.isFinite(edge)) return 'HOLD';
  if (edge >= policy.minEdge && confidence >= policy.minConfidence) return 'BUY';
  return 'PASS';
}

/**
 * Sizes a position using a fractional (half) Kelly criterion for a binary
 * contract costing `priceProb` dollars per $1 of payout:
 *
 *   fullKelly = edge / (1 - priceProb)     where edge = prob - priceProb
 *   halfKelly = 0.5 * fullKelly
 *   sizeUsd   = halfKelly * bankroll
 *
 * The result is:
 *   - `0` whenever the bet isn't favorable (full Kelly <= 0 — i.e. not a
 *     BUY-worthy edge), or the price/bankroll are unusable.
 *   - clamped to `[0, policy.maxSizeUsd]` (single-position cap).
 *   - further clamped so it never exceeds the remaining exposure budget,
 *     `policy.maxExposureUsd` (no prior open exposure is tracked here, so
 *     the full `maxExposureUsd` is the remaining budget).
 */
export function kellySize({
  edge,
  prob,
  priceProb,
  bankroll,
  policy,
}: {
  edge: number;
  prob: number;
  priceProb: number;
  bankroll: number;
  policy: PolicyConfig;
}): number {
  if (!Number.isFinite(priceProb) || priceProb >= 1 || priceProb < 0) return 0;
  if (!Number.isFinite(bankroll) || bankroll <= 0) return 0;
  if (!Number.isFinite(edge) || !Number.isFinite(prob)) return 0;

  const fullKelly = edge / (1 - priceProb);
  if (fullKelly <= 0) return 0;

  const halfKelly = 0.5 * fullKelly;
  const rawSizeUsd = halfKelly * bankroll;

  const cappedBySize = Math.min(rawSizeUsd, policy.maxSizeUsd);
  const cappedByExposure = Math.min(cappedBySize, policy.maxExposureUsd);

  return Math.max(0, cappedByExposure);
}
