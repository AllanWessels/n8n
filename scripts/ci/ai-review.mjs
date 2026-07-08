#!/usr/bin/env node
// scripts/ci/ai-review.mjs
//
// In-CI adversarial AI code reviewer. Computes the PR diff, sends it to a
// locally running Ollama instance (OpenAI-compatible /v1/chat/completions
// endpoint) with an adversarial reviewer system prompt + rubric, parses the
// JSON findings the model returns, writes a Markdown report to
// $GITHUB_STEP_SUMMARY, and (when a GITHUB_TOKEN is available) posts the
// report as a PR comment.
//
// Exit codes:
//   0 - no blocking findings (or Ollama/model unavailable — infra flakiness
//       must never hard-fail the pipeline).
//   1 - one or more `high` severity findings, and the PR does NOT carry the
//       `override-ai-review` label.
//
// Zero dependencies: Node 22 built-ins only (global fetch, node:child_process,
// node:fs, node:process).

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const BASE_REF = process.env.BASE_REF || 'main';
const REPO = process.env.REPO || '';
const PR_NUMBER = process.env.PR_NUMBER || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY || '';
const OVERRIDE_LABEL = 'override-ai-review';

// Cap the diff we send to the model to keep small local models fast and
// within context. Diffs larger than this are truncated with a notice.
const MAX_DIFF_CHARS = 60_000;
// Network timeouts so a hung Ollama server / GitHub API can't wedge CI.
const OLLAMA_TIMEOUT_MS = 120_000;
const GITHUB_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You are an ADVERSARIAL senior code reviewer embedded in a CI pipeline. \
Your job is to find real problems before they reach production — assume the \
author missed something and actively try to prove the diff is unsafe, \
incorrect, undertested, or overcomplicated. Do not be polite or hedge; be \
specific and cite file paths/line numbers from the diff hunks when possible. \
Do not invent findings that aren't supported by the diff — no finding is \
better than a fabricated one.

Review the diff strictly against this rubric:
1. Correctness — logic errors, off-by-one, incorrect control flow, unhandled \
   edge cases, race conditions, broken contracts with callers.
2. Security — injection, secrets, unsafe deserialization, SSRF, path \
   traversal, auth/authz gaps, unsafe use of eval/child_process/fs, \
   dependency risk.
3. Test coverage — new/changed behavior without corresponding tests, weak or \
   tautological assertions, missing edge-case tests.
4. Error handling — swallowed errors, silent fallbacks, missing propagation, \
   unclear failure modes.
5. Simplicity — unnecessary complexity, duplication, dead code, better \
   existing utilities that should have been reused instead.

Respond with ONLY a single JSON object, no prose outside it, matching this \
shape exactly:
{
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "category": "correctness" | "security" | "test-coverage" | "error-handling" | "simplicity",
      "file": "path/to/file or null if not file-specific",
      "line": number or null,
      "title": "short summary",
      "description": "what is wrong and why it matters",
      "recommendation": "concrete suggested fix"
    }
  ],
  "summary": "1-3 sentence overall assessment"
}

