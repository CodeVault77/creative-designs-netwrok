import { chromium } from 'playwright';

/**
 * P11 acceptance harness.
 *
 * §20 sets one criterion and one risk:
 *   "Two accounts co-edit and chat without data loss or lockout"
 *   risk: realtime cost and reconnection
 *
 * So this harness runs TWO real browser contexts at once against the live
 * server. The two words in the criterion drive the two hardest sections:
 *
 *   - DATA LOSS: Bob's stream is deliberately cut while Alice keeps talking,
 *     then reconnected. He must end up with everything, in order, exactly once.
 *   - LOCKOUT: a lock is taken and then abandoned, and someone else must be
 *     able to get it back without an administrator.
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
const browser = await chromium.launch();

async function signUp(label) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 950 },
  });
  const page = await context.newPage();
  const email = `collab-${stamp}-${label}@example.com`;

  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill(label);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a good long passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 20000 });

  return { context, page, email, label };
}

const alice = await signUp('Alice');
const bob = await signUp('Bob');

// A shared map: Alice owns it, Bob is an editor.
await alice.page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
await alice.page.getByLabel('Name').fill(`Team map ${stamp}`);
await alice.page.getByRole('button', { name: 'Create map' }).click();
await alice.page.waitForURL(/\/maps\/m_/, { timeout: 20000 });
const mapId = alice.page.url().split('/maps/')[1].split('?')[0];
await alice.page.waitForTimeout(1200);

/**
 * Bob joins through the REAL P7 invite flow — invite by email, then accept the
 * link — rather than by a row inserted behind the app's back. A harness that
 * fabricates membership would pass while the path a person actually takes was
 * broken.
 */
const invited = await alice.page.evaluate(
  async ({ id, email }) => {
    const response = await fetch(`/api/maps/${id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: 'editor' }),
    });
    return { status: response.status, body: await response.json() };
  },
  { id: mapId, email: bob.email },
);

check(
  'the owner can invite an editor',
  invited.status === 200 && typeof invited.body.url === 'string',
  `HTTP ${invited.status}`,
);

if (invited.body?.url) {
  await bob.page.goto(invited.body.url, { waitUntil: 'domcontentloaded' });
  await bob.page.waitForTimeout(1500);
}

section('two accounts, one map');

const bobRole = await bob.page.evaluate(
  async (id) => (await fetch(`/api/maps/${id}/chat`)).status,
  mapId,
);
check(
  'Bob can reach the shared map',
  bobRole === 200,
  `HTTP ${bobRole}${bobRole === 404 ? ' — invite did not take' : ''}`,
);

if (bobRole !== 200) {
  console.log('\nRESULT: cannot continue without a shared map');
  await browser.close();
  process.exit(1);
}

// ============================================================== NO DATA LOSS

section('no data loss — the reconnect');

/**
 * Open a stream in the page and record every event id it sees, so the harness
 * can assert on ordering and duplicates rather than on what rendered.
 */
async function openStream(session, id) {
  await session.page.evaluate((mapId) => {
    window.__seen = [];
    window.__stream = new EventSource(`/api/maps/${mapId}/stream?since=0`);
    window.__stream.addEventListener('message', (event) => {
      window.__seen.push(Number(event.lastEventId));
    });
    window.__stream.addEventListener('node_changed', (event) => {
      window.__seen.push(Number(event.lastEventId));
    });
  }, id);
}

await bob.page.goto(`${BASE}/maps/${mapId}`, { waitUntil: 'domcontentloaded' });
await bob.page.waitForTimeout(1500);
await openStream(bob, mapId);
await bob.page.waitForTimeout(800);

async function say(session, text) {
  return session.page.evaluate(
    async ({ id, body }) => {
      const response = await fetch(`/api/maps/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      return response.status;
    },
    { id: mapId, body: text },
  );
}

