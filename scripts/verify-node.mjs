import { chromium } from 'playwright';

/**
 * P4 acceptance harness.
 *
 * Two criteria from §20:
 *   "3-tap path to a live destination"
 *   "every dark node captures interest"
 *
 * Both are checked here against a running server, by driving the real UI
 * rather than by calling the functions underneath it. A unit test can prove
 * `getNodeDetail` returns an href; only this can prove a person can reach the
 * destination in three taps.
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

/** Taps a node on the canvas by its world position at the fitted camera. */
async function tapRingNode(page, slot, siblings = 12) {
  await page.evaluate(
    ({ slot, siblings }) => {
      const host = document.querySelector('[data-map-canvas]');
      const rect = host.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Mirrors src/lib/map/geometry.ts: R0 = 148 on mobile, slot 0 at -90deg.
      const scale = Number(host.dataset.scale ?? '1');
      const theta = -Math.PI / 2 + slot * ((Math.PI * 2) / siblings);
      const r = 148 * scale;

      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;

      const send = (type) =>
        host.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 21,
            clientX: x,
            clientY: y,
            bubbles: true,
            pointerType: 'touch',
            isPrimary: true,
          }),
        );
      send('pointerdown');
      send('pointerup');
    },
    { slot, siblings },
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

// ------------------------------------------------------------ node detail API

const detailResponse = await page.request.get(`${BASE}/api/nodes/mind-mapping`);
check(
  'node detail API responds',
  detailResponse.ok(),
  String(detailResponse.status()),
);
const detail = await detailResponse.json();
check(
  'detail carries a trail',
  Array.isArray(detail.trail) && detail.trail.length >= 2,
);
check(
  'detail carries an absolute share URL',
  String(detail.shareUrl).startsWith('http'),
);
check('live node has an href', Boolean(detail.href));

const soonResponse = await page.request.get(`${BASE}/api/nodes/ai-tools`);
const soon = await soonResponse.json();
check(
  'Coming Soon node has a target window',
  Boolean(soon.targetWindow),
  soon.targetWindow,
);
check('Coming Soon node has NO href', soon.href === undefined);
check(
  'Coming Soon node offers related live nodes',
  (soon.relatedLive ?? []).length > 0,
);

const missing = await page.request.get(`${BASE}/api/nodes/does-not-exist`);
check(
  'unknown node returns 404',
  missing.status() === 404,
  String(missing.status()),
);

// ------------------------------------------------------- 3 taps to a destination

await page.goto(`${BASE}/map`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);

// Tap 1 was arriving on the map. Tap 2 selects a node.
//
// Slot 8 is Page Watcher — a PUBLIC live destination. §24 measures arrival for
// NEW visitors, who are signed out by definition, so the criterion has to be
// tested against a destination that does not require an account.
//
// Slot 0 (Mind Mapping) points at /maps, which bounces a signed-out visitor to
// /sign-in. That is a real problem for the arrival metric and is recorded in
// docs/09-node-interaction.md — it is not something to paper over by testing
// the happy path while signed in.
await tapRingNode(page, 8);
await page.waitForTimeout(700);

const sheetVisible = await page.locator('[role="dialog"]').isVisible();
check('tap 2 opens the detail sheet', sheetVisible);

const sheetTitle = await page.locator('[role="dialog"] h2').first().innerText();
check(
  'sheet shows the tapped node',
  sheetTitle.includes('Page Watcher'),
  sheetTitle,
);

const urlAfterSelect = new URL(page.url());
check(
  'selection is mirrored into ?node=',
  urlAfterSelect.searchParams.get('node') === 'page-watcher',
  page.url(),
);

// Tap 3 opens the destination.
const openButton = page
  .locator('[role="dialog"]')
  .getByRole('button', { name: 'Open' });
check('sheet offers an Open action', await openButton.isVisible());
await openButton.click();
await page.waitForTimeout(900);

check(
  '3 taps reach a live PUBLIC destination',
  page.url().includes('/watch') && !page.url().includes('sign-in'),
  page.url(),
);

// The signed-out gap, asserted rather than left as prose.
const mapsGuard = await page.request.get(`${BASE}/maps`, { maxRedirects: 0 });
check(
  'KNOWN GAP: /maps redirects signed-out visitors to sign-in',
  mapsGuard.status() === 307,
  `${mapsGuard.status()} -> ${mapsGuard.headers()['location'] ?? ''}`,
);

