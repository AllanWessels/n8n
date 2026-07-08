import { kalshiImpliedProb } from '@f1/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KALSHI_BASE_URL, KalshiClient } from './client.js';

const SAMPLE_MARKETS_RESPONSE = {
  markets: [
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
    {
      ticker: 'KXF1RACE-26MON-HAM',
      title: 'Will Hamilton win the Monaco GP?',
      yes_bid: 12,
      yes_ask: 15,
      last_price: 13,
      volume: 987,
      status: 'active',
      close_time: '2026-05-24T13:00:00.000Z',
    },
    {
      ticker: 'KXF1RACE-27ABU-VER',
      title: 'Will Verstappen win the Abu Dhabi GP?',
      yes_bid: null,
      yes_ask: null,
      last_price: null,
      volume: 0,
      status: 'initialized',
      close_time: '2027-12-05T13:00:00.000Z',
    },
  ],
  cursor: '',
};

const SAMPLE_ORDERBOOK_RESPONSE = {
  orderbook: {
    yes: [[40, 100], [39, 50]],
    no: [[56, 80]],
  },
};

const SAMPLE_EVENTS_RESPONSE = {
  events: [{ event_ticker: 'KXF1RACE-26MON', series_ticker: 'KXF1RACE', title: 'Monaco GP winner' }],
  cursor: '',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchArgs = [input: string, init?: { headers: Record<string, string> }];

describe('KalshiClient.getMarkets', () => {
  it('fetches, parses, and normalizes markets, tolerating null yes_bid/yes_ask', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }>>(
      async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => SAMPLE_MARKETS_RESPONSE,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KalshiClient();
    const markets = await client.getMarkets({ seriesTicker: 'KXF1RACE', limit: 50 });

    expect(markets).toHaveLength(3);

    const ver = markets[0]!;
    const ham = markets[1]!;
    const offSeason = markets[2]!;
    expect(ver.ticker).toBe('KXF1RACE-26MON-VER');
    expect(kalshiImpliedProb(ver)).toBeCloseTo(0.42);
    expect(kalshiImpliedProb(ham)).toBeCloseTo(0.135);

    // The off-season market had null yes_bid/yes_ask on the wire; the
    // client normalizes them to 0 so the shared KalshiMarketSchema (which
    // requires numbers) still validates it.
    expect(offSeason.yes_bid).toBe(0);
    expect(offSeason.yes_ask).toBe(0);
    expect(kalshiImpliedProb(offSeason)).toBe(0);

    // Verify the request URL included the query params and hit the default base URL.
    const call = fetchMock.mock.calls[0] as FetchArgs;
    const calledUrl = call[0];
    expect(calledUrl).toContain(DEFAULT_KALSHI_BASE_URL);
    expect(calledUrl).toContain('series_ticker=KXF1RACE');
    expect(calledUrl).toContain('limit=50');
  });

  it('does not attach signed headers when no credentials are provided', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }>>(
      async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => SAMPLE_MARKETS_RESPONSE,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KalshiClient();
    await client.getMarkets();

    const call = fetchMock.mock.calls[0] as FetchArgs;
    const options = call[1]!;
    expect(options.headers['KALSHI-ACCESS-KEY']).toBeUndefined();
    expect(options.headers['KALSHI-ACCESS-SIGNATURE']).toBeUndefined();
  });

  it('attaches signed headers when credentials are provided', async () => {
    const crypto = await import('node:crypto');
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }>>(
      async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => SAMPLE_MARKETS_RESPONSE,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KalshiClient({ keyId: 'my-key', privateKeyPem: privateKey });
    await client.getMarkets();

    const call = fetchMock.mock.calls[0] as FetchArgs;
    const options = call[1]!;
    expect(options.headers['KALSHI-ACCESS-KEY']).toBe('my-key');
    expect(typeof options.headers['KALSHI-ACCESS-SIGNATURE']).toBe('string');
    expect(options.headers['KALSHI-ACCESS-SIGNATURE']!.length).toBeGreaterThan(0);
  });

  it('throws a clear error on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) })),
    );
    const client = new KalshiClient();
    await expect(client.getMarkets()).rejects.toThrow(/Kalshi API request failed: 500/);
  });
});

describe('KalshiClient.getMarket', () => {
  it('fetches and normalizes a single market', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ market: SAMPLE_MARKETS_RESPONSE.markets[0] }),
      })),
    );
    const client = new KalshiClient();
    const market = await client.getMarket('KXF1RACE-26MON-VER');
    expect(market.ticker).toBe('KXF1RACE-26MON-VER');
    expect(kalshiImpliedProb(market)).toBeCloseTo(0.42);
  });
});

describe('KalshiClient.getOrderbook', () => {
  it('fetches and parses the orderbook', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => SAMPLE_ORDERBOOK_RESPONSE,
      })),
    );
    const client = new KalshiClient();
    const orderbook = await client.getOrderbook('KXF1RACE-26MON-VER');
    expect(orderbook.yes).toEqual([[40, 100], [39, 50]]);
    expect(orderbook.no).toEqual([[56, 80]]);
  });
});

describe('KalshiClient.getEvents', () => {
  it('fetches and parses events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => SAMPLE_EVENTS_RESPONSE,
      })),
    );
    const client = new KalshiClient();
    const events = await client.getEvents({ seriesTicker: 'KXF1RACE' });
    expect(events).toHaveLength(1);
    expect(events[0]?.event_ticker).toBe('KXF1RACE-26MON');
  });
});
