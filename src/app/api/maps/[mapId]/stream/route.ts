import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { subscribe } from '@/lib/collab/bus';
import { eventsSince, latestEventId, roleOn } from '@/lib/collab/repo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/maps/[mapId]/stream — the realtime channel.
 *
 * §20's risk for this phase is "realtime cost and reconnection". Both halves
 * are answered by the same decision: **the stream carries nudges, and the
 * database carries the truth.**
 *
 * Reconnection. `EventSource` resends the last id it saw as `Last-Event-ID`,
 * automatically, on every reconnect. This route reads it and replays the log
 * from that point before subscribing to anything new — so a client that was
 * offline for a minute gets the minute it missed, in order, exactly once. A
 * design that only pushed live events would silently lose whatever happened
 * during the gap, and the first anyone would know is a message that never
 * arrived.
 *
 * Cost. No polling anywhere: one listener per connection on an in-process
 * emitter, and a heartbeat comment every 25 seconds purely to stop proxies
 * closing an idle connection. The expensive thing a naive implementation does
 * — every client asking "anything new?" every second — does not happen.
 */

/** Under the 30s that most proxies and load balancers use to reap idle sockets. */
const HEARTBEAT_MS = 25_000;

/**
 * How long one connection may live before the server retires it.
 *
 * Ten minutes is comfortably longer than a working session's attention span
 * and short enough that an abandoned tab cannot hold a connection for an hour.
 * See the reasoning at the `lifetime` timer below.
 */
const MAX_LIFETIME_MS = 10 * 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  // 404, not 403: a 403 confirms the map exists.
  if (!roleOn(ctx, mapId)) {
    return new Response('Not found', { status: 404 });
  }

  /**
   * Where to resume from.
   *
   * `Last-Event-ID` is set by the browser on an automatic reconnect; `since`
   * is for a client resuming deliberately (a tab restored from bfcache, say).
   * Absent both, start from the head — a fresh client loads current state
   * through the ordinary REST endpoints and does not want the whole history
   * replayed at it.
   */
  const header = request.headers.get('last-event-id');
  const query = new URL(request.url).searchParams.get('since');
  const resumeFrom = Number(header ?? query ?? NaN);

  let cursor = Number.isFinite(resumeFrom) ? resumeFrom : latestEventId(mapId);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let flushing = false;

      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client vanished between the check and the write.
          open = false;
        }
      };

      /**
       * Drain the log up to now.
       *
       * Guarded against re-entry: a burst of writes fires the listener several
       * times, and without the guard each one would start its own read and
       * they would interleave, delivering events out of order.
       */
      const flush = () => {
        if (!open || flushing) return;
        flushing = true;
        try {
          for (;;) {
            const { events, truncated } = eventsSince(ctx, mapId, cursor);
            if (events.length === 0) break;

            for (const event of events) {
              // `id:` is what the browser echoes back as Last-Event-ID.
              write(
                `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
              );
              cursor = event.id;
            }

            // Keep going only while the log was capped; otherwise we are current.
            if (!truncated) break;
          }
        } finally {
          flushing = false;
        }
      };

      // Tell the client where it is, so a fresh connection knows its baseline
      // without having to infer one.
      write(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`);
      flush();

      const unsubscribe = subscribe(mapId, () => flush());

      const heartbeat = setInterval(() => {
        // A comment line: valid SSE, ignored by EventSource, and enough to
        // keep an idle connection from being reaped.
        write(`: keep-alive\n\n`);
      }, HEARTBEAT_MS);

      /*
       * The backstop for connections that never say goodbye.
       *
       * `request.signal` fires on a clean disconnect and usually does. It does
       * NOT fire for a laptop that sleeps, a phone that loses signal, or a
       * proxy that drops the socket without telling the origin — and each of
       * those leaves a listener, an interval and a held connection behind.
       * Observed directly in development: one stream open for over seventeen
       * minutes with nobody at the other end, and enough of them to stop the
       * server answering anything at all.
       *
       * Retiring the connection on a timer is what bounds it. EventSource
       * reconnects on its own with `Last-Event-ID`, so the client replays what
       * it missed and notices nothing — the reconnect path already exists and
       * is already tested, which is what makes this cheap.
       */
      const lifetime = setTimeout(() => close(), MAX_LIFETIME_MS);

      function close() {
        if (!open) return;
        open = false;

        /*
         * Every resource this connection holds, released together.
         *
         * The timers matter as much as the listener: an uncleared interval
         * keeps its closure — and through it the controller — reachable for as
         * long as the process runs, so the connection would be gone while its
         * memory was not.
         */
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      }

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx buffers streamed responses by default, which would hold every
      // event until the connection closed.
      'x-accel-buffering': 'no',
    },
  });
}
