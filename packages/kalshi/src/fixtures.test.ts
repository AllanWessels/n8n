import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { KalshiMarket } from '@dop/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMarkets, loadKalshiFixture } from './fixtures.js';
import { KalshiClient } from './client.js';

const SAMPLE_MARKETS: KalshiMarket[] = [
  {
    ticker: 'KXF1RACE-26MON-VER',
    title: 'Will Verstappen win the Monaco GP?',
    yes_bid: 40,
    yes_ask: 44,
    last_price: 42,
    volume: 12345,
    status: 'active',
    close_time: '2026-05-24T13:00:00.000Z',
  },
];

describe('loadKalshiFixture', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'kalshi-fixture-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads and parses a fixture JSON file from fixtures/kalshi/<name>.json', async () => {
    const dir = path.join(root, 'fixtures', 'kalshi');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'kxf1_markets.json'), JSON.stringify(SAMPLE_MARKETS), 'utf-8');

    const loaded = await loadKalshiFixture<KalshiMarket[]>('kxf1_markets', { root });
    expect(loaded).toEqual(SAMPLE_MARKETS);
  });

  it('throws a clear error when the fixture is missing', async () => {
    await expect(loadKalshiFixture('does_not_exist', { root })).rejects.toThrow(
      /Kalshi fixture "does_not_exist" not found/,
    );
  });
});

describe('getMarkets', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'kalshi-fixture-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('mode "fixture" loads markets from the kxf1_markets fixture', async () => {
    const dir = path.join(root, 'fixtures', 'kalshi');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'kxf1_markets.json'), JSON.stringify(SAMPLE_MARKETS), 'utf-8');

    const markets = await getMarkets('fixture', { root });
    expect(markets).toEqual(SAMPLE_MARKETS);
  });

  it('mode "live" delegates to KalshiClient.getMarkets', async () => {
    const fakeClient = {
      getMarkets: vi.fn(async () => SAMPLE_MARKETS),
    } as unknown as KalshiClient;

    const markets = await getMarkets('live', { client: fakeClient, params: { seriesTicker: 'KXF1RACE' } });
    expect(markets).toEqual(SAMPLE_MARKETS);
    expect(fakeClient.getMarkets).toHaveBeenCalledWith({ seriesTicker: 'KXF1RACE' });
  });
});