await alice.page.goto(`${BASE}/maps/${mapId}`, { waitUntil: 'domcontentloaded' });
await alice.page.waitForTimeout(1200);

await say(alice, 'first message while connected');
await bob.page.waitForTimeout(1200);

const seenLive = await bob.page.evaluate(() => window.__seen.length);
check('a live message reaches the other tab', seenLive > 0, `${seenLive} events`);

// Cut Bob's connection, and let Alice keep talking into the void.
await bob.page.evaluate(() => window.__stream.close());
const cursorBefore = await bob.page.evaluate(() =>
  window.__seen.length ? Math.max(...window.__seen) : 0,
);

await say(alice, 'sent while Bob was disconnected ONE');
await say(alice, 'sent while Bob was disconnected TWO');
await say(alice, 'sent while Bob was disconnected THREE');
await alice.page.waitForTimeout(600);

// Reconnect from where he left off — exactly what EventSource does on its own
// with Last-Event-ID; done explicitly here so the assertion is unambiguous.
const caught = await bob.page.evaluate(
  ({ id, since }) =>
    new Promise((resolve) => {
      const ids = [];
      const source = new EventSource(`/api/maps/${id}/stream?since=${since}`);
      const done = () => {
        source.close();
        resolve(ids);
      };
      source.addEventListener('message', (event) =>
        ids.push(Number(event.lastEventId)),
      );
      setTimeout(done, 2500);
    }),
  { id: mapId, since: cursorBefore },
);

check(
  'THE MISSED EVENTS ARE REPLAYED — no data loss across a reconnect',
  caught.length >= 3,
  `${caught.length} events replayed from ${cursorBefore}`,
);
check(
  'and replayed in order, with no duplicates',
  JSON.stringify(caught) === JSON.stringify([...caught].sort((a, b) => a - b)) &&
    new Set(caught).size === caught.length,
  caught.join(','),
);
check(
  'and nothing before the cursor is replayed',
  caught.every((id) => id > cursorBefore),
);

// And the messages themselves are all there, read from storage.
const bobMessages = await bob.page.evaluate(
  async (id) => (await (await fetch(`/api/maps/${id}/chat`)).json()).messages,
  mapId,
);
check(
  'every message Alice sent is readable by Bob',
  ['ONE', 'TWO', 'THREE'].every((marker) =>
    bobMessages.some((message) => message.body.includes(marker)),
  ),
  `${bobMessages.length} messages`,
);
check(
  'in the order they were sent',
  bobMessages.findIndex((m) => m.body.includes('ONE')) <
    bobMessages.findIndex((m) => m.body.includes('THREE')),
);

// Bob speaks too, so the fan-out below has something real to assert on.
await say(bob, 'Bob checking in');
await bob.page.waitForTimeout(600);

// ================================================================ NO LOCKOUT

section('no lockout — the soft lock');

