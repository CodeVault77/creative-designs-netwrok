/**
 * The Creative Design Networks SDK.
 *
 * ── Zero dependencies, on purpose ───────────────────────────────────────────
 *
 * An SDK is the first code a third party runs, and every dependency it drags
 * in is a version conflict with something they already use, plus a supply
 * chain they did not choose. This one uses `fetch` and `crypto`, both of which
 * are in Node 18+, Deno, Bun and every browser.
 *
 * ── It is thin on purpose too ───────────────────────────────────────────────
 *
 * It does four things the API cannot do for you: attach the key, parse the
 * error envelope into a typed error, retry the failures that are worth
 * retrying, and verify a webhook signature. Everything else is a URL and a
 * JSON body, and an SDK that wrapped each endpoint in a bespoke method would
 * be a second API surface to keep in step with the first.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *     import { CdnClient, verifyWebhook } from '@cdn/sdk';
 *
 *     const cdn = new CdnClient({ apiKey: process.env.CDN_API_KEY! });
 *
 *     const maps = await cdn.maps.list();
 *     const map  = await cdn.maps.get(maps[0].id);
 *
 *     await cdn.maps.writeNode(map.id, map.version, {
 *       title: 'From an integration',
 *       parentId: map.rootId,
 *     });
 *
 * Never put a key in a browser: a key shipped to a page is a key given to
 * everyone who opens it. The API allows cross-origin calls so that server-side
 * tooling and local development work, not as an invitation.
 */

export const SDK_VERSION = '1.0.0';

export interface ClientOptions {
  apiKey: string;
  /** Defaults to the hosted API. Override for a self-hosted deployment. */
  baseUrl?: string;
  /** Attempts for a retryable failure, including the first. */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

/**
 * A failure the API described.
 *
 * `code` is stable and safe to branch on. `message` is prose and may change
 * between releases — an integration that matched on it would break on a
 * wording fix, which is why the code exists.
 */
export class CdnError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CdnError';
  }

  /** True when the call is worth making again unchanged. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** True when the key lacks a permission. `detail.missing` names which. */
  get insufficientScope(): boolean {
    return this.code === 'insufficient_scope';
  }

  /** True when someone else changed the map. Re-read and retry. */
  get conflict(): boolean {
    return this.code === 'version_conflict';
  }
}

export interface ApiNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string | null;
  type: string;
  family: string;
  status: string;
  visibility: string;
  icon: string | null;
  href: string | null;
  payload: Record<string, unknown>;
  weight: number;
}

export interface ApiMap {
  id: string;
  title: string;
  family: string;
  visibility: string;
  updatedAt: string;
  ownerHandle: string;
  nodeCount: number;
  relation: 'owner' | 'member';
}

export interface ApiMapDetail {
  id: string;
  title: string;
  family: string;
  visibility: string;
  rootId: string;
  version: number;
  updatedAt: string;
  ownerHandle: string;
  nodeCount: number;
  nodes: ApiNode[];
}

export interface NodeInput {
  id?: string;
  parentId?: string | null;
  title?: string;
  description?: string | null;
  type?: string;
  icon?: string | null;
  href?: string | null;
  payload?: Record<string, unknown>;
  weight?: number;
}

export interface Identity {
  keyId: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  userId: string;
  organizationId: string | null;
  installationId: string | null;
  expiresAt: string | null;
  apiVersion: string;
  rateLimit: { max: number; windowSeconds: number };
}

export interface Listing {
  id: string;
  kind: 'template' | 'plugin' | 'agent' | 'freelancing';
  slug: string;
  title: string;
  summary: string;
  authorHandle: string | null;
  priceCents: number;
  orders: number;
  rating: number | null;
  ratingCount: number;
}

const DEFAULT_BASE = 'https://creativedesignnetworks.com';

