import type { AnalyticsProvider } from './index';
import type { AnalyticsEventMap, AnalyticsEventName } from './events';

/**
 * The first-party sink (ADR-0009).
 *
 * §20 rates P14's risk as "launching without instrumentation", and this is the
 * module that closes it: events stop going to the console and start going to a
 * table we can query.
 *
 * Four properties it has to have, in order of how badly each one bites:
 *
 *   1. **It must never break a session.** Every path is wrapped, and the
 *      facade wraps it again. A sink that throws is worse than no sink.
 *   2. **It must not cost a request per event.** Selecting a node emits an
 *      event; nobody should pay a round trip for a tap. Batched, flushed on a
 *      timer or when the batch fills.
 *   3. **It must not lose the last batch.** The most interesting events happen
 *      just before someone leaves, which is exactly when an ordinary fetch is
 *      cancelled. `sendBeacon` on pagehide.
 *   4. **It must not identify anyone.** A rotating anonymous id, and no
 *      personal data in properties — §03's rule, which this file cannot
 *      enforce alone but does not undermine.
 */

const ENDPOINT = '/api/analytics';

/** Flush when either of these trips. Small enough to lose little, large enough to batch. */
const BATCH_SIZE = 20;
const FLUSH_MS = 5000;

interface QueuedEvent {
  name: string;
  props: Record<string, unknown>;
  at: string;
}

/**
 * The anonymous id.
 *
 * `localStorage` so it survives a reload — otherwise every refresh looks like a
 * new person and the activation number is meaningless. It is a random value
 * with no relationship to the account, and it is cleared on sign-out.
 *
 * Rotated every 180 days so it does not become a permanent identifier by
 * accident.
 */
const ANON_KEY = 'cdn.analytics.anon';
const ANON_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function randomId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function anonId(): string {
  try {
    const raw = localStorage.getItem(ANON_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; at: number };
      if (parsed.id && Date.now() - parsed.at < ANON_MAX_AGE_MS) return parsed.id;
    }
  } catch {
    // Private mode, blocked storage, corrupted value — fall through and make
    // a session-only id rather than failing.
  }

  const id = randomId();
  try {
    localStorage.setItem(ANON_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    /* ignore */
  }
  return id;
}

/**
 * The session id.
 *
 * Per tab, in memory. §24's "3 taps and 25 seconds" is a within-session
 * question, so the funnel needs a boundary that resets when someone comes back
 * tomorrow — and a tab is the closest honest approximation.
 */
const sessionId = randomId();

export function createBeaconProvider(): AnalyticsProvider {
  let queue: QueuedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let userId: string | null = null;

  const send = (useBeacon: boolean) => {
    if (queue.length === 0) return;

    const batch = queue;
    queue = [];
    clearTimeout(timer);
    timer = undefined;

    const payload = JSON.stringify({
      anonId: anonId(),
      sessionId,
      userId,
      events: batch,
    });

    try {
      /**
       * `sendBeacon` survives the page going away; `fetch` does not. But it
       * cannot report failure and has a size cap, so it is used only on the
       * way out, where the alternative is losing the batch entirely.
       */
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          ENDPOINT,
          new Blob([payload], { type: 'application/json' }),
        );
        return;
      }

      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // A failed flush drops its batch. Retrying risks an unbounded queue in a
      // tab that has been open all day with no network, which is a worse
      // failure than a missing sample.
    }
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => send(false), FLUSH_MS);
  };

  if (typeof window !== 'undefined') {
    /**
     * `pagehide`, not `beforeunload` or `unload`.
     *
     * `unload` does not fire reliably on mobile Safari, and `beforeunload`
     * blocks the back-forward cache. `pagehide` fires in both cases.
     */
    window.addEventListener('pagehide', () => send(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') send(true);
    });
  }

  return {
    name: 'beacon',

    track<E extends AnalyticsEventName>(
      event: E,
      properties: AnalyticsEventMap[E],
    ) {
      queue.push({
        name: event,
        props: (properties ?? {}) as Record<string, unknown>,
        at: new Date().toISOString(),
      });

      if (queue.length >= BATCH_SIZE) send(false);
      else schedule();
    },

    identify(id: string) {
      userId = id;
    },

    reset() {
      // Sign-out clears the association AND rotates the anonymous id, so the
      // next person on a shared machine is not counted as the previous one.
      send(false);
      userId = null;
      try {
        localStorage.removeItem(ANON_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
