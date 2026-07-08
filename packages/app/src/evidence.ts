/**
 * Evidence gathering for the F1 decision pipeline.
 *
 * In `fixture` mode every source is read deterministically from the
 * recorded JSON fixtures under `${root}/fixtures/**` (no network access —
 * see `fixtures/README.md`). In `live` mode Kalshi markets are fetched from
 * the live Kalshi API via `@dop/kalshi`; the remaining sources (Jolpica
 * standings/results, Open-Meteo weather, Autosport news) have no live
 * client wired up in this platform yet, so they continue to be read from
 * the same bundled fixture files. This keeps `live` mode runnable without
 * requiring extra credentials for those sources, while Kalshi pricing — the
 * signal that actually needs to be fresh — is genuinely live.
 *
 * NOTE: fixtures were all captured at the fixed timestamp below (see
 * `fixtures/README.md`) — never call `Date.now()`/`new Date()` here.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  JolpicaDriverStandingSchema,
  JolpicaRaceResultSchema,
  KalshiMarketSchema,
  OpenMeteoForecastSchema,
  RssItemSchema,
  type Evidence,
  type JolpicaDriverStanding,
  type KalshiMarket,
} from '@dop/contracts';
import { getMarkets, type KalshiMode } from '@dop/kalshi';

/** Fixed capture timestamp shared by every bundled fixture. */
export const FIXTURE_CAPTURED_AT = '2026-07-07T00:00:00Z';

export interface GatherEvidenceOptions {
  root?: string;
}

export interface GatheredEvidence {
  standings: JolpicaDriverStanding[];
  markets: KalshiMarket[];
  evidence: Evidence[];
  weatherRisk: number;
  newsSentiment: Record<string, number>;
}

/**
 * Walks up from `startDir` looking for the repo root: the first ancestor
 * directory that contains both a `fixtures/` folder and a `package.json`.
 * Falls back to `startDir` if none is found within 10 levels. Honors the
 * `F1_REPO_ROOT` env var when set, taking precedence over the walk-up.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  if (process.env.F1_REPO_ROOT) return process.env.F1_REPO_ROOT;
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(dir, 'fixtures')) && existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

async function readJsonFixture<T>(root: string, relPath: string): Promise<T> {
  const fullPath = path.join(root, relPath);
  let raw: string;
  try {
    raw = await readFile(fullPath, 'utf-8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Evidence fixture not found at ${fullPath}. Ensure the repo's fixtures/ directory is present, ` +
        `or pass an explicit { root } pointing at it. Cause: ${cause}`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Evidence fixture at ${fullPath} is not valid JSON. Cause: ${cause}`);
  }
}

interface JolpicaStandingsResponse {
  MRData?: {
    StandingsTable?: {
      StandingsLists?: Array<{ DriverStandings?: unknown[] }>;
    };
  };
}

interface JolpicaResultsResponse {
  MRData?: {
    RaceTable?: {
      Races?: Array<Record<string, unknown>>;
    };
  };
}

async function loadStandings(root: string): Promise<JolpicaDriverStanding[]> {
  const data = await readJsonFixture<JolpicaStandingsResponse>(root, 'fixtures/jolpica/driver_standings.json');
  const list = data.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
  return list.map((s) => JolpicaDriverStandingSchema.parse(s));
}

/** The most recently completed race result, validated but kept loosely typed for the evidence payload. */
async function loadLastResults(root: string): Promise<unknown> {
  const data = await readJsonFixture<JolpicaResultsResponse>(root, 'fixtures/jolpica/last_results.json');
  const race = data.MRData?.RaceTable?.Races?.[0];
  if (!race) return { races: [] };
  return JolpicaRaceResultSchema.parse(race);
}

interface OpenMeteoRaw {
  hourly?: { precipitation_probability?: number[] };
}

async function loadWeather(root: string): Promise<{ payload: unknown; weatherRisk: number }> {
  const data = await readJsonFixture<OpenMeteoRaw>(root, 'fixtures/openmeteo/silverstone_forecast.json');
  const probs = data.hourly?.precipitation_probability ?? [];
  if (probs.length === 0) {
    return { payload: data, weatherRisk: 0.1 };
  }
  const parsed = OpenMeteoForecastSchema.parse(data);
  const maxProb = parsed.hourly.precipitation_probability.reduce((max, p) => Math.max(max, p), 0);
  const weatherRisk = Math.min(1, Math.max(0, maxProb / 100));
  return { payload: parsed, weatherRisk };
}

