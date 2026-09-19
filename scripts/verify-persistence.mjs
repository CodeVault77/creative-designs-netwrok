import { chromium } from 'playwright';

/**
 * Proves data survives a SERVER RESTART, not just a page reload.
 *
 * Run in two phases either side of restarting the server:
 *
 *   node scripts/verify-persistence.mjs create <stamp>
 *   # restart the server
 *   node scripts/verify-persistence.mjs check <stamp>
 *
 * This is the check the in-memory stores from P4 and P5 could not pass, and
 * the reason P6 exists. A single-run harness cannot catch it: everything looks
 * durable while the process that holds the data is still alive.
 */

const BASE = 'http://localhost:3000';
const [phase, stamp] = process.argv.slice(2);

if (!phase || !stamp) {
  console.error('usage: verify-persistence.mjs <create|check> <stamp>');
  process.exit(2);
}

const USER = {
  email: `persist-${stamp}@example.com`,
  password: 'a sufficiently long passphrase',
  name: `Persist ${stamp}`,
};
const MAP_NAME = `Persisted map ${stamp}`;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

let failed = false;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failed = true;
}

if (phase === 'create') {
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill(USER.name);
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/maps/, { timeout: 15000 });

  await page.goto(`${BASE}/maps/new`, { waitUntil: 'networkidle' });
  await page.getByLabel('Name').fill(MAP_NAME);
  await page.getByRole('button', { name: 'Create map' }).click();
  await page.waitForURL(/\/maps\/m_/, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const add = page.getByRole('button', { name: /Add a node/ });
  for (let i = 0; i < 3; i++) {
    await add.click();
    await page.waitForTimeout(180);
    await page.keyboard.type(`Durable ${i + 1}`);
  }
  await page.waitForTimeout(2000);

  check('created an account and a map', true, MAP_NAME);
} else {
  // A brand new browser: no cookies, no localStorage. Everything must come
  // from the server, which has been restarted since the data was written.
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  try {
    await page.waitForURL(/\/maps/, { timeout: 15000 });
    check('the ACCOUNT survived a server restart', true);
  } catch {
    check('the ACCOUNT survived a server restart', false, 'sign-in failed');
  }

  check(
    'the MAP survived a server restart',
    await page.getByText(MAP_NAME).isVisible(),
  );

  const nodes = await page.evaluate(async () => {
    const list = await (await fetch('/api/maps')).json();
    const map = list.owned[0];
    if (!map) return 0;
    const full = await (await fetch(`/api/maps/${map.id}`)).json();
    return Object.keys(full.nodes).length;
  });
  check('with all its NODES', nodes >= 4, `${nodes} nodes`);
}

await browser.close();
process.exit(failed ? 1 : 0);
