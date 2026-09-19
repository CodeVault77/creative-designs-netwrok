import { chromium } from 'playwright';

/**
 * P8 acceptance harness.
 *
 * §20 sets three criteria and one High risk:
 *   "<300 ms suggestions" · "map results render" · "back restores exact state"
 *   risk: permission leakage via search
 *
 * The leakage checks read RAW HTTP BODIES, for the same reason the P7 review
 * did: a UI test passes happily while the secret sits in the network tab.
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

const stamp = Date.now();
const SECRET = `KOALABEAR${stamp}`;
const ALICE = {
  email: `alice-${stamp}@example.com`,
  password: 'a good long passphrase',
  name: 'Alice Searcher',
};
const BOB = {
  email: `bob-${stamp}@example.com`,
  password: 'another long passphrase',
  name: 'Bob Searcher',
};

const browser = await chromium.launch();

async function newSession() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  return { context, page: await context.newPage() };
}

async function signUp(page, who) {
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 15000 });
}

// ------------------------------------------------------------------- set-up

const alice = await newSession();
await signUp(alice.page, ALICE);

await alice.page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
await alice.page.getByLabel('Name').fill(`Private notes ${stamp}`);
await alice.page.getByRole('button', { name: 'Create map' }).click();
await alice.page.waitForURL(/\/maps\/m_/, { timeout: 15000 });
const mapId = alice.page.url().split('/maps/')[1].split('?')[0];
await alice.page.waitForTimeout(1200);

const seeded = await alice.page.evaluate(
  async ({ id, secret }) => {
    const current = await (await fetch(`/api/maps/${id}`)).json();
    const nodes = { ...current.nodes };
    // Node ids are globally unique, so the seeded id has to be unique per run
    // too — a fixed 'secret1' collided with the previous run's row.
    const nodeId = `n_${secret.toLowerCase()}`;
    nodes[nodeId] = {
      id: nodeId,
      map_id: id,
      parent_id: current.rootId,
      slot: 0,
      title: `${secret} in a title`,
      description: `${secret} in a description`,
      family: 'create',
      type: 'topic',
      status: 'active',
      visibility: 'inherit',
      weight: 0.5,
    };
    const r = await fetch(`/api/maps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: current.version,
        nodes,
        rootId: current.rootId,
      }),
    });
    return r.status;
  },
  { id: mapId, secret: SECRET },
);
check('seeded a private map with a secret node', seeded === 200, String(seeded));

// ------------------------------------------------ the leakage risk, on bytes

const bob = await newSession();
await signUp(bob.page, BOB);

const bobBody = await (
  await bob.page.request.get(`${BASE}/api/search?q=${SECRET}`)
).text();
const bobJson = JSON.parse(bobBody);

check(
  "another user's search returns nothing for the secret",
  bobJson.total === 0,
  `${bobJson.total} results`,
);
check(
  'the secret appears NOWHERE in their results',
  !JSON.stringify(bobJson.results).includes(SECRET),
);
check(
  'and nowhere in the grouped suggestions',
  !JSON.stringify(bobJson.grouped).includes(SECRET),
);

// §08 screen 06: excluded SILENTLY. No count of what was withheld.
check(
  'no count of withheld results is teased',
  !bobBody.includes('hidden') && !bobBody.includes('withheld'),
);

const anon = await newSession();
const anonJson = await (
  await anon.page.request.get(`${BASE}/api/search?q=${SECRET}`)
).json();
check('a signed-out search returns nothing', anonJson.total === 0);

const aliceJson = await alice.page.evaluate(
  async (secret) => await (await fetch(`/api/search?q=${secret}`)).json(),
  SECRET,
);
check(
  'the OWNER can find their own node',
  aliceJson.total > 0,
  `${aliceJson.total}`,
);

// A forged context parameter must be ignored — the session decides.
const forged = await bob.page.request.get(
  `${BASE}/api/search?q=${SECRET}&userId=u_alice&isStaff=1`,
);
const forgedJson = await forged.json();
check(
  'a forged userId parameter changes nothing',
  forgedJson.total === 0,
  `${forgedJson.total}`,
);

// ------------------------------------------------------- <300ms suggestions

const timings = [];
for (const term of ['mind', 'page', 'build', 'proj', 'com']) {
  const started = Date.now();
  const response = await anon.page.request.get(`${BASE}/api/search?q=${term}`);
  const elapsed = Date.now() - started;
  const json = await response.json();
  timings.push({ term, elapsed, server: json.ms, total: json.total });
}

const worstServer = Math.max(...timings.map((t) => t.server));
const worstRound = Math.max(...timings.map((t) => t.elapsed));

check(
  'server-side search is well inside the 300ms budget',
  worstServer < 300,
  `worst ${worstServer}ms`,
);
check(
  'the full round trip is inside 300ms',
  worstRound < 300,
  `worst ${worstRound}ms · ${timings.map((t) => `${t.term}:${t.elapsed}`).join(' ')}`,
);

// -------------------------------------------------------------- the screen

await anon.page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });

const focused = await anon.page.evaluate(() =>
  document.activeElement?.getAttribute('role'),
);
check(
  'the search field is focused on arrival',
  focused === 'combobox',
  String(focused),
);

const field = anon.page.getByRole('combobox', { name: 'Search' });
await field.fill('mind');
await anon.page.waitForTimeout(700);

check(
  'suggestions appear as you type',
  await anon.page.locator('#search-suggestions').isVisible(),
);
check(
  'suggestions are grouped',
  (await anon.page.locator('#search-suggestions [role="group"]').count()) > 0,
);

await field.press('Enter');
await anon.page.waitForTimeout(800);

check(
  'results render',
  (await anon.page.locator('a:has-text("Mind Mapping")').count()) > 0,
);

// §11: map results.
// exact, or it also matches the Link-to-Mind-Map button.
await anon.page.getByRole('button', { name: 'Map', exact: true }).click();
await anon.page.waitForTimeout(1200);

const canvasPainted = await anon.page.evaluate(() => {
  const c = document.querySelector('[data-map-canvas] canvas');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let lit = 0;
  for (let i = 0; i < data.length; i += 1600) {
    if (data[i] + data[i + 1] + data[i + 2] > 40) lit++;
  }
  return lit;
});
check(
  'MAP RESULTS RENDER',
  (canvasPainted ?? 0) > 20,
  `${canvasPainted} lit samples`,
);

// §11: Live only.
await anon.page.getByRole('button', { name: 'Tree', exact: true }).click();
await anon.page.waitForTimeout(400);
const beforeLive = await anon.page.locator('a:has-text("SOON")').count();
await anon.page.getByRole('button', { name: 'Live only' }).click();
await anon.page.waitForTimeout(900);
const afterLive = await anon.page.locator('a:has-text("SOON")').count();
check(
  'Live only excludes Coming Soon results',
  afterLive === 0 && beforeLive >= 0,
  `${beforeLive} → ${afterLive}`,
);

// §11's assumption: the empty moment routes into Link-to-Mind-Map.
await anon.page.goto(`${BASE}/search?q=zzzznothingmatchesthis`, {
  waitUntil: 'networkidle',
});
await anon.page.waitForTimeout(900);
check(
  'an empty result offers Link-to-Mind-Map',
  await anon.page.getByText('Turn a web page into a map').isVisible(),
);

// --------------------------------------------------- back restores state

await anon.page.goto(`${BASE}/map`, { waitUntil: 'networkidle' });
await anon.page.waitForTimeout(1400);

// Move the camera and expand a branch so there is real state to lose.
const moved = await anon.page.evaluate(async () => {
  const host = document.querySelector('[data-map-canvas]');
  const rect = host.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const send = (type, x, y) =>
    host.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 3,
        clientX: x,
        clientY: y,
        bubbles: true,
        pointerType: 'mouse',
        isPrimary: true,
      }),
    );

  send('pointerdown', cx, cy);
  for (let i = 1; i <= 12; i++) {
    send('pointermove', cx + i * 12, cy + i * 6);
    await new Promise((r) => requestAnimationFrame(r));
  }
  send('pointerup', cx + 144, cy + 72);

  await new Promise((r) => setTimeout(r, 900));
  return Number(host.dataset.scale ?? '1');
});
check('the map camera can be moved', moved > 0);

const snapshotBefore = await anon.page.evaluate(() => {
  const raw = window.sessionStorage.getItem('cdn.search.snapshot');
  return raw ? JSON.parse(raw) : null;
});
check(
  'entering search captures a camera snapshot',
  snapshotBefore !== null && typeof snapshotBefore.camera?.x === 'number',
  snapshotBefore ? `x=${Math.round(snapshotBefore.camera.x)}` : 'none',
);

await anon.page.goto(`${BASE}/search?q=mind`, { waitUntil: 'networkidle' });
await anon.page.waitForTimeout(600);

const backLabel = await anon.page
  .locator('a:has-text("Back to")')
  .first()
  .innerText();
check(
  'the results screen offers a return path',
  backLabel.includes('Back to'),
  backLabel,
);

await anon.page.locator('a:has-text("Back to")').first().click();
await anon.page.waitForTimeout(1800);

check(
  'the return path lands back on the map',
  anon.page.url().includes('/map'),
  anon.page.url(),
);

// Read the live camera, not just the scale: the pan above moves x and y and
// leaves scale at the fitted value, so a scale-only assertion passes even when
// nothing was restored at all.
const cameraAfter = await anon.page.evaluate(() => {
  const host = document.querySelector('[data-map-canvas]');
  if (!host) return null;
  return {
    x: Number(host.dataset.cameraX ?? 'NaN'),
    y: Number(host.dataset.cameraY ?? 'NaN'),
    scale: Number(host.dataset.scale ?? 'NaN'),
  };
});

const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) < tol;

check(
  'BACK RESTORES EXACT STATE — the camera is re-applied',
  cameraAfter !== null &&
    near(cameraAfter.x, snapshotBefore.camera.x, 1) &&
    near(cameraAfter.y, snapshotBefore.camera.y, 1) &&
    near(cameraAfter.scale, snapshotBefore.camera.scale, 0.02),
  `got ${JSON.stringify(cameraAfter)} want ${JSON.stringify(snapshotBefore?.camera)}`,
);

// The restore flag must be consumed, or a refresh re-applies a position the
// user has since moved away from.
check(
  'the restore flag is consumed',
  !anon.page.url().includes('restore'),
  anon.page.url(),
);

// ------------------------------------------------- the return path on a phone
//
// Added because the desktop-only checks above missed a real one: the return
// bar and the tab bar are both fixed to the bottom of the viewport, so at
// phone width the return path sat exactly behind the tab bar — present in the
// DOM, invisible to the user, and §11 requires it to be there. Visibility is
// not enough to catch that; this asks whether the point a thumb would land on
// actually belongs to the link.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phonePage = await phone.newPage();
await phonePage.goto(`${BASE}/search?q=map`, { waitUntil: 'networkidle' });
await phonePage.waitForTimeout(1000);

const returnLink = phonePage.locator('a:has-text("Back to")').first();
check('the return path exists at phone width', await returnLink.isVisible());

const occluded = await phonePage.evaluate(() => {
  const link = [...document.querySelectorAll('a')].find((a) =>
    a.textContent?.includes('Back to'),
  );
  if (!link) return 'missing';
  const r = link.getBoundingClientRect();
  if (r.bottom > window.innerHeight || r.top < 0) return 'offscreen';
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return link.contains(hit) || hit?.contains(link) ? 'clickable' : 'covered';
});
check(
  'THE RETURN PATH IS NOT BURIED UNDER THE TAB BAR',
  occluded === 'clickable',
  occluded,
);

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
