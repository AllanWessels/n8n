import { describe, expect, it } from 'vitest';
import type { AgentAssessment, Evidence, JudgeRubric } from '@dop/contracts';
import { judge } from './judge.js';
import { StubLLM } from './ollama.js';

const rubric: JudgeRubric = {
  criteria: [
    { id: 'evidence_grounded', description: 'grounded', weight: 0.5 },
    { id: 'reasoning_quality', description: 'quality', weight: 0.5 },
  ],
  passThreshold: 0.7,
  reviseThreshold: 0.5,
};

const assessment: AgentAssessment = {
  subject: 'driver-x-wins',
  probability: 0.6,
  reasoning: 'Some reasoning.',
  keyFactors: ['a', 'b'],
  modelId: 'llama3',
};

const evidence: Evidence[] = [
  { source: 'kalshi', kind: 'market', fetchedAt: '2026-07-07T00:00:00.000Z', ok: true, payload: {} },
];

describe('judge', () => {
  it('computes overall via weightedScore and verdict pass when above passThreshold', async () => {
    const llm = new StubLLM([
      JSON.stringify({ evidence_grounded: 0.9, reasoning_quality: 0.9, critique: 'Solid.' }),
    ]);

    const result = await judge(assessment, evidence, rubric, llm);

    expect(result.overall).toBeCloseTo(0.9, 5);
    expect(result.criteria).toEqual({ evidence_grounded: 0.9, reasoning_quality: 0.9 });
    expect(result.verdict).toBe('pass');
    expect(result.critique).toBe('Solid.');
  });

  it('returns verdict revise when overall is between reviseThreshold and passThreshold', async () => {
    const llm = new StubLLM([
      JSON.stringify({ evidence_grounded: 0.6, reasoning_quality: 0.6, critique: 'Needs work.' }),
    ]);

    const result = await judge(assessment, evidence, rubric, llm);
    expect(result.overall).toBeCloseTo(0.6, 5);
    expect(result.verdict).toBe('revise');
  });

  it('returns verdict reject when overall is below reviseThreshold', async () => {
    const llm = new StubLLM([
      JSON.stringify({ evidence_grounded: 0.1, reasoning_quality: 0.1, critique: 'Poor.' }),
    ]);

    const result = await judge(assessment, evidence, rubric, llm);
    expect(result.overall).toBeCloseTo(0.1, 5);
    expect(result.verdict).toBe('reject');
  });

  it('clamps out-of-range criterion scores and defaults missing ones to 0', async () => {
    const llm = new StubLLM([JSON.stringify({ evidence_grounded: 2, critique: 'x' })]);
    const result = await judge(assessment, evidence, rubric, llm);
    expect(result.criteria.evidence_grounded).toBe(1);
    expect(result.criteria.reasoning_quality).toBe(0);
  });

  it('parses JSON wrapped in prose', async () => {
    const llm = new StubLLM([
      `Here you go:\n${JSON.stringify({
        evidence_grounded: 0.8,
        reasoning_quality: 0.8,
        critique: 'Good.',
      })}\nDone.`,
    ]);
    const result = await judge(assessment, evidence, rubric, llm);
    expect(result.overall).toBeCloseTo(0.8, 5);
    expect(result.critique).toBe('Good.');
  });
});
