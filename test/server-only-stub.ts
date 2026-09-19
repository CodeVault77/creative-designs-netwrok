/**
 * Stub for the `server-only` package under Vitest.
 *
 * `server-only` throws on import by design: it is a build-time guard that
 * makes the Next bundler fail if a server module is pulled into a client
 * bundle. That guard is exactly what we want in the app, and meaningless in a
 * test runner, where there is no client bundle to protect.
 *
 * Aliasing it to this empty module lets server modules be unit-tested without
 * weakening the real guard, which still applies to every Next build.
 */
export {};
