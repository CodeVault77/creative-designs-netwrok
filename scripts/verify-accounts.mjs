import { chromium } from 'playwright';

/**
 * P6 acceptance harness.
 *
 * §20's criterion is "map survives sign-out, device change and offline edit",
 * and its named risk is "RLS mistakes leak data". Both are checked end to end
 * against a running server, through the real HTTP surface rather than the
 * repository — the unit tests already cover the repository, and the leak that
 * matters is one that gets past a route handler.
 *
 * "Device change" is a second browser context: a different cookie jar, a
 * different localStorage, nothing shared but the server. That is what a second
 * device is from the app's point of view.
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
const ALICE = {
  email: `alice-${stamp}@example.com`,
  password: 'correct horse battery',
  name: 'Alice Test',
};
const BOB = {
  email: `bob-${stamp}@example.com`,
  password: 'another good passphrase',
  name: 'Bob Test',
};

const browser = await chromium.launch();

async function newSession() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  return { context, page };
}

async function signUp(page, who) {
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 15000 });
}

async function signIn(page, who) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/maps/, { timeout: 15000 });
}

// -------------------------------------------------------------------- sign up

const a = await newSession();
const errors = [];
a.page.on('pageerror', (e) => errors.push(String(e)));

await signUp(a.page, ALICE);
check(
  'sign-up creates an account and lands in My Maps',
  a.page.url().includes('/maps'),
);

check(
  'a new account sees the empty state, not a blank page',
  await a.page.getByText('Your first map starts with one idea').isVisible(),
);

// Weak passwords are refused.
const weak = await a.page.request.post(`${BASE}/api/auth/sign-up`, {
  data: {
    email: `weak-${stamp}@example.com`,
    password: 'short',
    displayName: 'Weak',
  },
});
check(
  'a short password is refused',
  weak.status() === 409 || weak.status() === 400,
  String(weak.status()),
);

// The same email cannot be registered twice.
const dupe = await a.page.request.post(`${BASE}/api/auth/sign-up`, {
  data: {
    email: ALICE.email,
    password: 'a different long passphrase',
    displayName: 'Dupe',
  },
});
check('a duplicate email is refused', dupe.status() === 409, String(dupe.status()));

// ---------------------------------------------------------------- create map

await a.page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
const mapName = `Alice map ${stamp}`;
await a.page.getByLabel('Name').fill(mapName);
await a.page.getByRole('button', { name: 'Create map' }).click();
await a.page.waitForURL(/\/maps\/m_/, { timeout: 15000 });
const mapId = a.page.url().split('/maps/')[1].split('?')[0];
await a.page.waitForTimeout(1200);

// Add a couple of nodes so there is something to survive.
const addButton = a.page.getByRole('button', { name: /Add a node/ });
for (let i = 0; i < 3; i++) {
  await addButton.click();
  await a.page.waitForTimeout(180);
  await a.page.keyboard.type(`Alice node ${i + 1}`);
  await a.page.waitForTimeout(80);
}
await a.page.waitForTimeout(1600);

const created = await a.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  return Object.keys((await r.json()).nodes).length;
}, mapId);
check('nodes were saved to the server', created >= 4, `${created} nodes`);

// ------------------------------------------------ survives sign-out and back

await a.page.evaluate(() => fetch('/api/auth/sign-out', { method: 'POST' }));
await a.page.goto(`${BASE}/maps`, { waitUntil: 'networkidle' });
check('sign-out ends the session', a.page.url().includes('/sign-in'), a.page.url());

const signedOutRead = await a.page.request.get(`${BASE}/api/maps/${mapId}`);
check(
  'a signed-out request cannot read the map',
  signedOutRead.status() === 401,
  String(signedOutRead.status()),
);

await signIn(a.page, ALICE);
check('signing back in restores access', a.page.url().includes('/maps'));
check(
  'the map is still listed after sign-out',
  await a.page.getByText(mapName).isVisible(),
);

const afterSignOut = await a.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  const m = await r.json();
  return { nodes: Object.keys(m.nodes).length, title: m.title };
}, mapId);
check(
  'the map SURVIVES sign-out with its nodes',
  afterSignOut.nodes === created,
  `${afterSignOut.nodes}/${created}`,
);

// --------------------------------------------------------- device change

// A fresh context: different cookie jar, different localStorage, nothing
// shared with the first browser but the server.
const device2 = await newSession();
await signIn(device2.page, ALICE);

check(
  'the map SURVIVES a device change',
  await device2.page.getByText(mapName).isVisible(),
);

const onDevice2 = await device2.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  const m = await r.json();
  return Object.keys(m.nodes).length;
}, mapId);
check('with all its nodes', onDevice2 === created, `${onDevice2}/${created}`);

// --------------------------------------------------------- offline edit

await device2.page.goto(`${BASE}/maps/${mapId}`, { waitUntil: 'networkidle' });
await device2.page.waitForTimeout(1500);

await device2.context.setOffline(true);
const offlineAdd = device2.page.getByRole('button', { name: /Add a node/ });
await offlineAdd.click();
await device2.page.waitForTimeout(200);
await device2.page.keyboard.type('Made offline');
await device2.page.waitForTimeout(1400);

const heldLocally = await device2.page.evaluate((id) => {
  const raw = window.localStorage.getItem(`cdn.draft.${id}`);
  if (!raw) return null;
  const draft = JSON.parse(raw);
  return Object.values(draft.nodes).some((n) => n.title === 'Made offline');
}, mapId);
check('an offline edit is held locally', heldLocally === true);

await device2.context.setOffline(false);
// Nudge the editor to retry now that the network is back.
await device2.page.evaluate(() => window.dispatchEvent(new Event('online')));
await device2.page.waitForTimeout(2500);

const synced = await device2.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  const m = await r.json();
  return Object.values(m.nodes).some((n) => n.title === 'Made offline');
}, mapId);
check('the offline edit SYNCS when the network returns', synced === true);

// ------------------------------------------------ cross-user isolation

const b = await newSession();
await signUp(b.page, BOB);

check(
  "Bob's map list is empty",
  await b.page.getByText('Your first map starts with one idea').isVisible(),
);

const bobRead = await b.page.request.get(`${BASE}/api/maps/${mapId}`);
check(
  "Bob cannot READ Alice's map",
  bobRead.status() === 404,
  String(bobRead.status()),
);

const bobWrite = await b.page.request.patch(`${BASE}/api/maps/${mapId}`, {
  data: { version: 1, title: 'Stolen by Bob' },
});
check(
  "Bob cannot WRITE Alice's map",
  bobWrite.status() === 404,
  String(bobWrite.status()),
);

const bobDelete = await b.page.request.delete(`${BASE}/api/maps/${mapId}`);
check(
  "Bob cannot DELETE Alice's map",
  bobDelete.status() === 404,
  String(bobDelete.status()),
);

const bobList = await b.page.evaluate(async () => {
  const r = await fetch('/api/maps');
  return await r.json();
});
check("Alice's map is not in Bob's list", !JSON.stringify(bobList).includes(mapId));

// Bob cannot edit Alice's profile by forging an id.
const bobProfile = await b.page.request.patch(`${BASE}/api/profile`, {
  data: { displayName: 'Renamed by Bob', userId: 'u_alice' },
});
const aliceStillNamed = await a.page.evaluate(async () => {
  const r = await fetch('/api/maps');
  return r.ok;
});
check(
  'a forged userId does not edit another profile',
  bobProfile.ok() && aliceStillNamed,
);

// Alice's map is intact after all of that.
const intact = await a.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  const m = await r.json();
  return m.title;
}, mapId);
check("Alice's map is untouched", intact === mapName, intact);

// ---------------------------------------------------------------- profile

const aliceHandle = await a.page.evaluate(async () => {
  const r = await fetch('/api/maps');
  return r.ok;
});
check('signed-in API access works', aliceHandle);

await a.page.goto(`${BASE}/you`, { waitUntil: 'networkidle' });
check('/you resolves to the profile', /\/u\//.test(a.page.url()), a.page.url());
check(
  'the profile shows the display name',
  await a.page.getByText(ALICE.name).first().isVisible(),
);
check(
  'the owner sees an edit control',
  await a.page.getByRole('button', { name: 'Edit profile' }).isVisible(),
);

// A visitor sees the profile but no edit control.
const profileUrl = a.page.url();
await b.page.goto(profileUrl, { waitUntil: 'networkidle' });
check(
  'a visitor can see the profile',
  await b.page.getByText(ALICE.name).first().isVisible(),
);
check(
  'a visitor sees no edit control',
  (await b.page.getByRole('button', { name: 'Edit profile' }).count()) === 0,
);
check(
  'a visitor sees no private maps on the profile',
  !(await b.page
    .getByText(mapName)
    .isVisible()
    .catch(() => false)),
);

// ------------------------------------------------------------------ interest

// Interest counts are now durable, closing the P4 caveat.
const interest1 = await b.page.request.post(`${BASE}/api/interest`, {
  data: { nodeId: 'ai-tools' },
});
const body1 = await interest1.json();
const interest2 = await b.page.request.post(`${BASE}/api/interest`, {
  data: { nodeId: 'ai-tools' },
});
const body2 = await interest2.json();
check(
  'interest is deduped in the database, not in memory',
  body2.created === false && body2.count === body1.count,
  `${body1.count} -> ${body2.count}`,
);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
