/**
 * The AI provider interface.
 *
 * ── The problem it solves ───────────────────────────────────────────────────
 *
 * `lib/ingest/structure.ts` calls `https://api.anthropic.com/v1/messages`
 * directly: the URL, the auth header, the API version, the request shape and
 * the response shape are all inline in one function. That was the right size
 * for one feature. It is the wrong size for a platform that intends to add
 * embeddings, an assistant, agents and evals — each of which would otherwise
 * repeat the same handling of 429s, timeouts, token counting and tool blocks.
 *
 * ── Four capabilities, deliberately ─────────────────────────────────────────
 *
 *   complete   text in, text out
 *   stream     the same, incrementally, for anything a person watches
 *   embed      text to vector, for semantic search
 *   toolCall   a schema in, a validated object out
 *
 * `toolCall` is the one this codebase already depends on, and it is separate
 * from `complete` on purpose: a tool schema is enforced by the API, whereas
 * "reply with JSON" is enforced by hope. Keeping them distinct means a
 * provider that cannot do tool use fails to satisfy the interface rather than
 * silently degrading to string parsing.
 *
 * ── What a provider does NOT do ─────────────────────────────────────────────
 *
 * No budgets, no quotas, no audit rows, no retries across calls. A provider
 * translates one request into one vendor's protocol. Everything policy-shaped
 * lives in `lib/ai/gateway.ts`, so it applies identically to every provider —
 * a provider that also enforced quotas would let a second implementation
 * quietly enforce them differently, or not at all.
 */

/** Why a call failed, in terms a caller can act on. */
export type AIFailure =
  /** Transport, 429, or 5xx. Worth retrying. */
  | 'unavailable'
  /**
   * The call exceeded its deadline, or the caller aborted it.
   *
   * Distinct from `unavailable` because the two want different responses: a
   * 429 says slow down, a timeout says the work was too big or the deadline
   * too short. Collapsing them — which an earlier version of this file did —
   * loses the only signal that tells those apart.
   */
  | 'timeout'
  /** The model answered, but not in the shape asked for. */
  | 'invalid'
  /** Refused, filtered, or the request was rejected. Retrying will not help. */
  | 'refused'
  /** No key, bad key, or the provider is not configured. */
  | 'unconfigured';

export class AIError extends Error {
  constructor(
    readonly kind: AIFailure,
    message: string,
    /** The provider's own message, for logs. Never shown to a user. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'AIError';
  }

  /** Whether a caller should try again. */
  get retryable(): boolean {
    return this.kind === 'unavailable' || this.kind === 'timeout';
  }
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /**
   * Cost in USD, computed by the provider from its own price table.
   *
   * The provider owns this because only it knows its prices; the gateway
   * records it, and the budget enforces on it.
   */
  costUsd: number;
}

export interface CallOptions {
  /** Overrides the provider's default model. */
  model?: string;
  maxTokens?: number;
  /** 0 is deterministic. Left to the provider's default when absent. */
  temperature?: number;
  system?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  usage: Usage;
  /** The model that actually ran, which may differ from the one requested. */
  model: string;
}

export interface ToolCallResult<T = unknown> {
  /** The tool's arguments, exactly as the model produced them. UNVALIDATED. */
  input: T;
  usage: Usage;
  model: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema. Passed to the provider verbatim. */
  schema: Record<string, unknown>;
}

export interface EmbedResult {
  /** One vector per input, in the same order. */
  vectors: number[][];
  usage: Usage;
  model: string;
  /**
   * Vector length.
   *
   * Returned rather than assumed: an index built at one dimension cannot be
   * compared against vectors of another, and finding that out at query time
   * gives silently wrong results instead of an error.
   */
  dimensions: number;
}

export interface AIProvider {
  /** Stable identifier, stored on every audit row. */
  readonly id: string;

  /** Whether this provider can actually run — a key is present, and so on. */
  isConfigured(): boolean;

  complete(prompt: string, options?: CallOptions): Promise<CompletionResult>;

  /**
   * The same as `complete`, yielding as it goes.
   *
   * An async iterable rather than a callback so a caller can use `for await`
   * and so cancellation is ordinary `break`, not a flag the callback has to
   * check.
   */
  stream(prompt: string, options?: CallOptions): AsyncIterable<string>;

  toolCall<T = unknown>(
    prompt: string,
    tool: ToolSpec,
    options?: CallOptions,
  ): Promise<ToolCallResult<T>>;

  embed(texts: string[], options?: CallOptions): Promise<EmbedResult>;
}

/**
 * A provider that is present but cannot run.
 *
 * Returned instead of null when nothing is configured, so callers handle one
 * shape. Every method throws `unconfigured`, which the gateway turns into the
 * documented fallback — for ingest, that is the three-node starter stub, which
 * §14 already specifies as the answer when the model is unavailable.
 */
export class UnconfiguredProvider implements AIProvider {
  readonly id = 'unconfigured';

  isConfigured(): boolean {
    return false;
  }

  private fail(): never {
    throw new AIError('unconfigured', 'AI is not configured in this environment.');
  }

  async complete(): Promise<CompletionResult> {
    this.fail();
  }

  async *stream(): AsyncIterable<string> {
    this.fail();
  }

  async toolCall<T>(): Promise<ToolCallResult<T>> {
    this.fail();
  }

  async embed(): Promise<EmbedResult> {
    this.fail();
  }
}
