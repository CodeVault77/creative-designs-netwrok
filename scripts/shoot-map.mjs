import { chromium } from 'playwright';

const out = process.argv[2] ?? 'map.png';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto('http://localhost:3000/map', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
