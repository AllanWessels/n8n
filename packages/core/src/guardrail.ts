import type {
  AgentAssessment,
  DecisionInput,
  EdgeResult,
  PolicyConfig,
  PolicyDecision,
} from '@f1/contracts';

/**
 * Checks a decision input against policy BEFORE any model call is made —
 * e.g. banned subjects/markets or missing evidence. Cheap, fast-fail gate.
 */
export function checkInputPolicy(input: DecisionInput, policy: PolicyConfig): PolicyDecision {
  const appliedPolicies = ['bannedMarkets', 'evidenceRequired'];
  const violations: string[] = [];

  if (policy.bannedMarkets.includes(input.subject)) {
    violations.push(`subject "${input.subject}" is on the banned markets list`);
  }

  if (input.evidence.length === 0) {
    violations.push('no evidence was supplied for this decision input');
  }

  return {
    approved: violations.length === 0,
    violations,
    appliedPolicies,
  };
}

/**
 * Checks a fully-formed decision (assessment + optional edge) against
 * policy AFTER the agent/judge steps have run.
 */
export function checkDecisionPolicy(
  edge: EdgeResult | undefined,
  assessment: AgentAssessment,
  policy: PolicyConfig,
): PolicyDecision {
  const appliedPolicies = ['minConfidence', 'minEdge', 'maxSizeUsd', 'bannedMarkets'];
  const violations: string[] = [];

  if (assessment.probability < policy.minConfidence) {
    violations.push(
      `assessment confidence ${assessment.probability} is below minConfidence ${policy.minConfidence}`,
    );
  }

  if (policy.bannedMarkets.includes(assessment.subject)) {
    violations.push(`subject "${assessment.subject}" is on the banned markets list`);
  }

  if (edge) {
    if (edge.action === 'BUY' && edge.edge < policy.minEdge) {
      violations.push(`edge ${edge.edge} is below minEdge ${policy.minEdge} for a BUY action`);
    }
    if (edge.sizeUsd > policy.maxSizeUsd) {
      violations.push(`position size ${edge.sizeUsd} exceeds maxSizeUsd ${policy.maxSizeUsd}`);
    }
    if (policy.bannedMarkets.includes(edge.marketTicker)) {
      violations.push(`market "${edge.marketTicker}" is on the banned markets list`);
    }
  }

  return {
    approved: violations.length === 0,
    violations,
    appliedPolicies,
  };
}
