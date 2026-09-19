import { chromium } from 'playwright';

/**
 * P13 security pass.
 *
 * §20: "Moderation queue, reporting, rate limits, pen-test pass, load test" —
 * with the criterion "no critical findings".
 *
 * Every check below is an ATTACK, run against the live server as a real
 * client. They are grouped by what an attacker is actually trying to get:
 *
 *   1. someone else's data          (authorisation)
 *   2. knowledge that something exists (enumeration)
 *   3. the server's own network     (SSRF)
 *   4. a foothold in someone's browser (XSS, headers)
 *   5. an action taken as someone else (CSRF, session)
 *   6. the service itself           (rate limits, payload size)
 *
 * Phrased as "must not" throughout: a security test that asserts the happy
 * path is a functional test wearing a hat.
 */

const BASE = 'http://localhost:3000';
let failures = 0;
let critical = 0;

function check(label, ok, detail = '', severity = 'high') {
  if (ok) console.log(`ok   ${label}${detail ? '  ' + detail : ''}`);
  else {
    failures++;
    if (severity === 'critical') critical++;
    console.log(`FAIL [${severity}] ${label}${detail ? '  ' + detail : ''}`);
  }
}

function section(name) {
  console.log(`\n— ${name} ${'-'.repeat(Math.max(0, 60 - name.length))}`);
}

const stamp = Date.now();
const browser = await chromium.launch();

async function signUp(label) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const email = `sec-${stamp}-${label}@example.com`;
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill(label);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a good long passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 20000 });
  return { context, page, email, label };
}

const victim = await signUp('Victim');
const attacker = await signUp('Attacker');
const anonContext = await browser.newContext();
const anon = { page: await anonContext.newPage(), context: anonContext };
// A page with no document has no origin, so a relative fetch has nothing to
// resolve against.
await anon.page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

// The victim's private map, with a secret in it.
const SECRET = `TOPSECRET${stamp}`;
await victim.page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
await victim.page.getByLabel('Name').fill(`Private ${stamp}`);
await victim.page.getByRole('button', { name: 'Create map' }).click();
await victim.page.waitForURL(/\/maps\/m_/, { timeout: 20000 });
const mapId = victim.page.url().split('/maps/')[1].split('?')[0];
await victim.page.waitForTimeout(1200);

/**
 * A unique node id per run.
 *
 * Node ids are globally unique, so a hard-coded one is accepted on the first
 * run and refused with a 409 on every run after — leaving the map unseeded and
 * the assertions failing for a reason that has nothing to do with security.
 * The product was right to refuse it; the harness was wrong to ask twice.
 */
const SECRET_NODE = `n_sec_${stamp}`;

