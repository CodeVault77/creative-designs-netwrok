import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';

/**
 * Milestone B acceptance harness — the landing page.
 *
 * Checks the roadmap's stated criteria rather than "does it render":
 *
 *   AC-1  the above-the-fold contract on a 375×667 phone
 *   AC-14 axe at WCAG 2.2 AA, 0 serious or critical
 *   AC-15 reduced motion removes every animation
 *   AC-16 one h1, title, description, canonical, OG
 *   AC-19 no sentence claims the platform is available
 *   §13   no horizontal scroll at any supported width
 *
 * It also writes screenshots, because the thing that repeatedly catches real
 * problems in this project is looking at the page rather than asserting on it.
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const BASE = 'http://localhost:3000';
const SHOTS = 'scripts/__screenshots__';
let failures = 0;

function check(label, ok, detail = '') {
  if (ok) console.log(`ok   ${label}${detail ? '  ' + detail : ''}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? '  ' + detail : ''}`);
  }
}

function section(name) {
  console.log(`\n— ${name} ${'-'.repeat(Math.max(0, 58 - name.length))}`);
}

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();

// ===================================================== above the fold (AC-1)

section('AC-1 — the above-the-fold contract on a phone');

{
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  /**
   * "Visible without scrolling" means inside the viewport box, which
   * `isVisible()` does NOT check — it only asks whether the element is
   * rendered. So each element's box is measured against the fold.
   */
  const aboveFold = async (locator) => {
    const box = await locator.first().boundingBox();
    return box !== null && box.y < 667;
  };

  check('the logo is above the fold', await aboveFold(page.locator('header svg')));
  check('the headline is above the fold', await aboveFold(page.locator('h1')));

  const status = page.getByText(/in development/i).first();
  check(
    'the pre-launch statement is above the fold',
    await aboveFold(status),
    (await status.textContent().catch(() => '')) ?? '',
  );

  const explains = page.getByText(/visual platform where ideas/i).first();
  check('the explaining sentence is above the fold', await aboveFold(explains));

  const cta = page.getByRole('link', { name: /Request a project/i }).first();
  check('at least one CTA is above the fold', await aboveFold(cta));

  await page.screenshot({ path: `${SHOTS}/landing-375.png` });
  await context.close();
}

// ============================================================ no horizontal scroll

section('§13 — responsive, 320 → 1920');

for (const width of [320, 375, 414, 768, 1024, 1440, 1920]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(
    `${width}px: no horizontal scroll`,
    overflow <= 0,
    `overflow ${overflow}px`,
  );

  if (width === 320 || width === 768 || width === 1440) {
    await page.screenshot({
      path: `${SHOTS}/landing-${width}.png`,
      fullPage: true,
    });
  }
  await context.close();
}

// ==================================================== every section rendered

section('§9.1 — the sections are present and in order');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('section[id]')].map((el) => el.id),
  );

  for (const id of ['what', 'how', 'services', 'who', 'vision', 'contact']) {
    check(`section #${id} renders`, order.includes(id), '');
  }

  /**
   * Services must come BEFORE vision. A visitor who can hire us should reach
   * the revenue path before the section about what does not exist yet.
   */
  check(
    'services appears before vision',
    order.indexOf('services') >= 0 &&
      order.indexOf('services') < order.indexOf('vision'),
    order.join(' → '),
  );

  check(
    'the service grid reads from config',
    (await page.locator('#services li').count()) >= 3,
    `${await page.locator('#services li').count()} cards`,
  );

  check(
    'the network diagram is present and labelled',
    await page
      .getByRole('img', { name: /central node with six nodes/i })
      .isVisible(),
  );

  await context.close();
}

// ==================================================== honesty (AC-19)

section('AC-19 — nothing claims the platform is available');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const text = (await page.locator('main').innerText()).toLowerCase();

  /**
   * Phrases that would assert availability. This is a smoke test, not a
   * substitute for the human review the roadmap requires — but it catches the
   * obvious regression where marketing copy drifts into the present tense.
   */
  const forbidden = [
    'sign up now',
    'try it now',
    'get started free',
    'available now',
    'start using',
    'log in to your map',
  ];
  const found = forbidden.filter((phrase) => text.includes(phrase));
  check(
    'no availability claim in the copy',
    found.length === 0,
    found.join(', ') || 'clean',
  );

  check(
    'the vision section is labelled as a vision',
    text.includes('vision') && text.includes('none of this is available yet'),
  );

  await context.close();
}

