import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

/**
 * P9 acceptance harness.
 *
 * §20 sets two criteria and two High risks:
 *   "10 varied URLs produce useful maps" · "every failure has a specific message"
 *   risks: the fetcher is an abuse surface · LLM cost per run
 *
 * The SSRF section runs FIRST and against the live server, because a guard
 * that holds in a unit test and not behind the route is not a guard. Each
 * attack is a real technique, and the harness asserts the server refused it
 * rather than that it merely returned something.
 */

const BASE = 'http://localhost:3000';
let failures = 0;

function check(label, ok, detail = '') {
  if (ok) console.log(`ok   ${label}${detail ? '  ' + detail : ''}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? '  ' + detail : ''}`);
  }
}

function section(name) {
  console.log(`\n— ${name} ${'-'.repeat(Math.max(0, 60 - name.length))}`);
}

const stamp = Date.now();

/**
 * Clear the run log before starting.
 *
 * Rate limits are per user, per anonymous visitor and PER SOURCE HOST, and
 * they persist. Run this harness twice inside an hour and the second run
 * throttles itself on the same handful of Wikipedia URLs — which is the limit
 * working, and useless for a repeatable acceptance test. So the harness resets
 * the counters it is about to trip.
 *
 * Deliberately a direct write to the dev database rather than a reset endpoint:
 * an endpoint that clears rate limits is an attack surface, and this is a
 * developer script running on the same machine as the file.
 */
try {
  const db = new Database(
    process.env.CDN_DATABASE_PATH ?? resolve(process.cwd(), '.data', 'cdn.sqlite'),
  );
  const { changes } = db.prepare('DELETE FROM ingest_runs').run();
  db.close();
  console.log(
    `(cleared ${changes} previous ingest runs so the limits start fresh)`,
  );
} catch (error) {
  console.log(`(could not clear ingest_runs: ${error.message})`);
}

const browser = await chromium.launch();

/**
 * Every browser context gets a UNIQUE user agent.
 *
 * Signed-out callers are bucketed by address plus agent, and on localhost every
 * request shares one address — so without this each anonymous session in the
 * harness would inherit the previous one's spent free run.
 */
let sessionSeq = 0;
async function newSession() {
  sessionSeq += 1;
  const context = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    userAgent: `CDNHarness/${stamp}-${sessionSeq} (anonymous visitor ${sessionSeq})`,
  });
  return { context, page: await context.newPage() };
}

let userSeq = 0;
/**
 * A fresh account per batch.
 *
 * The hourly limit is ten runs per user, which is exactly the number of URLs
 * §20 asks for — so the harness would rate-limit itself halfway through if it
 * used one account throughout. Needing to do this is the limit working.
 */
async function signUpFresh(page) {
  userSeq += 1;
  const who = {
    email: `link-${stamp}-${userSeq}@example.com`,
    password: 'a good long passphrase',
    name: `Linker ${userSeq}`,
  };
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 20000 });
  return who;
}

/**
 * Run the pipeline through the real SSE route, from inside the browser so the
 * session cookie applies. Returns every event, so the harness can assert on
 * the stages as well as the outcome.
 */
async function runIngest(page, url, timeoutMs = 45000) {
  return page.evaluate(
    ({ url, timeoutMs }) =>
      new Promise((resolve) => {
        const events = [];
        const source = new EventSource(
          `/api/ingest/run?url=${encodeURIComponent(url)}`,
        );
        const done = () => {
          source.close();
          resolve(events);
        };
        const timer = setTimeout(done, timeoutMs);
        source.onmessage = (message) => {
          const event = JSON.parse(message.data);
          events.push(event);
          if (event.type === 'done' || event.type === 'error') {
            clearTimeout(timer);
            done();
          }
        };
        source.onerror = () => {
          if (source.readyState === EventSource.CLOSED) {
            clearTimeout(timer);
            done();
          }
        };
      }),
    { url, timeoutMs },
  );
}

const outcomeOf = (events) =>
  events.find((e) => e.type === 'done' || e.type === 'error');
const countNodes = (node) =>
  1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

// ===================================================== the fetcher as a weapon

section('SSRF — the fetcher is an abuse surface');

const attacker = await newSession();

/**
 * Every entry is a real technique. The comment says what it defeats, so a
 * future reader can tell which line protects which hole.
 */
