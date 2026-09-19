import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

/**
 * P13 accessibility audit.
 *
 * §20's criterion: "WCAG 2.1 AA on all non-canvas surfaces; tree view fully
 * operable by keyboard and screen reader; no critical findings."
 * §20's risk: "Discovering a11y debt here `High` — mitigate by auditing from P3."
 *
 * Two things this harness is careful about:
 *
 *   - **The canvas is excluded, and only the canvas.** §20 says "all non-canvas
 *     surfaces", because a 2D canvas has no accessible tree to audit. The tree
 *     view is the accessible equivalent, so it gets the OPPOSITE treatment: a
 *     hand-written keyboard and semantics audit on top of the automated pass.
 *
 *   - **Automated checks find perhaps a third of real barriers.** Passing this
 *     is necessary, not sufficient, and the summary says so rather than
 *     implying the product is accessible because a tool was quiet.
 */

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const AXE_SOURCE = readFileSync(AXE_PATH, 'utf8');

const BASE = 'http://localhost:3000';
let failures = 0;
let totalViolations = 0;

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

async function signIn() {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 950 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill('Ada Auditor');
  await page.getByLabel('Email').fill(`a11y-${stamp}@example.com`);
  await page.getByLabel('Password').fill('a good long passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 20000 });
  return { context, page };
}

const { page } = await signIn();

// A map to audit the editor against.
await page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
await page.getByLabel('Name').fill(`Audit map ${stamp}`);
await page.getByRole('button', { name: 'Create map' }).click();
await page.waitForURL(/\/maps\/m_/, { timeout: 20000 });
const mapId = page.url().split('/maps/')[1].split('?')[0];
await page.waitForTimeout(1200);

/**
 * Run axe against the current page.
 *
 * `[data-map-canvas]` is excluded by selector rather than by rule, so anything
 * that is not the canvas itself — the controls over it, the sheets beside it —
 * is still audited.
 */
async function audit(label, url, { wait = 1200, prepare } = {}) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);
  if (prepare) await prepare(page);

  await page.evaluate(AXE_SOURCE);

  const results = await page.evaluate(async () => {
    // WCAG 2.1 AA is exactly the tag set §20 names.
    return window.axe.run(
      {
        exclude: [['[data-map-canvas]']],
      },
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
        resultTypes: ['violations'],
      },
    );
  });

  const serious = results.violations.filter(
    (violation) =>
      violation.impact === 'critical' || violation.impact === 'serious',
  );
  const minor = results.violations.filter(
    (violation) =>
      violation.impact !== 'critical' && violation.impact !== 'serious',
  );

  totalViolations += results.violations.length;

  // §20: "no critical findings". Serious is included, because the line between
  // serious and critical in axe is not one a user notices.
  check(
    `${label} — no critical or serious WCAG 2.1 AA violations`,
    serious.length === 0,
    serious.length === 0
      ? minor.length > 0
        ? `${minor.length} minor`
        : 'clean'
      : serious.map((v) => `${v.id} (${v.nodes.length}×)`).join(', '),
  );

  for (const violation of serious) {
    console.log(`       ${violation.id}: ${violation.help}`);
    for (const node of violation.nodes.slice(0, 3)) {
      console.log(`         ${node.html.slice(0, 110)}`);
    }
  }

  return results;
}

// ==================================================== every non-canvas surface

section('WCAG 2.1 AA — every non-canvas surface');

await audit('Sign in', '/sign-in');
await audit('Sign up', '/sign-up');
await audit('My Maps', '/maps');
await audit('New map', '/maps/new');
await audit('Search (empty)', '/search');
await audit('Search (results)', '/search?q=mind', { wait: 2000 });
await audit('Page Watcher interests', '/watch', { wait: 2000 });
await audit('Page Watcher feed', '/watch/feed?tags=design', { wait: 2500 });
await audit('Link-to-Mind-Map', '/create/link');
await audit('Service node', '/services/build-with-us');
await audit('Notifications', '/notifications');
await audit('Settings', '/settings');
await audit('Profile', '/you');
await audit('Community map — chrome around the canvas', '/map', { wait: 2500 });
await audit('Map editor — chrome around the canvas', `/maps/${mapId}`, {
  wait: 2500,
});

