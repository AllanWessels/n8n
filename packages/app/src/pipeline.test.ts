import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_F1_RUBRIC, DecisionRecordSchema, loadPolicyFromEnv } from '@dop/contracts';
import { StubLLM } from '@dop/core';
import { findRepoRoot } from './evidence.js';
import { InMemoryDecisionStore } from './persist.js';
import { runF1Pipeline } from './pipeline.js';

/**
 * A `StubLLM` responder that recognizes the two prompt shapes used by
 * `@dop/core` (agent assess vs. judge) and answers deterministically,
 * however many times it's called — unlike a fixed queue, this never runs
 * out no matter how many markets the pipeline processes.
 */
function makeStubLLM(): StubLLM {
  return new StubLLM((req) => {
    if (req.system?.toLowerCase().includes('impartial judge')) {
      return JSON.stringify({
        evidence_grounded: 0.8,
        calibrated_confidence: 0.7,
        policy_compliant: 0.9,
        reasoning_quality: 0.75,
        critique: 'ok',
      });
    }
    return JSON.stringify({
      probability: 0.55,
      reasoning: 'form-based reasoning',
      keyFactors: ['form'],
    });
  });
}

describe('runF1Pipeline (real repo fixtures)', () => {
  it('produces schema-valid decision records for every processed market and persists them', async () => {
    const store = new InMemoryDecisionStore();
    const llm = makeStubLLM();
    const policy = loadPolicyFromEnv({});

    const records = await runF1Pipeline({
      mode: 'fixture',
      llm,
      policy,
      rubric: DEFAULT_F1_RUBRIC,
      store,
      runId: 'test-run-1',
      makeId: (i) => `dec_test-run-1_${i}`,
      createdAt: '2026-07-07T00:00:00Z',
      limit: 6,
      root: findRepoRoot(),
    });

    expect(records.length).toBeGreaterThanOrEqual(1);
    for (const record of records) {
      expect(() => DecisionRecordSchema.parse(record)).not.toThrow();
    }

    expect(store.records).toHaveLength(records.length);
    expect(store.runs.length).toBeGreaterThanOrEqual(1);
    expect(store.evidenceByRun.length).toBeGreaterThanOrEqual(1);

    const actions = new Set(records.map((r) => r.action));
    expect(actions.has('BUY') || actions.has('PASS')).toBe(true);
  });

  it('defaults limit to 8 markets when not provided', async () => {
    const store = new InMemoryDecisionStore();
    const records = await runF1Pipeline({
      mode: 'fixture',
      llm: makeStubLLM(),
      policy: loadPolicyFromEnv({}),
      rubric: DEFAULT_F1_RUBRIC,
      store,
      runId: 'test-run-default-limit',
      makeId: (i) => `dec_default_${i}`,
      createdAt: '2026-07-07T00:00:00Z',
      root: findRepoRoot(),
    });

    expect(records.length).toBeLessThanOrEqual(8);
    expect(records.length).toBeGreaterThan(0);
  });
});

describe('runF1Pipeline (synthetic fixtures: HOLD + unmatched-market handling)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'f1-app-pipeline-'));
    await mkdir(path.join(root, 'fixtures', 'jolpica'), { recursive: true });
    await mkdir(path.join(root, 'fixtures', 'openmeteo'), { recursive: true });
    await mkdir(path.join(root, 'fixtures', 'news'), { recursive: true });
    await mkdir(path.join(root, 'fixtures', 'kalshi'), { recursive: true });

    await writeFile(
      path.join(root, 'fixtures', 'jolpica', 'driver_standings.json'),
      JSON.stringify({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                DriverStandings: [
                  {
                    position: '1',
                    points: '100',
                    wins: '5',
                    Driver: { driverId: 'driver_a', givenName: 'Ayrton', familyName: 'Senna', code: 'SEN' },
                    Constructors: [{ constructorId: 'team_a', name: 'Team A' }],
                  },
                  {
                    position: '2',
                    points: '80',
                    wins: '3',
                    Driver: { driverId: 'driver_b', givenName: 'Alain', familyName: 'Prost', code: 'PRO' },
                    Constructors: [{ constructorId: 'team_b', name: 'Team B' }],
                  },
                ],
              },
            ],
          },
        },
      }),
      'utf-8',
    );

    await writeFile(
      path.join(root, 'fixtures', 'jolpica', 'last_results.json'),
      JSON.stringify({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2025',
                round: '1',
                raceName: 'Test GP',
                Results: [
                  {
                    position: '1',
                    Driver: { driverId: 'driver_a', givenName: 'Ayrton', familyName: 'Senna' },
                    Constructor: { constructorId: 'team_a', name: 'Team A' },
                    grid: '1',
                    status: 'Finished',
                  },
                ],
              },
            ],
          },
        },
      }),
      'utf-8',
    );

    await writeFile(
      path.join(root, 'fixtures', 'openmeteo', 'silverstone_forecast.json'),
      JSON.stringify({
        latitude: 52,
        longitude: -1,
        hourly: { time: ['2026-07-08T00:00'], temperature_2m: [20], precipitation_probability: [40] },
      }),
      'utf-8',
    );

    await writeFile(
      path.join(root, 'fixtures', 'news', 'autosport_f1.json'),
      JSON.stringify([
        {
          title: 'Ayrton Senna scores a dominant victory',
          link: 'https://example.com/senna-win',
          isoDate: '2026-07-07T00:00:00Z',
          contentSnippet: 'A great win for Senna',
        },
      ]),
      'utf-8',
    );

    await writeFile(
      path.join(root, 'fixtures', 'kalshi', 'kxf1_markets.json'),
      JSON.stringify({
        cursor: '',
        series_ticker: 'KXF1',
        markets: [
          {
            ticker: 'KXF1-TEST-AS',
            title: 'Will Ayrton Senna win the F1 Drivers Championship?',
            status: 'active',
            close_time: '2026-12-22T15:00:00Z',
            yes_bid: null,
            yes_ask: null,
          },
          {
            ticker: 'KXF1-TEST-XX',
            title: 'Will Nobody Driver win the F1 Drivers Championship?',
            status: 'active',
            close_time: '2026-12-22T15:00:00Z',
            yes_bid: 40,
            yes_ask: 44,
          },
        ],
      }),
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('yields HOLD for a null-priced market and does not crash on an unmatched market', async () => {
    const store = new InMemoryDecisionStore();

    const records = await runF1Pipeline({
      mode: 'fixture',
      llm: makeStubLLM(),
      policy: loadPolicyFromEnv({}),
      rubric: DEFAULT_F1_RUBRIC,
      store,
      runId: 'test-run-2',
      makeId: (i) => `dec_test-run-2_${i}`,
      createdAt: '2026-07-07T00:00:00Z',
      root,
    });

    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(() => DecisionRecordSchema.parse(record)).not.toThrow();
    }

    const sennaRecord = records.find((r) => r.subject.includes('Ayrton Senna'));
    expect(sennaRecord?.action).toBe('HOLD');
    // computeEdge signals "no usable price" via NaN, but the pipeline
    // substitutes a schema-safe 0 before it flows through DecisionRecordSchema
    // (marketProb: z.number(), which zod rejects for NaN).
    expect(sennaRecord?.edge?.marketProb).toBe(0);
    expect(sennaRecord?.edge?.edge).toBe(0);

    const unmatchedRecord = records.find((r) => r.subject.includes('Nobody Driver'));
    expect(unmatchedRecord).toBeDefined();
    expect(unmatchedRecord?.action).toBe('PASS');
  });
});
