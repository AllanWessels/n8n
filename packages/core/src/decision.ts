import {
  DecisionRecordSchema,
  type AgentAssessment,
  type DecisionInput,
  type DecisionRecord,
  type DecisionStatus,
  type EdgeResult,
  type JudgeRubric,
  type JudgeScore,
  type PolicyConfig,
  type PolicyDecision,
} from '@f1/contracts';
import { assess } from './agent.js';
import { judge } from './judge.js';
import { checkDecisionPolicy, checkInputPolicy } from './guardrail.js';
import type { LLM } from './ollama.js';

export interface BuildDecisionRecordParts {
  id: string;
  runId: string;
  domain: string;
  subject: string;
  createdAt: string;
  assessment: AgentAssessment;
  edge?: EdgeResult;
  judge: JudgeScore;
  policy: PolicyDecision;
  action: DecisionRecord['action'];
  rationale: string;
  status: DecisionStatus;
  modelIds: string[];
}

/**
 * Assembles a `DecisionRecord` from its constituent parts and validates it
 * against `DecisionRecordSchema` before returning. `id`/`createdAt` are
 * injected by the caller so record construction stays deterministic and
 * testable (no `Date.now()`/`randomUUID()` inside).
 */
export function buildDecisionRecord(parts: BuildDecisionRecordParts): DecisionRecord {
  const candidate: DecisionRecord = {
    id: parts.id,
    runId: parts.runId,
    domain: parts.domain,
    subject: parts.subject,
    createdAt: parts.createdAt,
    assessment: parts.assessment,
    edge: parts.edge,
    judge: parts.judge,
    policy: parts.policy,
    action: parts.action,
    rationale: parts.rationale,
    status: parts.status,
    modelIds: parts.modelIds,
  };
  return DecisionRecordSchema.parse(candidate) as DecisionRecord;
}

export interface RunDecisionDeps {
  llm: LLM;
  rubric: JudgeRubric;
  policy: PolicyConfig;
  computeEdge?: (assessment: AgentAssessment) => EdgeResult | undefined;
  id: string;
  createdAt: string;
  /** Maximum number of revise loop iterations. Defaults to 1. */
  maxRevise?: number;
}

function composeRationale(assessment: AgentAssessment, judgeScore: JudgeScore): string {
  const parts = [assessment.reasoning.trim(), judgeScore.critique.trim()].filter((s) => s.length > 0);
  return parts.join(' | ');
}

/**
 * Orchestrates the full decision pipeline for a single input:
 * guardrail (input) -> agent assess -> edge -> judge -> [revise loop] ->
 * guardrail (decision) -> decision record.
 */
export async function runDecision(input: DecisionInput, deps: RunDecisionDeps): Promise<DecisionRecord> {
  const { llm, rubric, policy, computeEdge, id, createdAt } = deps;
  const maxRevise = deps.maxRevise ?? 1;

  const inputPolicy = checkInputPolicy(input, policy);
  if (!inputPolicy.approved) {
    const placeholderAssessment: AgentAssessment = {
      subject: input.subject,
      probability: 0,
      reasoning: 'Decision rejected before assessment: input failed policy guardrails.',
      keyFactors: [],
      modelId: 'none',
    };
    const placeholderJudge: JudgeScore = {
      overall: 0,
      criteria: {},
      verdict: 'reject',
      critique: `Input policy violations: ${inputPolicy.violations.join('; ')}`,
    };

    return buildDecisionRecord({
      id,
      runId: input.runId,
      domain: input.domain,
      subject: input.subject,
      createdAt,
      assessment: placeholderAssessment,
      edge: undefined,
      judge: placeholderJudge,
      policy: inputPolicy,
      action: 'PASS',
      rationale: placeholderJudge.critique,
      status: 'rejected',
      modelIds: [],
    });
  }

  let assessment = await assess(input, llm);
  let edge = computeEdge?.(assessment);
  let judgeScore = await judge(assessment, input.evidence, rubric, llm);

  let reviseCount = 0;
  while (judgeScore.verdict === 'revise' && reviseCount < maxRevise) {
    reviseCount += 1;
    assessment = await assess(input, llm);
    edge = computeEdge?.(assessment);
    judgeScore = await judge(assessment, input.evidence, rubric, llm);
  }

  const decisionPolicy = checkDecisionPolicy(edge, assessment, policy);
  const status: DecisionStatus =
    decisionPolicy.approved && judgeScore.verdict !== 'reject' ? 'approved' : 'rejected';
  const action = edge?.action ?? 'PASS';
  const rationale = composeRationale(assessment, judgeScore);

  return buildDecisionRecord({
    id,
    runId: input.runId,
    domain: input.domain,
    subject: input.subject,
    createdAt,
    assessment,
    edge,
    judge: judgeScore,
    policy: decisionPolicy,
    action,
    rationale,
    status,
    modelIds: [assessment.modelId],
  });
}
