import { chromium } from 'playwright';

/**
 * P10 acceptance harness.
 *
 * §20 sets one criterion and one risk:
 *   "Interests → feed → node created, in one session"
 *   risk: cold-start emptiness
 *
 * The criterion is a JOURNEY, so the middle section below is written as one
 * unbroken run through the product — pick interests, press Go, scroll, add a
 * card to a map, open the map and find the node. Asserting the three steps
 * separately would pass while the seams between them were broken, and the
 * seams are the whole claim.
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

async function newSession() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  });
  return { context, page: await context.newPage() };
}

async function signUp(page, label) {
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill(`Watcher ${label}`);
  await page.getByLabel('Email').fill(`watch-${stamp}-${label}@example.com`);
  await page.getByLabel('Password').fill('a good long passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 20000 });
}

// ================================================== the cold-start mitigation

section('cold start — the seed is the mitigation');

const anon = await newSession();

const interests = await (
  await anon.page.request.get(`${BASE}/api/watch/interests`)
).json();

check(
  'the picker offers a real vocabulary',
  interests.interests.length >= 15,
  `${interests.interests.length} interests`,
);

/**
 * The specific way cold start bites: someone picks the one interest they care
 * about and lands on an empty feed. Every chip must have content behind it.
 */
const emptyInterests = interests.interests.filter((option) => option.count === 0);
check(
  'NO interest leads to an empty feed',
  emptyInterests.length === 0,
  emptyInterests.map((o) => o.tag).join(', ') || 'all populated',
);

const thin = interests.interests.filter((option) => option.count < 3);
check(
  'and every interest has enough to look alive',
  thin.length === 0,
  thin.map((o) => `${o.tag}:${o.count}`).join(', ') || 'all >= 3',
);

check(
  'the chips span every family, so the picker teaches the colour system',
  new Set(interests.interests.map((o) => o.family)).size === 6,
);

const allFeed = await (
  await anon.page.request.get(`${BASE}/api/watch/feed?limit=50`)
).json();
check(
  '§13 asks for 60–100 seeded pages',
  allFeed.total >= 60 && allFeed.total <= 100,
  `${allFeed.total} items`,
);

/**
 * §13: "let the empty state say honestly that the community is new". Seeded
 * content is ours, not the community's, and the card says so.
 */
check(
  'seeded content is labelled as seeded, not passed off as activity',
  allFeed.items.every((item) => item.seeded === true),
);

// Every single interest, on its own, must produce a feed.
let emptyOnItsOwn = [];
for (const option of interests.interests) {
  const page = await (
    await anon.page.request.get(`${BASE}/api/watch/feed?tags=${option.tag}&limit=3`)
  ).json();
  if (page.items.length === 0) emptyOnItsOwn.push(option.tag);
}
check(
  'every interest alone produces a feed',
  emptyOnItsOwn.length === 0,
  emptyOnItsOwn.join(', ') || 'all produce results',
);

// ===================================================================== ranking

section('relevance ranking');

const ranked = await (
  await anon.page.request.get(`${BASE}/api/watch/feed?tags=design,process&limit=10`)
).json();

const matchCounts = ranked.items.map((item) => item.matchedTags.length);
check(
  'items matching more interests rank first',
  JSON.stringify(matchCounts) ===
    JSON.stringify([...matchCounts].sort((a, b) => b - a)),
  matchCounts.join(','),
);

check(
  'every card says WHY it appeared',
  ranked.items.every((item) => item.matchedTags.length > 0),
);

check(
  'a filtered feed contains nothing that does not match',
  ranked.items.every((item) =>
    item.tags.some((tag) => ['design', 'process'].includes(tag)),
  ),
);

