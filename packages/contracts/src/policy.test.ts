import { describe, expect, it } from 'vitest';
import { loadPolicyFromEnv } from './policy.js';

describe('loadPolicyFromEnv', () => {
  it('falls back to documented defaults when env is empty', () => {
    expect(loadPolicyFromEnv({})).toEqual({
      maxExposureUsd: 1000,
      minConfidence: 0.55,
      minEdge: 0.05,
      maxSizeUsd: 100,
      bannedMarkets: [],
      requireHumanApprovalAboveUsd: 500,
    });
  });

  it('parses overrides from env vars', () => {
    const policy = loadPolicyFromEnv({
      POLICY_MAX_EXPOSURE_USD: '2500',
      POLICY_MIN_CONFIDENCE: '0.7',
      POLICY_MIN_EDGE: '0.1',
      POLICY_MAX_SIZE_USD: '250',
      POLICY_BANNED_MARKETS: 'KXFOO-1, KXBAR-2',
      POLICY_REQUIRE_HUMAN_APPROVAL_ABOVE_USD: '750',
    });

    expect(policy).toEqual({
      maxExposureUsd: 2500,
      minConfidence: 0.7,
      minEdge: 0.1,
      maxSizeUsd: 250,
      bannedMarkets: ['KXFOO-1', 'KXBAR-2'],
      requireHumanApprovalAboveUsd: 750,
    });
  });

  it('falls back to defaults for unparseable numeric values', () => {
    const policy = loadPolicyFromEnv({ POLICY_MAX_EXPOSURE_USD: 'not-a-number' });
    expect(policy.maxExposureUsd).toBe(1000);
  });

  it('defaults to process.env when no env is provided', () => {
    const policy = loadPolicyFromEnv();
    expect(policy.maxExposureUsd).toBeGreaterThan(0);
  });
});
