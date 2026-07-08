import { describe, expect, it } from 'vitest';
import type { DecisionRecord, Evidence } from '@dop/contracts';
import { InMemoryDecisionStore } from './persist.js';

function sampleRecord(id: string): DecisionRecord {
  return {
    id,
    runId: 'run-1',
    domain: 'f1-championship-winner',
    subject: 'Will Test Driver win the F1 Drivers Championship?',
    createdAt: '2026-07-07T00:00:00Z',
    assessment: {
      subject: 'Will Test Driver win the F1 Drivers Championship?',
      probability: 0.6,
      reasoning: 'test reasoning',
      keyFactors: ['form'],
      modelId: 'stub',
    },
    edge: {
      marketTicker: 'KXF1-TEST',
      subject: 'Will Test Driver win the F1 Drivers Championship?',
      modelProb: 0.6,
      marketProb: 0.4,
      edge: 0.2,
      action: 'BUY',
      sizeUsd: 10,
    },
    judge: {
      overall: 0.8,
      criteria: { evidence_grounded: 0.8 },
      verdict: 'pass',
      critique: 'ok',
    },
    policy: { approved: true, violations: [], appliedPolicies: [] },
    action: 'BUY',
    rationale: 'test rationale',
    status: 'approved',
    modelIds: ['stub'],
  };
}

describe('InMemoryDecisionStore', () => {
  it('round-trips a saved run', async () => {
    const store = new InMemoryDecisionStore();
    const id = await store.saveRun({
      id: 'run-1',
      domain: 'f1-championship-winner',
      subject: 'F1 Drivers Championship winner',
      startedAt: '2026-07-07T00:00:00Z',
    });

    expect(id).toBe('run-1');
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]?.status).toBeUndefined();
  });

  it('round-trips saved evidence, keyed by runId', async () => {
    const store = new InMemoryDecisionStore();
    const evidence: Evidence[] = [
      { source: 'kalshi', kind: 'market', fetchedAt: '2026-07-07T00:00:00Z', ok: true, payload: [] },
      { source: 'jolpica', kind: 'standings', fetchedAt: '2026-07-07T00:00:00Z', ok: true, payload: [] },
    ];

    await store.saveEvidence('run-1', evidence);

    expect(store.evidenceByRun).toHaveLength(1);
    expect(store.evidenceByRun[0]?.runId).toBe('run-1');
    expect(store.evidenceByRun[0]?.evidence).toEqual(evidence);
  });

  it('round-trips a saved decision record', async () => {
    const store = new InMemoryDecisionStore();
    const record = sampleRecord('dec_1');

    await store.saveRecord(record);

    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toEqual(record);
  });

  it('accumulates multiple runs, evidence snapshots, and records independently', async () => {
    const store = new InMemoryDecisionStore();

    await store.saveRun({ id: 'run-1', domain: 'd', subject: 's', startedAt: '2026-07-07T00:00:00Z' });
    await store.saveRun({
      id: 'run-1',
      domain: 'd',
      subject: 's',
      startedAt: '2026-07-07T00:00:00Z',
      finishedAt: '2026-07-07T00:05:00Z',
      status: 'completed',
    });
    await store.saveRecord(sampleRecord('dec_1'));
    await store.saveRecord(sampleRecord('dec_2'));

    expect(store.runs).toHaveLength(2);
    expect(store.runs[1]?.status).toBe('completed');
    expect(store.records.map((r) => r.id)).toEqual(['dec_1', 'dec_2']);
  });
});
