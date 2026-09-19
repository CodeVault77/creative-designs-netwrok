import { chromium } from 'playwright';

const dir = process.argv[2] ?? '.';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();

async function tap(slot) {
  await page.evaluate((slot) => {
    const host = document.querySelector('[data-map-canvas]');
    const rect = host.getBoundingClientRect();
    const scale = Number(host.dataset.scale ?? '1');
    const theta = -Math.PI / 2 + slot * ((Math.PI * 2) / 12);
    const x = rect.left + rect.width / 2 + Math.cos(theta) * 148 * scale;
    const y = rect.top + rect.height / 2 + Math.sin(theta) * 148 * scale;
    const send = (t) =>
      host.dispatchEvent(
        new PointerEvent(t, {
          pointerId: 9,
          clientX: x,
          clientY: y,
          bubbles: true,
          pointerType: 'touch',
          isPrimary: true,
        }),
      );
    send('pointerdown');
    send('pointerup');
  }, slot);
}

await page.goto('http://localhost:3000/map', { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await tap(8);
await page.waitForTimeout(900);
await page.screenshot({ path: `${dir}/sheet.png` });

await page.goto('http://localhost:3000/soon/ai-tools', {
  waitUntil: 'networkidle',
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${dir}/soon.png`, fullPage: true });

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const dpage = await desktop.newPage();
await dpage.goto('http://localhost:3000/map?node=build-with-us', {
  waitUntil: 'networkidle',
});
await dpage.waitForTimeout(1300);
await dpage.screenshot({ path: `${dir}/inspector.png` });

await browser.close();
console.log('wrote sheet.png, soon.png, inspector.png');