// ==================================================== accessibility (AC-14)

section('AC-14 — WCAG 2.2 AA');

for (const [label, width] of [
  ['mobile', 375],
  ['desktop', 1280],
]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.evaluate(AXE);
  const results = await page.evaluate(async () =>
    window.axe.run(
      { exclude: [] },
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
        resultTypes: ['violations'],
      },
    ),
  );

  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  check(
    `${label}: 0 serious or critical violations`,
    serious.length === 0,
    serious.map((v) => `${v.id} (${v.nodes.length}×)`).join(', ') || 'clean',
  );

  for (const violation of serious) {
    console.log(`       ${violation.id}: ${violation.help}`);
    for (const node of violation.nodes.slice(0, 3)) {
      console.log(`         ${node.html.slice(0, 110)}`);
    }
  }

  await context.close();
}

// ==================================================== reduced motion (AC-15)

section('AC-15 — reduced motion');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const animating = await page.evaluate(
    () =>
      [...document.querySelectorAll('*')].filter((el) => {
        const style = getComputedStyle(el);
        return style.animationName !== 'none' && style.animationDuration !== '0s';
      }).length,
  );

  check(
    'no element animates under prefers-reduced-motion',
    animating === 0,
    `${animating}`,
  );
  check(
    'and content is still visible',
    await page.getByRole('heading', { level: 1 }).isVisible(),
  );

  await context.close();
}

// ==================================================== SEO (AC-16)

section('AC-16 — metadata');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const meta = await page.evaluate(() => ({
    h1s: document.querySelectorAll('h1').length,
    title: document.title,
    description:
      document.querySelector('meta[name="description"]')?.getAttribute('content') ??
      '',
    canonical:
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    ogTitle:
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content') ?? '',
    ogImage:
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content') ?? '',
    lang: document.documentElement.lang,
    jsonLd: [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].map((el) => JSON.parse(el.textContent ?? '{}')),
  }));

  check('exactly one h1', meta.h1s === 1, `${meta.h1s}`);
  check(
    'title is set and under 60 chars',
    meta.title.length > 0 && meta.title.length <= 60,
    `${meta.title.length}: ${meta.title}`,
  );
  check(
    'description is 140–160 chars',
    meta.description.length >= 100 && meta.description.length <= 200,
    `${meta.description.length}`,
  );
  check('canonical is set', meta.canonical.length > 0, meta.canonical);
  check(
    'Open Graph title and image are set',
    Boolean(meta.ogTitle && meta.ogImage),
  );
  check('the document declares a language', meta.lang === 'en', meta.lang);

  const org = meta.jsonLd.find((item) => item['@type'] === 'Organization');
  check(
    'Organization structured data is present',
    Boolean(org),
    org?.name ?? 'missing',
  );
  check(
    'and no Product or Review markup for an unreleased product',
    !meta.jsonLd.some((item) =>
      ['Product', 'Review', 'AggregateRating'].includes(item['@type']),
    ),
  );

  await context.close();
}

// ==================================================== contact honesty

