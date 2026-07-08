/**
 * Robust-ish JSON extraction for LLM outputs. Models frequently wrap JSON in
 * prose, markdown code fences, or trailing commentary — this pulls out the
 * first balanced `{...}` object and parses it, throwing a descriptive error
 * if nothing parseable is found.
 */
export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('extractFirstJsonObject: no JSON object found in text');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }

  throw new Error('extractFirstJsonObject: unbalanced JSON object in text');
}

/** Clamp a number into the closed interval [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
