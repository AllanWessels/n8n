import { describe, expect, it } from 'vitest';
import {
  DecisionRecordSchema,
  JolpicaDriverStandingSchema,
  JolpicaRaceResultSchema,
  KalshiMarketSchema,
  OpenF1WeatherSchema,
  OpenMeteoForecastSchema,
  RssItemSchema,
  kalshiImpliedProb,
} from './schemas.js';

describe('kalshiImpliedProb', () => {
  it('computes the mid of bid/ask as a probability', () => {
    expect(kalshiImpliedProb({ yes_bid: 40, yes_ask: 44 })).toBeCloseTo(0.42);
  });

  it('clamps below 0', () => {
    expect(kalshiImpliedProb({ yes_bid: -20, yes_ask: -10 })).toBe(0);
  });

  it('clamps above 1', () => {
    expect(kalshiImpliedProb({ yes_bid: 150, yes_ask: 160 })).toBe(1);
  });

  it('handles a 0/100 spread as 0.5', () => {
    expect(kalshiImpliedProb({ yes_bid: 0, yes_ask: 100 })).toBeCloseTo(0.5);
  });
});

describe('KalshiMarketSchema', () => {
  const valid = {
    ticker: 'KXF1RACE-26MON-VER',
    title: 'Will Verstappen win the Monaco GP?',
    yes_bid: 40,
    yes_ask: 44,
    last_price: 42,
    volume: 12345,
    status: 'active',
    close_time: '2026-05-24T13:00:00.000Z',
  };

  it('accepts a valid market', () => {
    expect(KalshiMarketSchema.parse(valid)).toEqual(valid);
  });

  it('accepts optional fields being omitted', () => {
    const minimal = {
      ticker: valid.ticker,
      title: valid.title,
      yes_bid: valid.yes_bid,
      yes_ask: valid.yes_ask,
      status: valid.status,
    };
    expect(() => KalshiMarketSchema.parse(minimal)).not.toThrow();
  });

  it('rejects a malformed market (missing required fields, wrong types)', () => {
    expect(() =>
      KalshiMarketSchema.parse({ ticker: 'X', yes_bid: 'forty' }),
    ).toThrow();
  });
});

describe('JolpicaDriverStandingSchema', () => {
  const valid = {
    position: '1',
    points: '575',
    wins: '19',
    Driver: {
      driverId: 'max_verstappen',
      givenName: 'Max',
      familyName: 'Verstappen',
      code: 'VER',
    },
    Constructors: [{ constructorId: 'red_bull', name: 'Red Bull' }],
  };

  it('accepts a valid standing', () => {
    expect(JolpicaDriverStandingSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a malformed standing', () => {
    expect(() =>
      JolpicaDriverStandingSchema.parse({ position: '1', Driver: {} }),
    ).toThrow();
  });
});

describe('JolpicaRaceResultSchema', () => {
  const valid = {
    season: '2026',
    round: '8',
    raceName: 'Monaco Grand Prix',
    Results: [
      {
        position: '1',
        Driver: {
          driverId: 'max_verstappen',
          givenName: 'Max',
          familyName: 'Verstappen',
        },
        Constructor: { constructorId: 'red_bull', name: 'Red Bull' },
        grid: '1',
        status: 'Finished',
      },
    ],
  };

  it('accepts a valid race result', () => {
    expect(JolpicaRaceResultSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a malformed race result', () => {
    expect(() =>
      JolpicaRaceResultSchema.parse({ season: '2026', Results: 'not-an-array' }),
    ).toThrow();
  });
});

describe('OpenF1WeatherSchema', () => {
  const valid = {
    air_temperature: 24.5,
    track_temperature: 38.2,
    humidity: 55,
    rainfall: 0,
    wind_speed: 1.8,
    date: '2026-05-24T13:00:00+00:00',
  };

  it('accepts valid weather', () => {
    expect(OpenF1WeatherSchema.parse(valid)).toEqual(valid);
  });

  it('rejects malformed weather', () => {
    expect(() => OpenF1WeatherSchema.parse({ air_temperature: 'hot' })).toThrow();
  });
});

describe('OpenMeteoForecastSchema', () => {
  const valid = {
    latitude: 43.7347,
    longitude: 7.4206,
    hourly: {
      time: ['2026-05-24T12:00', '2026-05-24T13:00'],
      temperature_2m: [23.1, 24.0],
      precipitation_probability: [10, 15],
    },
  };

  it('accepts a valid forecast', () => {
    expect(OpenMeteoForecastSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a malformed forecast', () => {
    expect(() =>
      OpenMeteoForecastSchema.parse({ latitude: 43.7, longitude: 7.4, hourly: { time: 'nope' } }),
    ).toThrow();
  });
});

describe('RssItemSchema', () => {
  const valid = {
    title: 'F1 news headline',
    link: 'https://example.com/news/1',
    isoDate: '2026-07-01T08:00:00.000Z',
    contentSnippet: 'Some snippet...',
  };

  it('accepts a valid item', () => {
    expect(RssItemSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a minimal item without optional fields', () => {
    expect(() =>
      RssItemSchema.parse({ title: 'X', link: 'https://example.com' }),
    ).not.toThrow();
  });

  it('rejects a malformed item', () => {
    expect(() => RssItemSchema.parse({ title: 42 })).toThrow();
  });
});

describe('DecisionRecordSchema', () => {
  const valid = {
    id: 'dec_1',
    runId: 'run_1',
    domain: 'f1',
    subject: 'monaco-gp-2026-winner',
    createdAt: '2026-05-24T13:00:00.000Z',
    assessment: {
      subject: 'monaco-gp-2026-winner',
      probability: 0.6,
      reasoning: 'Strong qualifying pace and historical Monaco dominance.',
      keyFactors: ['qualifying pace', 'track history'],
      modelId: 'qwen2.5:14b-instruct',
    },
    edge: {
      marketTicker: 'KXF1RACE-26MON-VER',
      subject: 'monaco-gp-2026-winner',
      modelProb: 0.6,
      marketProb: 0.42,
      edge: 0.18,
      action: 'BUY' as const,
      sizeUsd: 50,
      kellyFraction: 0.12,
    },
    judge: {
      overall: 0.82,
      criteria: { evidence_grounded: 0.9, calibrated_confidence: 0.75 },
      verdict: 'pass' as const,
      critique: 'Well grounded in evidence.',
    },
    policy: {
      approved: true,
      violations: [],
      appliedPolicies: ['minEdge', 'minConfidence'],
    },
    action: 'BUY' as const,
    rationale: 'Positive edge with high judge confidence.',
    status: 'approved' as const,
    modelIds: ['qwen2.5:14b-instruct'],
  };

  it('accepts a valid decision record', () => {
    expect(DecisionRecordSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a decision record without the optional edge field', () => {
    const withoutEdge: Record<string, unknown> = { ...valid };
    delete withoutEdge.edge;
    expect(() => DecisionRecordSchema.parse(withoutEdge)).not.toThrow();
  });

  it('rejects a malformed decision record', () => {
    expect(() =>
      DecisionRecordSchema.parse({ ...valid, action: 'NOT_AN_ACTION' }),
    ).toThrow();
  });
});