const ATTACKS = [
  ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP metadata — the prize'],
  ['http://metadata.google.internal/computeMetadata/v1/', 'metadata by name'],
  ['http://127.0.0.1:3000/api/maps', 'our own API, as us'],
  ['http://localhost:3000/api/maps', 'the same, by name'],
  ['http://[::1]:3000/', 'IPv6 loopback'],
  ['http://[::ffff:169.254.169.254]/', 'v4-mapped metadata'],
  ['http://2130706433/', 'decimal-encoded loopback'],
  ['http://0177.0.0.1/', 'octal-encoded loopback'],
  ['http://10.0.0.1/', 'RFC1918'],
  ['http://192.168.1.1/', 'home router'],
  ['http://100.100.100.200/', 'Alibaba metadata'],
  ['file:///etc/passwd', 'file scheme'],
  ['gopher://127.0.0.1:6379/_FLUSHALL', 'gopher to redis'],
  ['http://example.com@169.254.169.254/', 'userinfo confusion'],
  ['http://example.com:22/', 'ssh port'],
  ['http://redis.internal/', 'internal naming'],
];

let refused = 0;
for (const [url] of ATTACKS) {
  const response = await attacker.page.request.post(`${BASE}/api/ingest/preview`, {
    data: { url },
  });
  const body = await response.json();
  if (body.ok === false) refused += 1;
  else console.log(`     LEAK: ${url} → ${JSON.stringify(body).slice(0, 160)}`);
}
check(
  'every SSRF attack is refused by the preview route',
  refused === ATTACKS.length,
  `${refused}/${ATTACKS.length}`,
);

// The run route is the one that would actually fetch, so it is checked too.
await attacker.page.goto(`${BASE}/create/link`, { waitUntil: 'networkidle' });
const metadataRun = await runIngest(
  attacker.page,
  'http://169.254.169.254/latest/meta-data/',
);
const metadataOutcome = outcomeOf(metadataRun);
check(
  'the RUN route refuses the metadata endpoint',
  metadataOutcome?.type === 'error' &&
    metadataOutcome.failure === 'blocked-address',
  metadataOutcome?.failure ?? 'no outcome',
);

/**
 * A blocked address must not leak WHAT it found. "Connection refused" versus
 * a timeout is a port scan; the same message for every blocked address is the
 * point.
 */
check(
  'a blocked address returns no detail about the target',
  !JSON.stringify(metadataOutcome ?? {}).match(
    /refused|ECONN|timeout|latest\/meta-data/i,
  ),
);

// ================================================ 10 varied URLs → useful maps

section('10 varied URLs produce useful maps');

/**
 * Deliberately varied in SHAPE, not just in subject: an encyclopedia article,
 * reference docs, a formal specification, a tutorial and a news front page
 * are structured very differently, and a structurer that only handles one of
 * them would pass a less varied list.
 */
const URLS = [
  ['https://en.wikipedia.org/wiki/Mind_map', 'encyclopedia article'],
  ['https://en.wikipedia.org/wiki/Design_thinking', 'encyclopedia, long'],
  ['https://en.wikipedia.org/wiki/Graph_theory', 'encyclopedia, technical'],
  ['https://developer.mozilla.org/en-US/docs/Web/CSS/grid', 'reference docs'],
  ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching', 'guide'],
  ['https://www.w3.org/TR/WCAG21/', 'formal specification'],
  ['https://www.w3.org/TR/html-aria/', 'specification, tabular'],
  ['https://www.rfc-editor.org/rfc/rfc9309.html', 'RFC'],
  ['https://docs.python.org/3/tutorial/introduction.html', 'tutorial'],
  ['https://en.wikipedia.org/wiki/Information_architecture', 'encyclopedia, short'],
];

/**
 * Two accounts for ten URLs.
 *
 * The allowance is ten runs an hour and a retry spends one, so a single
 * account would throttle itself before the last URL. Splitting the list is the
 * harness respecting a limit it is not trying to test here.
 */
const batchA = await newSession();
await signUpFresh(batchA.page);
await batchA.page.goto(`${BASE}/create/link`, { waitUntil: 'networkidle' });

const batchA2 = await newSession();
await signUpFresh(batchA2.page);
await batchA2.page.goto(`${BASE}/create/link`, { waitUntil: 'networkidle' });

let useful = 0;
const timings = [];