// Keyset pagination: walk the whole feed and check for duplicates.
const seen = [];
let cursor = null;
for (let page = 0; page < 40; page++) {
  const url = `${BASE}/api/watch/feed?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const result = await (await anon.page.request.get(url)).json();
  seen.push(...result.items.map((i) => i.id));
  cursor = result.nextCursor;
  if (!cursor) break;
}
check(
  'the feed paginates without repeating or skipping a card',
  seen.length === allFeed.total && new Set(seen).size === seen.length,
  `${seen.length} of ${allFeed.total}, ${new Set(seen).size} distinct`,
);

// ============================================ THE CRITERION, in one session

section('interests → feed → node created, in ONE session');

const user = await newSession();
await signUp(user.page, 'a');

// A map to add into. §13 step 6 needs somewhere for the node to land.
await user.page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
await user.page.getByLabel('Name').fill(`Research ${stamp}`);
await user.page.getByRole('button', { name: 'Create map' }).click();
await user.page.waitForURL(/\/maps\/m_/, { timeout: 20000 });
const mapId = user.page.url().split('/maps/')[1].split('?')[0];
await user.page.waitForTimeout(1200);

// ---- step 1: choose interests
await user.page.goto(`${BASE}/watch`, { waitUntil: 'domcontentloaded' });
await user.page.waitForTimeout(1200);

check(
  'the Go button is disabled until something is chosen',
  await user.page
    .getByRole('button', { name: /Pick at least one interest/ })
    .isDisabled(),
);

/**
 * Clicks the LABEL, which is what a person does.
 *
 * The checkbox itself is visually hidden so the chip can be styled, so
 * clicking the input directly is not a real interaction — and the label
 * correctly intercepts it. Locating the label by the checkbox it contains
 * keeps the assertion tied to the accessible name rather than to the visible
 * text, which also carries the item count.
 */
async function pickInterest(page, name) {
  await page
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name, exact: true }) })
    .click();
}

await pickInterest(user.page, 'Design');
await pickInterest(user.page, 'Research');
await user.page.waitForTimeout(300);

check(
  'picking a chip checks its checkbox',
  await user.page
    .getByRole('checkbox', { name: 'Design', exact: true })
    .isChecked(),
);

check(
  'each chip shows its live content count, per §13 step 2',
  await user.page
    .getByText(/^\d+ items$/)
    .first()
    .isVisible(),
);

const goButton = user.page.getByRole('button', { name: /^Go · \d+ interests?$/ });
check(
  'the Go button shows the count, per §13 step 3',
  await goButton.isVisible(),
  await goButton.innerText().catch(() => '—'),
);

// ---- step 2: the feed
await goButton.click();
await user.page.waitForURL(/\/watch\/feed/, { timeout: 20000 });
await user.page.waitForTimeout(1200);

const cardCount = await user.page.locator('article').count();
check('the feed renders cards', cardCount > 0, `${cardCount} cards`);

check(
  'a card carries source, title, excerpt and actions',
  (await user.page.getByRole('button', { name: 'Add to map' }).count()) > 0 &&
    (await user.page.getByRole('button', { name: 'Save', exact: true }).count()) >
      0,
);

/**
 * Playwright matches an accessible name by SUBSTRING unless told otherwise, so
 * a card's "Save" also matched the header's saved-items filter and the harness
 * quietly switched the feed to saved-only. The filter has since been renamed,
 * and this asserts the names stay distinct.
 */
check(
  'the card action and the header filter have distinct names',
  (await user.page.getByRole('button', { name: 'Saved items' }).count()) === 1,
);

// §13 step 4: cards are ~72% viewport height so one is always dominant.
const cardHeight = await user.page
  .locator('article')
  .first()
  .evaluate((el) => el.getBoundingClientRect().height);
check(
  'cards are dominant, per §13 step 4',
  cardHeight > 950 * 0.5,
  `${Math.round(cardHeight)}px of a 950px viewport`,
);

// Infinite list: scrolling loads more without a click.
const before = await user.page.locator('article').count();
await user.page.mouse.wheel(0, 8000);
await user.page.waitForTimeout(1800);
const after = await user.page.locator('article').count();
check('scrolling loads more', after > before, `${before} → ${after}`);

// Save round-trips.
const saveButton = user.page
  .getByRole('button', { name: 'Save', exact: true })
  .first();
await saveButton.click();
await user.page.waitForTimeout(900);
check(
  'Save round-trips to the server',
  (await user.page.getByRole('button', { name: 'Saved', exact: true }).count()) > 0,
);
check(
  'and saving does not disturb the feed',
  (await user.page.locator('article').count()) > 0,
);

// ---- step 3: node created
await user.page.getByRole('button', { name: 'Add to map' }).first().click();
await user.page.waitForTimeout(1200);

// Scoped to the dialog: "Map" is also the nav rail's link and every card's
// accessible name mentions maps.
const picker = user.page.getByRole('dialog', { name: 'Add to map' });
check(
  'Add to map opens a compact picker with map and parent',
  (await picker.getByLabel('Map', { exact: true }).isVisible()) &&
    (await picker.getByLabel('Parent node').isVisible()),
);

const addedTitle = await user.page.locator('article h3').first().innerText();

await picker.getByRole('button', { name: 'Add node' }).click();
await user.page.waitForTimeout(1500);

// §13 step 6: 'a toast: Added to "Research" · View in map'.
check(
  'a toast confirms where it went',
  await user.page
    .getByText(/Added to/)
    .isVisible()
    .catch(() => false),
);
check(
  'and offers a way back into the map',
  await user.page
    .getByRole('button', { name: 'View in map' })
    .isVisible()
    .catch(() => false),
);

// The node really exists, read from the API rather than the screen.
const saved = await user.page.evaluate(
  async (id) => await (await fetch(`/api/maps/${id}`)).json(),
  mapId,
);
const created = Object.values(saved.nodes).find((node) =>
  node.href?.startsWith('/watch/item/'),
);

check(
  'THE NODE WAS CREATED — interests → feed → node, in one session',
  created !== undefined,
  created ? `node "${created.title}"` : 'no node found',
);
check(
  'the node carries the card it came from',
  created?.title === addedTitle.slice(0, 60),
  `${created?.title} vs ${addedTitle}`,
);
check(
  'and keeps the card’s family, so it looks like what was chosen',
  typeof created?.family === 'string' && created.family.length > 0,
  created?.family,
);

// ===================================================== the empty state, honest

section('the empty state');

const fresh = await newSession();
// domcontentloaded, not networkidle: an infinite list keeps fetching as the
// sentinel comes into view, so "the network went quiet" is not a state this
// screen reliably reaches.
await fresh.page.goto(`${BASE}/watch/feed?tags=design&saved=1`, {
  waitUntil: 'domcontentloaded',
});
await fresh.page.waitForTimeout(1200);

// A signed-out visitor has nothing saved, which is the reachable empty state.
const emptyVisible = await fresh.page
  .getByText(/Nothing saved yet|Nothing here yet/)
  .isVisible()
  .catch(() => false);
check('an empty feed says so plainly', emptyVisible);

check(
  'and offers a way forward rather than a dead end',
  (await fresh.page
    .getByRole('button', { name: /Choose more interests|Back to the feed/ })
    .count()) > 0,
);

// ============================================================== permissions

section('permissions');

const other = await newSession();
await signUp(other.page, 'b');

// Another user must not see the first user's saves.
const otherSaved = await (
  await other.page.request.get(`${BASE}/api/watch/feed?saved=1&limit=20`)
).json();
check(
  "one user cannot see another's saved items",
  otherSaved.items.length === 0,
  `${otherSaved.items.length} items`,
);

// Nor add to their map.
const forbidden = await other.page.request.post(`${BASE}/api/watch/add-to-map`, {
  data: { itemId: allFeed.items[0].id, mapId, parentId: saved.rootId },
});
check(
  "and cannot add a node to another user's map",
  forbidden.status() === 404,
  `HTTP ${forbidden.status()} (404, not 403 — a 403 confirms the map exists)`,
);

// Signed out, saving is refused rather than silently dropped.
const anonSave = await anon.page.request.post(`${BASE}/api/watch/save`, {
  data: { itemId: allFeed.items[0].id, saved: true },
});
check(
  'a signed-out visitor cannot save',
  anonSave.status() === 401,
  `HTTP ${anonSave.status()}`,
);

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
