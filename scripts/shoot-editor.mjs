import { chromium } from 'playwright';

const dir = process.argv[2] ?? '.';
const browser = await chromium.launch();

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await desktop.addCookies([
  { name: 'cdn_dev_session', value: 'user', domain: 'localhost', path: '/' },
]);
const page = await desktop.newPage();

// Build a small map so the shot shows a real structure, not an empty canvas.
await page.goto('http://localhost:3000/maps/new', { waitUntil: 'networkidle' });
await page.getByLabel('Name').fill('Product research');
await page.getByRole('button', { name: 'Research' }).click();
await page.getByRole('button', { name: 'Create map' }).click();
await page.waitForURL(/\/maps\/m_/);
await page.waitForTimeout(2200);

await page.screenshot({ path: `${dir}/editor.png` });

// With the node editor open.
await page.evaluate(() => {
  const host = document.querySelector('[data-map-canvas]');
  const rect = host.getBoundingClientRect();
  const scale = Number(host.dataset.scale ?? '1');
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2 - 190 * scale;
  const send = (t) =>
    host.dispatchEvent(
      new PointerEvent(t, {
        pointerId: 7,
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
await page.waitForTimeout(900);
await page.screenshot({ path: `${dir}/node-editor.png` });

await browser.close();
console.log('wrote editor.png, node-editor.png');
