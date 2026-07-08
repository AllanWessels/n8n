import type { AgentAssessment, DecisionInput } from '@f1/contracts';
import type { LLM } from './ollama.js';
import { clamp, extractFirstJsonObject } from './json.js';

interface RawAgentJson {
  probability?: unknown;
  reasoning?: unknown;
  keyFactors?: unknown;
}

function summarizeEvidence(input: DecisionInput): string {
  if (input.evidence.length === 0) {
    return '(no evidence was gathered for this run)';
  }
  return input.evidence
    .map((e, i) => {
      const status = e.ok ? 'ok' : 'FAILED';
      const payload = safeStringify(e.payload);
      return `${i + 1}. [${e.source}/${e.kind}] (${status}, fetched ${e.fetchedAt}): ${payload}`;
    })
    .join('\n');
}

function safeStringify(payload: unknown): string {
  try {
    const s = JSON.stringify(payload);
    if (s === undefined) return String(payload);
    return s.length > 2000 ? `${s.slice(0, 2000)}...(truncated)` : s;
  } catch {
    return String(payload);
  }
}

function buildPrompt(input: DecisionInput): { system: string; user: string } {
  const system =
    'You are a careful, well-calibrated analyst producing a probability assessment for a ' +
    'decision-support system. Rules: (1) Base the number ONLY on the supplied evidence ' +
    '(championship points, standings position, recent results, weather, news). ' +
    '(2) Be calibrated: in a field of ~20 drivers only one wins a championship, so most ' +
    'drivers should score well below 0.15; reserve high probabilities for clear points ' +
    'leaders. Never output 1.0 unless the outcome is already mathematically certain. ' +
    '(3) "reasoning" MUST be a non-empty sentence citing specific evidence (e.g. points, ' +
    'position). (4) "keyFactors" MUST list 2-4 concrete factors. ' +
    'Respond with ONLY a single JSON object of the form ' +
    '{"probability": number between 0 and 1, "reasoning": string, "keyFactors": string[]}. ' +
    'Do not include any text outside the JSON object.';

  const user = [
    `Domain: ${input.domain}`,
    `Subject: ${input.subject}`,
    '',
    'Evidence gathered for this run:',
    summarizeEvidence(input),
    '',
    'Based solely on the evidence above, estimate the probability that the outcome described ' +
      `by the subject ("${input.subject}") occurs. Return the JSON object described in the ` +
      'system instructions.',
  ].join('\n');

  return { system, user };
}

function parseAgentJson(text: string): { probability: number; reasoning: string; keyFactors: string[] } {
  const raw = extractFirstJsonObject(text) as RawAgentJson;

  const rawProbability = typeof raw.probability === 'number' ? raw.probability : Number(raw.probability);
  const probability = clamp(Number.isFinite(rawProbability) ? rawProbability : 0, 0, 1);

  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';

  const keyFactors = Array.isArray(raw.keyFactors)
    ? raw.keyFactors.filter((f): f is string => typeof f === 'string')
    : [];

  return { probability, reasoning, keyFactors };
}

/**
 * Runs the LLM agent over a decision input's evidence and returns a
 * structured probability assessment.
 */
export async function assess(
  input: DecisionInput,
  llm: LLM,
  opts?: { modelId?: string },
): Promise<AgentAssessment> {
  const { system, user } = buildPrompt(input);
  const raw = await llm.chat({ system, user, json: true });
  const parsed = parseAgentJson(raw);

  return {
    subject: input.subject,
    probability: parsed.probability,
    reasoning: parsed.reasoning,
    keyFactors: parsed.keyFactors,
    modelId: opts?.modelId ?? 'unknown',
  };
}
