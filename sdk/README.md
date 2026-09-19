# Creative Design Networks SDK

A zero-dependency TypeScript client for the public API. Runs on Node 18+, Deno,
Bun, and any browser — though a key does not belong in a browser; see below.

## Install

```
npm install @cdn/sdk
```

## Authenticate

Create a key at **Settings → Developer**. It is shown once and stored hashed,
so it cannot be recovered — if it is lost, revoke it and make another.

```ts
import { CdnClient } from '@cdn/sdk';

const cdn = new CdnClient({ apiKey: process.env.CDN_API_KEY! });

const me = await cdn.me();
console.log(me.scopes); // ['maps:read', 'maps:write']
```

`me()` is the call to make first. It validates the key at start-up rather than
letting a bad one surface on the first real operation, in production.

### Keys belong on a server

A key shipped to a browser is a key given to everyone who opens the page. The
API permits cross-origin requests because authentication is by explicit header
and cannot be triggered by a hostile page the way a cookie can — that makes
server-side tooling and local development work. It is not an invitation to put
a key in client code.

## Read and write maps

```ts
const maps = await cdn.maps.list();
const map = await cdn.maps.get(maps[0].id);

await cdn.maps.writeNode(map.id, map.version, {
  title: 'Added by an integration',
  parentId: map.rootId,
  type: 'task',
  payload: { status: 'todo', priority: 'high' },
});
```

### Versions are required

Every write carries the version you read. If someone changed the map in
between, the write is refused rather than silently overwriting them:

```ts
try {
  await cdn.maps.writeNode(map.id, map.version, { title: 'New' });
} catch (error) {
  if (error instanceof CdnError && error.conflict) {
    const fresh = await cdn.maps.get(map.id);
    await cdn.maps.writeNode(fresh.id, fresh.version, { title: 'New' });
  }
}
```

This is normal in a collaborative product, not an exceptional case. Handle it.

## Scopes

A key holds a subset of these. **A scope narrows what its owner can already do
— it never widens it.** A key with `maps:write` can write the maps its owner
could already write, and nothing else. Revoking someone's access to a map
revokes it for every key, plugin and agent acting for them, immediately.

| Scope               | Allows                              |
| ------------------- | ----------------------------------- |
| `maps:read`         | List and read maps and their nodes  |
| `maps:write`        | Create and change maps              |
| `nodes:read`        | Read individual nodes               |
| `nodes:write`       | Add and change nodes                |
| `events:read`       | Receive events                      |
| `webhooks:manage`   | Manage its own webhook endpoints    |
| `marketplace:read`  | Browse listings                     |
| `marketplace:write` | Publish and update its own listings |
| `agents:read`       | See agents and their runs           |
| `agents:run`        | Start agent runs                    |

A 403 names the missing scope:

```ts
catch (error) {
  if (error instanceof CdnError && error.insufficientScope) {
    console.error('Missing:', error.detail?.missing);
  }
}
```

## Webhooks

Deliveries are signed. **Verify with the raw body** — not a parsed object, and
not one re-serialised with `JSON.stringify`. The signature covers exact bytes.

```ts
import { verifyWebhook } from '@cdn/sdk';

// Next.js route handler
export async function POST(request: Request) {
  const raw = await request.text(); // BEFORE anything parses it
  const signature = request.headers.get('x-cdn-signature') ?? '';

  try {
    const event = await verifyWebhook(
      raw,
      signature,
      process.env.CDN_WEBHOOK_SECRET!,
    );
    console.log(event.type, event.data);
  } catch {
    return new Response('bad signature', { status: 400 });
  }

  return new Response('ok');
}
```

Express needs `express.raw({ type: 'application/json' })` on the route, for the
same reason.

### Answer quickly

Return 2xx as soon as the payload is stored, and do the work afterwards. A
receiver that takes ten seconds is treated as timed out and retried, so slow
work causes duplicate deliveries rather than preventing them.

### Retries and idempotency

- 5xx and 429 are retried with exponential backoff.
- 4xx is not retried. It will be refused the same way next time.
- Ten consecutive failures disable the endpoint; re-enable it in Settings once
  the receiver is fixed.

Every delivery carries `X-CDN-Event-Id`, which is stable across retries. Keep
the ids you have processed and ignore a repeat — delivery is at-least-once, so
this is required, not defensive.

## Rate limits

600 requests per key per minute. Every response carries `X-RateLimit-Limit` and
`X-RateLimit-Remaining`; a 429 carries `Retry-After`, which the client honours
automatically.

## Errors

`CdnError` has a stable `code`, an HTTP `status`, and helpers: `retryable`,
`conflict`, `insufficientScope`. Branch on the code. The `message` is prose and
may be reworded between releases.
