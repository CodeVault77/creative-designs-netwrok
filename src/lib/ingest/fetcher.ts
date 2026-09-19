import 'server-only';
import { lookup as dnsLookup } from 'node:dns';
import { Agent, request as undiciRequest } from 'undici';
import { checkUrl, isBlockedAddress } from './ssrf';

/**
 * The guarded fetcher.
 *
 * Every limit here is a defence, and each one is named after what happens
 * without it:
 *
 *   MAX_REDIRECTS   an open redirect on a public site walks us to metadata
 *   MAX_BYTES       a multi-gigabyte response is a memory DoS
 *   TIMEOUT_MS      a server that accepts and never replies pins a worker
 *   ALLOWED_TYPES   only HTML can be read; anything else wastes the budget
 *
 * Redirects are followed MANUALLY. `fetch`'s own redirect following is the
 * single most common way this goes wrong: the first URL is validated, the
 * library transparently follows a 302 to 169.254.169.254, and the guard never
 * runs again.
 */

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 2 * 1024 * 1024; // 2 MB of HTML is a very long article
export const TIMEOUT_MS = 8000;

/** §12 step 3 gives the preview an 800 ms budget, so its fetch gets less. */
export const HEAD_TIMEOUT_MS = 2500;

/**
 * How much of a page the preview reads before giving up on finding a title.
 *
 * The preview only needs `<head>`, and downloading a 300 KB article to read
 * forty bytes of it is why the first version of this took 2.4 seconds against
 * a budget of 800 ms. Everything the chip shows lives in the first few
 * kilobytes; the cap is generous because some sites put a wall of inline CSS
 * above their title.
 */
export const PREVIEW_MAX_BYTES = 96 * 1024;

export const USER_AGENT =
  'CDNBot/1.0 (+https://creativedesignnetworks.com/bot; Link-to-Mind-Map)';

/**
 * Every distinct way this can fail, and nothing else.
 *
 * §12 requires "a specific message per cause" — so the causes are a closed
 * union rather than an error string. A new failure mode cannot be added
 * without the compiler asking for its message.
 */
export type FetchFailure =
  | 'blocked-address' // SSRF policy said no
  | 'blocked-by-robots' // robots.txt disallows us
  | 'unreachable' // DNS, TCP, TLS, timeout
  | 'not-html' // a PDF, an image, a download
  | 'too-large' // exceeded MAX_BYTES
  | 'auth-required' // 401/403, or a login wall in the body
  | 'server-error'; // 5xx

export class FetchError extends Error {
  constructor(
    readonly failure: FetchFailure,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * The connect-time guard.
 *
 * This is the one check that closes DNS rebinding. The static check and the
 * per-hop check both look at a name and ask the resolver what it means; a
 * hostile resolver is free to answer differently a millisecond later, when the
 * socket is actually opened. undici's connect hook runs with the address the
 * kernel is about to use, so there is no window left to race.
 *
 * A shared Agent also gives us connection pooling for free, which matters
 * because robots.txt and the page itself are usually the same origin.
 */
/*
 * Exported so outbound WEBHOOK delivery uses this exact agent rather than a
 * second one written from memory. The rebinding guard below is the hardest
 * part of this codebase to get right and the easiest to get subtly wrong; two
 * copies would mean the next fix lands in only one of them.
 */
export const guardedAgent = new Agent({
  connect: {
    // The lookup the socket will actually use. Reject before the handshake.
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '', 4);
        const list = Array.isArray(addresses) ? addresses : [];
        if (list.length === 0) {
          return callback(new Error('No address for host'), '', 4);
        }
        /**
         * ALL resolved addresses must be public, not merely the first. A name
         * that answers with one public and one private address is a rebinding
         * attempt, and which one the stack ends up using is not ours to
         * predict.
         */
        const blocked = list.find((entry) => isBlockedAddress(entry.address));
        if (blocked) {
          return callback(
            new FetchError(
              'blocked-address',
              'That address points inside a private network.',
              blocked.address,
            ),
            '',
            4,
          );
        }

        /**
         * Answer in the form the CALLER asked for. undici sets `all: true` and
         * expects the array back; handing it a single address instead makes it
         * read `undefined` as the host and fail every request with
         * ERR_INVALID_IP_ADDRESS. Supporting both shapes keeps this correct
         * whichever way it is called.
         */
        if (options.all) {
          return (callback as unknown as (e: Error | null, a: typeof list) => void)(
            null,
            list,
          );
        }
        const first = list[0]!;
        callback(null, first.address, first.family);
      });
    },
  },
  connectTimeout: TIMEOUT_MS,
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});

