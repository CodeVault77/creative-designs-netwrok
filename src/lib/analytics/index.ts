import { clientEnv } from '@/lib/env';
import { createBeaconProvider } from './beacon';
import type { AnalyticsEventMap, AnalyticsEventName } from './events';

/**
 * Provider-agnostic analytics facade.
 *
 * Product code calls `track('node_selected', {...})` and never imports a
 * vendor SDK. Swapping PostHog for Plausible for an in-house sink is then a
 * one-file change rather than a find-and-replace across every component —
 * which matters because the provider decision is deliberately deferred
 * (see docs/03-analytics-plan.md).
 *
 * Never throws. An analytics failure must not break a user's session.
 */

export interface AnalyticsProvider {
  readonly name: string;
  track<E extends AnalyticsEventName>(
    event: E,
    properties: AnalyticsEventMap[E],
  ): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  reset(): void;
}

const noopProvider: AnalyticsProvider = {
  name: 'noop',
  track: () => {},
  identify: () => {},
  reset: () => {},
};

const consoleProvider: AnalyticsProvider = {
  name: 'console',
  track: (event, properties) => {
    // eslint-disable-next-line no-console
    console.info(`[analytics] ${event}`, properties);
  },
  identify: (userId, traits) => {
    // eslint-disable-next-line no-console
    console.info('[analytics] identify', userId, traits ?? {});
  },
  reset: () => {
    // eslint-disable-next-line no-console
    console.info('[analytics] reset');
  },
};

function selectProvider(): AnalyticsProvider {
  switch (clientEnv.NEXT_PUBLIC_ANALYTICS_PROVIDER) {
    case 'beacon':
      /**
       * The first-party sink (ADR-0009), and the answer to §20 P14's "launching
       * without instrumentation" risk.
       *
       * Loaded lazily and only in a browser: it registers `pagehide` and
       * `visibilitychange` listeners and reads `localStorage`, none of which
       * exist during server rendering. On the server it degrades to noop
       * rather than throwing — server-side `track()` calls are not the ones
       * this measures.
       */
      if (typeof window === 'undefined') return noopProvider;
      return beaconProvider();
    case 'console':
      return consoleProvider;
    case 'noop':
    default:
      return noopProvider;
  }
}

/**
 * Built once, on first use.
 *
 * Each instance owns a queue and registers page listeners, so constructing one
 * per call would leak a listener per event. `createBeaconProvider` is only
 * reached in a browser (see the guard in `selectProvider`), which is why a
 * plain static import is safe here — the module touches `window` inside
 * functions, never at load.
 */
let beacon: AnalyticsProvider | null = null;
function beaconProvider(): AnalyticsProvider {
  if (!beacon) beacon = createBeaconProvider();
  return beacon;
}

let provider: AnalyticsProvider = selectProvider();

/** Test seam — lets a test assert on emitted events without a real sink. */
export function setAnalyticsProvider(next: AnalyticsProvider): void {
  provider = next;
}

export function getAnalyticsProvider(): AnalyticsProvider {
  return provider;
}

export function track<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEventMap[E],
): void {
  try {
    provider.track(event, properties);
  } catch {
    // Analytics is never allowed to break the app.
  }
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
  try {
    provider.identify(userId, traits);
  } catch {
    /* ignore */
  }
}

export function resetAnalytics(): void {
  try {
    provider.reset();
  } catch {
    /* ignore */
  }
}

export type { AnalyticsEventMap, AnalyticsEventName };
export { ANALYTICS_EVENTS } from './events';
