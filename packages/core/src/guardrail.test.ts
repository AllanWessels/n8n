import { describe, expect, it } from 'vitest';
import type { AgentAssessment, DecisionInput, EdgeResult, PolicyConfig } from '@f1/contracts';
import { checkDecisionPolicy, checkInputPolicy } from './guardrail.js';

const policy: PolicyConfig = {
  maxExposureUsd: 1000,
  minConfidence: 0.55,
  minEdge: 0.05,
  maxSizeUsd: 100,
  bannedMarkets: ['banned-subject', 'BANNED-TICKER'],
  requireHumanApprovalAboveUsd: 500,
};

function makeInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    runId: 'run-1',
    domain: 'f1',
    subject: 'driver-x-wins',
    evidence: [
      { source: 'kalshi', kind: 'market', fetchedAt: '2026-07-07T00:00:00.000Z', ok: true, payload: {} },
    ],
    ...overrides,
  };
}

const assessment: AgentAssessment = {
  subject: 'driver-x-wins',
  probability: 0.7,
  reasoning: 'r',
  keyFactors: [],
  modelId: 'm',
};

const edge: EdgeResult = {
  marketTicker: 'TICKER-1',
  subject: 'driver-x-wins',
  modelProb: 0.7,
  marketProb: 0.5,
  edge: 0.2,
  action: 'BUY',
  sizeUsd: 50,
};

describe('checkInputPolicy', () => {
  it('approves a valid input', () => {
    const result = checkInputPolicy(makeInput(), policy);
    expect(result.approved).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.appliedPolicies).toContain('bannedMarkets');
  });

  it('rejects a banned subject', () => {
    const result = checkInputPolicy(makeInput({ subject: 'banned-subject' }), policy);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.includes('banned markets'))).toBe(true);
  });

  it('rejects empty evidence', () => {
    const result = checkInputPolicy(makeInput({ evidence: [] }), policy);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.includes('no evidence'))).toBe(true);
  });
});

describe('checkDecisionPolicy', () => {
  it('approves a compliant decision', () => {
    const result = checkDecisionPolicy(edge, assessment, policy);
    expect(result.approved).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects when confidence is below minConfidence', () => {
    const lowConfidence: AgentAssessment = { ...assessment, probability: 0.3 };
    const result = checkDecisionPolicy(edge, lowConfidence, policy);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.includes('minConfidence'))).toBe(true);
  });

  it('rejects a BUY with edge below minEdge', () => {
    const lowEdge: EdgeResult = { ...edge, edge: 0.01 };
    const result = checkDecisionPolicy(lowEdge, assessment, policy);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.includes('minEdge'))).toBe(true);
  });

  it('does not flag minEdge for non-BUY actions', () => {
    const passEdge: EdgeResult = { ...edge, action: 'PASS', edge: 0.01 };
    const result = checkDecisionPolicy(passEdge, assessment, policy);
    expect(result.violations.some((v) => v.includes('minEdge'))).toBe(false);
  });

  it('rejects size above maxSizeUsd', () => {
    const bigSize: EdgeResult = { ...edge, sizeUsd: 500 };
    const result = checkDecisionPolicy(bigSize, assessment, policy);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.includes('maxSizeUsd'))).toBe(true);
  });

  it('rejects a banned subject on the assessment', () => {
    const bannedAssessment: AgentAssessment = { ...assessment, subject: 'banned-subject' };
    const result = checkDecisionPolicy(undefined, bannedAssessment, policy);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.includes('banned markets'))).toBe(true);
  });

  it('rejects a banned market ticker on the edge', () => {
    const bannedEdge: EdgeResult = { ...edge, marketTicker: 'BANNED-TICKER' };
    const result = checkDecisionPolicy(bannedEdge, assessment, policy);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.includes('BANNED-TICKER'))).toBe(true);
  });

  it('handles an undefined edge (no edge computed) without throwing', () => {
    const result = checkDecisionPolicy(undefined, assessment, policy);
    expect(result.approved).toBe(true);
  });
});
