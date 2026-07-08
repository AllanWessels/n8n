import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { KalshiMarket } from '@f1/contracts';
import { KalshiClient, type GetMarketsParams } from './client.js';

export interface LoadKalshiFixtureOptions {
  root?: string;
}

const KXF1_MARKETS_FIXTURE = 'kxf1_markets';

/**
 * Loads a recorded Kalshi JSON fixture from `fixtures/kalshi/<name>.json`,
 * relative to `root` (defaults to `process.cwd()`).
 */
export async function loadKalshiFixture<T = unknown>(
  name: string,
  options: LoadKalshiFixtureOptions = {},
): Promise<T> {
  const root = options.root ?? process.cwd();
  const fixturePath = path.join(root, 'fixtures', 'kalshi', `${name}.json`);
  let raw: string;
  try {
    raw = await readFile(fixturePath, 'utf-8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Kalshi fixture "${name}" not found at ${fixturePath}. ` +
        `Ensure fixtures/kalshi/${name}.json exists (record one from a live response, or check the ` +
        `"root" option passed to loadKalshiFixture). Cause: ${cause}`,
    );
  }
  return JSON.parse(raw) as T;
}

export type KalshiMode = 'fixture' | 'live';

export interface GetMarketsOptions extends LoadKalshiFixtureOptions {
  client?: KalshiClient;
  params?: GetMarketsParams;
}

/**
 * Fetches Kalshi F1 markets either from a recorded fixture (`mode:
 * 'fixture'`, deterministic/offline) or from the live Kalshi API (`mode:
 * 'live'`, via `KalshiClient`).
 */
export async function getMarkets(mode: KalshiMode, options: GetMarketsOptions = {}): Promise<KalshiMarket[]> {
  if (mode === 'fixture') {
    return loadKalshiFixture<KalshiMarket[]>(KXF1_MARKETS_FIXTURE, { root: options.root });
  }
  const client = options.client ?? new KalshiClient();
  return client.getMarkets(options.params ?? {});
}
