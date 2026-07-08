import { describe, expect, it } from 'vitest';
import { FIXTURE_CAPTURED_AT, findRepoRoot, gatherEvidence } from './evidence.js';

describe('findRepoRoot', () => {
  it('finds the ancestor directory containing fixtures/ and package.json', () => {
    const root = findRepoRoot(process.cwd());
    expect(root).toBe(process.cwd());
  });
});

describe('gatherEvidence (fixture mode, real repo fixtures)', () => {
  it('loads standings, markets, and a full evidence audit trail', async () => {
    const result = await gatherEvidence('fixture', { root: findRepoRoot() });

    expect(result.standings.length).toBeGreaterThan(0);
    expect(result.markets.length).toBeGreaterThan(0);

    // one evidence entry per source: standings, results, weather, news, kalshi
    expect(result.evidence).toHaveLength(5);
    const sources = result.evidence.map((e) => e.source).sort();
    expect(sources).toEqual(['autosport', 'jolpica', 'jolpica', 'kalshi', 'openmeteo']);
    for (const e of result.evidence) {
      expect(e.ok).toBe(true);
      expect(e.fetchedAt).toBe(FIXTURE_CAPTURED_AT);
    }
  });

  it('derives a weatherRisk in [0, 1] from the openmeteo fixture', async () => {
    const result = await gatherEvidence('fixture', { root: findRepoRoot() });
    expect(result.weatherRisk).toBeGreaterThanOrEqual(0);
    expect(result.weatherRisk).toBeLessThanOrEqual(1);
  });

  it('derives a newsSentiment score in [-1, 1] per standings driver, keyed by driverId', async () => {
    const result = await gatherEvidence('fixture', { root: findRepoRoot() });
    const driverIds = result.standings.map((s) => s.Driver.driverId);
    expect(Object.keys(result.newsSentiment).sort()).toEqual([...driverIds].sort());
    for (const score of Object.values(result.newsSentiment)) {
      expect(score).toBeGreaterThanOrEqual(-1);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('matches at least one Kalshi market title against a known driver family name', async () => {
    const result = await gatherEvidence('fixture', { root: findRepoRoot() });
    const familyNames = result.standings.map((s) => s.Driver.familyName.toLowerCase());
    const anyMatch = result.markets.some((m) => familyNames.some((name) => m.title.toLowerCase().includes(name)));
    expect(anyMatch).toBe(true);
  });
});

describe('gatherEvidence error handling', () => {
  it('throws a clear error when fixtures are missing at the given root', async () => {
    await expect(gatherEvidence('fixture', { root: '/nonexistent/f1-decision-platform-fixtures' })).rejects.toThrow(
      /not found/,
    );
  });
});
