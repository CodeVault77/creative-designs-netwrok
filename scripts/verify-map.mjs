import { chromium } from 'playwright';

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

// ---------------------------------------------------------------- phone
const phone = await browser.newContext({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await phone.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${BASE}/map`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// --- canvas exists and has actually painted -------------------------------
const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('[data-map-canvas] canvas');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let lit = 0;
  // Sample every 400th pixel; count anything meaningfully brighter than black.
  for (let i = 0; i < data.length; i += 1600) {
    if (data[i] + data[i + 1] + data[i + 2] > 40) lit++;
  }
  return { w: c.width, h: c.height, lit, sampled: Math.floor(data.length / 1600) };
});

check('canvas element present', canvasInfo !== null);
check(
  'canvas backed at DPR 3',
  canvasInfo && canvasInfo.w === 390 * 3,
  canvasInfo ? `${canvasInfo.w}x${canvasInfo.h}` : '',
);
check(
  'canvas has painted non-black pixels',
  canvasInfo && canvasInfo.lit > 20,
  canvasInfo ? `${canvasInfo.lit} lit / ${canvasInfo.sampled} sampled` : '',
);

// --- chrome present --------------------------------------------------------
check(
  'breadcrumb rendered',
  await page.locator('nav[aria-label="Map location"]').isVisible(),
);
check(
  'view toggle rendered',
  await page.locator('div[role="group"][aria-label="View"]').isVisible(),
);
check(
  'layer stepper rendered',
  await page.locator('div[role="group"][aria-label="Map layer"]').isVisible(),
);
check('zoom in control', await page.getByLabel('Zoom in').isVisible());
check('recentre control', await page.getByLabel('Recentre the map').isVisible());
check(
  'tab bar on phone',
  await page.locator('nav[aria-label="Primary"]').isVisible(),
);

// --- frame rate under sustained panning -----------------------------------
const fps = await page.evaluate(async () => {
  const host = document.querySelector('[data-map-canvas]');
  const rect = host.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  let frames = 0;
  let running = true;
  const count = () => {
    frames++;
    if (running) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);

  const send = (type, x, y) =>
    host.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        pointerType: 'touch',
        isPrimary: true,
      }),
    );

  const start = performance.now();
  send('pointerdown', cx, cy);
  for (let i = 0; i < 90; i++) {
    send('pointermove', cx + Math.sin(i / 8) * 120, cy + Math.cos(i / 8) * 120);
    await new Promise((r) => requestAnimationFrame(r));
  }
  send('pointerup', cx, cy);
  const elapsed = performance.now() - start;
  running = false;

  return Math.round((frames / elapsed) * 1000);
});

check('sustained pan frame rate >= 55fps', fps >= 55, `${fps} fps`);

// --- tapping a node selects it (and does NOT navigate) ---------------------
const urlBefore = page.url();
await page.evaluate(() => {
  const host = document.querySelector('[data-map-canvas]');
  const rect = host.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  // Slot 0 (Mind Mapping) sits at twelve o'clock, radius 148 at scale 1.
  const cy = rect.top + rect.height / 2 - 148;
  const send = (type) =>
    host.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 5,
        clientX: cx,
        clientY: cy,
        bubbles: true,
        pointerType: 'touch',
        isPrimary: true,
      }),
    );
  send('pointerdown');
  send('pointerup');
});
await page.waitForTimeout(300);
check('single tap does not navigate away', page.url() === urlBefore, page.url());

// --- tree view -------------------------------------------------------------
await page.goto(`${BASE}/map/tree`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const treeItems = await page.locator('[role="treeitem"]').count();
check('tree renders rows', treeItems >= 13, `${treeItems} rows`);

const ringOneTitles = await page
  .locator('[role="treeitem"][aria-level="2"]')
  .allInnerTexts();
check(
  'tree shows all 12 ring-one nodes',
  ringOneTitles.length === 12,
  `${ringOneTitles.length}`,
);

const soonBadges = await page.locator('[role="treeitem"]:has-text("Soon")').count();
check('tree marks Coming Soon nodes', soonBadges === 7, `${soonBadges} badged`);

// --- keyboard operation of the tree ---------------------------------------
await page.locator('[role="treeitem"]').first().focus();
await page.keyboard.press('ArrowDown');
const focusedLevel = await page.evaluate(() =>
  document.activeElement?.getAttribute('aria-level'),
);
check(
  'ArrowDown moves between tree rows',
  focusedLevel === '2',
  `level ${focusedLevel}`,
);

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const expandedAfter = await page
  .locator('[role="treeitem"][aria-expanded="true"]')
  .count();
check(
  'ArrowRight expands a branch',
  expandedAfter >= 1,
  `${expandedAfter} expanded`,
);

// ---------------------------------------------------------------- desktop
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const dpage = await desktop.newPage();
await dpage.goto(`${BASE}/map`, { waitUntil: 'networkidle' });
await dpage.waitForTimeout(900);

const railVisible = await dpage
  .locator('nav[aria-label="Primary"]')
  .first()
  .isVisible();
check('desktop shows the nav rail', railVisible);

const desktopCanvas = await dpage.evaluate(() => {
  const c = document.querySelector('[data-map-canvas] canvas');
  return c ? { w: c.width, h: c.height } : null;
});
check(
  'desktop canvas sized',
  desktopCanvas && desktopCanvas.w > 1000,
  desktopCanvas ? `${desktopCanvas.w}px` : '',
);

// --- no runtime errors anywhere -------------------------------------------
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

console.log('');
console.log(
  failures === 0 ? `RESULT: all checks passed` : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