// ------------------------------------------------------------ Coming Soon

await page.goto(`${BASE}/map`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Slot 2 is AI Tools — a dark node.
await tapRingNode(page, 2);
await page.waitForTimeout(700);

const soonBadge = await page
  .locator('[role="dialog"]')
  .getByText('SOON', { exact: true })
  .isVisible();
check('dark node opens in soon mode', soonBadge);

const noOpen = await page
  .locator('[role="dialog"]')
  .getByRole('button', { name: 'Open' })
  .count();
check('Coming Soon offers no Open action', noOpen === 0);

const notifyVisible = await page
  .locator('[role="dialog"]')
  .getByRole('button', { name: 'Notify me' })
  .isVisible();
check('Coming Soon offers interest capture', notifyVisible);

// ------------------------------------------ every dark node captures interest

const DARK = [
  'ai-tools',
  'commerce',
  'tasks-projects',
  'freelance',
  'ideas-innovation',
  'people-networks',
  'partners',
];

let captured = 0;
for (const nodeId of DARK) {
  const response = await page.request.post(`${BASE}/api/interest`, {
    data: { nodeId },
  });
  const body = await response.json();
  if (response.ok() && body.count >= 1) captured++;
}
check(
  'every dark node captures interest',
  captured === DARK.length,
  `${captured}/${DARK.length}`,
);

// Dedupe: a second registration from the same visitor must not inflate.
const first = await page.request.post(`${BASE}/api/interest`, {
  data: { nodeId: 'ai-tools' },
});
const firstBody = await first.json();
const second = await page.request.post(`${BASE}/api/interest`, {
  data: { nodeId: 'ai-tools' },
});
const secondBody = await second.json();
check(
  'interest is deduped per person per node',
  secondBody.created === false && secondBody.count === firstBody.count,
  `count ${firstBody.count} -> ${secondBody.count}`,
);

// A live node must not accept interest, or the counter is meaningless.
const liveInterest = await page.request.post(`${BASE}/api/interest`, {
  data: { nodeId: 'mind-mapping' },
});
check(
  'live nodes reject interest',
  liveInterest.status() === 409,
  String(liveInterest.status()),
);

const bogusInterest = await page.request.post(`${BASE}/api/interest`, {
  data: { nodeId: 'not-a-real-node' },
});
check(
  'unknown nodes reject interest',
  bogusInterest.status() === 404,
  String(bogusInterest.status()),
);

// ------------------------------------------------------ Coming Soon page + /n/

const soonPage = await page.goto(`${BASE}/soon/ai-tools`, {
  waitUntil: 'networkidle',
});
check('Coming Soon page renders', soonPage.status() === 200);
check(
  'Coming Soon page is server-rendered with its window',
  (await page.content()).includes('Q1 2027'),
);

const liveSoon = await page.request.get(`${BASE}/soon/mind-mapping`, {
  maxRedirects: 0,
});
check(
  'no Coming Soon page for a live node',
  liveSoon.status() === 404,
  String(liveSoon.status()),
);

const shareLive = await page.request.get(`${BASE}/n/mind-mapping`, {
  maxRedirects: 0,
});
check(
  'share link for a live node goes to the map',
  shareLive.status() === 307 &&
    shareLive.headers()['location']?.includes('/map?node='),
  shareLive.headers()['location'],
);

const shareSoon = await page.request.get(`${BASE}/n/ai-tools`, { maxRedirects: 0 });
check(
  'share link for a dark node goes to its Coming Soon page',
  shareSoon.status() === 307 && shareSoon.headers()['location']?.includes('/soon/'),
  shareSoon.headers()['location'],
);

// ------------------------------------------------------------------ desktop

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const dpage = await desktop.newPage();
await dpage.goto(`${BASE}/map?node=mind-mapping`, { waitUntil: 'networkidle' });
await dpage.waitForTimeout(1200);

const inspector = dpage.locator('aside[aria-label="Mind Mapping"]');
check('desktop uses the inspector, not a sheet', await inspector.isVisible());
check(
  'desktop has no modal dialog',
  (await dpage.locator('[role="dialog"]').count()) === 0,
);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