Use "high" severity ONLY for issues that would cause data loss, a security \
vulnerability, broken production behavior, or a build/test break. Use \
"medium" for real but non-critical issues. Use "low" for nitpicks/style. If \
you find nothing wrong, return an empty "findings" array — do not pad with \
low-value nitpicks.`;

function log(msg) {
  console.log(msg);
}

function warn(msg) {
  console.warn(`WARNING: ${msg}`);
}

async function run(cmd, args, opts = {}) {
  return execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 64, ...opts });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Compute the PR diff against the base branch. Returns '' if unavailable. */
async function computeDiff() {
  try {
    await run('git', ['fetch', '--no-tags', '--depth=200', 'origin', BASE_REF]);
  } catch (err) {
    warn(`git fetch origin ${BASE_REF} failed: ${err.message}. Trying local ref.`);
  }

  const candidates = [`origin/${BASE_REF}...HEAD`, `${BASE_REF}...HEAD`];
  for (const range of candidates) {
    try {
      const { stdout } = await run('git', [
        'diff',
        range,
        '--',
        '.',
        ':(exclude)package-lock.json',
      ]);
      if (stdout && stdout.trim().length > 0) return stdout;
    } catch {
      // try next candidate
    }
  }
  return '';
}

function truncateDiff(diff) {
  if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: false };
  return {
    diff: `${diff.slice(0, MAX_DIFF_CHARS)}\n\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`,
    truncated: true,
  };
}

/** Check whether the local Ollama server is up. */
async function isOllamaUp() {
  try {
    const res = await fetchWithTimeout('http://localhost:11434/api/version', {}, 5000);
    return res.ok;
  } catch {
    return false;
  }
}

/** Extract the first balanced top-level JSON object from a string. */
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseFindings(raw) {
  const jsonText = extractJsonObject(raw) ?? raw;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`could not parse model output as JSON: ${err.message}`);
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const normalized = findings
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      severity: ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'low',
      category: typeof f.category === 'string' ? f.category : 'unspecified',
      file: typeof f.file === 'string' ? f.file : null,
      line: typeof f.line === 'number' ? f.line : null,
      title: typeof f.title === 'string' && f.title.trim() ? f.title.trim() : 'Untitled finding',
      description: typeof f.description === 'string' ? f.description : '',
      recommendation: typeof f.recommendation === 'string' ? f.recommendation : '',
    }));
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  return { findings: normalized, summary };
}

async function callOllama(diff) {
  const body = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Review the following PR diff (base: ${BASE_REF}). Diff:\n\n${diff}`,
      },
    ],
    stream: false,
    temperature: 0.1,
    format: 'json',
  };

  const res = await fetchWithTimeout(
    OLLAMA_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    OLLAMA_TIMEOUT_MS,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText} ${text}`.trim());
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Ollama response had no message content');
  }
  return content;
}

function severityEmoji(severity) {
  if (severity === 'high') return '🔴';
  if (severity === 'medium') return '🟠';
  return '🟡';
}

function buildMarkdownReport({ findings, summary, truncatedNotice, skippedReason }) {
  const lines = [];
  lines.push('## Adversarial AI Review (Ollama · qwen2.5:3b)');
  lines.push('');

  if (skippedReason) {
    lines.push(`_Review skipped: ${skippedReason}_`);
    return lines.join('\n');
  }

  if (truncatedNotice) {
    lines.push(`> ${truncatedNotice}`);
    lines.push('');
  }

  if (summary) {
    lines.push(`**Summary:** ${summary}`);
    lines.push('');
  }

  if (findings.length === 0) {
    lines.push('No findings. ✅');
    return lines.join('\n');
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  lines.push(
    `**Findings:** ${counts.high} high · ${counts.medium} medium · ${counts.low} low`,
  );
  lines.push('');
  lines.push('| Severity | Category | Location | Title |');
  lines.push('|---|---|---|---|');
  for (const f of findings) {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '—';
    lines.push(
      `| ${severityEmoji(f.severity)} ${f.severity} | ${f.category} | ${loc} | ${f.title} |`,
    );
  }
  lines.push('');

  for (const f of findings) {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : 'general';
    lines.push(`### ${severityEmoji(f.severity)} [${f.severity}] ${f.title} (${loc})`);
    if (f.description) lines.push(f.description);
    if (f.recommendation) lines.push(`\n**Recommendation:** ${f.recommendation}`);
    lines.push('');
  }

  if (counts.high > 0) {
    lines.push(
      `> This PR has ${counts.high} high-severity finding(s) and will be **blocked** unless labeled \`${OVERRIDE_LABEL}\`.`,
    );
  }

  return lines.join('\n');
}

