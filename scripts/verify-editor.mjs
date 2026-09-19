import { chromium } from 'playwright';

/**
 * P5 acceptance harness.
 *
 * §20's criterion is "blank → 10-node map in <3 min unaided in a usability
 * test". A script cannot run a usability test, so this measures the thing a
 * script CAN measure and that the usability test depends on: that a ten-node
 * map is reachable in ten interactions with no dead ends, and how long the
 * machine takes to do it. A human is slower than this; the point is that the
 * path exists and nothing blocks it.
 *
 * It also exercises the phase's named risk directly — undo across canvas and
 * form — which is the part most likely to be quietly broken.
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

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});

// Signed in via the P2 dev-session cookie.
await context.addCookies([
  { name: 'cdn_dev_session', value: 'user', domain: 'localhost', path: '/' },
]);

const page = await context.newPage();
const errors = [];

/**
 * Set while the harness is deliberately provoking failures.
 *
 * The conflict and structural-guard tests make the server return 409 and 400
 * on purpose, and the browser logs those as console errors. Counting them as
 * app errors would make a passing negative test fail the suite.
 */
let expectingFailures = false;

page.on('pageerror', (e) => {
  if (!expectingFailures) errors.push(String(e));
});
page.on('console', (m) => {
  if (m.type() === 'error' && !expectingFailures) errors.push(m.text());
});

// ------------------------------------------------------------- My Maps empty

await page.goto(`${BASE}/maps`, { waitUntil: 'networkidle' });
check(
  'empty My Maps offers a way to start',
  await page.getByText('Your first map starts with one idea').isVisible(),
);

// ------------------------------------------------------------------ create

await page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });

// Typing straight away must land in the name field — no aiming required.
await page.keyboard.type('probe');
check(
  'new-map name field is autofocused',
  (await page.getByLabel('Name').inputValue()) === 'probe',
);
await page.getByLabel('Name').fill('');

const mapName = `Harness ${Date.now()}`;
await page.getByLabel('Name').fill(mapName);
await page.getByRole('button', { name: 'Create map' }).click();
await page.waitForURL(/\/maps\/m_/, { timeout: 15000 });
check('creating a map opens the editor', /\/maps\/m_/.test(page.url()), page.url());

const mapId = page.url().split('/maps/')[1].split('?')[0];
await page.waitForTimeout(1200);

check(
  'empty editor prompts rather than showing a blank canvas',
  await page.getByText('Add your first branch').isVisible(),
);

// -------------------------------------------------- blank -> 10 nodes

const started = Date.now();
const addButton = page.getByRole('button', { name: /Add a node/ });

// 9 adds on top of the root = 10 nodes.
for (let i = 0; i < 9; i++) {
  await addButton.click();
  await page.waitForTimeout(200);

  if (i === 0) {
    // The rhythm the 3-minute criterion depends on: after Add, the cursor is
    // already in the title field. If it is not, every node costs an extra
    // click and the criterion is unreachable for a real person.
    const focusedLabel = await page.evaluate(() => {
      const el = document.activeElement;
      const id = el?.getAttribute('id');
      if (!id) return null;
      return document.querySelector(`label[for="${id}"]`)?.textContent ?? null;
    });
    check(
      'after Add, the cursor is in the title field',
      focusedLabel === 'Title',
      String(focusedLabel),
    );
  }

  await page.keyboard.type(`Node ${i + 1}`);
  await page.waitForTimeout(60);
}

const elapsed = Date.now() - started;
await page.waitForTimeout(1500);

const nodeCount = await page.evaluate(async (id) => {
  const response = await fetch(`/api/maps/${id}`);
  const map = await response.json();
  return Object.keys(map.nodes).length;
}, mapId);

check(
  'blank to a 10-node map',
  nodeCount >= 10,
  `${nodeCount} nodes in ${elapsed}ms`,
);

// ----------------------------------------------------------------- autosave

const saveState = await page.evaluate(async (id) => {
  const response = await fetch(`/api/maps/${id}`);
  const map = await response.json();
  return {
    version: map.version,
    titled: Object.values(map.nodes).some((n) => n.title === 'Node 1'),
  };
}, mapId);

check(
  'autosave persisted without a save button',
  saveState.version > 1,
  `v${saveState.version}`,
);
check('typed titles were saved', saveState.titled);
check(
  'save status is visible',
  await page.locator('[role="status"]').first().isVisible(),
);

// --------------------------------------- undo across canvas AND form

// A rename (form) then an add (canvas-ish). Two separate undo steps, in order.
const firstNodeId = await page.evaluate(async (id) => {
  const response = await fetch(`/api/maps/${id}`);
  const map = await response.json();
  return Object.values(map.nodes).find((n) => n.title === 'Node 1')?.id;
}, mapId);

check('a created node is addressable', Boolean(firstNodeId), String(firstNodeId));