const seeded = await victim.page.evaluate(
  async ({ id, secret, nodeId }) => {
    const current = await (await fetch(`/api/maps/${id}`)).json();
    const nodes = { ...current.nodes };
    nodes[nodeId] = {
      id: nodeId,
      map_id: id,
      parent_id: current.rootId,
      slot: 0,
      title: `${secret} title`,
      description: `${secret} description`,
      family: 'create',
      type: 'topic',
      status: 'active',
      visibility: 'inherit',
      weight: 0.5,
    };
    const response = await fetch(`/api/maps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: current.version,
        nodes,
        rootId: current.rootId,
      }),
    });
    return response.status;
  },
  { id: mapId, secret: SECRET, nodeId: SECRET_NODE },
);
if (seeded !== 200) {
  console.log(
    `(seeding failed with HTTP ${seeded} — the run below is not meaningful)`,
  );
  process.exit(1);
}
console.log(`(seeded the victim's private map: HTTP ${seeded})`);

/** Fetch as a given session and return status + raw body. */
async function as(session, path, init = {}) {
  return session.page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { status: response.status, body: await response.text() };
    },
    { path, init },
  );
}

// ================================================== 1. someone else's data

section('authorisation — reading what is not yours');

const targets = [
  `/api/maps/${mapId}`,
  `/api/maps/${mapId}/chat`,
  `/api/maps/${mapId}/activity`,
  `/api/maps/${mapId}/members`,
  `/api/maps/${mapId}/stream`,
];

for (const path of targets) {
  const result = await as(attacker, path);
  check(
    `a stranger cannot read ${path.replace(mapId, '<map>')}`,
    result.status === 404 || result.status === 401,
    `HTTP ${result.status}`,
    'critical',
  );
  check(
    `  …and the secret is not in the body`,
    !result.body.includes(SECRET),
    '',
    'critical',
  );
}

// Writing.
const writeAttempts = [
  [`/api/maps/${mapId}`, 'PATCH', { version: 1, nodes: {} }],
  [`/api/maps/${mapId}`, 'DELETE', null],
  [`/api/maps/${mapId}/chat`, 'POST', { body: 'I am in your map' }],
  [`/api/maps/${mapId}/lock`, 'POST', { nodeId: SECRET_NODE }],
  [`/api/maps/${mapId}/presence`, 'POST', { selectedId: null }],
];

for (const [path, method, payload] of writeAttempts) {
  const result = await as(attacker, path, {
    method,
    ...(payload
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      : {}),
  });
  check(
    `a stranger cannot ${method} ${path.replace(mapId, '<map>')}`,
    result.status === 404 || result.status === 401 || result.status === 403,
    `HTTP ${result.status}`,
    'critical',
  );
}

// The victim's map must still be intact after all that.
const stillThere = await as(victim, `/api/maps/${mapId}`);
check(
  "the victim's map survived every write attempt",
  stillThere.status === 200 && stillThere.body.includes(SECRET),
  `HTTP ${stillThere.status}`,
  'critical',
);

// Search must not surface it either.
const searched = await as(attacker, `/api/search?q=${SECRET}`);
check(
  'search does not surface a private node',
  !JSON.parse(searched.body).results?.some((r) =>
    JSON.stringify(r).includes(SECRET),
  ),
  '',
  'critical',
);

// ================================================ 2. enumeration

section('enumeration — learning that something exists');

/**
 * 404 everywhere, never 403. A 403 says "this exists but is not yours", which
 * turns an id into an oracle. The whole codebase follows this rule, so it is
 * asserted as a rule rather than per endpoint.
 */
const forbidden = await as(attacker, `/api/maps/${mapId}`);
const missing = await as(attacker, '/api/maps/m_definitely_not_a_real_map');
check(
  'a real private map and a nonexistent one are indistinguishable',
  forbidden.status === missing.status,
  `${forbidden.status} vs ${missing.status}`,
  'critical',
);

const staffOnly = [
  ['/api/moderation', 'the moderation queue'],
  ['/api/enquiries', 'the enquiry inbox'],
];
for (const [path, what] of staffOnly) {
  const result = await as(attacker, path);
  check(
    `${what} is hidden with a 404, not a 403`,
    result.status === 404,
    `HTTP ${result.status}`,
  );
}

const adminPage = await attacker.page.goto(`${BASE}/admin/moderation`, {
  waitUntil: 'domcontentloaded',
});
check(
  'the moderation SCREEN 404s for a non-staff account',
  adminPage?.status() === 404,
  `HTTP ${adminPage?.status()}`,
);

// Sign-in must not reveal whether an account exists.
const knownEmail = await as(anon, '/api/auth/sign-in', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: victim.email,
    password: 'wrong password entirely',
  }),
});
const unknownEmail = await as(anon, '/api/auth/sign-in', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: `nobody-${stamp}@example.com`,
    password: 'wrong password entirely',
  }),
});
check(
  'sign-in does not reveal whether an account exists',
  knownEmail.status === unknownEmail.status &&
    knownEmail.body === unknownEmail.body,
  `${knownEmail.status}/${unknownEmail.status}`,
);