export interface FetchedPage {
  /** The URL actually read, after redirects. Attribution must cite this. */
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
  /** How many bytes we read. Useful for the cost log. */
  bytes: number;
  redirects: number;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bytes: number;
  finalUrl: string;
  redirects: number;
}

function headerOf(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * One request, following redirects by hand and re-running the address policy
 * on every hop.
 */
async function requestFollowing(
  startUrl: string,
  {
    timeoutMs,
    maxBytes,
    stopAfterHead = false,
  }: { timeoutMs: number; maxBytes: number; stopAfterHead?: boolean },
): Promise<RawResponse> {
  let current = startUrl;
  let redirects = 0;

  for (;;) {
    const verdict = checkUrl(current);
    if (!verdict.ok) {
      throw new FetchError(
        'blocked-address',
        verdict.detail ?? 'That address cannot be read.',
        verdict.reason,
      );
    }

    let response;
    try {
      response = await undiciRequest(current, {
        method: 'GET',
        dispatcher: guardedAgent,
        maxRedirections: 0, // we follow by hand — see the note at the top
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en',
        },
      });
    } catch (error) {
      if (error instanceof FetchError) throw error;
      // The connect hook's rejection arrives wrapped; unwrap it so the user
      // gets "private network" rather than a generic socket error.
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof FetchError) throw cause;
      throw new FetchError(
        'unreachable',
        "That page didn't respond. Check the link or try another.",
        error instanceof Error ? error.message : undefined,
      );
    }

    const { statusCode, headers } = response;

    if (statusCode >= 300 && statusCode < 400) {
      const location = headerOf(headers, 'location');
      response.body.destroy();

      if (!location) {
        throw new FetchError(
          'unreachable',
          "That page didn't respond. Check the link or try another.",
        );
      }
      if (redirects >= MAX_REDIRECTS) {
        throw new FetchError(
          'unreachable',
          'That link redirects too many times.',
          `>${MAX_REDIRECTS} hops`,
        );
      }
      redirects += 1;
      current = new URL(location, current).toString();
      continue; // and the policy runs again at the top of the loop
    }

    // Read the body with a hard ceiling, aborting mid-stream rather than
    // buffering whatever the far end decides to send.
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;

    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;

        if (bytes > maxBytes) {
          if (!stopAfterHead) {
            response.body.destroy();
            throw new FetchError('too-large', 'That page is too large to read.');
          }
          // The preview asked for a prefix and has one. Stop, keep it.
          chunks.push(buffer);
          truncated = true;
          break;
        }

        chunks.push(buffer);

        /**
         * Stop the moment the head is closed. Only the last two chunks are
         * searched rather than the whole buffer, so this stays O(bytes) over
         * the response instead of O(bytes²).
         */
        if (stopAfterHead && chunks.length > 0) {
          const tail = Buffer.concat(chunks.slice(-2)).toString('utf8');
          if (/<\/head\s*>/i.test(tail) || /<body[\s>]/i.test(tail)) {
            truncated = true;
            break;
          }
        }
      }
      if (truncated) response.body.destroy();
    } catch (error) {
      if (error instanceof FetchError) throw error;
      throw new FetchError(
        'unreachable',
        "That page didn't respond. Check the link or try another.",
      );
    }

    return {
      status: statusCode,
      headers,
      body: Buffer.concat(chunks).toString('utf8'),
      bytes,
      finalUrl: current,
      redirects,
    };
  }
}

/**
 * robots.txt, honoured.
 *
 * §12: "Honour robots.txt. This is a legal and reputational line, not a
 * preference." So a failure to *read* robots.txt is not treated as consent —
 * but neither is it treated as refusal, which would make every site with a
 * flaky robots endpoint unreadable. The rule below matches the de-facto
 * standard: only an explicit Disallow blocks us.
 */
