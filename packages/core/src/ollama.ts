/**
 * LLM client abstraction. `@dop/core` never talks to a concrete model
 * provider directly — everything downstream depends on the `LLM` interface
 * so callers can inject a real client (Ollama, hosted APIs, ...) or a
 * scripted `StubLLM` for deterministic tests.
 */

/** Minimal chat-completion contract used throughout the decision pipeline. */
export interface LLM {
  chat(req: { system?: string; user: string; json?: boolean }): Promise<string>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * `LLM` implementation backed by an OpenAI-compatible chat-completions
 * endpoint, as exposed by Ollama (`/v1/chat/completions`).
 */
export class OllamaClient implements LLM {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(model: string, baseUrl?: string) {
    this.model = model;
    this.baseUrl = baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }

  async chat(req: { system?: string; user: string; json?: boolean }): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) {
      messages.push({ role: 'system', content: req.system });
    }
    messages.push({ role: 'user', content: req.user });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    if (req.json) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OllamaClient: request failed with status ${res.status}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('OllamaClient: response did not contain message content');
    }
    return content;
  }
}

/** A queued/scripted response, or a function computing one from the request. */
export type StubResponder =
  | string[]
  | ((req: { system?: string; user: string; json?: boolean }) => string);

/**
 * Deterministic `LLM` implementation for tests. Accepts either an array of
 * scripted responses (consumed in order, one per `chat()` call) or a
 * function that computes a response from the request.
 */
export class StubLLM implements LLM {
  private readonly queue: string[] | undefined;
  private readonly fn: ((req: { system?: string; user: string; json?: boolean }) => string) | undefined;
  private cursor = 0;
  public readonly calls: Array<{ system?: string; user: string; json?: boolean }> = [];

  constructor(responder: StubResponder) {
    if (typeof responder === 'function') {
      this.fn = responder;
    } else {
      this.queue = responder;
    }
  }

  async chat(req: { system?: string; user: string; json?: boolean }): Promise<string> {
    this.calls.push(req);
    if (this.fn) {
      return this.fn(req);
    }
    const queue = this.queue ?? [];
    if (this.cursor >= queue.length) {
      throw new Error(
        `StubLLM: no scripted response left for call #${this.cursor + 1} (queue has ${queue.length})`,
      );
    }
    const response = queue[this.cursor];
    this.cursor += 1;
    return response as string;
  }
}
