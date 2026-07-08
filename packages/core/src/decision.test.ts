import { describe, expect, it } from 'vitest';
import { DecisionRecordSchema } from '@dop/contracts';
import type { AgentAssessment, DecisionInput, EdgeResult, JudgeRubric, PolicyConfig } from '@dop/contracts';
import { buildDecisionRecord, runDecision } from './decision.js';
import { StubLLM } from './ollama.js';

const rubric: JudgeRubric = {
  criteria: [
    { id: 'evidence_grounded', description: 'grounded', weight: 0.5 },
    { id: 'reasoning_quality', description: 'quality', weight: 0.5 },
  ],
  passThreshold: 0.7,
  reviseThreshold: 0.5,
};

const policy: PolicyConfig = {
  maxExposureUsd: 1000,
  minConfidence: 0.55,
  minEdge: 0.05,
  maxSizeUsd: 100,
  bannedMarkets: ['banned-subject'],
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

function buyEdgeFor(assessment: AgentAssessment): EdgeResult {
  return {
    marketTicker: 'TICKER-1',
    subject: assessment.subject,
    modelProb: assessment.probability,
    marketProb: 0.4,
    edge: assessment.probability - 0.4,
    action: 'BUY',
    sizeUsd: 50,
  };
}

const agentJsonPass = JSON.stringify({
  probability: 0.8,
  reasoning: 'Strong evidence supports this outcome.',
  keyFactors: ['form', 'grid'],
});
const judgeJsonPass = JSON.stringify({
  evidence_grounded: 0.9,
  reasoning_quality: 0.9,
  critique: 'Well grounded and clear.',
});

describe('buildDecisionRecord', () => {
  it('builds and validates a record against DecisionRecordSchema', () => {
    const assessment: AgentAssessment = {
      subject: 's',
      probability: 0.6,
      reasoning: 'r',
      keyFactors: [],
      modelId: 'm',
    };
    const record = buildDecisionRecord({
      id: 'id-1',
      runId: 'run-1',
      domain: 'f1',
      subject: 's',
      createdAt: '2026-07-07T00:00:00.000Z',
      assessment,
      edge: undefined,
      judge: { overall: 0.6, criteria: {}, verdict: 'pass', critique: 'ok' },
      policy: { approved: true, violations: [], appliedPolicies: [] },
      action: 'PASS',
      rationale: 'r | ok',
      status: 'approved',
      modelIds: ['m'],
    });

    expect(() => DecisionRecordSchema.parse(record)).not.toThrow();
    expect(record.id).toBe('id-1');
    expect(record.status).toBe('approved');
  });
});

describe('runDecision', () => {
  it('happy path: approves and returns a schema-valid record', async () => {
    const llm = new StubLLM([agentJsonPass, judgeJsonPass]);

    const record = await runDecision(makeInput(), {
      llm,
      rubric,
      policy,
      computeEdge: buyEdgeFor,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(() => DecisionRecordSchema.parse(record)).not.toThrow();
    expect(record.status).toBe('approved');
    expect(record.id).toBe('fixed-id');
    expect(record.createdAt).toBe('2026-07-07T00:00:00.000Z');
    expect(record.action).toBe('BUY');
    expect(record.judge.verdict).toBe('pass');
    expect(record.modelIds).toEqual(['unknown']);
    expect(record.rationale).toContain('Strong evidence supports this outcome.');
    expect(record.rationale).toContain('Well grounded and clear.');
  });

  it('rejects at the input-policy gate for a banned subject, without calling the LLM', async () => {
    const llm = new StubLLM([]);

    const record = await runDecision(makeInput({ subject: 'banned-subject' }), {
      llm,
      rubric,
      policy,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(() => DecisionRecordSchema.parse(record)).not.toThrow();
    expect(record.status).toBe('rejected');
    expect(record.policy.approved).toBe(false);
    expect(record.policy.violations.length).toBeGreaterThan(0);
    expect(llm.calls.length).toBe(0);
  });

  it('rejects at the input-policy gate when evidence is empty', async () => {
    const llm = new StubLLM([]);

    const record = await runDecision(makeInput({ evidence: [] }), {
      llm,
      rubric,
      policy,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(record.status).toBe('rejected');
    expect(record.policy.violations.some((v) => v.includes('no evidence'))).toBe(true);
  });

  it('rejects at the decision-policy gate when confidence is too low', async () => {
    const lowConfidenceAgentJson = JSON.stringify({
      probability: 0.2,
      reasoning: 'Weak signal.',
      keyFactors: [],
    });
    // Judge still passes on quality grounds, but decision policy should reject on low confidence.
    const llm = new StubLLM([lowConfidenceAgentJson, judgeJsonPass]);

    const record = await runDecision(makeInput(), {
      llm,
      rubric,
      policy,
      computeEdge: buyEdgeFor,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(record.status).toBe('rejected');
    expect(record.policy.violations.some((v) => v.includes('minConfidence'))).toBe(true);
  });

  it('runs the revise loop: first judge revises, second assess+judge passes', async () => {
    const secondAgentJson = JSON.stringify({
      probability: 0.85,
      reasoning: 'Revised: stronger evidence on second pass.',
      keyFactors: ['revised'],
    });
    const reviseJudgeJson = JSON.stringify({
      evidence_grounded: 0.6,
      reasoning_quality: 0.6,
      critique: 'Needs more grounding.',
    });

    const llm = new StubLLM([agentJsonPass, reviseJudgeJson, secondAgentJson, judgeJsonPass]);

    const record = await runDecision(makeInput(), {
      llm,
      rubric,
      policy,
      computeEdge: buyEdgeFor,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
      maxRevise: 1,
    });

    // Two assess() calls + two judge() calls = 4 total LLM invocations.
    expect(llm.calls.length).toBe(4);
    expect(record.status).toBe('approved');
    expect(record.judge.verdict).toBe('pass');
    expect(record.assessment.reasoning).toBe('Revised: stronger evidence on second pass.');
  });

  it('does not exceed maxRevise: stops reviseing and reflects the final verdict', async () => {
    const reviseJudgeJson = JSON.stringify({
      evidence_grounded: 0.6,
      reasoning_quality: 0.6,
      critique: 'Still needs more grounding.',
    });
    // Only 1 revise allowed (default), so agent/judge called twice total, second judge still 'revise'.
    const llm = new StubLLM([agentJsonPass, reviseJudgeJson, agentJsonPass, reviseJudgeJson]);

    const record = await runDecision(makeInput(), {
      llm,
      rubric,
      policy,
      computeEdge: buyEdgeFor,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
      maxRevise: 1,
    });

    expect(llm.calls.length).toBe(4);
    expect(record.judge.verdict).toBe('revise');
    // revise is not 'reject', so status depends on policy approval only; verdict !== 'reject' keeps it eligible.
    expect(record.status).toBe('approved');
  });

  it('rejects when judge verdict is reject', async () => {
    const rejectJudgeJson = JSON.stringify({
      evidence_grounded: 0.1,
      reasoning_quality: 0.1,
      critique: 'Not grounded at all.',
    });
    const llm = new StubLLM([agentJsonPass, rejectJudgeJson]);

    const record = await runDecision(makeInput(), {
      llm,
      rubric,
      policy,
      computeEdge: buyEdgeFor,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(record.judge.verdict).toBe('reject');
    expect(record.status).toBe('rejected');
  });

  it('handles agent JSON wrapped in prose end-to-end', async () => {
    const proseWrapped = `Here's my analysis:\n${agentJsonPass}\nLet me know if you need anything else.`;
    const llm = new StubLLM([proseWrapped, judgeJsonPass]);

    const record = await runDecision(makeInput(), {
      llm,
      rubric,
      policy,
      computeEdge: buyEdgeFor,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(record.assessment.probability).toBe(0.8);
    expect(record.status).toBe('approved');
  });

  it('defaults action to PASS when no computeEdge is supplied', async () => {
    const llm = new StubLLM([agentJsonPass, judgeJsonPass]);

    const record = await runDecision(makeInput(), {
      llm,
      rubric,
      policy,
      id: 'fixed-id',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(record.edge).toBeUndefined();
    expect(record.action).toBe('PASS');
  });
});
