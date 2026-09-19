import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { clientKeyFor } from '@/lib/ingest/client-key';
import { runIngest } from '@/lib/ingest/pipeline';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ingest/run?url=… — the four named stages, streamed.
 *
 * Server-sent events rather than a poll loop or one long request:
 *
 *   - A single POST that returns after fifteen seconds can report nothing on
 *     the way, and §12 is explicit that a generic spinner is not acceptable.
 *   - Polling needs a job table and a second round trip per stage, to deliver
 *     four events.
 *
 * SSE is a GET because EventSource only issues GETs. That is safe here: the
 * request is rate-limited, and it creates nothing the user keeps — the map is
 * only written by the separate save route, after they have edited it.
 *
 * Cancellation is the request being aborted. `request.signal` fires when the
 * browser closes the stream, which is what §12's "Cancel available throughout"
 * means in practice: the pipeline stops between stages and the model call is
 * aborted mid-flight.
 */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get('url') ?? '';
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;
  const clientKey = await clientKeyFor(request);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of runIngest({
          ctx,
          clientKey,
          url,
          signal: request.signal,
        })) {
          if (request.signal.aborted) break;
          send(event);
        }
      } catch (error) {
        /**
         * The pipeline is written so every expected failure arrives as an
         * `error` event. Reaching here means something genuinely unforeseen
         * broke, so the user still gets a specific message rather than a
         * stream that simply stops — an ended stream with no verdict is the
         * one outcome the UI cannot explain.
         */
        send({
          type: 'error',
          failure: 'model-failed',
          copy: {
            title: 'Something broke while reading that page',
            body: 'Try again, or build the map by hand.',
            retryable: true,
            fallback: 'retry',
          },
          detail: error instanceof Error ? error.name : undefined,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and friends buffer streamed responses by default, which turns
      // four progress events into one delivery at the end.
      'x-accel-buffering': 'no',
    },
  });
}