async function writeStepSummary(markdown) {
  if (!GITHUB_STEP_SUMMARY) {
    log('GITHUB_STEP_SUMMARY not set; printing report to stdout instead.');
    log(markdown);
    return;
  }
  await fs.appendFile(GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function githubApi(pathname, options = {}) {
  const res = await fetchWithTimeout(
    `https://api.github.com${pathname}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'f1-decision-platform-ai-review',
        ...(options.headers || {}),
      },
    },
    GITHUB_TIMEOUT_MS,
  );
  return res;
}

async function hasOverrideLabel() {
  if (!GITHUB_TOKEN || !REPO || !PR_NUMBER) return false;
  try {
    const res = await githubApi(`/repos/${REPO}/issues/${PR_NUMBER}/labels`);
    if (!res.ok) return false;
    const labels = await res.json();
    return Array.isArray(labels) && labels.some((l) => l?.name === OVERRIDE_LABEL);
  } catch (err) {
    warn(`could not fetch PR labels: ${err.message}`);
    return false;
  }
}

async function postPrComment(markdown) {
  if (!GITHUB_TOKEN || !REPO || !PR_NUMBER) {
    log('GITHUB_TOKEN/REPO/PR_NUMBER not fully available; skipping PR comment.');
    return;
  }
  try {
    const res = await githubApi(`/repos/${REPO}/issues/${PR_NUMBER}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: markdown }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      warn(`failed to post PR comment: ${res.status} ${res.statusText} ${text}`.trim());
    } else {
      log('Posted adversarial review comment on PR.');
    }
  } catch (err) {
    warn(`failed to post PR comment: ${err.message}`);
  }
}

async function main() {
  // 1. Compute the diff.
  const rawDiff = await computeDiff();
  if (!rawDiff || rawDiff.trim() === '') {
    const markdown = buildMarkdownReport({
      findings: [],
      summary: '',
      skippedReason: 'no diff against base branch (empty or unavailable).',
    });
    await writeStepSummary(markdown);
    log('No diff to review. Exiting 0.');
    return 0;
  }
  const { diff, truncated } = truncateDiff(rawDiff);

  // 2. Ollama availability check — infra flakiness must never hard-fail CI.
  if (!(await isOllamaUp())) {
    const markdown = buildMarkdownReport({
      findings: [],
      summary: '',
      skippedReason: 'local Ollama server is not reachable at localhost:11434.',
    });
    await writeStepSummary(markdown);
    warn('Ollama not reachable; skipping adversarial review (non-blocking).');
    return 0;
  }

  // 3. Call the model.
  let content;
  try {
    content = await callOllama(diff);
  } catch (err) {
    const markdown = buildMarkdownReport({
      findings: [],
      summary: '',
      skippedReason: `Ollama call failed (${err.message}).`,
    });
    await writeStepSummary(markdown);
    warn(`Ollama call failed; skipping adversarial review (non-blocking): ${err.message}`);
    return 0;
  }

  // 4. Parse findings — tolerant, but a parse failure is treated as
  //    infra/model flakiness, not a code problem, so it does not block.
  let findings = [];
  let summary = '';
  try {
    ({ findings, summary } = parseFindings(content));
  } catch (err) {
    const markdown = buildMarkdownReport({
      findings: [],
      summary: '',
      skippedReason: `could not parse model output (${err.message}). Raw output logged below.`,
    });
    await writeStepSummary(markdown);
    await writeStepSummary(`\n<details><summary>Raw model output</summary>\n\n\`\`\`\n${content}\n\`\`\`\n</details>\n`);
    warn(`Could not parse model output; skipping blocking logic (non-blocking): ${err.message}`);
    return 0;
  }

  // 5. Report.
  const truncatedNotice = truncated
    ? `Diff truncated to ${MAX_DIFF_CHARS} characters before review (large PR).`
    : null;
  const markdown = buildMarkdownReport({ findings, summary, truncatedNotice });
  await writeStepSummary(markdown);
  await postPrComment(markdown);

  const highFindings = findings.filter((f) => f.severity === 'high');
  if (highFindings.length === 0) {
    log(`Adversarial review complete: ${findings.length} finding(s), none high severity.`);
    return 0;
  }

  if (await hasOverrideLabel()) {
    log(
      `Adversarial review found ${highFindings.length} high-severity finding(s), but PR carries "${OVERRIDE_LABEL}" — not blocking.`,
    );
    return 0;
  }

  console.error(
    `Adversarial review found ${highFindings.length} high-severity finding(s). Blocking. Add the "${OVERRIDE_LABEL}" label to override.`,
  );
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Unexpected script crash: treat as infra flakiness, do not block merges
    // on a bug in the reviewer itself — but make it loud in logs.
    console.error('ai-review.mjs crashed unexpectedly:', err);
    process.exitCode = 0;
  });