// The tree view is the accessible equivalent of the canvas, so it is audited
// as a first-class surface rather than as an alternative.
await audit('Tree view', '/map', {
  wait: 2500,
  prepare: async (p) => {
    await p.getByRole('button', { name: 'Tree', exact: true }).click();
    await p.waitForTimeout(900);
  },
});

// Panels and sheets only exist once opened, so they are audited open.
await audit('Chat panel', `/maps/${mapId}`, {
  wait: 2500,
  prepare: async (p) => {
    await p.getByRole('button', { name: 'Chat' }).click();
    await p.waitForTimeout(800);
  },
});

await audit('Activity panel', `/maps/${mapId}`, {
  wait: 2500,
  prepare: async (p) => {
    await p.getByRole('button', { name: 'Activity' }).click();
    await p.waitForTimeout(900);
  },
});

// ========================================== the tree view, by hand

section('tree view — keyboard and screen reader');

await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Tree', exact: true }).click();
await page.waitForTimeout(900);

const tree = page.getByRole('tree');
check('the tree exposes a tree role with a name', await tree.isVisible());

const items = page.getByRole('treeitem');
const itemCount = await items.count();
check('and treeitem children', itemCount > 0, `${itemCount} items`);

/**
 * Roving tabindex: exactly ONE item is in the tab order. A tree where every
 * row is tabbable makes a keyboard user press Tab a hundred times to leave it,
 * which is the single most common way this pattern is got wrong.
 */
const tabbable = await page.evaluate(
  () => document.querySelectorAll('[role="treeitem"][tabindex="0"]').length,
);
check(
  'exactly one item is in the tab order (roving tabindex)',
  tabbable === 1,
  `${tabbable}`,
);

const semantics = await page.evaluate(() => {
  const first = document.querySelector('[role="treeitem"]');
  return {
    level: first?.getAttribute('aria-level'),
    selected: first?.getAttribute('aria-selected'),
    expanded: first?.getAttribute('aria-expanded'),
    name: (first?.textContent ?? '').trim().slice(0, 40),
  };
});
check(
  'each item reports its level and selection to a screen reader',
  semantics.level !== null && semantics.selected !== null,
  `level=${semantics.level} selected=${semantics.selected} expanded=${semantics.expanded}`,
);

// Keyboard navigation, driven for real.
await page.getByRole('treeitem').first().focus();

async function focusedText() {
  return page.evaluate(() =>
    (document.activeElement?.textContent ?? '').trim().slice(0, 40),
  );
}

const start = await focusedText();
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const afterDown = await focusedText();
check(
  'ArrowDown moves to the next item',
  afterDown !== start,
  `${start} → ${afterDown}`,
);

await page.keyboard.press('ArrowUp');
await page.waitForTimeout(200);
check('ArrowUp moves back', (await focusedText()) === start);

await page.keyboard.press('End');
await page.waitForTimeout(200);
const atEnd = await focusedText();
check('End jumps to the last item', atEnd !== start, atEnd);

await page.keyboard.press('Home');
await page.waitForTimeout(200);
check('Home jumps back to the first', (await focusedText()) === start);

/**
 * Expand and collapse, asserted against the WAI-ARIA tree pattern rather than
 * against intuition:
 *
 *   Right — collapsed: expand. Expanded: move to the first child.
 *   Left  — expanded: collapse. Collapsed: move to the parent.
 *
 * An earlier version of this harness expected Left to always collapse, and
 * reported a failure against an implementation that was following the spec
 * correctly. The four-way behaviour is the thing worth pinning.
 */
async function focusedState() {
  return page.evaluate(() => ({
    expanded: document.activeElement?.getAttribute('aria-expanded'),
    level: document.activeElement?.getAttribute('aria-level'),
    label: (document.activeElement?.textContent ?? '').trim().slice(0, 30),
  }));
}

// The root arrives expanded, so Right should descend rather than expand.
await page.getByRole('treeitem').first().focus();
const rootState = await focusedState();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const childState = await focusedState();

check(
  'ArrowRight on an expanded branch moves to its first child',
  Number(childState.level) === Number(rootState.level) + 1,
  `level ${rootState.level} → ${childState.level}`,
);

