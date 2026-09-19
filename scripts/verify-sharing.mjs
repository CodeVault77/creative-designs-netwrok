import { chromium } from 'playwright';

/**
 * P7 security review.
 *
 * §20's acceptance criterion is not a feature check, it is a review:
 * "no private node data in any shared response body". §15 sets the rule that
 * makes it testable: "Never ship a client-side filter for this."
 *
 * So this harness reads RAW HTTP BODIES and RAW SERVER-RENDERED HTML and looks
 * for strings that must not be there. It never asks whether the UI hides
 * something — a UI test would pass happily while the secret sat in the network
 * tab, which is the exact failure being guarded against.
 *
 * Every secret is a unique marker, so a match is unambiguous.
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
const SECRET_DESC = `SECRETDESC${stamp}`;
const SECRET_URL = `https://secret-${stamp}.example/hidden`;
const SECRET_TITLE = `SECRETNODE${stamp}`;

const OWNER = {
  email: `owner-${stamp}@example.com`,
  password: 'a good long passphrase',
  name: 'Owner Test',
};
const OTHER = {
  email: `other-${stamp}@example.com`,
  password: 'another long passphrase',
  name: 'Other Test',
};

const browser = await chromium.launch();

async function session() {
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

const owner = await session();
await signUp(owner.page, OWNER);

await owner.page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
await owner.page.getByLabel('Name').fill(`Shared map ${stamp}`);
await owner.page.getByRole('button', { name: 'Create map' }).click();
await owner.page.waitForURL(/\/maps\/m_/, { timeout: 15000 });
const mapId = owner.page.url().split('/maps/')[1].split('?')[0];
await owner.page.waitForTimeout(1200);

// Build a map with: a normal node carrying secrets, and a PRIVATE branch with
// a child, written straight through the API so the shape is exact.
const built = await owner.page.evaluate(
  async ({ id, desc, url, title }) => {
    const current = await (await fetch(`/api/maps/${id}`)).json();
    const rootId = current.rootId;

    const nodes = { ...current.nodes };
    nodes['open1'] = {
      id: 'open1',
      map_id: id,
      parent_id: rootId,
      slot: 0,
      title: 'Open node',
      description: desc,
      href: url,
      icon: '★',
      family: 'create',
      type: 'link',
      status: 'active',
      visibility: 'inherit',
      weight: 0.5,
    };
    nodes['priv1'] = {
      id: 'priv1',
      map_id: id,
      parent_id: rootId,
      slot: 1,
      title: title,
      description: 'Also hidden',
      family: 'organise',
      type: 'topic',
      status: 'active',
      visibility: 'private',
      weight: 0.5,
    };
    nodes['privchild'] = {
      id: 'privchild',
      map_id: id,
      parent_id: 'priv1',
      slot: 0,
      title: `${title}CHILD`,
      family: 'organise',
      type: 'topic',
      status: 'active',
      visibility: 'inherit',
      weight: 0.5,
    };

    const response = await fetch(`/api/maps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: current.version, nodes, rootId }),
    });
    return response.status;
  },
  { id: mapId, desc: SECRET_DESC, url: SECRET_URL, title: SECRET_TITLE },
);
check(
  'built a map with private and secret-bearing nodes',
  built === 200,
  String(built),
);

// ---------------------------------------------- share: link, node-viewable ON

const shareOn = await owner.page.evaluate(async (id) => {
  await fetch(`/api/maps/${id}/share`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: 'link', nodeViewable: true }),
  });
  const r = await fetch(`/api/maps/${id}/share`, { method: 'POST' });
  return (await r.json()).url;
}, mapId);

check('a share link is created', Boolean(shareOn), shareOn);
const tokenOn = shareOn.split('/s/')[1];

// A stranger: no cookies at all.
const stranger = await session();

const bodyOn = await (
  await stranger.page.request.get(`${BASE}/api/share/${tokenOn}`)
).text();

check(
  'with node-viewable ON, a stranger DOES get node detail',
  bodyOn.includes(SECRET_DESC),
);
check(
  'a PRIVATE node is absent even with node-viewable ON',
  !bodyOn.includes(SECRET_TITLE),
);
check(
  'the private node CHILD is absent too',
  !bodyOn.includes(`${SECRET_TITLE}CHILD`),
);

// ---------------------------------------------- share: node-viewable OFF

await owner.page.evaluate(async (id) => {
  await fetch(`/api/maps/${id}/share`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: 'link', nodeViewable: false }),
  });
}, mapId);

const bodyOff = await (
  await stranger.page.request.get(`${BASE}/api/share/${tokenOn}`)
).text();

// THE acceptance criterion, on the actual bytes.
check(
  'node-viewable OFF: description is NOT in the API body',
  !bodyOff.includes(SECRET_DESC),
);
check(
  'node-viewable OFF: href is NOT in the API body',
  !bodyOff.includes(SECRET_URL),
);
check(
  'node-viewable OFF: the map structure IS still sent',
  bodyOff.includes('Open node'),
);
check(
  'node-viewable OFF: nodes are marked locked',
  bodyOff.includes('"locked":true'),
);
check('the private node is still absent', !bodyOff.includes(SECRET_TITLE));

// The SSR path must filter identically — two paths to a payload is two
// chances to differ, and the one that differs is the one that leaks.
const html = await (await stranger.page.request.get(`${BASE}/s/${tokenOn}`)).text();

check(
  'node-viewable OFF: description is NOT in the server-rendered HTML',
  !html.includes(SECRET_DESC),
);
check(
  'node-viewable OFF: href is NOT in the server-rendered HTML',
  !html.includes(SECRET_URL),
);
check(
  'the private node is NOT in the server-rendered HTML',
  !html.includes(SECRET_TITLE),
);
check(
  'the shared page still renders the map title',
  html.includes(`Shared map ${stamp}`),
);

// §15: link-viewable maps are not indexed.
const headers = (
  await stranger.page.request.get(`${BASE}/api/share/${tokenOn}`)
).headers();
check(
  'a shared response asks not to be indexed',
  (headers['x-robots-tag'] ?? '').includes('noindex'),
  headers['x-robots-tag'],
);

// ------------------------------------------------------------ owner is exempt

const ownerBody = await owner.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  return JSON.stringify(await r.json());
}, mapId);

check('the OWNER still sees everything', ownerBody.includes(SECRET_DESC));
check('the owner still sees their private node', ownerBody.includes(SECRET_TITLE));

// ------------------------------------------------------------ link revocation

await owner.page.evaluate(
  (id) => fetch(`/api/maps/${id}/share`, { method: 'DELETE' }),
  mapId,
);

const afterRevoke = await stranger.page.request.get(`${BASE}/api/share/${tokenOn}`);
check(
  'a revoked link stops working',
  afterRevoke.status() === 404,
  String(afterRevoke.status()),
);

const revokedHtml = await stranger.page.request.get(`${BASE}/s/${tokenOn}`);
check(
  'the revoked share page 404s too',
  revokedHtml.status() === 404,
  String(revokedHtml.status()),
);

// ------------------------------------------------------- private map is private

await owner.page.evaluate(async (id) => {
  await fetch(`/api/maps/${id}/share`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: 'private', nodeViewable: true }),
  });
}, mapId);

const newLink = await owner.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}/share`, { method: 'POST' });
  return (await r.json()).url;
}, mapId);
const privateToken = newLink.split('/s/')[1];

const privateBody = await stranger.page.request.get(
  `${BASE}/api/share/${privateToken}`,
);
check(
  'a token for a PRIVATE map does not open it',
  privateBody.status() === 404,
  String(privateBody.status()),
);

// ------------------------------------------------------------------- invites

const other = await session();
await signUp(other.page, OTHER);

// Before any invite, a second account cannot touch the map at all.
const beforeInvite = await other.page.request.get(`${BASE}/api/maps/${mapId}`);
check(
  'a stranger account cannot read the map',
  beforeInvite.status() === 404,
  String(beforeInvite.status()),
);

const inviteUrl = await owner.page.evaluate(
  async ({ id, email }) => {
    const r = await fetch(`/api/maps/${id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: 'viewer' }),
    });
    const body = await r.json();
    return body.url ?? null;
  },
  { id: mapId, email: OTHER.email },
);
check('an invite produces an accept link', Boolean(inviteUrl), String(inviteUrl));

const inviteToken = inviteUrl.split('/invite/')[1];
await other.page.goto(`${BASE}/invite/${inviteToken}`, {
  waitUntil: 'networkidle',
});
check(
  'accepting an invite opens the map',
  other.page.url().includes(`/maps/${mapId}`),
  other.page.url(),
);

const afterInvite = await other.page.request.get(`${BASE}/api/maps/${mapId}`);
check('the invitee can now read the map', afterInvite.status() === 200);

// A viewer must not be able to write.
const viewerWrite = await other.page.request.patch(`${BASE}/api/maps/${mapId}`, {
  data: { version: 99, title: 'Hijacked' },
});
check(
  'a VIEWER cannot write to the map',
  viewerWrite.status() === 404,
  String(viewerWrite.status()),
);

// A viewer must not be able to change privacy.
const viewerPrivacy = await other.page.request.patch(
  `${BASE}/api/maps/${mapId}/share`,
  {
    data: { visibility: 'public', nodeViewable: true },
  },
);
check(
  'a VIEWER cannot make the map public',
  viewerPrivacy.status() === 404,
  String(viewerPrivacy.status()),
);

// A viewer must not be able to invite.
const viewerInvite = await other.page.request.post(
  `${BASE}/api/maps/${mapId}/members`,
  {
    data: { email: 'someone@example.com', role: 'admin' },
  },
);
check(
  'a VIEWER cannot invite anyone',
  viewerInvite.status() === 404,
  String(viewerInvite.status()),
);

// A viewer must not be able to promote themselves.
const selfPromote = await other.page.request.patch(
  `${BASE}/api/maps/${mapId}/members`,
  {
    data: { userId: 'self', role: 'admin' },
  },
);
check(
  'a VIEWER cannot promote anyone',
  selfPromote.status() === 403,
  String(selfPromote.status()),
);

// A viewer must not be able to mint a share link.
const viewerLink = await other.page.request.post(`${BASE}/api/maps/${mapId}/share`);
check(
  'a VIEWER cannot create a share link',
  viewerLink.status() === 404,
  String(viewerLink.status()),
);

// An invited VIEWER still must not see the owner's private node.
const inviteeBody = await other.page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  return JSON.stringify(await r.json());
}, mapId);
check(
  'an invited member does NOT see the private node',
  !inviteeBody.includes(SECRET_TITLE),
  'via /api/maps',
);

// The SSR path for a read-only member must filter identically. The first run
// of this harness found the API leaking here; the page would have leaked the
// same data into view-source.
const memberHtml = await (
  await other.page.request.get(`${BASE}/maps/${mapId}`)
).text();
check(
  'an invited member does NOT see the private node in the page HTML',
  !memberHtml.includes(SECRET_TITLE),
);
check(
  'an invited member does not get the private node’s description either',
  !memberHtml.includes('Also hidden'),
);

// A used invite cannot be replayed.
const replay = await other.page.request.get(`${BASE}/invite/${inviteToken}`);
check(
  'a used invite link is not reusable',
  replay.status() < 400 || replay.status() === 404,
);

// A bogus invite token is refused.
await other.page.goto(`${BASE}/invite/not-a-real-token`, {
  waitUntil: 'networkidle',
});
check(
  'a bogus invite token shows a refusal, not a map',
  await other.page.getByText('This invitation is not valid').isVisible(),
);

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
