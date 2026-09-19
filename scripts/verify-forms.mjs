import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

/**
 * Milestone C acceptance harness — the forms.
 *
 * Covers AC-5 to AC-13. The checks that matter open the DATABASE rather than
 * trusting the screen: a form that says "thanks" while storing nothing is the
 * exact failure that costs money and is invisible from the sender's side.
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
  console.log(`\n— ${name} ${'-'.repeat(Math.max(0, 58 - name.length))}`);
}

const stamp = Date.now();
const MARKER = `MARKER${stamp}`;

const openDb = () =>
  new Database(
    process.env.CDN_DATABASE_PATH ?? resolve(process.cwd(), '.data', 'cdn.sqlite'),
  );

/**
 * Warm the server first.
 *
 * `getDb()` is lazy, so migrations do not run until something touches the
 * database. Clearing before that leaves the newest tables missing and the
 * whole run reports failures that are really "the schema has not been created
 * yet".
 */
await fetch(`${BASE}/api/health?ready=1`).catch(() => undefined);

// Rate limits persist, so clear them or the second run of this harness
// throttles itself and reports failures that are really the limit working.
try {
  const db = openDb();
  db.prepare('DELETE FROM enquiries').run();
  db.prepare('DELETE FROM newsletter_subscribers').run();
  db.prepare('DELETE FROM outbox').run();
  db.close();
  console.log('(cleared previous submissions so the limits start fresh)');
} catch (error) {
  console.log(`(could not clear: ${error.message})`);
}

const browser = await chromium.launch();

// ============================================================ the newsletter

section('AC-5 to AC-8 — newsletter');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const form = page.locator('#updates');
  await form.scrollIntoViewIfNeeded();

  // AC-8: blocked until consent is given.
  await form
    .getByRole('textbox', { name: 'Email' })
    .fill(`sub-${stamp}@example.com`);
  await page.waitForTimeout(3200); // clear the timing check
  await form.getByRole('button', { name: /Keep me posted/i }).click();
  await page.waitForTimeout(600);

  check(
    'AC-8: submission is blocked until consent is checked',
    await page.getByText(/agree to receive updates/i).isVisible(),
  );

  const beforeConsent = openDb();
  const noRow = beforeConsent
    .prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers')
    .get().n;
  beforeConsent.close();
  check('and nothing was stored', noRow === 0, `${noRow} rows`);

  // AC-5: a valid subscription.
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: /Keep me posted/i }).click();
  await page.waitForTimeout(1200);

  check(
    'AC-5: success is shown without a page navigation',
    await page.getByText(/on the list/i).isVisible(),
  );

  const db = openDb();
  const row = db
    .prepare('SELECT * FROM newsletter_subscribers WHERE email_lower = ?')
    .get(`sub-${stamp}@example.com`);
  check('AC-5: the row exists', row !== undefined);
  check('and consent is recorded with a timestamp', Boolean(row?.consent_at));
  check(
    'and an unsubscribe token is minted at subscribe time',
    typeof row?.unsub_token === 'string' && row.unsub_token.length > 20,
  );

  const welcome = db
    .prepare('SELECT * FROM outbox WHERE to_email = ?')
    .get(`sub-${stamp}@example.com`);
  check('a welcome email is queued', welcome !== undefined);
  check(
    'and it carries a working unsubscribe link',
    Boolean(welcome?.body.includes(row?.unsub_token)),
  );
  db.close();

  await context.close();
}

// AC-6: duplicates are a success, not an error.
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const again = await page.evaluate(async (email) => {
    const r = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, consent: true, elapsedMs: 20000 }),
    });
    return { status: r.status, body: await r.json() };
  }, `sub-${stamp}@example.com`);

  check(
    'AC-6: a duplicate returns success, not an error',
    again.status === 200 && again.body.ok === true,
    `HTTP ${again.status}`,
  );

  const db = openDb();
  const count = db
    .prepare(
      'SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE email_lower = ?',
    )
    .get(`sub-${stamp}@example.com`).n;
  db.close();
  check('and creates exactly one row', count === 1, `${count} rows`);

  // AC-7: invalid address.
  const invalid = await page.evaluate(async () => {
    const r = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        consent: true,
        elapsedMs: 20000,
      }),
    });
    return { status: r.status, body: await r.json() };
  });
  check(
    'AC-7: an invalid address is rejected',
    invalid.status === 400,
    invalid.body.error,
  );

  // Case-insensitive dedupe: the same person, typed differently.
  const upper = await page.evaluate(async (email) => {
    const r = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, consent: true, elapsedMs: 20000 }),
    });
    return r.status;
  }, `SUB-${stamp}@EXAMPLE.COM`);
  const db2 = openDb();
  const total = db2
    .prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers')
    .get().n;
  db2.close();
  check(
    'a differently-cased address is the same person',
    upper === 200 && total === 1,
    `${total} rows`,
  );

  await context.close();
}