export class CdnClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    if (!options.apiKey) throw new Error('An API key is required');

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * One request, with retries for the failures that deserve them.
   *
   * A 4xx is never retried: the same request will be refused the same way, and
   * retrying a 403 only turns one refusal into three. `Retry-After` is honoured
   * when the server sends it, because the server knows when it will be ready
   * and a client guessing is how a thundering herd forms.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let lastError: CdnError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': `cdn-sdk/${SDK_VERSION}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (response.ok) {
        const parsed = (await response.json()) as { data: T };
        return parsed.data;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; [key: string]: unknown };
      };

      lastError = new CdnError(
        response.status,
        payload.error?.code ?? 'unknown',
        payload.error?.message ?? `HTTP ${response.status}`,
        payload.error,
      );

      if (!lastError.retryable || attempt === this.maxAttempts) throw lastError;

      const retryAfter = Number(response.headers.get('retry-after') ?? '0');
      const backoff = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250;

      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    throw lastError ?? new CdnError(500, 'unknown', 'Request failed');
  }

  /** Who this key is and what it may do. The call to make first. */
  me(): Promise<Identity> {
    return this.request<Identity>('GET', '/api/v1/me');
  }

  readonly maps = {
    list: (): Promise<ApiMap[]> => this.request<ApiMap[]>('GET', '/api/v1/maps'),

    get: (mapId: string): Promise<ApiMapDetail> =>
      this.request<ApiMapDetail>(
        'GET',
        `/api/v1/maps/${encodeURIComponent(mapId)}`,
      ),

    update: (
      mapId: string,
      version: number,
      patch: { title?: string; visibility?: 'private' | 'link' | 'public' },
    ): Promise<ApiMapDetail> =>
      this.request<ApiMapDetail>(
        'PATCH',
        `/api/v1/maps/${encodeURIComponent(mapId)}`,
        { version, ...patch },
      ),

    /**
     * Create or update one node.
     *
     * `version` is the one you read. On a conflict the error's `conflict` flag
     * is set and `detail.currentVersion` tells you what to re-read from — a
     * conflict is normal in a collaborative product, not an exception.
     */
    writeNode: (
      mapId: string,
      version: number,
      node: NodeInput,
    ): Promise<ApiMapDetail> =>
      this.request<ApiMapDetail>(
        'PATCH',
        `/api/v1/maps/${encodeURIComponent(mapId)}`,
        { version, node },
      ),
  };

  readonly marketplace = {
    browse: (options: { kind?: string; q?: string } = {}): Promise<Listing[]> => {
      const params = new URLSearchParams();
      if (options.kind) params.set('kind', options.kind);
      if (options.q) params.set('q', options.q);

      return this.request<Listing[]>(
        'GET',
        `/api/v1/marketplace?${params.toString()}`,
      );
    },
  };
}

// ------------------------------------------------------------------ webhooks

export const SIGNATURE_HEADER = 'x-cdn-signature';
export const MAX_AGE_SECONDS = 300;

export interface WebhookEvent {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

/**
 * Verify and parse a webhook.
 *
 * ── Pass the RAW body ───────────────────────────────────────────────────────
 *
 * Not a parsed object, and not one re-serialised with `JSON.stringify`. The
 * signature covers exact bytes, and re-serialising changes whitespace even
 * when it changes nothing else. In Express that means `express.raw()` on this
 * route; in Next.js it means `await request.text()` before anything touches
 * the body.
 *
 * Every mysterious signature mismatch is this.
 *
 * Uses Web Crypto so it runs unchanged on Node, Deno, Bun, Cloudflare Workers
 * and Vercel's edge runtime — a verifier that only worked on one of those
 * would be a verifier half the receivers could not use.
 */
export async function verifyWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<WebhookEvent> {
  const parts = new Map<string, string>();

  for (const piece of signatureHeader.split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) {
      parts.set(piece.slice(0, index).trim(), piece.slice(index + 1).trim());
    }
  }

  const timestamp = Number(parts.get('t'));
  const presented = parts.get('v1');

  if (!Number.isFinite(timestamp) || !presented) {
    throw new Error('Malformed signature header');
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > MAX_AGE_SECONDS) {
    // Absolute difference: clock skew goes both ways, and a signature from the
    // future is as suspect as one from last week.
    throw new Error('Signature is outside the allowed time window');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );

  const expected = [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  /*
   * Constant-time comparison, written out because Web Crypto has no
   * timingSafeEqual. Length is compared first and the loop always runs to the
   * end — an early return on the first differing byte leaks how much of a
   * forged signature was correct, which is enough to construct one.
   */
  if (expected.length !== presented.length) {
    throw new Error('Signature mismatch');
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }

  if (difference !== 0) throw new Error('Signature mismatch');

  return JSON.parse(rawBody) as WebhookEvent;
}
