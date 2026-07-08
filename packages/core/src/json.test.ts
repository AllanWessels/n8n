import { describe, expect, it } from 'vitest';
import { clamp, extractFirstJsonObject } from './json.js';

describe('extractFirstJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractFirstJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts JSON wrapped in prose', () => {
    const text = 'Sure, here is the result:\n{"a": 1, "b": "two"}\nHope that helps!';
    expect(extractFirstJsonObject(text)).toEqual({ a: 1, b: 'two' });
  });

  it('extracts JSON from a markdown code fence', () => {
    const text = '```json\n{"a": 1}\n```';
    expect(extractFirstJsonObject(text)).toEqual({ a: 1 });
  });

  it('handles nested braces and braces inside strings', () => {
    const text = 'prefix {"a": {"nested": 1}, "b": "a { b } c"} suffix';
    expect(extractFirstJsonObject(text)).toEqual({ a: { nested: 1 }, b: 'a { b } c' });
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractFirstJsonObject('no json here')).toThrow();
  });

  it('throws when braces are unbalanced', () => {
    expect(() => extractFirstJsonObject('{"a": 1')).toThrow();
  });
});

describe('clamp', () => {
  it('clamps below min', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clamp(2, 0, 1)).toBe(1);
  });

  it('passes through values in range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('treats NaN as min', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
});
