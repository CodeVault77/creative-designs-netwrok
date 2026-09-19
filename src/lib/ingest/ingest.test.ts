import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { AnthropicProvider } from '@/lib/ai/anthropic';
import { setProvider } from '@/lib/ai/gateway';
import { createTestDb } from '@/lib/db/client';
import { createUser, type AuthContext } from '@/lib/db/repo';
import { checkUrl, isBlockedAddress } from './ssrf';
import { parseRobots } from './fetcher';
import {
  detectPaywall,
  extract,
  extractHeadings,
  THIN_WORD_COUNT,
} from './extract';
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  atDepth,
  costOf,
  countNodes,
  isThin,
  starterStub,
  structureFromHeadings,
  structureWithModel,
} from './structure';
import {
  ANON_FREE_RUNS,
  USER_RUNS_PER_HOUR,
  checkLimits,
  clientHash,
  modelBudgetAvailable,
  monthSpend,
  recordRun,
} from './budget';
import { FAILURE_COPY, type IngestFailure } from './contract';

/**
 * §20 names two High risks for P9: "Fetcher is an abuse surface" and "LLM cost
 * per run".
 *
 * The SSRF block below is the most important test in this file and possibly in
 * the project. A fetcher that takes a user-supplied URL is an HTTP client
 * sitting inside the trust boundary; unguarded, its first job is to read the
 * cloud metadata endpoint and hand over a set of credentials.
 *
 * So these are written as a table of attacks. Each entry is a real technique,
 * and the comment says what it defeats.
 */

// ---------------------------------------------------------------- SSRF policy

describe('SSRF address policy', () => {
  const MUST_BLOCK: [string, string][] = [
    // The prize. Every cloud provider serves credentials from link-local.
    ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP/Azure metadata'],
    ['http://metadata.google.internal/', 'metadata by name'],
    ['http://100.100.100.200/', 'Alibaba metadata'],

    // Loopback, in every spelling that resolves to it.
    ['http://127.0.0.1/', 'loopback'],
    ['http://127.1/', 'short-form loopback'],
    ['http://localhost/', 'loopback by name'],
    ['http://LOCALHOST/', 'case does not matter'],
    ['http://localhost./', 'a trailing dot is still localhost'],
    ['http://2130706433/', 'decimal-encoded 127.0.0.1'],
    ['http://0177.0.0.1/', 'octal-encoded loopback'],
    ['http://0.0.0.0/', 'this host'],

    // Private ranges.
    ['http://10.0.0.1/', 'RFC1918 10/8'],
    ['http://172.16.0.1/', 'RFC1918 172.16/12'],
    ['http://172.31.255.255/', 'top of 172.16/12'],
    ['http://192.168.1.1/', 'RFC1918 192.168/16'],
    ['http://100.64.0.1/', 'carrier-grade NAT'],

    // IPv6, where range checks are most often forgotten entirely.
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[::ffff:169.254.169.254]/', 'v4-mapped metadata — the classic bypass'],
    ['http://[::ffff:a9fe:a9fe]/', 'v4-mapped metadata in hex'],
    ['http://[fd00::1]/', 'unique local'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[64:ff9b::a9fe:a9fe]/', 'NAT64 reaching v4 link-local'],

    // Internal naming schemes.
    ['http://redis.internal/', '.internal suffix'],
    ['http://db.local/', 'mDNS'],
    ['http://wiki.corp/', 'corporate suffix'],
    ['http://buildserver/', 'a bare label only a private resolver answers'],

    // Non-HTTP schemes, which reach filesystems and other daemons.
    ['file:///etc/passwd', 'file scheme'],
    ['gopher://example.com:6379/_FLUSHALL', 'gopher to redis'],
    ['ftp://example.com/', 'ftp'],

    // Credentials: reads as example.com to a human, internal-host to a socket.
    ['http://example.com@169.254.169.254/', 'userinfo confusion'],
    ['http://user:pass@example.com/', 'credentials at all'],

    // Ports that are not web ports are a way to point our socket at a daemon.
    ['http://example.com:6379/', 'redis'],
    ['http://example.com:22/', 'ssh'],
    ['http://example.com:25/', 'smtp'],
  ];

  it.each(MUST_BLOCK)('blocks %s (%s)', (url) => {
    expect(checkUrl(url).ok).toBe(false);
  });

  const MUST_ALLOW = [
    'https://example.com/',
    'https://en.wikipedia.org/wiki/Mind_map',
    'http://example.co.uk/a/b?c=d#e',
    'https://example.com:8443/docs',
    'https://sub.domain.example.org/path',
  ];

  it.each(MUST_ALLOW)('allows %s', (url) => {
    expect(checkUrl(url).ok).toBe(true);
  });

  it('gives each rejection a reason the UI can turn into a message', () => {
    expect(checkUrl('file:///etc/passwd').reason).toBe('protocol');
    expect(checkUrl('http://example.com:22/').reason).toBe('port');
    expect(checkUrl('http://u:p@example.com/').reason).toBe('credentials');
    expect(checkUrl('http://10.0.0.1/').reason).toBe('private-ip');
  });

  /**
   * isBlockedAddress is what the connect hook calls on the address the kernel
   * actually resolved. It is the only check DNS rebinding cannot race, so it
   * must never be permissive about anything it fails to understand.
   */
  it('refuses anything that is not a parseable public IP', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress('999.999.999.999')).toBe(true);
    expect(isBlockedAddress('93.184.216.34')).toBe(false); // example.com
  });

  it('blocks multicast, broadcast and reserved space', () => {
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
    expect(isBlockedAddress('255.255.255.255')).toBe(true);
    expect(isBlockedAddress('240.0.0.1')).toBe(true);
  });

  it('blocks link-local with a zone index appended', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true);
  });
});