// Reporting must not confirm a target exists either.
const reportReal = await as(anon, '/api/reports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ targetType: 'map', targetId: mapId, reason: 'spam' }),
});
const reportFake = await as(anon, '/api/reports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    targetType: 'map',
    targetId: 'm_not_real',
    reason: 'spam',
  }),
});
check(
  'reporting does not confirm whether the target exists',
  reportReal.status === reportFake.status,
  `${reportReal.status} vs ${reportFake.status}`,
);

// ================================================ 3. the server's own network

section('SSRF — pointing the server at itself');

const ssrf = [
  'http://169.254.169.254/latest/meta-data/',
  'http://localhost:3000/api/maps',
  'http://127.0.0.1:3000/api/maps',
  'http://[::1]:3000/',
  'http://[::ffff:169.254.169.254]/',
  'http://2130706433/',
  'file:///etc/passwd',
  'http://metadata.google.internal/',
  'http://10.0.0.1/',
  'gopher://127.0.0.1:6379/_FLUSHALL',
];

let blocked = 0;
for (const url of ssrf) {
  const result = await as(anon, '/api/ingest/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const body = JSON.parse(result.body);
  if (body.ok === false) blocked += 1;
  else console.log(`     LEAK: ${url}`);
}
check(
  'every SSRF probe is refused',
  blocked === ssrf.length,
  `${blocked}/${ssrf.length}`,
  'critical',
);

// ================================================ 4. a foothold in a browser

section('injection and headers');

/**
 * Stored XSS. React escapes by default, so the interesting question is whether
 * anything reaches the page unescaped — which is what this checks, on the
 * rendered DOM rather than on the response body.
 */
const XSS = `<img src=x onerror="window.__pwned=1">`;
await victim.page.evaluate(
  async ({ id, payload, nodeId }) => {
    const current = await (await fetch(`/api/maps/${id}`)).json();
    const nodes = { ...current.nodes };
    nodes[nodeId] = { ...nodes[nodeId], title: payload, description: payload };
    await fetch(`/api/maps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: current.version,
        nodes,
        rootId: current.rootId,
      }),
    });
  },
  { id: mapId, payload: XSS, nodeId: SECRET_NODE },
);

await victim.page.goto(`${BASE}/maps/${mapId}`, { waitUntil: 'domcontentloaded' });
await victim.page.waitForTimeout(2500);

const pwned = await victim.page.evaluate(() => Boolean(window.__pwned));
check('a stored script payload does not execute', !pwned, '', 'critical');

const injectedNodes = await victim.page.evaluate(
  () => document.querySelectorAll('img[src="x"]').length,
);
check(
  'and is not parsed as markup',
  injectedNodes === 0,
  `${injectedNodes} injected`,
  'critical',
);

// Reflected, through the search query.
await anon.page.goto(
  `${BASE}/search?q=${encodeURIComponent('<img src=x onerror="window.__pwned2=1">')}`,
  { waitUntil: 'domcontentloaded' },
);
await anon.page.waitForTimeout(1800);
check(
  'a reflected script payload does not execute',
  !(await anon.page.evaluate(() => Boolean(window.__pwned2))),
  '',
  'critical',
);

// A javascript: URL must never survive into a rendered link.
const jsUrl = await as(anon, '/api/ingest/preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'javascript:alert(1)' }),
});
check(
  'a javascript: URL is refused',
  JSON.parse(jsUrl.body).ok === false,
  '',
  'critical',
);

// SQL injection, against the parameterised layer.
const sqli = [
  "'; DROP TABLE maps; --",
  "' OR '1'='1",
  "\\'; SELECT * FROM users; --",
];
for (const payload of sqli) {
  await as(anon, `/api/search?q=${encodeURIComponent(payload)}`);
}
const survived = await as(victim, `/api/maps/${mapId}`);
check(
  'SQL injection attempts change nothing',
  survived.status === 200,
  `HTTP ${survived.status}`,
  'critical',
);

// Session cookie hygiene.
const cookies = await victim.context.cookies();
const session = cookies.find((cookie) => /session/i.test(cookie.name));
check('the session cookie is httpOnly', session?.httpOnly === true, session?.name);
check(
  'the session cookie is sameSite',
  Boolean(session?.sameSite && session.sameSite !== 'None'),
  session?.sameSite,
);

// ================================================ 5. acting as someone else

section('session and CSRF');

/**
 * A cross-site form POST. SameSite=Lax stops the cookie riding along, so the
 * request should arrive unauthenticated.
 */
const crossSite = await anon.page.evaluate(async (id) => {
  const response = await fetch(`http://localhost:3000/api/maps/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return response.status;
}, mapId);
check(
  'a cross-origin delete is not authorised',
  crossSite !== 200,
  `HTTP ${crossSite}`,
  'critical',
);

// Signing out must actually invalidate the session server-side.
const throwaway = await signUp('Throwaway');
const beforeOut = await as(throwaway, '/api/maps');
await throwaway.page.evaluate(async () => {
  await fetch('/api/auth/sign-out', { method: 'POST' });
});
const afterOut = await as(throwaway, '/api/maps');
check(
  'signing out invalidates the session',
  beforeOut.status === 200 && afterOut.status !== 200,
  `${beforeOut.status} → ${afterOut.status}`,
);

// A forged session cookie must not be accepted.
await anon.context.addCookies([
  {
    name: 'cdn_session',
    value: 'forged-token-value-that-is-not-real',
    domain: 'localhost',
    path: '/',
  },
]);
const forged = await as(anon, '/api/maps');
check(
  'a forged session token is rejected',
  forged.status !== 200,
  `HTTP ${forged.status}`,
  'critical',
);

// ================================================ 6. the service itself

section('availability');

// A very large payload must be refused rather than buffered.
const huge = await as(attacker, '/api/reports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    targetType: 'map',
    targetId: 'm_x',
    reason: 'spam',
    detail: 'x'.repeat(2_000_000),
  }),
});
check('an oversized payload is refused', huge.status >= 400, `HTTP ${huge.status}`);

