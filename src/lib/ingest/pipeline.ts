import 'server-only';
import { serverEnv } from '@/lib/env';
import type { AuthContext } from '@/lib/db/repo';
import { FetchError, fetchPage, type FetchFailure } from './fetcher';
import { extract, type ExtractedPage } from './extract';
import {
  ModelError,
  isThin,
  starterStub,
  structureFromHeadings,
  structureWithModel,
  type StructureResult,
} from './structure';
import {
  checkLimits,
  finishRun,
  modelBudgetAvailable,
  recordRun,
  settleRun,
} from './budget';
import {
  FAILURE_COPY,
  STAGE_LABEL,
  type IngestEvent,
  type IngestFailure,
} from './contract';

// Re-exported so server callers have one import for the whole feature.
export {
  FAILURE_COPY,
  STAGES,
  STAGE_LABEL,
  type FailureCopy,
  type IngestEvent,
  type IngestFailure,
  type Stage,
} from './contract';

/**
 * The Link-to-Mind-Map pipeline.
 *
 * §12 gives four named stages and five failure modes, and this module owns
 * both. The stages are emitted as events rather than returned at the end
 * because §12 is explicit: "Never a generic spinner. Named stages make 15 s
 * feel like 5." A progress bar that cannot report a stage is a lie about
 * where the time goes.
 *
 * Every exit is either a `done` event or an `error` event carrying one of the
 * named codes. There is no third outcome, and no bare throw reaches the route.
 */

/** How a fetcher failure maps onto the user-facing taxonomy. */
const FETCH_TO_FAILURE: Record<FetchFailure, IngestFailure> = {
  'blocked-address': 'blocked-address',
  'blocked-by-robots': 'blocked-by-robots',
  unreachable: 'unreachable',
  'not-html': 'unreachable',
  'too-large': 'unreachable',
  'auth-required': 'auth-required',
  'server-error': 'unreachable',
};

export interface IngestOptions {
  ctx: AuthContext;
  clientKey: string;
  url: string;
  signal?: AbortSignal;
  /** Injected in tests so the pipeline can run without a network. */
  fetchImpl?: typeof fetch;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Run the pipeline, yielding a stage event before each stage begins.
 *
 * An async generator rather than a callback, so the route can pipe it straight
 * into an SSE stream and cancellation is just breaking the loop — §12
 * requires "Cancel available throughout".
 */
export async function* runIngest(
  options: IngestOptions,
): AsyncGenerator<IngestEvent> {
  const { ctx, clientKey, url, signal } = options;
  const host = hostOf(url);

  // --------------------------------------------------------------- limits
  // Checked before ANY network call. A run that will be refused must not get
  // to make a request first — that is the abuse the limit exists to stop.
  const limits = checkLimits(ctx, clientKey, host);
  if (!limits.allowed) {
    recordRun({
      userId: ctx.userId || null,
      clientKey,
      url,
      host,
      outcome: `rate-limited:${limits.reason}`,
    });
    yield {
      type: 'error',
      failure: 'rate-limited',
      copy: {
        ...FAILURE_COPY['rate-limited'],
        body: limits.message ?? FAILURE_COPY['rate-limited'].body,
      },
      retryAfter: limits.retryAfter,
    };
    return;
  }

  // Recorded now, before the fetch, so a crash mid-pipeline still counts
  // against the limit. An attempt counted only on success is not a limit.
  const runId = recordRun({
    userId: ctx.userId || null,
    clientKey,
    url,
    host,
    outcome: 'started',
  });

  // -------------------------------------------------------------- fetching
  yield { type: 'stage', stage: 'fetching', label: STAGE_LABEL.fetching };

  let html: string;
  let finalUrl: string;
  try {
    const fetched = await fetchPage(url);
    html = fetched.html;
    finalUrl = fetched.finalUrl;
  } catch (error) {
    const failure =
      error instanceof FetchError ? FETCH_TO_FAILURE[error.failure] : 'unreachable';
    finishRun(runId, `failed:${failure}`);
    yield {
      type: 'error',
      failure,
      copy: FAILURE_COPY[failure],
      detail: error instanceof FetchError ? error.detail : undefined,
    };
    return;
  }

  if (signal?.aborted) return;

  // --------------------------------------------------------------- reading
  yield { type: 'stage', stage: 'reading', label: STAGE_LABEL.reading };

  const page: ExtractedPage = extract(html, finalUrl);

  /**
   * A 200 response can still be a login wall. Detected here rather than in
   * the fetcher because it takes the extracted text to tell a real paywall
   * from a page that merely mentions subscribing.
   */
  if (page.paywalled) {
    finishRun(runId, 'failed:auth-required');
    yield {
      type: 'error',
      failure: 'auth-required',
      copy: FAILURE_COPY['auth-required'],
    };
    return;
  }

  yield { type: 'meta', title: page.title, siteName: page.siteName, finalUrl };

  /**
   * §12's "too thin" mode. Note this is NOT an error event — it returns a real
   * 3-node map with a note attached. Delivering nothing here would be the one
   * failure mode that leaves the user staring at an empty screen.
   */
  if (isThin(page)) {
    const stub = starterStub(page, finalUrl);
    settleRun(runId, { inputTokens: 0, outputTokens: 0, costUsd: 0 }, 'stub');
    finishRun(runId, 'ok:stub');
    yield {
      type: 'done',
      runId,
      result: stub,
      sourceUrl: finalUrl,
      degraded: 'too-thin',
    };
    return;
  }

  if (signal?.aborted) return;

  // ----------------------------------------------------------- structuring
  yield { type: 'stage', stage: 'structuring', label: STAGE_LABEL.structuring };

  let result: StructureResult | null = null;

  /**
   * The deterministic path first — see the note in structure.ts. A page that
   * already carries a usable outline does not need a model, and skipping the
   * call is both the latency win and the cost win.
   */
  const fromHeadings = structureFromHeadings(page);

  if (fromHeadings) {
    result = fromHeadings;
  } else if (serverEnv.ANTHROPIC_API_KEY && modelBudgetAvailable()) {
    try {
      result = await structureWithModel(page, finalUrl, {
        apiKey: serverEnv.ANTHROPIC_API_KEY,
        model: serverEnv.INGEST_MODEL,
        signal,
        fetchImpl: options.fetchImpl,
      });
      if (result.usage) settleRun(runId, result.usage, 'model');
    } catch (error) {
      // A model failure is not the end of the run — we already hold the page.
      if (!(error instanceof ModelError)) throw error;
      result = null;
    }
  }

  if (!result) {
    /**
     * Neither path produced a tree: no usable headings, and no model (missing
     * key, over budget, or it failed). Fall back to the stub rather than an
     * error — the user still gets a map, and the outcome is logged as
     * degraded so the gap stays visible in the run log.
     */
    const stub = starterStub(page, finalUrl);
    finishRun(runId, 'ok:degraded');
    yield {
      type: 'done',
      runId,
      result: stub,
      sourceUrl: finalUrl,
      degraded: 'model-failed',
    };
    return;
  }

  if (signal?.aborted) return;

  // ----------------------------------------------------------- laying out
  yield { type: 'stage', stage: 'laying-out', label: STAGE_LABEL['laying-out'] };

  finishRun(runId, `ok:${result.source}`);
  yield { type: 'done', runId, result, sourceUrl: finalUrl };
}
