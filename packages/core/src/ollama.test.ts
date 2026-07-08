import { describe, expect, it, vi, afterEach } from 'vitest';
import { OllamaClient, StubLLM } from './ollama.js';

describe('StubLLM', () => {
  it('returns queued responses in order', async () => {
    const llm = new StubLLM(['first', 'second']);
    await expect(llm.chat({ user: 'a' })).resolves.toBe('first');
    await expect(llm.chat({ user: 'b' })).resolves.toBe('second');
  });

  it('records calls made to it', async () => {
    const llm = new StubLLM(['ok']);
    await llm.chat({ system: 'sys', user: 'usr', json: true });
    expect(llm.calls).toEqual([{ system: 'sys', user: 'usr', json: true }]);
  });

  it('throws when the queue is exhausted', async () => {
    const llm = new StubLLM(['only-one']);
    await llm.chat({ user: 'a' });
    await expect(llm.chat({ user: 'b' })).rejects.toThrow(/no scripted response left/);
  });

  it('supports a function responder', async () => {
    const llm = new StubLLM((req) => `echo:${req.user}`);
    await expect(llm.chat({ user: 'hello' })).resolves.toBe('echo:hello');
  });
});

describe('OllamaClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('posts to the OpenAI-compatible endpoint and returns message content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'hello world' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient('llama3', 'http://example.test:11434');
    const result = await client.chat({ system: 'sys', user: 'usr', json: true });

    expect(result).toBe('hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://example.test:11434/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('llama3');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('omits response_format when json is not requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'plain text' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient('llama3', 'http://example.test:11434');
    await client.chat({ user: 'usr' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'usr' }]);
  });

  it('defaults baseUrl to OLLAMA_BASE_URL env var, falling back to localhost', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', 'http://envhost:9999');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient('m');
    await client.chat({ user: 'u' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://envhost:9999/v1/chat/completions');
  });

  it('throws when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient('m', 'http://x');
    await expect(client.chat({ user: 'u' })).rejects.toThrow(/status 500/);
  });

  it('throws when the response has no message content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient('m', 'http://x');
    await expect(client.chat({ user: 'u' })).rejects.toThrow(/did not contain message content/);
  });
});
