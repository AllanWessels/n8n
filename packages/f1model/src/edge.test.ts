import { describe, expect, it } from 'vitest';
import type { KalshiMarket, PolicyConfig } from '@dop/contracts';
import { computeEdge, decideAction, kellySize, DEFAULT_EDGE_POLICY } from './edge.js';

function market(overrides: Partial<KalshiMarket> = {}): KalshiMarket {
  return {
    ticker: 'KXF1NOR-26-YES',
    title: 'Will Lando Norris win the 2026 championship?',
    yes_bid: 40,
    yes_ask: 44,
    status: 'active',
    ...overrides,
  };
}

function policy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return { ...DEFAULT_EDGE_POLICY, ...overrides };
}

describe('computeEdge', () => {
  it('computes a positive edge when the model is more bullish than the market', () => {
    // yes_bid/yes_ask 40/44 -> marketProb = 0.42
    const result = computeEdge(0.6, market());
    expect(result.marketProb).toBeCloseTo(0.42, 9);
    expect(result.edge).toBeCloseTo(0.6 - 0.42, 9);
    expect(result.edge).toBeGreaterThan(0);
  });

  it('computes a negative edge when the model is more bearish than the market', () => {
    const result = computeEdge(0.3, market());
    expect(result.marketProb).toBeCloseTo(0.42, 9);
    expect(result.edge).toBeCloseTo(0.3 - 0.42, 9);
    expect(result.edge).toBeLessThan(0);
  });

  it('carries marketTicker and subject through from the market', () => {
    const result = computeEdge(0.5, market({ ticker: 'KXFOO-1', title: 'Some question?' }));
    expect(result.marketTicker).toBe('KXFOO-1');
    expect(result.subject).toBe('Some question?');
  });

  it('always returns a 0 sizeUsd placeholder', () => {
    expect(computeEdge(0.9, market()).sizeUsd).toBe(0);
    expect(computeEdge(0.1, market()).sizeUsd).toBe(0);
  });

  it('derives a default action via decideAction (BUY when edge clears the default policy)', () => {
    // modelProb 0.6 vs marketProb 0.42 -> edge 0.18 >= DEFAULT_EDGE_POLICY.minEdge (0.05)
    const result = computeEdge(0.6, market());
    expect(result.action).toBe('BUY');
  });

  it('derives a default action of PASS when edge does not clear the default policy', () => {
    // modelProb 0.4 vs marketProb 0.42 -> edge -0.02 < minEdge
    const result = computeEdge(0.4, market());
    expect(result.action).toBe('PASS');
  });

  it('returns HOLD with edge 0 and NaN marketProb when the market has no usable bid/ask', () => {
    const noPriceMarket = {
      ...market(),
      yes_bid: null,
      yes_ask: null,
    } as unknown as KalshiMarket;

    const result = computeEdge(0.6, noPriceMarket);
    expect(result.action).toBe('HOLD');
    expect(result.edge).toBe(0);
    expect(Number.isNaN(result.marketProb)).toBe(true);
  });
});

describe('decideAction', () => {
  it('returns BUY when edge and confidence both meet the policy minimums', () => {
    const p = policy({ minEdge: 0.05, minConfidence: 0.55 });
    expect(decideAction({ edge: 0.05, confidence: 0.55, policy: p })).toBe('BUY');
    expect(decideAction({ edge: 0.2, confidence: 0.9, policy: p })).toBe('BUY');
  });

  it('returns PASS when edge is just below the minimum', () => {
    const p = policy({ minEdge: 0.05, minConfidence: 0.55 });
    expect(decideAction({ edge: 0.049999, confidence: 0.9, policy: p })).toBe('PASS');
  });

  it('returns PASS when confidence is just below the minimum', () => {
    const p = policy({ minEdge: 0.05, minConfidence: 0.55 });
    expect(decideAction({ edge: 0.2, confidence: 0.549999, policy: p })).toBe('PASS');
  });

  it('returns PASS when edge is negative', () => {
    const p = policy();
    expect(decideAction({ edge: -0.1, confidence: 1, policy: p })).toBe('PASS');
  });

  it('returns HOLD when edge is not a finite number (price missing)', () => {
    const p = policy();
    expect(decideAction({ edge: NaN, confidence: 1, policy: p })).toBe('HOLD');
  });
});

describe('kellySize', () => {
  it('computes a half-Kelly size for a favorable edge', () => {
    // edge = 0.2, priceProb = 0.4 -> fullKelly = 0.2 / 0.6 = 0.33333...
    // halfKelly = 0.166667, bankroll 1000 -> 166.667
    const p = policy({ maxSizeUsd: 100000, maxExposureUsd: 100000 });
    const size = kellySize({ edge: 0.2, prob: 0.6, priceProb: 0.4, bankroll: 1000, policy: p });
    expect(size).toBeCloseTo(166.6667, 3);
  });

  it('clamps to policy.maxSizeUsd when the raw half-Kelly size would exceed it', () => {
    const p = policy({ maxSizeUsd: 100, maxExposureUsd: 100000 });
    const size = kellySize({ edge: 0.2, prob: 0.6, priceProb: 0.4, bankroll: 100000, policy: p });
    expect(size).toBe(100);
  });

  it('clamps to the remaining exposure budget (policy.maxExposureUsd) when tighter than maxSizeUsd', () => {
    const p = policy({ maxSizeUsd: 1000, maxExposureUsd: 50 });
    const size = kellySize({ edge: 0.2, prob: 0.6, priceProb: 0.4, bankroll: 100000, policy: p });
    expect(size).toBe(50);
  });

  it('returns 0 for a non-favorable (non-BUY) edge', () => {
    const p = policy();
    expect(kellySize({ edge: -0.1, prob: 0.3, priceProb: 0.4, bankroll: 1000, policy: p })).toBe(
      0,
    );
    expect(kellySize({ edge: 0, prob: 0.4, priceProb: 0.4, bankroll: 1000, policy: p })).toBe(0);
  });

  it('returns 0 when the price is missing/invalid', () => {
    const p = policy();
    expect(
      kellySize({ edge: 0.2, prob: 0.6, priceProb: NaN, bankroll: 1000, policy: p }),
    ).toBe(0);
    expect(
      kellySize({ edge: 0.2, prob: 0.6, priceProb: 1, bankroll: 1000, policy: p }),
    ).toBe(0);
  });

  it('returns 0 when bankroll is zero or negative', () => {
    const p = policy();
    expect(kellySize({ edge: 0.2, prob: 0.6, priceProb: 0.4, bankroll: 0, policy: p })).toBe(0);
    expect(kellySize({ edge: 0.2, prob: 0.6, priceProb: 0.4, bankroll: -500, policy: p })).toBe(
      0,
    );
  });

  it('returns 0 when prob is not a finite number', () => {
    const p = policy();
    expect(
      kellySize({ edge: 0.2, prob: NaN, priceProb: 0.4, bankroll: 1000, policy: p }),
    ).toBe(0);
  });
});
