// Paper-only: order execution intentionally not implemented; this client is read-only.
import { KalshiMarketSchema, type KalshiMarket } from '@dop/contracts';
import { z } from 'zod';
import { signKalshiRequest } from './signer.js';

export const DEFAULT_KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

export interface KalshiClientOptions {
  baseUrl?: string;
  keyId?: string;
  privateKeyPem?: string;
}

export interface GetMarketsParams {
  seriesTicker?: string;
  eventTicker?: string;
  status?: string;
  limit?: number;
}

export interface GetEventsParams {
  seriesTicker?: string;
  limit?: number;
}

/**
 * Raw Kalshi market payload, as returned over the wire. Kalshi returns
 * `null` for `yes_bid`/`yes_ask` on markets with no current quotes (e.g.
 * off-season markets) — the shared `@dop/contracts` `KalshiMarketSchema`
 * requires numbers, so this raw schema tolerates `null` and the values are
 * normalized to `0` before being handed to `KalshiMarketSchema`.
 */
const RawKalshiMarketSchema = z.object({
  ticker: z.string(),
  title: z.string(),
  yes_bid: z.number().nullable().optional(),
  yes_ask: z.number().nullable().optional(),
  last_price: z.number().nullable().optional(),
  volume: z.number().optional(),
  status: z.string(),
  close_time: z.string().optional(),
});

const RawKalshiMarketsResponseSchema = z.object({
  markets: z.array(RawKalshiMarketSchema),
  cursor: z.string().optional(),
});

const RawKalshiEventSchema = z.object({
  event_ticker: z.string(),
  series_ticker: z.string().optional(),
  title: z.string().optional(),
});

const RawKalshiEventsResponseSchema = z.object({
  events: z.array(RawKalshiEventSchema),
  cursor: z.string().optional(),
});
export type KalshiEvent = z.infer<typeof RawKalshiEventSchema>;

const RawKalshiOrderbookSchema = z.object({
  yes: z.array(z.tuple([z.number(), z.number()])).optional(),
  no: z.array(z.tuple([z.number(), z.number()])).optional(),
});
export type KalshiOrderbook = z.infer<typeof RawKalshiOrderbookSchema>;

/**
 * Normalizes a raw wire market into the shared `KalshiMarket` contract type.
 * `yes_bid`/`yes_ask` are preserved as `null` when the market has no live
 * quote (the contract schema is nullable) so that `kalshiImpliedProb` returns
 * `NaN` and downstream logic HOLDs, rather than inferring a false 0% price.
 */
function normalizeMarket(raw: z.infer<typeof RawKalshiMarketSchema>): KalshiMarket {
  return KalshiMarketSchema.parse({
    ...raw,
    yes_bid: raw.yes_bid ?? null,
    yes_ask: raw.yes_ask ?? null,
  });
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

/**
 * Read-only client for the Kalshi trade API. Market data endpoints are
 * public and require no credentials; if `keyId` + `privateKeyPem` are
 * supplied, requests are signed with RSA-PSS per Kalshi's auth spec (this
 * is not required for the public market-data endpoints used here, but is
 * supported for parity with authenticated endpoints).
 */
export class KalshiClient {
  private readonly baseUrl: string;
  private readonly keyId?: string;
  private readonly privateKeyPem?: string;

  constructor(options: KalshiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_KALSHI_BASE_URL;
    this.keyId = options.keyId;
    this.privateKeyPem = options.privateKeyPem;
  }

  private buildHeaders(method: string, requestPath: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.keyId && this.privateKeyPem) {
      const signed = signKalshiRequest({
        keyId: this.keyId,
        privateKeyPem: this.privateKeyPem,
        method,
        path: requestPath,
        timestampMs: Date.now(),
      });
      Object.assign(headers, signed);
    }
    return headers;
  }

  /** Path portion (including `/trade-api/v2/...`) derived from `baseUrl`, used for signing. */
  private basePath(): string {
    return new URL(this.baseUrl).pathname;
  }

  private async getJson<T>(pathSuffix: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = toQueryString(query);
    const url = `${this.baseUrl}${pathSuffix}${qs}`;
    const requestPath = `${this.basePath()}${pathSuffix}`;
    const res = await fetch(url, { method: 'GET', headers: this.buildHeaders('GET', requestPath) });
    if (!res.ok) {
      throw new Error(`Kalshi API request failed: ${res.status} ${res.statusText} (${url})`);
    }
    return (await res.json()) as T;
  }

  async getMarkets(params: GetMarketsParams = {}): Promise<KalshiMarket[]> {
    const raw = await this.getJson<unknown>('/markets', {
      series_ticker: params.seriesTicker,
      event_ticker: params.eventTicker,
      status: params.status,
      limit: params.limit,
    });
    const parsed = RawKalshiMarketsResponseSchema.parse(raw);
    return parsed.markets.map(normalizeMarket);
  }

  async getMarket(ticker: string): Promise<KalshiMarket> {
    const raw = await this.getJson<unknown>(`/markets/${encodeURIComponent(ticker)}`);
    const parsed = z.object({ market: RawKalshiMarketSchema }).parse(raw);
    return normalizeMarket(parsed.market);
  }

  async getOrderbook(ticker: string): Promise<KalshiOrderbook> {
    const raw = await this.getJson<unknown>(`/markets/${encodeURIComponent(ticker)}/orderbook`);
    const parsed = z.object({ orderbook: RawKalshiOrderbookSchema }).parse(raw);
    return parsed.orderbook;
  }

  async getEvents(params: GetEventsParams = {}): Promise<KalshiEvent[]> {
    const raw = await this.getJson<unknown>('/events', {
      series_ticker: params.seriesTicker,
      limit: params.limit,
    });
    const parsed = RawKalshiEventsResponseSchema.parse(raw);
    return parsed.events;
  }
}