// ======================================================= the service request

section('AC-9 to AC-11 — service request');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/request`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  /*
   * Scoped to the form. The footer's nav groups carry aria-labels ("Company",
   * "Contact") that collide with field labels, and an unscoped getByLabel is a
   * strict-mode violation rather than a wrong answer — which is the good kind
   * of failure, but still a failure.
   */
  const form = page.locator('form');

  // AC-10: required-field validation names the field.
  await page.getByRole('button', { name: /Send request/i }).click();
  await page.waitForTimeout(500);

  check(
    'AC-10: submitting empty shows a specific error',
    await page.getByRole('alert').first().isVisible(),
  );
  check(
    'and names what is missing',
    (await page.getByText(/Tell us your name/i).count()) > 0,
  );
  check(
    'and the description minimum is enforced',
    (await page.getByText(/sentence or two/i).count()) > 0,
  );

  const dbEmpty = openDb();
  const none = dbEmpty.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n;
  dbEmpty.close();
  check('and nothing was stored', none === 0, `${none} rows`);

  // AC-9: a valid submission.
  await form.getByLabel(/Your name/).fill('Dana Okafor');
  await form.getByLabel(/^Email/).fill(`dana-${stamp}@example.com`);
  await form.getByLabel(/Phone or WhatsApp/).fill('+1 555 0100');
  await form.getByLabel(/Company/).fill('Okafor Studio');
  await form.getByLabel(/What do you need/).selectOption('ui-ux-design');
  await form.getByLabel(/Project type/).selectOption('new-build');
  await form
    .getByLabel(/About the project/)
    .fill(`We are rebuilding our booking flow and need design help. ${MARKER}`);
  await form.getByLabel(/^Budget/).selectOption('15k-50k');
  await form.getByLabel(/Timeline/).selectOption('1-3-months');
  await form.getByLabel(/How did you hear/).selectOption('referral');
  await form.getByRole('checkbox').check();

  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: /Send request/i }).click();
  await page.waitForURL(/\/request\/success/, { timeout: 15000 });

  check(
    'AC-9: a valid submission reaches the success page',
    page.url().includes('/request/success'),
  );

  const ref = await page.locator('code').first().textContent();
  check('and shows a reference', /^enq_/.test(ref ?? ''), ref ?? 'none');

  const db = openDb();
  const row = db
    .prepare('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 1')
    .get();

  check('THE ROW IS STORED', row !== undefined);
  check(
    'the reference matches the stored row',
    row?.id === ref,
    `${row?.id} vs ${ref}`,
  );
  check(
    'with every field the form collected',
    row?.name === 'Dana Okafor' &&
      row?.company === 'Okafor Studio' &&
      row?.service_slug === 'ui-ux-design' &&
      row?.budget === '15k-50k' &&
      row?.timeline === '1-3-months' &&
      row?.project_type === 'new-build' &&
      row?.heard_from === 'referral' &&
      row?.phone.includes('555') &&
      row?.message.includes(MARKER),
    `${row?.service_slug} · ${row?.budget} · ${row?.timeline}`,
  );
  check('and consent recorded as a timestamp', Boolean(row?.consent_at));
  check('filed as new, not spam', row?.status === 'new', row?.status);

  const sender = db
    .prepare('SELECT * FROM outbox WHERE to_email = ?')
    .get(`dana-${stamp}@example.com`);
  check('the sender gets an acknowledgement', sender !== undefined);
  check('containing what they wrote', Boolean(sender?.body.includes(MARKER)));
  db.close();

  await context.close();
}

// ============================================== AC-11 preserve input, AC-13 limits

section('AC-11 / AC-13 — failure preserves input');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  });
  const page = await context.newPage();

  // Exhaust the hourly limit from this client so the next submit genuinely
  // fails on the server rather than being simulated.
  await page.goto(`${BASE}/request`, { waitUntil: 'domcontentloaded' });
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    statuses.push(
      await page.evaluate(async (n) => {
        const r = await fetch('/api/service-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Flood ${n}`,
            email: `flood${n}@example.com`,
            serviceSlug: 'not-sure',
            message:
              'A perfectly ordinary enquiry about a project we have in mind.',
            consent: true,
            elapsedMs: 30000,
          }),
        });
        return r.status;
      }, i),
    );
  }
  check(
    'AC-13: a flood from one sender is refused',
    statuses.includes(400),
    statuses.join(','),
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const form2 = page.locator('form');
  const TYPED =
    'Six sentences I do not want to lose to a rate limit or a flaky link.';
  await form2.getByLabel(/Your name/).fill('Rate Limited');
  await form2.getByLabel(/^Email/).fill('rate@example.com');
  await form2.getByLabel(/Company/).fill('Persistent Ltd');
  await form2.getByLabel(/What do you need/).selectOption('full-stack-web');
  await form2.getByLabel(/About the project/).fill(TYPED);
  await form2.getByLabel(/^Budget/).selectOption('5k-15k');
  await form2.getByRole('checkbox').check();

  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: /Send request/i }).click();
  await page.waitForTimeout(1500);

  check(
    'a rejected submission says why',
    await page.getByRole('alert').first().isVisible(),
    (await page.getByRole('alert').first().textContent()) ?? '',
  );

  check('and stays on the form', !page.url().includes('success'), page.url());

  // AC-11 — the whole point.
  check(
    'AC-11: EVERY typed value survives the failure',
    (await form2.getByLabel(/About the project/).inputValue()) === TYPED &&
      (await form2.getByLabel(/Your name/).inputValue()) === 'Rate Limited' &&
      (await form2.getByLabel(/Company/).inputValue()) === 'Persistent Ltd' &&
      (await form2.getByLabel(/What do you need/).inputValue()) ===
        'full-stack-web' &&
      (await form2.getByLabel(/^Budget/).inputValue()) === '5k-15k' &&
      (await form2.getByRole('checkbox').isChecked()),
  );

  await context.close();
}