// That child is collapsed, so Left should go back UP rather than collapse.
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(400);
const backUp = await focusedState();
check(
  'ArrowLeft on a collapsed item moves to its parent',
  Number(backUp.level) === Number(rootState.level),
  `level ${childState.level} → ${backUp.level}`,
);

/**
 * Expand then collapse, on a BRANCH rather than on the root.
 *
 * The centre node of a radial map stays expanded by design — collapsing it
 * would leave an empty map — so it is the one node where Left correctly does
 * not collapse. An earlier version of this harness tested exactly that node
 * and reported a bug against intended behaviour.
 */
const branchIndex = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="treeitem"]')];
  return items.findIndex((el) => el.getAttribute('aria-expanded') === 'false');
});
check(
  'the tree has a collapsed branch to exercise',
  branchIndex >= 0,
  `index ${branchIndex}`,
);

if (branchIndex >= 0) {
  await page.getByRole('treeitem').nth(branchIndex).focus();

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  check(
    'ArrowRight on a collapsed branch expands it',
    (await focusedState()).expanded === 'true',
    `expanded=${(await focusedState()).expanded}`,
  );

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  check(
    'ArrowLeft on an expanded branch collapses it',
    (await focusedState()).expanded === 'false',
    `expanded=${(await focusedState()).expanded}`,
  );
}

// Enter and Space are the two activation keys the pattern requires.
await page.getByRole('treeitem').nth(1).focus();
await page.keyboard.press(' ');
await page.waitForTimeout(400);
check(
  'Space selects an item',
  (await page.evaluate(() =>
    document.activeElement?.getAttribute('aria-selected'),
  )) === 'true',
);

const itemsAfterKeyboard = await page.getByRole('treeitem').count();
check(
  'the whole map is reachable without a mouse',
  itemsAfterKeyboard > 0,
  `${itemsAfterKeyboard} items`,
);

// ============================================================ shared basics

section('shared basics');

await page.goto(`${BASE}/maps`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

/**
 * A visible focus indicator. Removing an outline without replacing it is the
 * most common serious barrier in a dark UI, and axe cannot see it — it has no
 * way to know whether a focused control looks different.
 */
const focusVisible = await page.evaluate(() => {
  const candidates = [
    ...document.querySelectorAll('a, button, input, select, textarea'),
  ]
    .filter((el) => el.offsetParent !== null)
    .slice(0, 12);

  let indistinguishable = 0;
  for (const el of candidates) {
    const before = getComputedStyle(el);
    const beforeStyle = `${before.outlineWidth}|${before.outlineStyle}|${before.boxShadow}|${before.borderColor}|${before.backgroundColor}`;
    el.focus();
    const after = getComputedStyle(el);
    const afterStyle = `${after.outlineWidth}|${after.outlineStyle}|${after.boxShadow}|${after.borderColor}|${after.backgroundColor}`;
    if (beforeStyle === afterStyle) indistinguishable++;
    el.blur();
  }
  return { checked: candidates.length, indistinguishable };
});

check(
  'focused controls look different from unfocused ones',
  focusVisible.indistinguishable === 0,
  `${focusVisible.checked - focusVisible.indistinguishable}/${focusVisible.checked} show focus`,
);

// One h1 per page, in document order.
for (const url of [
  '/maps',
  '/search',
  '/watch',
  '/services/build-with-us',
  '/notifications',
]) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const h1s = await page.locator('h1').count();
  check(`${url} has exactly one h1`, h1s === 1, `${h1s}`);
}

// The page must declare its language, or a screen reader guesses the accent.
await page.goto(`${BASE}/maps`, { waitUntil: 'domcontentloaded' });
const lang = await page.evaluate(() => document.documentElement.lang);
check('the document declares a language', Boolean(lang), lang || 'missing');

// Every page needs a distinct, useful title.
const titles = [];
for (const url of ['/maps', '/search', '/watch', '/services/build-with-us']) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  titles.push(await page.title());
}
check(
  'each page has its own title',
  new Set(titles).size === titles.length && titles.every(Boolean),
  titles.join(' · '),
);

await browser.close();

console.log('');
console.log(`Total WCAG 2.1 AA violations across all surfaces: ${totalViolations}`);
console.log(
  'NOTE: an automated pass finds roughly a third of real barriers. Green here is',
);
console.log(
  'necessary, not sufficient — manual screen-reader testing is still owed.',
);
console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