export async function robotsAllows(target: string): Promise<boolean> {
  const url = new URL(target);
  const robotsUrl = `${url.origin}/robots.txt`;

  let raw: RawResponse;
  try {
    raw = await requestFollowing(robotsUrl, {
      timeoutMs: HEAD_TIMEOUT_MS,
      maxBytes: 512 * 1024,
    });
  } catch {
    // Unreachable robots.txt is not a disallow. RFC 9309 treats it as allow.
    return true;
  }

  // 4xx means no robots file, which is permission. 5xx is a server problem;
  // the conservative reading of RFC 9309 is to stay out, so we do.
  if (raw.status >= 500) return false;
  if (raw.status >= 400) return true;

  return parseRobots(raw.body, url.pathname + url.search);
}

/**
 * A robots.txt parser covering the parts that actually appear in the wild.
 *
 * Precedence follows RFC 9309: the most specific group wins (our own agent
 * name beats `*`), and within a group the LONGEST matching rule wins, with
 * Allow beating Disallow on an exact tie. Getting the tie wrong is how a
 * crawler ends up ignoring an `Allow` carve-out inside a broad `Disallow: /`.
 */
export function parseRobots(text: string, path: string): boolean {
  const ourAgent = 'cdnbot';

  type Rule = { allow: boolean; pattern: string };
  const groups = new Map<string, Rule[]>();

  let currentAgents: string[] = [];
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;

    const index = line.indexOf(':');
    if (index === -1) continue;
    const field = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!lastLineWasAgent) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      lastLineWasAgent = true;
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
      continue;
    }

    lastLineWasAgent = false;
    if (field !== 'allow' && field !== 'disallow') continue;
    if (currentAgents.length === 0) continue;

    for (const agent of currentAgents) {
      groups.get(agent)!.push({ allow: field === 'allow', pattern: value });
    }
  }

  const rules = groups.get(ourAgent) ?? groups.get('*');
  if (!rules || rules.length === 0) return true;

  let best: { length: number; allow: boolean } | null = null;

  for (const rule of rules) {
    // "Disallow:" with an empty value means allow everything — it is not a
    // zero-length match on every path.
    if (rule.pattern === '') {
      if (!rule.allow) continue;
      continue;
    }
    if (!robotsPatternMatches(rule.pattern, path)) continue;

    const length = rule.pattern.replace(/\*/g, '').length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }

  return best ? best.allow : true;
}

/** robots.txt wildcards: `*` matches any run, `$` anchors the end. */
function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

/**
 * Fetch a page for ingestion. Applies the address policy, robots.txt, the
 * size cap and the content-type check, in that order.
 */
export async function fetchPage(
  target: string,
  options: { skipRobots?: boolean; headOnly?: boolean } = {},
): Promise<FetchedPage> {
  const verdict = checkUrl(target);
  if (!verdict.ok) {
    throw new FetchError(
      'blocked-address',
      verdict.detail ?? 'That address cannot be read.',
      verdict.reason,
    );
  }

  if (!options.skipRobots) {
    const allowed = await robotsAllows(target);
    if (!allowed) {
      throw new FetchError(
        'blocked-by-robots',
        'This site asks not to be read by tools like CDN.',
      );
    }
  }

  const raw = await requestFollowing(target, {
    timeoutMs: options.headOnly ? HEAD_TIMEOUT_MS : TIMEOUT_MS,
    maxBytes: options.headOnly ? PREVIEW_MAX_BYTES : MAX_BYTES,
    stopAfterHead: options.headOnly,
  });

  if (raw.status === 401 || raw.status === 403) {
    throw new FetchError(
      'auth-required',
      'We can only read publicly visible pages.',
    );
  }
  if (raw.status >= 500) {
    throw new FetchError(
      'server-error',
      "That page didn't respond. Check the link or try another.",
    );
  }
  if (raw.status >= 400) {
    throw new FetchError(
      'unreachable',
      "That page didn't respond. Check the link or try another.",
    );
  }

  const contentType = headerOf(raw.headers, 'content-type').toLowerCase();
  if (contentType && !/text\/html|application\/xhtml/.test(contentType)) {
    throw new FetchError(
      'not-html',
      'That link is not a web page we can read yet.',
      contentType,
    );
  }

  return {
    finalUrl: raw.finalUrl,
    status: raw.status,
    contentType,
    html: raw.body,
    bytes: raw.bytes,
    redirects: raw.redirects,
  };
}