section('B5 — contact renders honestly while unconfigured');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const html = await page.locator('#contact').innerHTML();

  /**
   * OD-1 and OD-2 are unanswered, so no dead link may be rendered. A `wa.me/`
   * with no number opens WhatsApp on a blank chat and looks like it worked.
   */
  check('no wa.me link with an empty number', !/wa\.me\/["'?]/.test(html));
  check('no mailto with an empty address', !/mailto:["']/.test(html));
  check(
    'the unconfigured state says so',
    await page.getByText(/Direct contact coming soon/i).isVisible(),
  );

  await context.close();
}

// ============================================ the demonstration + console

/**
 * The interactive diagram in "What is CDN?", and the browser console.
 *
 * The console check is here because of what it found the first time it ran: a
 * hydration mismatch in the static diagram that had been shipping since
 * Milestone B. `Math.cos` disagrees with itself in the last bit between Node
 * and Chrome, so the server HTML and the first client render carried different
 * coordinates. Nothing looked wrong, every other assertion passed, and React
 * was throwing on every single page load. A page that logs errors is broken
 * whether or not it looks broken.
 */

section('the demonstration, and a clean console');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text().split('\n')[0]);
  });
  page.on('pageerror', (error) => problems.push(String(error).split('\n')[0]));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const nodes = page.locator('#what button[aria-expanded]');
  check(
    'every branch is a real button, not a div wearing a role',
    (await nodes.count()) === 6,
    `${await nodes.count()} branches`,
  );

  const first = nodes.first();
  check(
    'nothing is expanded to begin with',
    (await first.getAttribute('aria-expanded')) === 'false',
  );

  /** Keyboard, not just mouse: these are the semantics the pills exist for. */
  await first.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  check(
    'Enter expands a branch',
    (await first.getAttribute('aria-expanded')) === 'true',
  );

  const status = page.locator('#what [role="status"]');
  check(
    'and the change is announced, not only drawn',
    /expanded:/.test(await status.innerText()),
    (await status.innerText()).trim(),
  );

  /** Opening a second branch must close the first — one open at a time. */
  await nodes.nth(3).click();
  await page.waitForTimeout(400);
  check(
    'opening another branch closes the first',
    (await first.getAttribute('aria-expanded')) === 'false' &&
      (await nodes.nth(3).getAttribute('aria-expanded')) === 'true',
  );

  /**
   * Every node fill must be opaque. Edges are drawn from the centre to each
   * node's centre point, so a transparent pill has its own spoke printed
   * across its label — which is exactly what an undefined CSS variable caused
   * the first time this was built.
   */
  const seeThrough = await page.evaluate(() =>
    [...document.querySelectorAll('#what figure *')]
      // The pills, and only the pills: they are the absolutely positioned
      // elements carrying a label. The stage they sit on is `relative` and is
      // supposed to be transparent.
      .filter((el) => {
        const style = getComputedStyle(el);
        return (
          style.position === 'absolute' && (el.textContent ?? '').trim() !== ''
        );
      })
      .map(
        (el) => `${el.textContent.trim()}: ${getComputedStyle(el).backgroundColor}`,
      )
      .filter((entry) => /rgba\([^)]*,\s*0(\.\d+)?\)$/.test(entry)),
  );
  check(
    'no node is transparent enough to show the edges beneath it',
    seeThrough.length === 0,
    seeThrough.join(', ') || 'all opaque',
  );

  check(
    'the illustration does not pass itself off as the product',
    /illustration/i.test(await page.locator('#what figcaption').innerText()),
  );

  /**
   * The vision blueprint.
   *
   * Nothing in it may be interactive. The section says none of this exists,
   * and a diagram you can press reads as a working feature no matter what the
   * paragraph beside it says — so "is it clickable" is the check, not "does it
   * look dashed".
   */
  const sketch = page.locator('#vision figure');
  check('the vision has a blueprint beside the prose', await sketch.isVisible());
  check(
    'and nothing in it is interactive',
    (await sketch
      .locator('button, a, input, [role="button"], [tabindex]')
      .count()) === 0,
  );
  check(
    'every edge and node in it is drawn dashed',
    await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#vision figure svg line')];
      const pills = [...document.querySelectorAll('#vision figure span')];
      return (
        lines.length > 0 &&
        lines.every((el) => el.getAttribute('stroke-dasharray')) &&
        pills.length > 0 &&
        pills.every((el) => getComputedStyle(el).borderStyle === 'dashed')
      );
    }),
  );
  check(
    'and it says so in words as well',
    /sketched|not built|exists yet/i.test(
      await page.locator('#vision figcaption').innerText(),
    ),
  );

  check(
    'the browser console is clean',
    problems.length === 0,
    problems.slice(0, 3).join(' | ') || 'no errors',
  );

  await context.close();
}

// The expand animation must also be off under reduced motion, which only
// matters once something is actually expanded.
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.locator('#what button[aria-expanded]').first().click();
  await page.waitForTimeout(400);

  const animating = await page.evaluate(
    () =>
      [...document.querySelectorAll('#what *')].filter((el) => {
        const style = getComputedStyle(el);
        return style.animationName !== 'none' && style.animationDuration !== '0s';
      }).length,
  );
  check('AC-15: expanding animates nothing under reduced motion', animating === 0);

  await context.close();
}

await browser.close();

console.log('');
console.log(`Screenshots in ${SHOTS}/`);
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