// ----------------------------------------------------------------- robots.txt

describe('robots.txt', () => {
  it('honours a blanket disallow', () => {
    expect(parseRobots('User-agent: *\nDisallow: /', '/any')).toBe(false);
  });

  it('treats an empty Disallow as permission', () => {
    expect(parseRobots('User-agent: *\nDisallow:', '/any')).toBe(true);
  });

  it('allows when there is no matching rule', () => {
    expect(parseRobots('User-agent: *\nDisallow: /admin', '/blog/post')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /admin', '/admin/users')).toBe(
      false,
    );
  });

  /**
   * Longest-match precedence. Getting this wrong is how a crawler ignores an
   * Allow carve-out inside a broad Disallow and reads what it was told not to.
   */
  it('lets a longer Allow override a shorter Disallow', () => {
    const robots = 'User-agent: *\nDisallow: /\nAllow: /public/';
    expect(parseRobots(robots, '/private')).toBe(false);
    expect(parseRobots(robots, '/public/page')).toBe(true);
  });

  it('prefers a rule naming us over the wildcard group', () => {
    const robots = 'User-agent: *\nDisallow:\n\nUser-agent: CDNBot\nDisallow: /';
    expect(parseRobots(robots, '/anything')).toBe(false);
  });

  it('supports * and $ wildcards', () => {
    expect(parseRobots('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf')).toBe(
      false,
    );
    expect(
      parseRobots('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf?x=1'),
    ).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /a/*/c', '/a/b/c')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    expect(parseRobots('# hello\n\nUser-agent: *  # all\nDisallow: /x', '/x')).toBe(
      false,
    );
  });

  it('shares one rule block between consecutive User-agent lines', () => {
    const robots = 'User-agent: CDNBot\nUser-agent: OtherBot\nDisallow: /shared';
    expect(parseRobots(robots, '/shared')).toBe(false);
  });

  it('allows when robots.txt is empty or unparseable', () => {
    expect(parseRobots('', '/x')).toBe(true);
    expect(parseRobots('garbage without colons', '/x')).toBe(true);
  });
});

// ------------------------------------------------------------------ extractor

describe('extraction', () => {
  const PAGE = `
    <html lang="en">
      <head>
        <title>Fallback title</title>
        <meta property="og:title" content="How mind maps work">
        <meta property="og:description" content="A short overview.">
        <meta property="og:site_name" content="Example Docs">
      </head>
      <body>
        <nav><h2>Navigation</h2></nav>
        <h1>How mind maps work</h1>
        <p>${'word '.repeat(200)}</p>
        <h2>Radial layout</h2>
        <p>Nodes sit on rings around a centre, which is the whole idea here.</p>
        <h3>Angles</h3>
        <p>Each node keeps a fixed angular slot for its whole life.</p>
        <h2>Editing</h2>
        <p>You can drag a node to reparent it onto another branch entirely.</p>
        <script>var tracking = "<h2>Not a heading</h2>";</script>
        <footer><h2>Navigation</h2></footer>
      </body>
    </html>`;

  it('prefers og:title over <title>', () => {
    expect(extract(PAGE, 'https://example.com/x').title).toBe('How mind maps work');
  });

  it('reads the description and site name', () => {
    const page = extract(PAGE, 'https://example.com/x');
    expect(page.description).toBe('A short overview.');
    expect(page.siteName).toBe('Example Docs');
    expect(page.lang).toBe('en');
  });

  it('never treats script contents as page structure', () => {
    const titles = extract(PAGE, 'https://example.com/x').headings.map(
      (h) => h.text,
    );
    expect(titles).not.toContain('Not a heading');
  });

  it('drops nav and footer headings', () => {
    const titles = extract(PAGE, 'https://example.com/x').headings.map(
      (h) => h.text,
    );
    expect(titles).not.toContain('Navigation');
  });

  it('captures the paragraph after each heading as a blurb', () => {
    const headings = extract(PAGE, 'https://example.com/x').headings;
    const radial = headings.find((h) => h.text === 'Radial layout');
    expect(radial?.blurb).toContain('rings around a centre');
  });

  it('falls back to the hostname when there is no title at all', () => {
    expect(
      extract('<html><body><p>hi</p></body></html>', 'https://www.example.com/x')
        .title,
    ).toBe('example.com');
  });

  it('decodes entities rather than leaving them raw', () => {
    const page = extract(
      '<html><h1>Tips &amp; tricks &#8212; part 1</h1></html>',
      'https://e.com',
    );
    expect(page.title).toBe('Tips & tricks — part 1');
  });

  it('survives malformed markup without throwing', () => {
    expect(() => extract('<h1>unclosed <p><div', 'https://e.com')).not.toThrow();
    expect(() => extract('', 'https://e.com')).not.toThrow();
  });

  it('ignores a 200-character "heading" that is really a layout div', () => {
    const long = 'x'.repeat(200);
    expect(extractHeadings(`<h2>${long}</h2>`)).toHaveLength(0);
  });

  /**
   * §12 separates "login or paywall" from "unreachable" because the messages
   * and the offered fallbacks differ. A false positive tells the user their
   * public page is paywalled, which is worse than missing one — so the prose
   * signal only counts on a short page.
   */
  describe('paywall detection', () => {
    it('trusts a structured signal on its own', () => {
      expect(
        detectPaywall('{"isAccessibleForFree":false}', 'a '.repeat(1000)),
      ).toBe(true);
      expect(
        detectPaywall(
          '<meta name="article:content_tier" content="locked">',
          'a '.repeat(1000),
        ),
      ).toBe(true);
    });

    it('treats prose as a wall only when there is nothing else on the page', () => {
      const short = 'Subscribe to continue reading this article.';
      expect(detectPaywall('<div>x</div>', short)).toBe(true);

      // The same words in a footer promo under a full article are not a wall.
      const long = `${'real content '.repeat(300)} Subscribe to continue reading`;
      expect(detectPaywall('<div>x</div>', long)).toBe(false);
    });

    it('does not fire on an ordinary page', () => {
      expect(detectPaywall('<article>hello</article>', 'hello world')).toBe(false);
    });
  });
});

// ----------------------------------------------------------------- structuring

describe('structuring', () => {
  function pageWith(headings: { level: number; text: string }[], words = 500) {
    return {
      title: 'Doc',
      description: 'desc',
      siteName: 'site',
      headings: headings.map((h) => ({ ...h, blurb: '' })),
      text: 'w '.repeat(words),
      wordCount: words,
      paywalled: false,
      lang: 'en',
    };
  }

  it('nests headings by level', () => {
    const result = structureFromHeadings(
      pageWith([
        { level: 2, text: 'One' },
        { level: 3, text: 'One A' },
        { level: 2, text: 'Two' },
      ]),
    );
    expect(result?.root.children.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(result?.root.children[0]?.children[0]?.title).toBe('One A');
  });

  /**
   * Headings in the wild are not well nested — an h4 often follows an h1 with
   * nothing between. Attaching to the nearest shallower ancestor is what a
   * reader infers, so it is what we do: h4 and the later h2 both belong to the
   * h1 above them, and the skipped h2/h3 levels simply do not create nodes.
   */
  it('handles skipped heading levels', () => {
    const result = structureFromHeadings(
      pageWith([
        { level: 1, text: 'Top' },
        { level: 4, text: 'Deep' },
        { level: 2, text: 'Mid' },
      ]),
    );
    // The lone h1 collapses into the root, so its children become ring one.
    expect(result?.root.children.map((c) => c.title)).toEqual(['Deep', 'Mid']);
  });

  /**
   * The commonest page on the web: one h1 carrying the title, then h2
   * sections. An earlier version rejected this shape as "not enough
   * structure" and sent the best-formed pages down the paid model path.
   */
  it('collapses a lone h1 so its sections become ring one', () => {
    const result = structureFromHeadings(
      pageWith([
        { level: 1, text: 'The page title' },
        { level: 2, text: 'Section one' },
        { level: 2, text: 'Section two' },
        { level: 2, text: 'Section three' },
      ]),
    );
    expect(result).not.toBeNull();
    expect(result!.root.children.map((c) => c.title)).toEqual([
      'Section one',
      'Section two',
      'Section three',
    ]);
  });

  it('refuses to guess from too few headings', () => {
    expect(
      structureFromHeadings(pageWith([{ level: 2, text: 'Only' }])),
    ).toBeNull();
  });

  it('never exceeds the depth or breadth caps', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      level: 2,
      text: `H${i}`,
    }));
    const result = structureFromHeadings(pageWith(many));
    expect(result!.root.children.length).toBeLessThanOrEqual(MAX_CHILDREN);
  });

  it('trims to a chosen depth for the 2-or-3 control', () => {
    const result = structureFromHeadings(
      pageWith([
        { level: 2, text: 'One' },
        { level: 3, text: 'One A' },
        { level: 2, text: 'Two' },
      ]),
    )!;
    const shallow = atDepth(result.root, 2);
    expect(shallow.children[0]?.children).toHaveLength(0);
    expect(shallow.children).toHaveLength(2);
  });

  it('counts nodes for the checklist', () => {
    const stub = starterStub(pageWith([]), 'https://example.com/a');
    expect(countNodes(stub.root)).toBe(4); // root + three
  });

  // §12: "delivering a 3-node stub rather than nothing"
  it('delivers a three-node starter map for a thin page', () => {
    const thin = pageWith([], THIN_WORD_COUNT - 1);
    expect(isThin(thin)).toBe(true);
    expect(starterStub(thin, 'https://example.com/a').root.children).toHaveLength(
      3,
    );
  });

  it('does not call a page thin when it has enough text', () => {
    expect(isThin(pageWith([], THIN_WORD_COUNT + 1))).toBe(false);
  });

  describe('the model call', () => {
    const page = pageWith([], 500);

    function reply(body: unknown, status = 200) {
      return vi.fn(
        async () => new Response(JSON.stringify(body), { status }),
      ) as unknown as typeof fetch;
    }

    /**
     * These tests fake the ANTHROPIC HTTP shape, and that translation now lives
     * in AnthropicProvider rather than inline in structureWithModel.
     *
     * So the fake fetch is installed where the protocol is actually spoken.
     * The fixtures are unchanged and still meaningful — they exercise the real
     * request building, the real 429 handling and the real tool-block parsing —
     * but they now reach it through the seam the refactor created instead of a
     * `fetchImpl` parameter that no longer had a reader.
     */
    function withFetch(fetchImpl: typeof fetch) {
      setProvider(
        new AnthropicProvider({ apiKey: 'k', defaultModel: 'm', fetchImpl }),
      );
    }

    afterEach(() => setProvider(null));

    it('reads a well-formed tool use', async () => {
      const fetchImpl = reply({
        content: [
          {
            type: 'tool_use',
            name: 'emit_structure',
            input: {
              title: 'A map',
              nodes: [
                {
                  title: 'One',
                  summary: 's',
                  children: [{ title: 'Two', summary: '' }],
                },
              ],
            },
          },
        ],
        usage: { input_tokens: 1000, output_tokens: 500 },
      });
      withFetch(fetchImpl);

      const result = await structureWithModel(page, 'https://example.com', {});

      expect(result.source).toBe('model');
      expect(result.root.children[0]?.title).toBe('One');
      expect(result.usage?.costUsd).toBeCloseTo(costOf(1000, 500), 10);
    });

    /**
     * The schema is enforced by the API, but our own limits are not. A model
     * that returns forty top-level nodes must be clamped, not trusted.
     */
    it('clamps a response that exceeds our limits', async () => {
      const nodes = Array.from({ length: 40 }, (_, i) => ({
        title: `N${i}`,
        summary: '',
      }));
      const fetchImpl = reply({
        content: [
          {
            type: 'tool_use',
            name: 'emit_structure',
            input: { title: 'T', nodes },
          },
        ],
        usage: {},
      });
      withFetch(fetchImpl);

      await expect(
        structureWithModel(page, 'https://example.com', {}),
      ).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('rejects a response with no tool use in it', async () => {
      const fetchImpl = reply({ content: [{ type: 'text', text: 'here you go' }] });
      withFetch(fetchImpl);
      await expect(
        structureWithModel(page, 'https://example.com', {}),
      ).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('treats 429 and 5xx as unavailable rather than a bad response', async () => {
      for (const status of [429, 500, 503]) {
        const fetchImpl = reply({}, status);
        withFetch(fetchImpl);
        await expect(
          structureWithModel(page, 'https://example.com', {}),
        ).rejects.toMatchObject({ kind: 'unavailable' });
      }
    });

    it('times out rather than hanging the request', async () => {
      const fetchImpl = vi.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, rejectPromise) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              rejectPromise(error);
            });
          }),
      ) as unknown as typeof fetch;
      withFetch(fetchImpl);

      await expect(
        structureWithModel(page, 'https://example.com', { timeoutMs: 20 }),
      ).rejects.toMatchObject({ kind: 'timeout' });
    });

    it('sends the key as a header and never in the body', async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: [
                {
                  type: 'tool_use',
                  name: 'emit_structure',
                  input: { title: 'T', nodes: [{ title: 'A' }] },
                },
              ],
              usage: {},
            }),
          ),
      );

      setProvider(
        new AnthropicProvider({
          apiKey: 'sk-secret-value',
          defaultModel: 'm',
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      );

      await structureWithModel(page, 'https://example.com', {});

      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(
        'sk-secret-value',
      );
      expect(String(init.body)).not.toContain('sk-secret-value');
    });
  });

  it('prices a run the way the cap expects', () => {
    // 1M in + 1M out at the documented rates.
    expect(costOf(1_000_000, 1_000_000)).toBeCloseTo(18, 10);
  });
});

