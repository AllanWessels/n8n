import type { AgentAssessment, Evidence, JudgeScore, JudgeVerdict } from '@dop/contracts';
import { type JudgeRubric, weightedScore } from '@dop/contracts';
import type { LLM } from './ollama.js';
import { clamp, extractFirstJsonObject } from './json.js';

function buildPrompt(
  assessment: AgentAssessment,
  evidence: Evidence[],
  rubric: JudgeRubric,
): { system: string; user: string } {
  const criteriaList = rubric.criteria
    .map((c) => `- "${c.id}" (weight ${c.weight}): ${c.description}`)
    .join('\n');

  const responseShape = [
    '{',
    ...rubric.criteria.map((c) => `  "${c.id}": <number 0-1>,`),
    '  "critique": <string>',
    '}',
  ].join('\n');

  const system =
    'You are an impartial judge scoring an AI analyst\'s assessment against a rubric. ' +
    `Respond with ONLY a single JSON object of the form:\n${responseShape}\n` +
    'Do not include any text outside the JSON object.';

  const evidenceSummary = evidence
    .map((e, i) => `${i + 1}. [${e.source}/${e.kind}] ok=${e.ok}`)
    .join('\n');

  const user = [
    `Subject: ${assessment.subject}`,
    `Assessed probability: ${assessment.probability}`,
    `Reasoning: ${assessment.reasoning}`,
    `Key factors: ${assessment.keyFactors.join('; ') || '(none)'}`,
    '',
    'Evidence available to the analyst:',
    evidenceSummary || '(no evidence)',
    '',
    'Rubric criteria to score (each 0-1):',
    criteriaList,
    '',
    'Score each criterion and provide a brief critique. Return the JSON object described in ' +
      'the system instructions.',
  ].join('\n');

  return { system, user };
}

function parseJudgeJson(text: string, rubric: JudgeRubric): { criteria: Record<string, number>; critique: string } {
  const raw = extractFirstJsonObject(text) as Record<string, unknown>;

  const criteria: Record<string, number> = {};
  for (const c of rubric.criteria) {
    const value = raw[c.id];
    const num = typeof value === 'number' ? value : Number(value);
    criteria[c.id] = clamp(Number.isFinite(num) ? num : 0, 0, 1);
  }

  const critique = typeof raw.critique === 'string' ? raw.critique : '';

  return { criteria, critique };
}

function verdictFor(overall: number, rubric: JudgeRubric): JudgeVerdict {
  if (overall >= rubric.passThreshold) return 'pass';
  if (overall >= rubric.reviseThreshold) return 'revise';
  return 'reject';
}

/**
 * Asks the LLM to score an agent's assessment against a rubric, then
 * computes the weighted overall score and derives a pass/revise/reject
 * verdict from the rubric's thresholds.
 */
export async function judge(
  assessment: AgentAssessment,
  evidence: Evidence[],
  rubric: JudgeRubric,
  llm: LLM,
): Promise<JudgeScore> {
  const { system, user } = buildPrompt(assessment, evidence, rubric);
  const raw = await llm.chat({ system, user, json: true });
  const { criteria, critique } = parseJudgeJson(raw, rubric);

  const overall = weightedScore(criteria, rubric);
  const verdict = verdictFor(overall, rubric);

  return { overall, criteria, verdict, critique };
}
