/**
 * F1 win-probability model.
 *
 * This is a *transparent, documented heuristic* — not a trained statistical
 * model. It is intentionally simple and auditable: every input signal maps
 * to one term in a linear score, the score is compressed by weather-driven
 * upset potential, and the result is converted to a probability distribution
 * via a numerically-stable softmax.
 *
 * Pipeline:
 *   1. For each driver, compute a linear score from four signals:
 *        - championship standing (normalized points, relative to the
 *          field leader)
 *        - recent form
 *        - news sentiment
 *        - an external LLM-derived prior probability/confidence
 *      each scaled by an exported weight constant.
 *   2. Compress every score toward zero (the pre-softmax "uniform" point) in
 *      proportion to `weatherRisk`. Wet/unstable conditions increase upset
 *      potential, so a higher weatherRisk should flatten (increase the
 *      entropy of) the resulting distribution.
 *   3. Convert the compressed scores to probabilities with a temperature
 *      softmax, subtracting the max score first for numerical stability
 *      with large point gaps (dominant championship leaders, etc.).
 *
 * The output always sums to 1.0 (within floating point tolerance) and is
 * sorted by descending probability.
 */
import type { JolpicaDriverStanding } from '@f1/contracts';

/** A single driver's estimated probability of winning. */
export interface DriverProb {
  driverId: string;
  code: string;
  probability: number;
}

/** Input bundle for {@link estimateWinProbabilities}. */
export interface WinProbabilityInput {
  /** Current championship standings (source of truth for driver identity). */
  standings: JolpicaDriverStanding[];
  /** Optional recent-form signal per driverId (higher = better recent form). */
  recentForm?: Record<string, number>;
  /**
   * Optional [0, 1] weather-risk signal for the upcoming session. Higher
   * values represent more unstable/wet conditions and more upset potential,
   * which compresses the field's scores toward a uniform distribution.
   */
  weatherRisk?: number;
  /** Optional news-sentiment signal per driverId (higher = more positive). */
  newsSentiment?: Record<string, number>;
  /** Optional LLM-derived prior signal per driverId. */
  llmPrior?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Exported, inspectable weight constants.
// ---------------------------------------------------------------------------

/** Weight applied to a driver's normalized championship points. */
export const W_CHAMPIONSHIP = 3.0;
/** Weight applied to the `recentForm` signal. */
export const W_FORM = 1.5;
/** Weight applied to the `newsSentiment` signal. */
export const W_NEWS = 0.5;
/** Weight applied to the `llmPrior` signal. */
export const W_PRIOR = 2.0;
/**
 * Fraction of a driver's score removed at `weatherRisk === 1`. At
 * `weatherRisk === 0` no compression is applied; the effect scales linearly
 * in between.
 */
export const WEATHER_COMPRESSION = 0.85;
/** Softmax temperature. Higher values flatten the resulting distribution. */
export const SOFTMAX_TEMPERATURE = 1.0;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Estimates a per-driver probability of winning from championship
 * standings plus optional recent-form, weather-risk, news-sentiment and
 * LLM-prior signals. See module docs for the full method.
 */
export function estimateWinProbabilities(input: WinProbabilityInput): DriverProb[] {
  const { standings, recentForm = {}, weatherRisk = 0, newsSentiment = {}, llmPrior = {} } = input;

  if (standings.length === 0) return [];

  const drivers = standings.map((s) => ({
    driverId: s.Driver.driverId,
    code: s.Driver.code ?? s.Driver.driverId,
    points: Number.parseFloat(s.points) || 0,
  }));

  const maxPoints = drivers.reduce((max, d) => Math.max(max, d.points), 0);
  const weatherFactor = 1 - clamp01(weatherRisk) * WEATHER_COMPRESSION;

  const scored = drivers.map((d) => {
    const normalizedPoints = maxPoints > 0 ? d.points / maxPoints : 0;
    const form = recentForm[d.driverId] ?? 0;
    const news = newsSentiment[d.driverId] ?? 0;
    const prior = llmPrior[d.driverId] ?? 0;
    const rawScore =
      W_CHAMPIONSHIP * normalizedPoints + W_FORM * form + W_NEWS * news + W_PRIOR * prior;
    return {
      driverId: d.driverId,
      code: d.code,
      // Compress toward zero (pre-softmax "uniform") proportional to
      // weather risk — more upset potential in unstable conditions.
      score: rawScore * weatherFactor,
    };
  });

  // Numerically stable softmax: subtract the max score before exponentiating
  // so large point gaps (e.g. a dominant championship leader) don't overflow.
  const maxScore = scored.reduce((max, s) => Math.max(max, s.score), -Infinity);
  const withExp = scored.map((s) => ({
    driverId: s.driverId,
    code: s.code,
    exp: Math.exp((s.score - maxScore) / SOFTMAX_TEMPERATURE),
  }));
  const sumExp = withExp.reduce((sum, s) => sum + s.exp, 0);

  const result: DriverProb[] = withExp.map((s) => ({
    driverId: s.driverId,
    code: s.code,
    probability: s.exp / sumExp,
  }));

  return result.sort((a, b) => b.probability - a.probability);
}
