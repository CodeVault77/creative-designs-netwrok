/*
 * The service worker.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * It does not cache HTML pages, and it does not cache anything from `/api`.
 *
 * A service worker that serves stale HTML is the single most common way to
 * ship a bug that outlives its own fix: the browser keeps handing back a
 * cached page for weeks, and the person seeing it has no way to know. A
 * service worker that caches API responses is worse — it serves one account's
 * data to whoever is signed in next on that device.
 *
 * So the cache holds STATIC BUILD ASSETS, which are content-hashed and
 * therefore safe to keep forever, plus one offline page. Everything else goes
 * to the network.
 *
 * ── Offline map editing does not live here ──────────────────────────────────
 *
 * The interesting offline story is the CRDT in `src/lib/sync`, which queues
 * operations in IndexedDB and reconciles them on reconnect. That is
 * application state, not a caching concern, and putting it in a service worker
 * would put the hardest logic in the codebase in the one place that is
 * hardest to debug and cannot be unit-tested.
 */

const VERSION = 'v1';
const STATIC_CACHE = `cdn-static-${VERSION}`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL])),
  );

  // Take over immediately rather than waiting for every tab to close. The
  // alternative leaves two versions of the worker running on one device.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith('cdn-static-') && name !== STATIC_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET. A cached POST would be a replayed write.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same origin only. Caching a third party's response is caching something
  // we do not control and cannot invalidate.
  if (url.origin !== self.location.origin) return;

  /*
   * NEVER the API. Not with a network-first strategy, not with a short TTL,
   * not at all. An API response is somebody's data and this cache is shared by
   * every account that has signed in on the device.
   */
  if (url.pathname.startsWith('/api/')) return;

  // Content-hashed build output: safe to cache indefinitely, because a change
  // produces a different URL.
  const isImmutable =
    url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');

  if (isImmutable) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  /*
   * Navigations go to the network, and fall back to the offline page ONLY when
   * the network fails. No stale HTML is ever served to a working connection.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit ?? Response.error()),
      ),
    );
  }
});
