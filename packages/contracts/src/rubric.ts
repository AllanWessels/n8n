/**
 * Rubric used by the LLM-judge step to score an agent's assessment before
 * it is allowed to flow into a decision.
 */

export interface JudgeRubricCriterion {
  id: string;
  description: string;
  weight: number;
}

export interface JudgeRubric {
  criteria: JudgeRubricCriterion[];
  passThreshold: number;
  reviseThreshold: number;
}

export const DEFAULT_F1_RUBRIC: JudgeRubric = {
  criteria: [
    {
      id: 'evidence_grounded',
      description: 'The assessment cites and is consistent with the gathered evidence.',
      weight: 0.35,
    },
    {
      id: 'calibrated_confidence',
      description: 'The stated probability is well-calibrated relative to the evidence strength.',
      weight: 0.25,
    },
    {
      id: 'policy_compliant',
      description: 'The recommendation respects the configured decision policy guardrails.',
      weight: 0.2,
    },
    {
      id: 'reasoning_quality',
      description: 'The reasoning is coherent, specific, and free of contradictions.',
      weight: 0.2,
    },
  ],
  passThreshold: 0.7,
  reviseThreshold: 0.5,
};

/**
 * Computes a weighted score in [0, 1] (in general) from a map of
 * criterion-id -> raw score (each expected in [0, 1]) and a rubric that
 * defines the weight of each criterion. Criteria present in `criteria` but
 * absent from the rubric are ignored; criteria in the rubric but absent
 * from `criteria` contribute 0.
 */
export function weightedScore(criteria: Record<string, number>, rubric: JudgeRubric): number {
  let total = 0;
  for (const c of rubric.criteria) {
    const value = criteria[c.id] ?? 0;
    total += value * c.weight;
  }
  return total;
}