interface RssFixtureItem {
  title: string;
  link: string;
  isoDate?: string;
  contentSnippet?: string;
}

async function loadNews(root: string): Promise<RssFixtureItem[]> {
  const data = await readJsonFixture<unknown[]>(root, 'fixtures/news/autosport_f1.json');
  return data.map((item) => RssItemSchema.parse(item));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const POSITIVE_WORDS = ['win', 'wins', 'winning', 'victory', 'fastest', 'pole', 'title', 'best', 'dominant'];
const NEGATIVE_WORDS = [
  'crash',
  'crashed',
  'penalty',
  'penalised',
  'penalized',
  'boo',
  'boos',
  'anticlimactic',
  'deficit',
  'fail',
  'failed',
  'hampered',
];

/**
 * Simple keyword tally per driver: for every driver in the standings, scan
 * every news item whose title/snippet mentions the driver's family name and
 * tally positive vs. negative keyword hits, averaged per mention and
 * clamped to [-1, 1]. Drivers with no news mentions get a neutral 0. Keyed
 * by `driverId` so the result can be passed straight to
 * `estimateWinProbabilities`'s `newsSentiment` input.
 */
function tallyNewsSentiment(standings: JolpicaDriverStanding[], news: RssFixtureItem[]): Record<string, number> {
  const sentiment: Record<string, number> = {};
  for (const standing of standings) {
    const familyName = standing.Driver.familyName.toLowerCase();
    let score = 0;
    let mentions = 0;
    for (const item of news) {
      const haystack = `${item.title} ${item.contentSnippet ?? ''}`.toLowerCase();
      if (!haystack.includes(familyName)) continue;
      mentions += 1;
      for (const w of POSITIVE_WORDS) if (haystack.includes(w)) score += 1;
      for (const w of NEGATIVE_WORDS) if (haystack.includes(w)) score -= 1;
    }
    sentiment[standing.Driver.driverId] = mentions === 0 ? 0 : clamp(score / mentions, -1, 1);
  }
  return sentiment;
}

interface RawKalshiFixture {
  markets?: unknown[];
}

async function loadMarkets(mode: KalshiMode, root: string): Promise<KalshiMarket[]> {
  const raw = await getMarkets(mode, { root });
  // The bundled fixture is captured verbatim from Kalshi's list-markets
  // response, `{ cursor, series_ticker, markets: [...] }`, rather than a
  // bare array — unwrap it defensively so both shapes work.
  const list: unknown[] = Array.isArray(raw) ? raw : ((raw as RawKalshiFixture).markets ?? []);
  return list.map((m) => KalshiMarketSchema.parse(m));
}

/**
 * Gathers all evidence needed for a single F1 decision-pipeline run:
 * championship standings, the most recent race result, weather risk, news
 * sentiment, and Kalshi markets — plus an `Evidence[]` audit trail (one
 * entry per source) suitable for persistence and for handing to the LLM
 * agent/judge steps.
 */
export async function gatherEvidence(
  mode: KalshiMode,
  opts: GatherEvidenceOptions = {},
): Promise<GatheredEvidence> {
  const root = opts.root ?? findRepoRoot();

  const [standings, lastResults, weather, news, markets] = await Promise.all([
    loadStandings(root),
    loadLastResults(root),
    loadWeather(root),
    loadNews(root),
    loadMarkets(mode, root),
  ]);

  const newsSentiment = tallyNewsSentiment(standings, news);

  const evidence: Evidence[] = [
    { source: 'jolpica', kind: 'standings', fetchedAt: FIXTURE_CAPTURED_AT, ok: true, payload: standings },
    { source: 'jolpica', kind: 'results', fetchedAt: FIXTURE_CAPTURED_AT, ok: true, payload: lastResults },
    {
      source: 'openmeteo',
      kind: 'weather',
      fetchedAt: FIXTURE_CAPTURED_AT,
      ok: true,
      payload: weather.payload,
    },
    { source: 'autosport', kind: 'news', fetchedAt: FIXTURE_CAPTURED_AT, ok: true, payload: news },
    { source: 'kalshi', kind: 'market', fetchedAt: FIXTURE_CAPTURED_AT, ok: true, payload: markets },
  ];

  return {
    standings,
    markets,
    evidence,
    weatherRisk: weather.weatherRisk,
    newsSentiment,
  };
}
