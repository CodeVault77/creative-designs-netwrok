'use client';

import { useEffect } from 'react';

/**
 * The last line of defence.
 *
 * A render error anywhere without a nearer boundary lands here instead of
 * showing Next's default screen. There was no boundary at all before this, so
 * an exception in any server or client component gave the user a blank page
 * and gave us nothing.
 *
 * `global-error` replaces the root layout when it renders, which is why it has
 * to supply its own `<html>` and `<body>` — and why it cannot use anything from
 * the layout it is replacing. No styled-components, no theme provider, no
 * tokens: if the failure IS the theme provider, a screen that depends on it
 * fails to render the error about failing to render.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /*
     * Reported here rather than by `ErrorReporter`.
     *
     * React catches render errors before they ever reach `window.onerror`, so
     * the global listener never sees them. Without this the most serious class
     * of failure in the application would be the one class that is never
     * recorded.
     *
     * `digest` is the server's hash for the error — the only handle on a
     * server-side render failure, whose real message is deliberately withheld
     * from the browser.
     */
    void fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: error.message || 'Render error',
        stack: (error.stack ?? '').slice(0, 4000),
        route: typeof window === 'undefined' ? '' : window.location.pathname,
        source: 'client',
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: '#07070c',
          color: '#edeef7',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <main style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '20px', margin: '0 0 12px' }}>
            Something broke on this screen
          </h1>

          <p style={{ margin: '0 0 20px', lineHeight: 1.6, color: '#8c8fa8' }}>
            Your maps are safe — this is a display problem, not a data one. Try
            again, and if it keeps happening the reference below tells us which
            failure it was.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              padding: '12px 20px',
              background: 'transparent',
              border: '1.5px solid #2fd9f5',
              borderRadius: '10px',
              color: '#edeef7',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>

          {/*
            The digest, shown deliberately. It is the only thing that connects
            what the user saw to what the server logged, and asking someone to
            describe a crash is a much worse way to find it.
          */}
          {error.digest && (
            <p
              style={{
                marginTop: '20px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
                color: '#5a5e7c',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