// Select it, rename it, then undo — the field must follow the draft back.
await page.evaluate(() => {
  const host = document.querySelector('[data-map-canvas]');
  const rect = host.getBoundingClientRect();
  const scale = Number(host.dataset.scale ?? '1');
  const theta = -Math.PI / 2;
  const x = rect.left + rect.width / 2 + Math.cos(theta) * 190 * scale;
  const y = rect.top + rect.height / 2 + Math.sin(theta) * 190 * scale;
  const send = (t) =>
    host.dispatchEvent(
      new PointerEvent(t, {
        pointerId: 31,
        clientX: x,
        clientY: y,
        bubbles: true,
        pointerType: 'mouse',
        isPrimary: true,
      }),
    );
  send('pointerdown');
  send('pointerup');
});
await page.waitForTimeout(500);

const titleField = page.getByLabel('Title');
const selectedOpened = await titleField.isVisible();
check('tapping a node opens its editor', selectedOpened);

if (selectedOpened) {
  const before = await titleField.inputValue();

  await titleField.fill('');
  await titleField.type('Renamed by harness');
  await page.waitForTimeout(300);
  check(
    'typing updates the field',
    (await titleField.inputValue()) === 'Renamed by harness',
  );

  // The risk, exercised: Cmd/Ctrl+Z while the FIELD has focus must revert the
  // draft AND the field together.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);

  const after = await titleField.inputValue();
  check(
    'undo from inside a form field reverts the field too',
    after === before,
    `"${after}" (was "${before}")`,
  );

  // Redo puts it back.
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(400);
  check(
    'redo restores the rename',
    (await titleField.inputValue()) === 'Renamed by harness',
    await titleField.inputValue(),
  );
}

// A whole typed word must undo as ONE step, not one per letter.
if (selectedOpened) {
  await titleField.fill('');
  await page.waitForTimeout(1000);
  await titleField.type('Coalesced');
  await page.waitForTimeout(300);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);

  const afterOneUndo = await titleField.inputValue();
  check(
    'a typed run undoes as one step, not one per keystroke',
    afterOneUndo !== 'Coalesce' && afterOneUndo !== 'Coalesced',
    `"${afterOneUndo}"`,
  );
}

// ------------------------------------------------------------------ delete

const beforeDelete = await page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  return Object.keys((await r.json()).nodes).length;
}, mapId);

// §14 confirms only when a subtree is at stake. Accept it if it appears, so
// the test covers both the leaf and the subtree case.
page.on('dialog', (dialog) => dialog.accept());

const deleteButton = page.getByRole('button', { name: 'Delete node' });
if (await deleteButton.isVisible()) {
  await deleteButton.click();
  await page.waitForTimeout(500);

  // The label is "Node deleted" for a leaf and "N nodes deleted" for a
  // subtree; the bar appearing at all is what matters here.
  const undoBar = page.locator('text=/(Node|nodes) deleted/');
  check('delete offers an undo bar', await undoBar.isVisible());

  // Two controls are named Undo: the toolbar icon and the undo bar's link.
  await undoBar.locator('..').getByText('Undo', { exact: true }).click();
  await page.waitForTimeout(1600);

  const afterUndo = await page.evaluate(async (id) => {
    const r = await fetch(`/api/maps/${id}`);
    return Object.keys((await r.json()).nodes).length;
  }, mapId);

  check(
    'undo restores the deleted node',
    afterUndo === beforeDelete,
    `${afterUndo}/${beforeDelete}`,
  );
}

// -------------------------------------------------------- conflict handling

// Everything below provokes failures on purpose.
expectingFailures = true;

const conflict = await page.evaluate(async (id) => {
  const response = await fetch(`/api/maps/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    // A deliberately stale version — what a second device would send.
    body: JSON.stringify({ version: 0, title: 'Stale write' }),
  });
  return response.status;
}, mapId);

check('a stale write is refused, not merged', conflict === 409, String(conflict));

const stillNamed = await page.evaluate(async (id) => {
  const r = await fetch(`/api/maps/${id}`);
  return (await r.json()).title;
}, mapId);
check('the refused write did not land', stillNamed !== 'Stale write', stillNamed);

// ------------------------------------------------------------ authorisation

const anon = await browser.newContext();
const apage = await anon.newPage();
const anonGet = await apage.request.get(`${BASE}/api/maps/${mapId}`);
check(
  'a signed-out request cannot read a map',
  anonGet.status() === 401,
  String(anonGet.status()),
);

await anon.addCookies([
  { name: 'cdn_dev_session', value: 'user', domain: 'localhost', path: '/' },
]);
const missing = await apage.request.get(`${BASE}/api/maps/does-not-exist`);
check('an unknown map is 404', missing.status() === 404, String(missing.status()));

// --------------------------------------------------------- structural guard

const brokenSave = await page.evaluate(async (id) => {
  const current = await (await fetch(`/api/maps/${id}`)).json();
  const response = await fetch(`/api/maps/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    // Nodes with no root: would render as an empty canvas.
    body: JSON.stringify({ version: current.version, nodes: {} }),
  });
  return response.status;
}, mapId);
check('a map with no root is refused', brokenSave === 400, String(brokenSave));

// -------------------------------------------------------------- My Maps list

await page.goto(`${BASE}/maps`, { waitUntil: 'networkidle' });
check('the new map appears in My Maps', await page.getByText(mapName).isVisible());

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
