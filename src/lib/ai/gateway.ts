import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { serverEnv } from '@/lib/env';
import { balanceOf, creditsForUsd, post } from '@/lib/billing/credits';
import { ensureCredits } from '@/lib/billing/subscriptions';
import { AnthropicProvider } from './anthropic';
import {
  AIError,
  UnconfiguredProvider,
  type AIProvider,
  type CallOptions,
  type CompletionResult,
  type EmbedResult,
  type ToolCallResult,
  type ToolSpec,
  type Usage,
} from './provider';

/**
 * The gateway: every AI call in the system goes through here.
 *
 * ── Why policy is not in the provider ───────────────────────────────────────
 *
 * A provider translates a request into one vendor's protocol and nothing else.
 * Quotas, audit rows and budget refusals live here so they apply identically to
 * every provider — put them in the provider and the second implementation
 * enforces them differently, or forgets to.
 *
 * That split is also what makes the phase's definition of done true: swapping
 * providers is a config change, because nothing outside this file knows which
 * one is running.
 *
 * ── Every call is recorded, including the failures ──────────────────────────
 *
 * Especially the failures. A refused call still cost latency and may have cost
 * tokens, and a feature that is quietly failing 40% of the time is invisible
 * if only the successes are written down.
 */

export type Feature = 'ingest' | 'assistant' | 'embed' | 'eval';

export interface CallContext {
  /** Who is asking. Null for a system job. */
  userId: string | null;
  feature: Feature;
  /** Which prompt version ran, when the call came from the registry. */
  promptId?: string;
  promptVersion?: number;
}

/**
 * Monthly spend a single user may cause.
 *
 * `lib/ingest/budget.ts` has a global cap, which protects the account but not
 * the other users on it: one person could consume the month in an afternoon
 * and everybody else would see "over budget" without having spent anything.
 * The global cap stays as the outer rail; this is the inner one.
 */
export const USER_MONTHLY_USD = 5;

let cached: AIProvider | null = null;

/**
 * The configured provider.
 *
 * Cached because constructing one reads env and allocates; invalidated only by
 * a process restart, which is also when env can change.
 */
export function provider(): AIProvider {
  if (cached) return cached;

  cached = serverEnv.ANTHROPIC_API_KEY
    ? new AnthropicProvider({
        apiKey: serverEnv.ANTHROPIC_API_KEY,
        defaultModel: serverEnv.INGEST_MODEL,
      })
    : new UnconfiguredProvider();

  return cached;
}

/** Tests swap the provider; nothing else should. */
export function setProvider(next: AIProvider | null): void {
  cached = next;
}

