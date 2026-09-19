import 'server-only';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { serverEnv } from '@/lib/env';

/**
 * Structured server logging.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * There were three `console.*` calls in the whole of `src/` outside tests. In
 * production that means no request log, no way to correlate a user's report
 * with what the server did, and no signal at all when something degrades
 * without throwing. The application was effectively blind.
 *
 * ── Why JSON lines ──────────────────────────────────────────────────────────
 *
 * Every log platform ingests newline-delimited JSON without configuration, and
 * a structured line can be filtered by field rather than by regex. In
 * development that is unreadable, so the same record is printed as a compact
 * human line instead — one logger, two renderings, decided by NODE_ENV.
 *
 * ── Request correlation ─────────────────────────────────────────────────────
 *
 * `AsyncLocalStorage` carries a request id through everything a request touches
 * without threading a parameter through every function. That is the difference
 * between "an error happened" and "THIS user's request produced this error
 * after these four queries".
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface RequestContext {
  requestId: string;
  /** Set once a session is resolved, so a line can be attributed. */
  userId?: string | null;
  route?: string;
  method?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with a request context attached to everything it calls. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attach facts discovered mid-request.
 *
 * The user id is not known when the request starts — the session has to be
 * read first — so the context is mutated rather than replaced. Every line
 * logged AFTER this point carries it.
 */
export function annotateRequest(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

export function newRequestId(): string {
  return randomUUID();
}

/**
 * The floor. Debug is dropped in production, where it is volume rather than
 * signal; everything else is kept.
 */
function threshold(): number {
  return serverEnv.NODE_ENV === 'production' ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

function write(level: LogLevel, message: string, fields: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < threshold()) return;

  const context = storage.getStore();

  const record = {
    level,
    message,
    time: new Date().toISOString(),
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.userId ? { userId: context.userId } : {}),
    ...(context?.route ? { route: context.route } : {}),
    ...(context?.method ? { method: context.method } : {}),
    ...fields,
  };

  /*
   * Only `warn` and `error` — the lint rule allows those two, and the
   * restriction turns out to be right for a different reason: on most hosts
   * stdout is buffered and stderr is not, so a line written during a crash is
   * far more likely to survive.
   */
  const line =
    serverEnv.NODE_ENV === 'production'
      ? JSON.stringify(record)
      : `${level.toUpperCase()} ${message} ${compact(fields)}`.trim();

  if (level === 'error') console.error(line);
  else console.warn(line);
}

/** Development rendering: only the fields that carry something. */
function compact(fields: Record<string, unknown>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${format(value)}`);

  return parts.join(' ');
}

function format(value: unknown): string {
  if (typeof value === 'string') return value.includes(' ') ? `"${value}"` : value;
  if (value instanceof Error) return value.message;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const log = {
  debug: (message: string, fields: Record<string, unknown> = {}) =>
    write('debug', message, fields),
  info: (message: string, fields: Record<string, unknown> = {}) =>
    write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) =>
    write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) =>
    write('error', message, fields),
};

/**
 * Wrap a route handler with a request context and timing.
 *
 * Used instead of `middleware.ts` deliberately: middleware runs on the Edge
 * runtime, where `AsyncLocalStorage` and `node:crypto` are not available, and
 * splitting logging across two runtimes would give two different shapes of
 * line for the same request.
 *
 *   export const POST = withLogging('POST /api/edges', handler);
 */
export function withLogging<TArgs extends unknown[]>(
  route: string,
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs): Promise<Response> => {
    const started = Date.now();
    const context: RequestContext = { requestId: newRequestId(), route };

    return withRequestContext(context, async () => {
      try {
        const response = await handler(...args);

        log.info('request', {
          status: response.status,
          ms: Date.now() - started,
        });

        /*
         * The request id goes back on the response.
         *
         * It is what turns "it broke for me around 3pm" into a single log
         * lookup — the user can read it off a support form or a devtools
         * network tab.
         */
        response.headers.set('x-request-id', context.requestId);
        return response;
      } catch (cause) {
        log.error('request failed', {
          ms: Date.now() - started,
          error: cause instanceof Error ? cause.message : String(cause),
          stack: cause instanceof Error ? cause.stack?.slice(0, 2000) : undefined,
        });
        throw cause;
      }
    });
  };
}
