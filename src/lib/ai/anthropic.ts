import {
  AIError,
  type AIProvider,
  type CallOptions,
  type CompletionResult,
  type EmbedResult,
  type ToolCallResult,
  type ToolSpec,
  type Usage,
} from './provider';

/**
 * Anthropic, as an AIProvider.
 *
 * Lifted from the inline fetch in `lib/ingest/structure.ts`, which owned the
 * URL, the auth header, the API version, the error mapping and the token
 * accounting for the one feature that needed them. All of that lives here now
 * and is shared by every caller.
 */

const API = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';

/**
 * Prices per million tokens, USD.
 *
 * Approximate and deliberately conservative: the budget is a safety rail, and
 * a rail that under-counts is not one. Wrong prices are a config error, not a
 * correctness bug — the audit row keeps the token counts, so a cost can always
 * be recomputed from them if a rate changes.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 15, output: 75 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

const DEFAULT_PRICE = { input: 3, output: 15 };

function costOf(model: string, input: number, output: number): number {
  const price = PRICES[model] ?? DEFAULT_PRICE;
  return (input * price.input + output * price.output) / 1_000_000;
}

interface AnthropicResponse {
  model?: string;
  content?: { type: string; name?: string; text?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicOptions {
  apiKey: string;
  defaultModel: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';

  constructor(private readonly options: AnthropicOptions) {}

  isConfigured(): boolean {
    return this.options.apiKey.length > 0;
  }

  /**
   * One request, with the timeout and abort handling every call needs.
   *
   * Two abort sources are merged: our own timeout, and the caller's signal. The
   * original code did this correctly in the one place it existed; doing it once
   * here is the reason a second caller cannot get it wrong.
   */
  private async request(
    path: string,
    body: unknown,
    options: CallOptions = {},
  ): Promise<AnthropicResponse> {
    if (!this.isConfigured()) {
      throw new AIError('unconfigured', 'AI is not configured.');
    }

    const doFetch = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      const response = await doFetch(`${API}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': VERSION,
        },
        body: JSON.stringify(body),
      });

      /*
       * 429 and 5xx are transient; everything else is not.
       *
       * The distinction is what makes the retry decision belong to the caller
       * rather than to a guess — a 400 retried is a 400 again, and retrying it
       * spends the budget twice for the same answer.
       */
      if (response.status === 429 || response.status >= 500) {
        throw new AIError(
          'unavailable',
          'The model is busy. Try again in a moment.',
          `HTTP ${response.status}`,
        );
      }

      if (!response.ok) {
        throw new AIError(
          'refused',
          'That request was refused.',
          `HTTP ${response.status}`,
        );
      }

      return (await response.json()) as AnthropicResponse;
    } catch (cause) {
      if (cause instanceof AIError) throw cause;

      /*
       * An abort is our deadline or the caller's cancellation. Reported as
       * `timeout` rather than `unavailable` so a caller can tell "too slow"
       * from "busy" — they call for different responses, and only one of them
       * is fixed by waiting.
       */
      const aborted =
        cause instanceof Error &&
        (cause.name === 'AbortError' || controller.signal.aborted);

      throw new AIError(
        aborted ? 'timeout' : 'unavailable',
        'The model did not respond in time.',
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private usageFrom(payload: AnthropicResponse, model: string): Usage {
    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;

    return {
      inputTokens,
      outputTokens,
      costUsd: costOf(model, inputTokens, outputTokens),
    };
  }

  async complete(
    prompt: string,
    options: CallOptions = {},
  ): Promise<CompletionResult> {
    const model = options.model ?? this.options.defaultModel;

    const payload = await this.request(
      '/messages',
      {
        model,
        max_tokens: options.maxTokens ?? 2000,
        ...(options.system ? { system: options.system } : {}),
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        messages: [{ role: 'user', content: prompt }],
      },
      options,
    );

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    return {
      text,
      usage: this.usageFrom(payload, model),
      model: payload.model ?? model,
    };
  }

  /**
   * Streaming.
   *
   * Server-sent events, parsed for `content_block_delta` only. Other event
   * types carry lifecycle information no consumer of this interface needs — a
   * caller wants the text as it arrives, and anything else would make every
   * consumer handle a protocol.
   */
  async *stream(prompt: string, options: CallOptions = {}): AsyncIterable<string> {
    if (!this.isConfigured()) {
      throw new AIError('unconfigured', 'AI is not configured.');
    }

    const model = options.model ?? this.options.defaultModel;
    const doFetch = this.options.fetchImpl ?? fetch;

    const response = await doFetch(`${API}/messages`, {
      method: 'POST',
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': VERSION,
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: options.maxTokens ?? 2000,
        ...(options.system ? { system: options.system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok || !response.body) {
      throw new AIError(
        response.status === 429 || response.status >= 500
          ? 'unavailable'
          : 'refused',
        'The model is not available right now.',
        `HTTP ${response.status}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        /*
         * Split on the SSE record separator, keeping the tail.
         *
         * A chunk boundary lands mid-event often enough that parsing whatever
         * arrived would drop tokens silently — the failure looks like the
         * model omitting words rather than like a bug here.
         */
        const records = buffer.split('\n\n');
        buffer = records.pop() ?? '';

        for (const record of records) {
          const line = record.split('\n').find((part) => part.startsWith('data: '));
          if (!line) continue;

          try {
            const event = JSON.parse(line.slice(6)) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };

            if (
              event.type === 'content_block_delta' &&
              event.delta?.type === 'text_delta' &&
              event.delta.text
            ) {
              yield event.delta.text;
            }
          } catch {
            // A malformed event is skipped rather than fatal: losing one delta
            // degrades the output, and throwing loses the whole response.
          }
        }
      }
    } finally {
      // Releasing matters on `break`: an abandoned reader holds the socket.
      reader.releaseLock();
    }
  }

  async toolCall<T = unknown>(
    prompt: string,
    tool: ToolSpec,
    options: CallOptions = {},
  ): Promise<ToolCallResult<T>> {
    const model = options.model ?? this.options.defaultModel;

    const payload = await this.request(
      '/messages',
      {
        model,
        max_tokens: options.maxTokens ?? 2000,
        ...(options.system ? { system: options.system } : {}),
        // Forces the tool rather than making it available: the caller asked
        // for a structured result, not for the model to decide whether to
        // give one.
        tool_choice: { type: 'tool', name: tool.name },
        tools: [
          {
            name: tool.name,
            description: tool.description,
            input_schema: tool.schema,
          },
        ],
        messages: [{ role: 'user', content: prompt }],
      },
      options,
    );

    const block = payload.content?.find(
      (item) => item.type === 'tool_use' && item.name === tool.name,
    );

    if (!block?.input) {
      throw new AIError('invalid', 'The model did not answer in the right shape.');
    }

    return {
      input: block.input as T,
      usage: this.usageFrom(payload, model),
      model: payload.model ?? model,
    };
  }

  /**
   * Embeddings.
   *
   * Anthropic has no embeddings endpoint, and pretending otherwise would fail
   * at runtime in whichever feature reached for it first. Failing here, with a
   * message that names the reason, is what lets `hybridSearch` fall back to
   * keyword-only rather than break.
   */
  async embed(): Promise<EmbedResult> {
    throw new AIError(
      'unconfigured',
      'This provider does not support embeddings.',
      'Anthropic exposes no embeddings endpoint; configure an embedding provider.',
    );
  }
}