/** What a user has spent this calendar month. */
export function userSpend(userId: string, db: Database = getDb()): number {
  return (
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_calls
            WHERE user_id = ?
              AND created_at >= datetime('now', 'start of month')`,
        )
        .get(userId) as { total: number }
    ).total ?? 0
  );
}

/**
 * Whether a user may make another call.
 *
 * ── Credits, with the flat cap kept as a backstop ───────────────────────────
 *
 * Phase 6 replaced the flat monthly dollar cap with a credit balance, because
 * a cap that is the same for everyone cannot express a paid plan. The old cap
 * survives as an outer rail: a bug that granted somebody a million credits
 * should still not be able to spend a million dollars.
 *
 * Both must pass, and either refusing is a refusal.
 */
export function withinQuota(
  userId: string | null,
  db: Database = getDb(),
): boolean {
  // A system job has no user quota; the global spend cap still applies to it.
  if (!userId) return true;

  if (userSpend(userId, db) >= USER_MONTHLY_USD) return false;

  /*
   * Provision the free allowance on first use.
   *
   * Idempotent — the grant is keyed on the month — so this is a no-op after
   * the first call. Without it every account predating the ledger would read
   * as having zero credits and be refused, which is a migration problem solved
   * more simply by not needing a migration.
   */
  ensureCredits(userId, db);

  return balanceOf(userId, db) > 0;
}

function record(
  ctx: CallContext,
  fields: {
    provider: string;
    model: string;
    usage?: Usage;
    outcome: string;
    durationMs: number;
    detail?: string;
  },
  db: Database,
): string {
  const id = `aic_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  db.prepare(
    `INSERT INTO ai_calls
       (id, user_id, feature, provider, model, prompt_id, prompt_version,
        input_tokens, output_tokens, cost_usd, outcome, duration_ms, detail)
     VALUES (@id, @userId, @feature, @provider, @model, @promptId,
             @promptVersion, @inputTokens, @outputTokens, @costUsd, @outcome,
             @durationMs, @detail)`,
  ).run({
    id,
    userId: ctx.userId,
    feature: ctx.feature,
    provider: fields.provider,
    model: fields.model,
    promptId: ctx.promptId ?? null,
    promptVersion: ctx.promptVersion ?? null,
    inputTokens: fields.usage?.inputTokens ?? 0,
    outputTokens: fields.usage?.outputTokens ?? 0,
    costUsd: fields.usage?.costUsd ?? 0,
    outcome: fields.outcome,
    durationMs: fields.durationMs,
    detail: fields.detail?.slice(0, 500) ?? null,
  });

  return id;
}

export interface GatewayResult<T> {
  ok: boolean;
  value?: T;
  error?: AIError;
  /** The audit row, so a caller can attach a proposal to the call that made it. */
  callId: string;
}

/**
 * Run one call: quota, provider, audit.
 *
 * Generic over the provider method so `complete`, `toolCall` and `embed` share
 * exactly one path — three copies of quota-check-then-record is three places
 * for the audit row to be forgotten.
 */
async function run<T extends { usage: Usage; model: string }>(
  ctx: CallContext,
  work: (p: AIProvider) => Promise<T>,
  db: Database,
): Promise<GatewayResult<T>> {
  const active = provider();
  const started = Date.now();

  if (!withinQuota(ctx.userId, db)) {
    const error = new AIError('refused', 'You have run out of AI credits.');
    return {
      ok: false,
      error,
      callId: record(
        ctx,
        {
          provider: active.id,
          model: '-',
          outcome: 'quota',
          durationMs: 0,
          detail: 'user monthly quota reached',
        },
        db,
      ),
    };
  }

  try {
    const value = await work(active);

    const callId = record(
      ctx,
      {
        provider: active.id,
        model: value.model,
        usage: value.usage,
        outcome: 'ok',
        durationMs: Date.now() - started,
      },
      db,
    );

    /*
     * Credits are spent AFTER the call, against its actual cost.
     *
     * Charging up front would need an estimate, and an estimate is either too
     * high — refusing calls that would have fitted — or too low, which is the
     * loophole. The audit row is written first and the ledger references it,
     * so a spend can always be traced to the call that caused it.
     *
     * Posted directly rather than through `spend`, which refuses when the
     * balance is short. The work is already done and the money already gone —
     * declining to record that because it took the balance negative would lose
     * the record of the very call that overspent. The balance goes slightly
     * below zero and the NEXT call is refused, which is the correct place to
     * stop.
     */
    if (ctx.userId) {
      post(
        ctx.userId,
        {
          amount: -creditsForUsd(value.usage.costUsd),
          kind: 'spend',
          reference: callId,
          note: `${ctx.feature} call`,
        },
        db,
      );
    }

    return { ok: true, value, callId };
  } catch (cause) {
    const error =
      cause instanceof AIError
        ? cause
        : new AIError(
            'unavailable',
            'Something went wrong.',
            cause instanceof Error ? cause.message : String(cause),
          );

    return {
      ok: false,
      error,
      callId: record(
        ctx,
        {
          provider: active.id,
          model: '-',
          outcome: error.kind,
          durationMs: Date.now() - started,
          ...(error.detail ? { detail: error.detail } : {}),
        },
        db,
      ),
    };
  }
}

export function complete(
  ctx: CallContext,
  prompt: string,
  options?: CallOptions,
  db: Database = getDb(),
): Promise<GatewayResult<CompletionResult>> {
  return run(ctx, (p) => p.complete(prompt, options), db);
}

export function toolCall<T = unknown>(
  ctx: CallContext,
  prompt: string,
  tool: ToolSpec,
  options?: CallOptions,
  db: Database = getDb(),
): Promise<GatewayResult<ToolCallResult<T>>> {
  return run(ctx, (p) => p.toolCall<T>(prompt, tool, options), db);
}

export function embed(
  ctx: CallContext,
  texts: string[],
  options?: CallOptions,
  db: Database = getDb(),
): Promise<GatewayResult<EmbedResult>> {
  return run(ctx, (p) => p.embed(texts, options), db);
}

export interface UsageSummary {
  calls: number;
  costUsd: number;
  byFeature: { feature: string; calls: number; costUsd: number }[];
  failures: number;
}

/** This month's usage, for the staff dashboard and for a user's own settings. */
export function usageSummary(
  userId: string | null,
  db: Database = getDb(),
): UsageSummary {
  const where = userId ? 'user_id = @userId AND' : '';
  const params = userId ? { userId } : {};

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
              SUM(CASE WHEN outcome != 'ok' THEN 1 ELSE 0 END) AS failures
         FROM ai_calls
        WHERE ${where} created_at >= datetime('now', 'start of month')`,
    )
    .get(params) as { calls: number; cost: number; failures: number | null };

  const byFeature = db
    .prepare(
      `SELECT feature, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost
         FROM ai_calls
        WHERE ${where} created_at >= datetime('now', 'start of month')
        GROUP BY feature ORDER BY cost DESC`,
    )
    .all(params) as { feature: string; calls: number; cost: number }[];

  return {
    calls: totals.calls,
    costUsd: totals.cost,
    failures: totals.failures ?? 0,
    byFeature: byFeature.map((row) => ({
      feature: row.feature,
      calls: row.calls,
      costUsd: row.cost,
    })),
  };
}
