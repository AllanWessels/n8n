import { describe, expect, it } from 'vitest';
import type { DecisionInput } from '@f1/contracts';
import { assess } from './agent.js';
import { StubLLM } from './ollama.js';

function makeInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    runId: 'run-1',
    domain: 'f1',
    subject: 'driver-x-wins',
    evidence: [
      {
        source: 'kalshi',
        kind: 'market',
        fetchedAt: '2026-07-07T00:00:00.000Z',
        ok: true,
        payload: { yes_bid: 40, yes_ask: 42 },
      },
    ],
    ...overrides,
  };
}

describe('assess', () => {
  it('parses a clean JSON response into an AgentAssessment', async () => {
    const llm = new StubLLM([
      JSON.stringify({
        probability: 0.62,
        reasoning: 'Strong recent form and favorable grid position.',
        keyFactors: ['recent form', 'grid position'],
      }),
    ]);

    const result = await assess(makeInput(), llm, { modelId: 'llama3' });

    expect(result).toEqual({
      subject: 'driver-x-wins',
      probability: 0.62,
      reasoning: 'Strong recent form and favorable grid position.',
      keyFactors: ['recent form', 'grid position'],
      modelId: 'llama3',
    });
  });

  it('defaults modelId to "unknown" when not provided', async () => {
    const llm = new StubLLM([JSON.stringify({ probability: 0.5, reasoning: 'r', keyFactors: [] })]);
    const result = await assess(makeInput(), llm);
    expect(result.modelId).toBe('unknown');
  });

  it('parses JSON wrapped in prose robustly', async () => {
    const llm = new StubLLM([
      `Sure! Here's my analysis:\n${JSON.stringify({
        probability: 0.8,
        reasoning: 'Dominant this season.',
        keyFactors: ['dominance'],
      })}\nLet me know if you need more.`,
    ]);

    const result = await assess(makeInput(), llm, { modelId: 'm' });
    expect(result.probability).toBe(0.8);
    expect(result.reasoning).toBe('Dominant this season.');
    expect(result.keyFactors).toEqual(['dominance']);
  });

  it('clamps out-of-range probabilities into [0, 1]', async () => {
    const llmHigh = new StubLLM([JSON.stringify({ probability: 1.5, reasoning: 'r', keyFactors: [] })]);
    const highResult = await assess(makeInput(), llmHigh);
    expect(highResult.probability).toBe(1);

    const llmLow = new StubLLM([JSON.stringify({ probability: -0.3, reasoning: 'r', keyFactors: [] })]);
    const lowResult = await assess(makeInput(), llmLow);
    expect(lowResult.probability).toBe(0);
  });

  it('falls back to sane defaults when fields are missing or malformed', async () => {
    const llm = new StubLLM([JSON.stringify({ probability: 'not-a-number' })]);
    const result = await assess(makeInput(), llm);
    expect(result.probability).toBe(0);
    expect(result.reasoning).toBe('');
    expect(result.keyFactors).toEqual([]);
  });

  it('handles empty evidence gracefully in the prompt', async () => {
    const llm = new StubLLM([JSON.stringify({ probability: 0.4, reasoning: 'r', keyFactors: [] })]);
    const result = await assess(makeInput({ evidence: [] }), llm);
    expect(result.probability).toBe(0.4);
    expect(llm.calls[0]?.user).toContain('no evidence was gathered');
  });
});
