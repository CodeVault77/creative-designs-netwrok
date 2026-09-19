'use client';

import { useEffect } from 'react';

/**
 * Reports uncaught browser errors to `/api/errors`.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * `lib/launch/errors.ts` fingerprints and groups errors well, and
 * `POST /api/errors` has accepted reports since P14. Nothing ever sent one.
 * The subsystem was complete and entirely unreachable, so a crash on a user's
 * phone left no trace anywhere.
 *
 * ── What it catches ─────────────────────────────────────────────────────────
 *
 * `error` covers uncaught exceptions; `unhandledrejection` covers a promise
 * nobody caught, which is the more common shape in an app that does most of its
 * work in async handlers. React render errors do NOT arrive here — they are
 * caught by the error boundary in `app/global-error.tsx`, which reports
 * separately with the component stack.
 */

/**
 * A hard cap per page load.
 *
 * A render loop can throw thousands of times a second. The server groups by
 * fingerprint so the ROWS stay bounded either way, but the requests would not:
 * without this the browser would flood its own connection pool reporting that
 * something is broken, which makes the page worse than the bug did.
 */
const MAX_REPORTS_PER_PAGE = 10;

export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;

    /*
     * Identical errors are only reported once per page.
     *
     * The same failing component remounting fires the same error repeatedly,
     * and ten copies of one fingerprint tell an operator nothing that one copy
     * does not.
     */
    const seen = new Set<string>();

    const report = (message: string, stack: string) => {
      if (sent >= MAX_REPORTS_PER_PAGE) return;

      const key = `${message}|${stack.slice(0, 200)}`;
      if (seen.has(key)) return;

      seen.add(key);
      sent++;

      // `keepalive` so a report survives the navigation that an error often
      // triggers — without it the request is cancelled as the page unloads.
      void fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          message: message.slice(0, 500),
          stack: stack.slice(0, 4000),
          route: window.location.pathname,
          source: 'client',
        }),
      }).catch(() => {
        // Reporting a failure to report would be the start of a loop.
      });
    };

    const onError = (event: ErrorEvent) => {
      report(
        event.message || 'Uncaught error',
        event.error instanceof Error ? (event.error.stack ?? '') : '',
      );
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      report(
        reason instanceof Error ? reason.message : String(reason),
        reason instanceof Error ? (reason.stack ?? '') : '',
      );
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