// -------------------------------------------------------- limits and the cap

describe('rate limits and the spend cap', () => {
  let db: Database;
  let alice: AuthContext;

  beforeEach(() => {
    db = createTestDb();
    const user = createUser(
      {
        id: 'u_alice',
        email: 'a@example.com',
        passwordHash: 'scrypt$notused',
        handle: 'alice',
        displayName: 'Alice',
      },
      db,
    );
    alice = { userId: user.id, isStaff: false };
  });

  const anon: AuthContext = { userId: '', isStaff: false };

  function run(over: Partial<Parameters<typeof recordRun>[0]> = {}) {
    return recordRun(
      {
        userId: alice.userId,
        clientKey: 'client-a',
        url: 'https://example.com/a',
        host: 'example.com',
        outcome: 'ok:headings',
        ...over,
      },
      db,
    );
  }

  it('gives a signed-out visitor exactly one free run', () => {
    expect(checkLimits(anon, 'anon-1', 'example.com', db).allowed).toBe(true);

    for (let i = 0; i < ANON_FREE_RUNS; i++) {
      run({ userId: null, clientKey: 'anon-1' });
    }

    const verdict = checkLimits(anon, 'anon-1', 'example.com', db);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('anon-exhausted');
    // §12: the answer is "sign in", not "wait".
    expect(verdict.message).toMatch(/sign in/i);
  });

  it('does not let one visitor exhaust another', () => {
    run({ userId: null, clientKey: 'anon-1' });
    expect(checkLimits(anon, 'anon-2', 'example.com', db).allowed).toBe(true);
  });

  it('stops a signed-in user at the hourly allowance', () => {
    for (let i = 0; i < USER_RUNS_PER_HOUR; i++) run();

    const verdict = checkLimits(alice, 'client-a', 'example.com', db);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('user-hourly');
    expect(verdict.retryAfter).toBe(3600);
  });

  /**
   * Failed attempts count. A limit that only counts successes is not a limit —
   * a scan produces almost entirely failures, which is exactly the traffic we
   * are trying to cap.
   */
  it('counts failed and blocked attempts against the limit', () => {
    for (let i = 0; i < USER_RUNS_PER_HOUR; i++) {
      run({ outcome: 'failed:blocked-address' });
    }
    expect(checkLimits(alice, 'client-a', 'example.com', db).allowed).toBe(false);
  });

  it('limits reads per source host across all users, to protect that site', () => {
    for (let i = 0; i < 12; i++) run({ userId: null, clientKey: `other-${i}` });

    const verdict = checkLimits(alice, 'client-a', 'example.com', db);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('host-hourly');

    // A different site is unaffected.
    expect(checkLimits(alice, 'client-a', 'other.example', db).allowed).toBe(true);
  });

  it('ignores runs outside the window', () => {
    db.prepare(
      `INSERT INTO ingest_runs (id, user_id, client_hash, url, host, outcome, created_at)
       VALUES ('old', @u, 'client-a', 'https://e.com', 'example.com', 'ok',
               datetime('now', '-2 hours'))`,
    ).run({ u: alice.userId });

    expect(checkLimits(alice, 'client-a', 'example.com', db).allowed).toBe(true);
  });

  it('sums the month for the spend cap', () => {
    run({ costUsd: 0.02 });
    run({ costUsd: 0.03 });
    expect(monthSpend(db)).toBeCloseTo(0.05, 6);
    expect(modelBudgetAvailable(db)).toBe(true);
  });

  /**
   * §20 asks for "a hard monthly LLM spend cap with graceful degradation".
   * Over the cap the model path closes but the deterministic path stays open,
   * so the feature gets less clever rather than unavailable.
   */
  it('closes the model path once the cap is passed, without failing runs', () => {
    run({ costUsd: 10_000 });
    expect(modelBudgetAvailable(db)).toBe(false);
    // The run itself is still allowed — it will use the free structurer.
    expect(checkLimits(alice, 'client-a', 'example.com', db).allowed).toBe(true);
  });

  it('salts the client hash so it is not a lookup table of the IPv4 space', () => {
    const hash = clientHash('203.0.113.5', 'Mozilla');
    expect(hash).not.toContain('203.0.113.5');
    expect(hash).toHaveLength(32);
    expect(clientHash('203.0.113.5', 'Mozilla')).toBe(hash); // stable
    expect(clientHash('203.0.113.6', 'Mozilla')).not.toBe(hash);
  });

  it('records the outcome so a scan is visible in the log', () => {
    run({ outcome: 'failed:blocked-address' });
    const row = db
      .prepare(`SELECT outcome, url FROM ingest_runs WHERE outcome LIKE 'failed%'`)
      .get() as { outcome: string; url: string };
    expect(row.outcome).toBe('failed:blocked-address');
    expect(row.url).toBe('https://example.com/a');
  });
});