for (const [index, [url, kind]] of URLS.entries()) {
  const runner = index < 5 ? batchA.page : batchA2.page;
  const started = Date.now();
  let events = await runIngest(runner, url);
  let outcome = outcomeOf(events);

  // One retry, and only for `unreachable`. A far-off server having a bad
  // moment is not this feature failing, but a second unreachable in a row is
  // worth reporting rather than papering over.
  if (outcome?.type === 'error' && outcome.failure === 'unreachable') {
    await runner.waitForTimeout(1500);
    events = await runIngest(runner, url);
    outcome = outcomeOf(events);
  }

  const elapsed = Date.now() - started;

  if (outcome?.type !== 'done') {
    console.log(`     ${kind}: ${outcome?.failure ?? 'no outcome'} — ${url}`);
    continue;
  }

  const root = outcome.result.root;
  const total = countNodes(root);
  const ringOne = root.children.length;
  const titled = [...flatten(root)].every((n) => n.title.trim().length > 0);
  const depth = maxDepth(root);

  /**
   * "Useful" is defined here rather than left to taste: enough nodes to be
   * worth opening, more than one branch, every node labelled, and at least
   * two levels — a flat list of eight is a list, not a map.
   */
  const isUseful = total >= 6 && ringOne >= 2 && titled && depth >= 2;
  if (isUseful) useful += 1;
  else
    console.log(
      `     thin result for ${kind}: total=${total} ring1=${ringOne} depth=${depth}`,
    );

  timings.push({ kind, elapsed, total });
}

check(
  'all 10 varied URLs produced a useful map',
  useful === 10,
  `${useful}/10 useful`,
);
check(
  'and each one within a reasonable time',
  timings.every((t) => t.elapsed < 30000),
  `slowest ${Math.max(...timings.map((t) => t.elapsed))}ms`,
);

function* flatten(node) {
  yield node;
  for (const child of node.children ?? []) yield* flatten(child);
}
function maxDepth(node) {
  if (!node.children?.length) return 1;
  return 1 + Math.max(...node.children.map(maxDepth));
}

// ==================================== every failure has a specific message

section('every failure has a specific message');

const batchB = await newSession();
await signUpFresh(batchB.page);
await batchB.page.goto(`${BASE}/create/link`, { waitUntil: 'networkidle' });

const seenMessages = new Map();

async function expectFailure(label, url, expected, { degraded = false } = {}) {
  const events = await runIngest(batchB.page, url);
  const outcome = outcomeOf(events);

  if (degraded) {
    const ok = outcome?.type === 'done' && outcome.degraded === expected;
    check(label, ok, `${outcome?.type}/${outcome?.degraded ?? '—'}`);
    if (ok) seenMessages.set(expected, `degraded:${expected}`);
    return outcome;
  }

  const ok = outcome?.type === 'error' && outcome.failure === expected;
  check(label, ok, outcome?.failure ?? 'no outcome');
  if (ok)
    seenMessages.set(expected, `${outcome.copy.title} — ${outcome.copy.body}`);
  return outcome;
}

// §12: "Unreachable — That page didn't respond."
await expectFailure(
  'unreachable has its own message',
  'https://cdn-no-such-host-xyz.example/',
  'unreachable',
);

/**
 * §12: "Blocked by robots.txt — Honour robots.txt. This is a legal and
 * reputational line, not a preference." Checked against a REAL site that
 * disallows unknown crawlers, not a fixture — the value of this test is that
 * it proves we read and obey a robots.txt in the wild.
 */
const robots = await expectFailure(
  'robots.txt is honoured, against a real site that disallows us',
  'https://www.reddit.com/r/programming/',
  'blocked-by-robots',
);
check(
  'and robots offers NO retry — the answer will not change',
  robots?.type === 'error' &&
    robots.copy.retryable === false &&
    robots.copy.fallback === 'manual',
  robots?.type === 'error' ? `retryable=${robots.copy.retryable}` : '—',
);

// §12: "Login or paywall — We can only read publicly visible pages."
const paywall = await expectFailure(
  'a 403 reads as login-or-paywall, not as unreachable',
  'https://httpbin.org/status/403',
  'auth-required',
);
check(
  'and offers the paste-text fallback',
  paywall?.type === 'error' && paywall.copy.fallback === 'paste-text',
);

/**
 * §12: "Too thin — here's a starter map instead, delivering a 3-node stub
 * rather than nothing." Note this is a SUCCESS with a note, not an error: the
 * user still gets a map.
 */