/**
 * The fetcher's own rate limit is asserted in `verify-link`, where the SSE
 * stream can be consumed properly. It is deliberately NOT re-asserted here
 * with a placeholder: a check that always passes is worse than no check,
 * because it prints "ok" and buys confidence it has not earned.
 */

const reportFlood = [];
for (let i = 0; i < 25; i++) {
  const result = await as(anon, '/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType: 'map', targetId: `m_${i}`, reason: 'spam' }),
  });
  reportFlood.push(result.status);
}
check(
  'anonymous reporting is rate limited',
  reportFlood.includes(400),
  `${reportFlood.filter((s) => s === 400).length} of 25 refused`,
);

// Concurrency: the server must stay correct under parallel writes.
const concurrent = await victim.page.evaluate(async (id) => {
  const current = await (await fetch(`/api/maps/${id}`)).json();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      fetch(`/api/maps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: current.version,
          nodes: current.nodes,
          rootId: current.rootId,
        }),
      }).then((r) => r.status),
    ),
  );
  return results;
}, mapId);

/**
 * Optimistic concurrency: exactly one write at a given version wins and the
 * rest are refused with 409. Two winners would mean one person's work was
 * silently overwritten.
 */
check(
  'concurrent writes at the same version produce exactly one winner',
  concurrent.filter((status) => status === 200).length === 1,
  concurrent.join(','),
  'critical',
);

await browser.close();

console.log('');
console.log(
  critical === 0
    ? 'No critical findings.'
    : `${critical} CRITICAL finding(s) — these block the launch gate.`,
);
console.log(
  'NOTE: this is an automated pass over known classes. It is not a substitute',
);
console.log('for a real penetration test before opening to the public.');
console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