// -------------------------------------------------------- the failure copy

describe('failure messages', () => {
  /**
   * P9's acceptance criterion is "every failure has a specific message". This
   * asserts the property directly rather than spot-checking a few, so a new
   * member of the union cannot ship with placeholder copy.
   */
  const ALL: IngestFailure[] = [
    'unreachable',
    'blocked-by-robots',
    'auth-required',
    'too-thin',
    'model-failed',
    'rate-limited',
    'blocked-address',
  ];

  it.each(ALL)('%s has its own non-generic message', (failure) => {
    const copy = FAILURE_COPY[failure];
    expect(copy.title.length).toBeGreaterThan(8);
    expect(copy.body.length).toBeGreaterThan(8);
    expect(copy.title.toLowerCase()).not.toContain('something went wrong');
    expect(copy.title.toLowerCase()).not.toContain('error');
  });

  it('gives every failure a distinct title', () => {
    const titles = ALL.map((f) => FAILURE_COPY[f].title);
    expect(new Set(titles).size).toBe(ALL.length);
  });

  /**
   * §12: robots.txt is "a legal and reputational line, not a preference". A
   * Retry button there invites the user to argue with a decision that is not
   * ours to reverse, so it must offer manual create instead.
   */
  it('never offers a retry for robots.txt', () => {
    expect(FAILURE_COPY['blocked-by-robots'].retryable).toBe(false);
    expect(FAILURE_COPY['blocked-by-robots'].fallback).toBe('manual');
  });

  it('offers the paste-text fallback for a paywall', () => {
    expect(FAILURE_COPY['auth-required'].fallback).toBe('paste-text');
  });

  it('keeps depth and breadth caps in agreement with the schema', () => {
    expect(MAX_DEPTH).toBeGreaterThanOrEqual(2);
    expect(MAX_CHILDREN).toBeGreaterThan(2);
  });
});