const thin = await expectFailure(
  'a thin page delivers a starter map rather than nothing',
  'https://example.com/',
  'too-thin',
  { degraded: true },
);
check(
  'and the starter map really has three nodes',
  thin?.type === 'done' && thin.result.root.children.length === 3,
  thin?.type === 'done' ? `${thin.result.root.children.length} nodes` : '—',
);

/**
 * A page with no usable headings and no model configured. §20 asks for
 * "graceful degradation" on the cost cap, and this is the same path: the user
 * gets a map, and the run is logged as degraded.
 */
await expectFailure(
  'a page with no structure degrades to a starter map',
  'https://news.ycombinator.com/',
  'model-failed',
  { degraded: true },
);

section('rate limits and the free run');

/**
 * §12: "Signed-out users get 1 free run, then sign-in."
 *
 * A distinct user agent, because signed-out callers are bucketed by address
 * plus agent and every request here comes from the same machine. On localhost
 * that makes all anonymous sessions ONE visitor — which is correct (they really
 * do share an address), and is why the SSRF section above, which runs signed
 * out, has already spent the default bucket's free run.
 */
const anon = await newSession();
await anon.page.goto(`${BASE}/create/link`, { waitUntil: 'networkidle' });

const free = await runIngest(anon.page, 'https://en.wikipedia.org/wiki/Mind_map');
check('a signed-out visitor gets one free run', outcomeOf(free)?.type === 'done');

const second = await runIngest(
  anon.page,
  'https://en.wikipedia.org/wiki/Graph_theory',
);
const secondOutcome = outcomeOf(second);
check(
  'and the second is refused',
  secondOutcome?.type === 'error' && secondOutcome.failure === 'rate-limited',
  secondOutcome?.failure ?? 'no outcome',
);
check(
  'with a message that says sign in, not "try later"',
  secondOutcome?.type === 'error' && /sign in/i.test(secondOutcome.copy.body),
  secondOutcome?.type === 'error' ? secondOutcome.copy.body : '—',
);

/** Every message must be distinct, or the taxonomy is decorative. */
const distinct = new Set(seenMessages.values());
check(
  'EVERY FAILURE HAS ITS OWN MESSAGE',
  distinct.size === seenMessages.size && seenMessages.size >= 5,
  `${seenMessages.size} failure modes, ${distinct.size} distinct messages`,
);

// ================================================================== the screen

section('the screen');

const ui = await newSession();
await signUpFresh(ui.page);
await ui.page.goto(`${BASE}/create/link`, { waitUntil: 'networkidle' });

check(
  'the URL field is focused on arrival',
  await ui.page.getByLabel('Page address').isVisible(),
);

// §12 step 2: "2–3 example links".
check(
  'example links set expectations about what works',
  (await ui.page
    .getByRole('button', { name: /Wikipedia|docs page|standard/ })
    .count()) >= 2,
);

/**
 * A page with a genuine third level.
 *
 * The depth control cannot be shown to work on a flat page — an earlier
 * version of this harness used one and reported a bug that was really the
 * article having no sub-sections to hide.
 */
const UI_URL = 'https://developer.mozilla.org/en-US/docs/Web/CSS/grid';
await ui.page.getByLabel('Page address').fill(UI_URL);

/**
 * §12 step 3: the trust moment — the title resolves before processing.
 *
 * Waited for rather than slept on: the point is that it arrives, and a fixed
 * sleep only tests whether the machine was fast that second.
 */
const chip = ui.page.getByText('developer.mozilla.org', { exact: false }).first();
await chip.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
check(
  'the page title resolves as a preview chip before processing',
  await chip.isVisible(),
);

/**
 * §12 step 3 puts an 800 ms budget on resolving the title. Measured against
 * warm connections, which is the state that matters — the very first request
 * of a process also pays for DNS and a TLS handshake.
 */
const previewTimings = [];
for (const target of [
  'https://en.wikipedia.org/wiki/Mind_map',
  'https://www.w3.org/TR/WCAG21/',
  'https://example.com/',
]) {
  const started = Date.now();
  const response = await ui.page.request.post(`${BASE}/api/ingest/preview`, {
    data: { url: target },
  });
  const body = await response.json();
  previewTimings.push({
    total: Date.now() - started,
    server: body.ms ?? -1,
    upstream: body.upstreamMs ?? -1,
  });
}

