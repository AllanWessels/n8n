/**
 * Zod schemas for validating EXTERNAL payloads at ingestion time.
 *
 * Anything that crosses a network boundary (Kalshi, Jolpica, OpenF1,
 * Open-Meteo, RSS feeds, ...) must be parsed through one of these schemas
 * before the rest of the platform is allowed to trust its shape.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Kalshi
// ---------------------------------------------------------------------------

/** A single Kalshi market, as returned by the Kalshi trade API. */
export const KalshiMarketSchema = z.object({
  ticker: z.string(),
  title: z.string(),
  /** Best yes bid, in cents (0-100). `null` when the market has no live quote (e.g. off-season). */
  yes_bid: z.number().nullable(),
  /** Best yes ask, in cents (0-100). `null` when the market has no live quote. */
  yes_ask: z.number().nullable(),
  last_price: z.number().nullable().optional(),
  volume: z.number().optional(),
  status: z.string(),
  close_time: z.string().optional(),
});
export type KalshiMarket = z.infer<typeof KalshiMarketSchema>;

/**
 * Implied probability of a Kalshi market's "yes" side, derived from the
 * mid of the bid/ask spread. Kalshi quotes prices in cents (0-100), so the
 * mid is divided by 100 to yield a probability, then clamped to [0, 1] to
 * guard against malformed/out-of-range upstream data.
 *
 * Returns `NaN` when either side has no live quote (`null`), signalling
 * "no market price" so downstream logic holds rather than inferring a 0%
 * probability. Callers should test with `Number.isFinite(...)`.
 */
export function kalshiImpliedProb(m: Pick<KalshiMarket, 'yes_bid' | 'yes_ask'>): number {
  if (m.yes_bid == null || m.yes_ask == null) return NaN;
  const mid = (m.yes_bid + m.yes_ask) / 2 / 100;
  return Math.min(1, Math.max(0, mid));
}

// ---------------------------------------------------------------------------
// Jolpica (Ergast-compatible F1 data API)
// ---------------------------------------------------------------------------

const JolpicaDriverSchema = z.object({
  driverId: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  code: z.string().optional(),
});

const JolpicaConstructorSchema = z.object({
  constructorId: z.string(),
  name: z.string(),
});

export const JolpicaDriverStandingSchema = z.object({
  position: z.string(),
  points: z.string(),
  wins: z.string(),
  Driver: JolpicaDriverSchema,
  Constructors: z.array(JolpicaConstructorSchema),
});
export type JolpicaDriverStanding = z.infer<typeof JolpicaDriverStandingSchema>;

const JolpicaResultEntrySchema = z.object({
  position: z.string(),
  Driver: JolpicaDriverSchema,
  Constructor: JolpicaConstructorSchema,
  grid: z.string(),
  status: z.string(),
});

export const JolpicaRaceResultSchema = z.object({
  season: z.string(),
  round: z.string(),
  raceName: z.string(),
  Results: z.array(JolpicaResultEntrySchema),
});
export type JolpicaRaceResult = z.infer<typeof JolpicaRaceResultSchema>;

// ---------------------------------------------------------------------------
// OpenF1
// ---------------------------------------------------------------------------

export const OpenF1WeatherSchema = z.object({
  air_temperature: z.number(),
  track_temperature: z.number(),
  humidity: z.number(),
  rainfall: z.number(),
  wind_speed: z.number(),
  date: z.string(),
});
export type OpenF1Weather = z.infer<typeof OpenF1WeatherSchema>;

// ---------------------------------------------------------------------------
// Open-Meteo
// ---------------------------------------------------------------------------

export const OpenMeteoForecastSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    precipitation_probability: z.array(z.number()),
  }),
});
export type OpenMeteoForecast = z.infer<typeof OpenMeteoForecastSchema>;

// ---------------------------------------------------------------------------
// RSS
// ---------------------------------------------------------------------------

export const RssItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  isoDate: z.string().optional(),
  contentSnippet: z.string().optional(),
});
export type RssItem = z.infer<typeof RssItemSchema>;

// ---------------------------------------------------------------------------
// Internal — decision record (validated before persistence)
// ---------------------------------------------------------------------------

const EvidenceSchema = z.object({
  source: z.string(),
  kind: z.string(),
  fetchedAt: z.string(),
  ok: z.boolean(),
  payload: z.unknown(),
});

const AgentAssessmentSchema = z.object({
  subject: z.string(),
  probability: z.number(),
  reasoning: z.string(),
  keyFactors: z.array(z.string()),
  modelId: z.string(),
});

const EdgeActionSchema = z.enum(['BUY', 'PASS', 'HOLD']);

const EdgeResultSchema = z.object({
  marketTicker: z.string(),
  subject: z.string(),
  modelProb: z.number(),
  marketProb: z.number(),
  edge: z.number(),
  action: EdgeActionSchema,
  sizeUsd: z.number(),
  kellyFraction: z.number().optional(),
});

const JudgeVerdictSchema = z.enum(['pass', 'revise', 'reject']);

const JudgeScoreSchema = z.object({
  overall: z.number(),
  criteria: z.record(z.string(), z.number()),
  verdict: JudgeVerdictSchema,
  critique: z.string(),
});

const PolicyDecisionSchema = z.object({
  approved: z.boolean(),
  violations: z.array(z.string()),
  appliedPolicies: z.array(z.string()),
});

export const DecisionRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  domain: z.string(),
  subject: z.string(),
  createdAt: z.string(),
  assessment: AgentAssessmentSchema,
  edge: EdgeResultSchema.optional(),
  judge: JudgeScoreSchema,
  policy: PolicyDecisionSchema,
  action: EdgeActionSchema,
  rationale: z.string(),
  status: z.enum(['approved', 'rejected']),
  modelIds: z.array(z.string()),
});
export type DecisionRecordParsed = z.infer<typeof DecisionRecordSchema>;

// Sanity note: `DecisionInput.evidence` uses EvidenceSchema's shape above;
// exported here in case callers want to validate raw evidence arrays too.
export { EvidenceSchema };
