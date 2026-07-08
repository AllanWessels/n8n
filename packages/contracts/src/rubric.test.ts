import { describe, expect, it } from 'vitest';
import { DEFAULT_F1_RUBRIC, weightedScore } from './rubric.js';

describe('DEFAULT_F1_RUBRIC', () => {
  it('has weights that sum to 1', () => {
    const sum = DEFAULT_F1_RUBRIC.criteria.reduce((acc, c) => acc + c.weight, 0);
    expect(sum).toBeCloseTo(1);
  });

  it('has a revise threshold below the pass threshold', () => {
    expect(DEFAULT_F1_RUBRIC.reviseThreshold).toBeLessThan(DEFAULT_F1_RUBRIC.passThreshold);
  });
});

describe('weightedScore', () => {
  it('computes a full score of 1 when every criterion scores 1', () => {
    const criteria = Object.fromEntries(DEFAULT_F1_RUBRIC.criteria.map((c) => [c.id, 1]));
    expect(weightedScore(criteria, DEFAULT_F1_RUBRIC)).toBeCloseTo(1);
  });

  it('computes a weighted average for mixed scores', () => {
    const criteria = {
      evidence_grounded: 0.8,
      calibrated_confidence: 0.6,
      policy_compliant: 1,
      reasoning_quality: 0.5,
    };
    // 0.8*0.35 + 0.6*0.25 + 1*0.2 + 0.5*0.2 = 0.28 + 0.15 + 0.2 + 0.1 = 0.73
    expect(weightedScore(criteria, DEFAULT_F1_RUBRIC)).toBeCloseTo(0.73);
  });

  it('treats missing criteria as 0', () => {
    const score = weightedScore({ evidence_grounded: 1 }, DEFAULT_F1_RUBRIC);
    expect(score).toBeCloseTo(0.35);
  });

  it('ignores extra unrelated criteria', () => {
    const score = weightedScore(
      { evidence_grounded: 1, calibrated_confidence: 1, policy_compliant: 1, reasoning_quality: 1, extra: 1 },
      DEFAULT_F1_RUBRIC,
    );
    expect(score).toBeCloseTo(1);
  });
});