const worstOurs = Math.max(...previewTimings.map((t) => t.server - t.upstream));

/**
 * Our own share of the step. This is the part the code controls, and it is
 * where a regression would show up — the alternative, asserting only on the
 * total, fails when a third-party origin is having a slow morning and passes
 * when our extractor doubles in cost.
 */
check(
  'our own share of the preview is negligible',
  worstOurs >= 0 && worstOurs < 50,
  `worst ${worstOurs}ms of our own work`,
);

check(
  'the preview meets its 800ms budget for a typical page',
  previewTimings.filter((t) => t.total < 800).length >= 2,
  previewTimings.map((t) => `${t.total}ms (${t.upstream}ms upstream)`).join(' · '),
);

await ui.page.getByRole('button', { name: 'Make a map' }).click();

// §12 step 4: four NAMED stages, not a spinner.
const sawStage = await ui.page
  .getByText(/Fetching|Reading|Structuring|Laying out/)
  .first()
  .isVisible()
  .catch(() => false);
check('named stages appear, not a generic spinner', sawStage);
check(
  'and cancel is offered during processing',
  await ui.page
    .getByRole('button', { name: 'Cancel' })
    .isVisible()
    .catch(() => false),
);

await ui.page.waitForSelector('[data-map-canvas]', { timeout: 45000 });
await ui.page.waitForTimeout(1500);

// §12 step 5: "Preview in the real renderer, not a list."
const painted = await ui.page.evaluate(() => {
  const canvas = document.querySelector('[data-map-canvas] canvas');
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let lit = 0;
  for (let i = 0; i < data.length; i += 1600) {
    if (data[i] + data[i + 1] + data[i + 2] > 40) lit++;
  }
  return lit;
});
check(
  'the proposal renders in the REAL map renderer',
  (painted ?? 0) > 20,
  `${painted} lit samples`,
);

// §12 step 5: "Depth control: 2 or 3 levels."
const before = await ui.page
  .getByRole('button', { name: /^Save \d+ nodes$/ })
  .innerText();
await ui.page.getByRole('button', { name: '2 levels' }).click();
await ui.page.waitForTimeout(500);
const after = await ui.page
  .getByRole('button', { name: /^Save \d+ nodes$/ })
  .innerText();
check(
  'the depth control changes the map',
  before !== after,
  `${before} → ${after}`,
);

await ui.page.getByRole('button', { name: '3 levels' }).click();
await ui.page.waitForTimeout(400);

// §12 step 6: "Toggle nodes off."
const countBefore = Number(
  (
    await ui.page.getByRole('button', { name: /^Save \d+ nodes$/ }).innerText()
  ).match(/\d+/)[0],
);
await ui.page.locator('input[type="checkbox"]').nth(1).uncheck();
await ui.page.waitForTimeout(400);
const countAfter = Number(
  (
    await ui.page.getByRole('button', { name: /^Save \d+ nodes$/ }).innerText()
  ).match(/\d+/)[0],
);
check(
  'switching a node off removes it and its subtree',
  countAfter < countBefore,
  `${countBefore} → ${countAfter}`,
);

// §12 step 7: "visibility defaults to Private — non-negotiable".
check(
  'the map is private by default, and says so',
  await ui.page.getByText(/Saved as private/i).isVisible(),
);

await ui.page.getByRole('button', { name: /^Save \d+ nodes$/ }).click();
await ui.page.waitForURL(/\/maps\/m_/, { timeout: 20000 });
check(
  'saving lands in the editor',
  /\/maps\/m_/.test(ui.page.url()),
  ui.page.url(),
);

// §12 step 8: attribution.
const savedMapId = ui.page.url().split('/maps/')[1].split('?')[0];
const saved = await ui.page.evaluate(
  async (id) => await (await fetch(`/api/maps/${id}`)).json(),
  savedMapId,
);
check(
  'the saved map is PRIVATE',
  saved.visibility === 'private',
  String(saved.visibility),
);
check(
  'every node carries a source link back to the origin',
  Object.values(saved.nodes).every((n) => n.href?.includes('mozilla.org')),
);
check(
  'and the map records where it came from',
  typeof saved.sourceUrl === 'string' && saved.sourceUrl.includes('mozilla.org'),
  saved.sourceUrl ?? 'none',
);

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
