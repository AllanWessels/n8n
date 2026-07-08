import { describe, expect, it } from 'vitest';
import type { JolpicaDriverStanding } from '@dop/contracts';
import { estimateWinProbabilities } from './model.js';

function standing(
  driverId: string,
  code: string,
  points: string,
  wins: string,
  position: string,
): JolpicaDriverStanding {
  return {
    position,
    points,
    wins,
    Driver: { driverId, givenName: driverId, familyName: driverId, code },
    Constructors: [{ constructorId: 'team', name: 'Team' }],
  };
}

// Realistic-ish 2026-season-shaped standings snapshot.
const baseStandings: JolpicaDriverStanding[] = [
  standing('norris', 'NOR', '374', '6', '1'),
  standing('verstappen', 'VER', '356', '5', '2'),
  standing('piastri', 'PIA', '292', '4', '3'),
];

function entropy(probs: number[]): number {
  return -probs.reduce((sum, p) => (p > 0 ? sum + p * Math.log(p) : sum), 0);
}

describe('estimateWinProbabilities', () => {
  it('returns probabilities that sum to 1.0 within tight tolerance', () => {
    const result = estimateWinProbabilities({ standings: baseStandings });
    const sum = result.reduce((s, d) => s + d.probability, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('returns one entry per driver, sorted descending by probability', () => {
    const result = estimateWinProbabilities({ standings: baseStandings });
    expect(result).toHaveLength(3);
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]!;
      const cur = result[i]!;
      expect(prev.probability).toBeGreaterThanOrEqual(cur.probability);
    }
  });

  it('returns an empty array for empty standings', () => {
    expect(estimateWinProbabilities({ standings: [] })).toEqual([]);
  });

  it('carries through driverId and code, falling back to driverId when code is missing', () => {
    const noCode: JolpicaDriverStanding = {
      position: '4',
      points: '100',
      wins: '0',
      Driver: { driverId: 'newdriver', givenName: 'New', familyName: 'Driver' },
      Constructors: [{ constructorId: 'team', name: 'Team' }],
    };
    const result = estimateWinProbabilities({ standings: [noCode] });
    expect(result[0]).toMatchObject({ driverId: 'newdriver', code: 'newdriver' });
  });

  it('is monotonic in points, ceteris paribus (leader gets the highest probability)', () => {
    const lowGap: JolpicaDriverStanding[] = [
      standing('a', 'A', '100', '0', '1'),
      standing('b', 'B', '90', '0', '2'),
      standing('c', 'C', '80', '0', '3'),
    ];
    const highGap: JolpicaDriverStanding[] = [
      standing('a', 'A', '200', '0', '1'),
      standing('b', 'B', '90', '0', '2'),
      standing('c', 'C', '80', '0', '3'),
    ];

    const lowResult = estimateWinProbabilities({ standings: lowGap });
    const highResult = estimateWinProbabilities({ standings: highGap });

    const aLow = lowResult.find((d) => d.driverId === 'a')!;
    const aHigh = highResult.find((d) => d.driverId === 'a')!;

    // Increasing driver A's points (holding B and C fixed) must not
    // decrease A's win probability.
    expect(aHigh.probability).toBeGreaterThanOrEqual(aLow.probability);
  });

  it('gives more points to a driver a strictly higher probability than a driver with fewer points and identical other signals', () => {
    const standings: JolpicaDriverStanding[] = [
      standing('a', 'A', '400', '0', '1'),
      standing('b', 'B', '10', '0', '2'),
    ];
    const result = estimateWinProbabilities({ standings });
    const a = result.find((d) => d.driverId === 'a')!;
    const b = result.find((d) => d.driverId === 'b')!;
    expect(a.probability).toBeGreaterThan(b.probability);
  });

  it('remains numerically stable (finite, no NaN, sums to 1) with large score gaps', () => {
    const standings: JolpicaDriverStanding[] = [
      standing('a', 'A', '100000', '0', '1'),
      standing('b', 'B', '1', '0', '2'),
      standing('c', 'C', '1', '0', '3'),
    ];
    const result = estimateWinProbabilities({
      standings,
      // Push raw scores far apart to stress-test the softmax
      // max-subtraction stabilization (would overflow/NaN otherwise).
      recentForm: { a: 500, b: -500, c: -500 },
      llmPrior: { a: 500, b: -500, c: -500 },
    });

    for (const d of result) {
      expect(Number.isFinite(d.probability)).toBe(true);
      expect(d.probability).toBeGreaterThanOrEqual(0);
      expect(d.probability).toBeLessThanOrEqual(1);
    }
    const sum = result.reduce((s, d) => s + d.probability, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('increases entropy (flattens the distribution) as weatherRisk increases', () => {
    const skewed: JolpicaDriverStanding[] = [
      standing('a', 'A', '400', '0', '1'),
      standing('b', 'B', '50', '0', '2'),
      standing('c', 'C', '10', '0', '3'),
    ];

    const calm = estimateWinProbabilities({ standings: skewed, weatherRisk: 0 });
    const stormy = estimateWinProbabilities({ standings: skewed, weatherRisk: 1 });

    const calmEntropy = entropy(calm.map((d) => d.probability));
    const stormyEntropy = entropy(stormy.map((d) => d.probability));

    expect(stormyEntropy).toBeGreaterThan(calmEntropy);

    // Sanity: still sums to 1 under weather compression.
    const stormySum = stormy.reduce((s, d) => s + d.probability, 0);
    expect(Math.abs(stormySum - 1)).toBeLessThan(1e-9);
  });

  it('clamps out-of-range weatherRisk instead of producing invalid probabilities', () => {
    const result = estimateWinProbabilities({ standings: baseStandings, weatherRisk: 5 });
    const sum = result.reduce((s, d) => s + d.probability, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    for (const d of result) {
      expect(Number.isFinite(d.probability)).toBe(true);
    }
  });

  it('treats a non-finite weatherRisk as no compression (falls back to 0)', () => {
    const result = estimateWinProbabilities({ standings: baseStandings, weatherRisk: NaN });
    const sum = result.reduce((s, d) => s + d.probability, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    for (const d of result) {
      expect(Number.isFinite(d.probability)).toBe(true);
    }
  });

  it('treats unparseable points as 0 rather than throwing', () => {
    const standings: JolpicaDriverStanding[] = [
      standing('a', 'A', 'not-a-number', '0', '1'),
      standing('b', 'B', '50', '0', '2'),
    ];
    const result = estimateWinProbabilities({ standings });
    const sum = result.reduce((s, d) => s + d.probability, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    expect(result.find((d) => d.driverId === 'b')!.probability).toBeGreaterThan(
      result.find((d) => d.driverId === 'a')!.probability,
    );
  });

  it('falls back to a uniform score baseline when every driver has 0 points', () => {
    const standings: JolpicaDriverStanding[] = [
      standing('a', 'A', '0', '0', '1'),
      standing('b', 'B', '0', '0', '2'),
    ];
    const result = estimateWinProbabilities({ standings });
    expect(result[0]!.probability).toBeCloseTo(0.5, 9);
    expect(result[1]!.probability).toBeCloseTo(0.5, 9);
  });

  it('folds in news sentiment and llm prior signals', () => {
    const standings: JolpicaDriverStanding[] = [
      standing('a', 'A', '100', '0', '1'),
      standing('b', 'B', '100', '0', '2'),
    ];
    const boosted = estimateWinProbabilities({
      standings,
      newsSentiment: { a: 1, b: -1 },
      llmPrior: { a: 1, b: -1 },
    });
    const a = boosted.find((d) => d.driverId === 'a')!;
    const b = boosted.find((d) => d.driverId === 'b')!;
    expect(a.probability).toBeGreaterThan(b.probability);
  });
});