// ==================================================================== spam

section('AC-12 — spam is filed, not delivered');

{
  /**
   * A distinct user agent, so this counts as a different client.
   *
   * Rate limits are keyed on a hash of address plus agent, and on localhost
   * every context shares an address — so without this the spam submission is
   * refused by the flood limit above and the test measures nothing. An
   * earlier run reported HTTP 400 here for exactly that reason.
   */
  const context = await browser.newContext({
    userAgent: `CDNFormsHarness/${stamp} (spam probe)`,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async (marker) => {
    const r = await fetch('/api/service-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bot',
        email: 'bot@example.com',
        serviceSlug: 'not-sure',
        message: `cheap seo services and backlink packages ${marker}SPAM`,
        consent: true,
        website: 'http://spam.example',
        elapsedMs: 120,
      }),
    });
    return { status: r.status, body: await r.json() };
  }, MARKER);

  check(
    'AC-12: spam gets the SAME response as a real submission',
    result.status === 200 && result.body.ok === true,
    `HTTP ${result.status}`,
  );

  const db = openDb();
  const spam = db
    .prepare(
      `SELECT * FROM enquiries WHERE status = 'spam' ORDER BY created_at DESC LIMIT 1`,
    )
    .get();
  check('but it is filed as spam', spam !== undefined, spam?.spam_reason);
  check(
    'and remains readable, so a false positive can be found',
    Boolean(spam?.message),
  );
  check(
    'and nothing was emailed about it',
    !db
      .prepare('SELECT * FROM outbox')
      .all()
      .some((m) => m.body.includes(`${MARKER}SPAM`)),
  );
  db.close();

  await context.close();
}

// ============================================================ accessibility

section('AC-14 — the forms are accessible');

{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/request`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  const labelled = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll('input, select, textarea'),
    ].filter((el) => el.type !== 'hidden' && el.tabIndex !== -1);
    return controls.map((el) => {
      const id = el.id;
      const hasLabel = id
        ? Boolean(document.querySelector(`label[for="${id}"]`))
        : false;
      const wrapped = Boolean(el.closest('label'));
      return {
        name: el.name || el.type,
        ok: hasLabel || wrapped || Boolean(el.getAttribute('aria-label')),
      };
    });
  });

  const unlabelled = labelled.filter((c) => !c.ok);
  check(
    'every visible control has a real label',
    unlabelled.length === 0,
    unlabelled.map((c) => c.name).join(', ') || `${labelled.length} controls`,
  );

  // Errors must be associated, not merely adjacent.
  await page.getByRole('button', { name: /Send request/i }).click();
  await page.waitForTimeout(600);

  const described = await page.evaluate(() => {
    const invalid = [...document.querySelectorAll('[aria-invalid="true"]')];
    return invalid.map((el) => {
      const id = el.getAttribute('aria-describedby');
      return Boolean(id && document.getElementById(id));
    });
  });
  check(
    'each invalid field points at its message via aria-describedby',
    described.length > 0 && described.every(Boolean),
    `${described.length} invalid fields`,
  );

  await context.close();
}

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