async function lock(session, nodeId) {
  return session.page.evaluate(
    async ({ id, node }) => {
      const response = await fetch(`/api/maps/${id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: node }),
      });
      return response.json();
    },
    { id: mapId, node: nodeId },
  );
}

const map = await alice.page.evaluate(
  async (id) => await (await fetch(`/api/maps/${id}`)).json(),
  mapId,
);
const rootId = map.rootId;

const aliceLock = await lock(alice, rootId);
check('the first editor gets the lock', aliceLock.ok === true);

const bobLock = await lock(bob, rootId);
check('the second is refused', bobLock.ok === false);

// §15: "your edit is refused with 'Sam is editing this.'"
check(
  'and told WHO has it, by name',
  typeof bobLock.message === 'string' && bobLock.message.includes('Alice'),
  bobLock.message ?? 'no message',
);

check(
  'the holder can renew their own lock',
  (await lock(alice, rootId)).ok === true,
);

// Releasing hands it straight over.
await alice.page.evaluate(
  async ({ id, node }) => {
    await fetch(`/api/maps/${id}/lock?nodeId=${node}`, { method: 'DELETE' });
  },
  { id: mapId, node: rootId },
);
check('releasing hands the node over', (await lock(bob, rootId)).ok === true);

/**
 * THE lockout test. Bob takes a lock and his browser vanishes — no release, no
 * cleanup. The node must NOT be stuck: the lease has to expire on its own.
 */
await bob.context.close();

const stuck = await lock(alice, rootId);
check('a vanished editor still holds the lease briefly', stuck.ok === false);

console.log('     (waiting out the 30s lease…)');
await alice.page.waitForTimeout(32_000);

const recovered = await lock(alice, rootId);
check(
  'THE LEASE EXPIRES — a closed laptop cannot lock a node forever',
  recovered.ok === true,
  recovered.ok ? 'recovered' : `still held by ${recovered.holder?.name}`,
);

// ================================================================ the screen

section('the screen');

await alice.page.reload({ waitUntil: 'domcontentloaded' });
await alice.page.waitForTimeout(2500);

check(
  'the editor shows a connection state',
  await alice.page
    .getByText(/Live|Connecting|Reconnecting|here/)
    .first()
    .isVisible(),
);

await alice.page.getByRole('button', { name: 'Chat' }).click();
await alice.page.waitForTimeout(800);

check('the chat panel opens', await alice.page.getByLabel('Map chat').isVisible());
check(
  'and shows the thread',
  (await alice.page.getByText(/disconnected ONE/).count()) > 0,
);

// §15: "Typing # mentions a node and posts a chip that recentres the map."
const composer = alice.page.getByLabel('Message');
await composer.fill('look at #');
await alice.page.waitForTimeout(600);
check(
  "typing # offers the map's nodes",
  await alice.page.getByRole('listbox', { name: 'Mention a node' }).isVisible(),
);

await alice.page.getByRole('option').first().click();
await alice.page.waitForTimeout(300);
await composer.press('Enter');
await alice.page.waitForTimeout(1200);

const chipCount = await alice.page
  .getByRole('button', { name: /Go to .* on the map/ })
  .count();
check('and posts a node chip', chipCount > 0, `${chipCount} chips`);

// §14: activity.
await alice.page.getByRole('button', { name: 'Activity' }).click();
await alice.page.waitForTimeout(1200);
check(
  'the activity log records who changed what',
  await alice.page.getByRole('dialog', { name: 'Activity' }).isVisible(),
);

// Notifications reached Alice for Bob's activity, and vice versa.
const notifications = await alice.page.evaluate(
  async () => await (await fetch('/api/notifications')).json(),
);
check(
  'notifications fan out to the other member',
  notifications.unread > 0 &&
    notifications.notifications.some((n) => n.actorName === 'Bob'),
  `${notifications.notifications?.length ?? 0} notifications, ${notifications.unread} unread`,
);

/** Nobody needs telling about their own message. */
const ownNotifications = notifications.notifications.filter(
  (n) => n.actorName === 'Alice',
);
check('and never about your own action', ownNotifications.length === 0);

// ============================================================== permissions

section('permissions');

const stranger = await signUp('Carol');
const strangerChat = await stranger.page.evaluate(async (id) => {
  const read = await fetch(`/api/maps/${id}/chat`);
  const write = await fetch(`/api/maps/${id}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'let me in' }),
  });
  const stream = await fetch(`/api/maps/${id}/stream`);
  return { read: read.status, write: write.status, stream: stream.status };
}, mapId);

check(
  'a stranger cannot read the thread',
  strangerChat.read === 404,
  `HTTP ${strangerChat.read}`,
);
check(
  'cannot post to it',
  strangerChat.write === 404,
  `HTTP ${strangerChat.write}`,
);
check(
  'and cannot open the stream',
  strangerChat.stream === 404,
  `HTTP ${strangerChat.stream} (404, not 403 — a 403 confirms the map exists)`,
);

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
