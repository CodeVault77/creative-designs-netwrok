import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

/**
 * P12 acceptance harness.
 *
 * §20 sets one criterion and rates the risk Low, with a note that matters:
 *   "Enquiry submitted end-to-end and reaches an inbox"
 *   "do this early if cash matters more than polish"
 *
 * The criterion says END-TO-END and INBOX, so the harness fills the real form
 * in a real browser and then opens the database to check the mail was queued
 * with the right content. Asserting the form said "thanks" would pass while
 * every enquiry went nowhere — which is the exact failure that costs money and
 * is invisible from the sender's side.
 */

const BASE = 'http://localhost:3000';
const SERVICE = 'build-with-us';
let failures = 0;

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
const MARKER = `PROJECT-${stamp}`;

function openDb() {
  return new Database(
    process.env.CDN_DATABASE_PATH ?? resolve(process.cwd(), '.data', 'cdn.sqlite'),
  );
}

// Rate limits are per client and persist; clear so the harness is repeatable.
try {
  const db = openDb();
  db.prepare('DELETE FROM enquiries').run();
  db.prepare('DELETE FROM outbox').run();
  db.close();
  console.log('(cleared previous enquiries so the limits start fresh)');
} catch (error) {
  console.log(`(could not clear enquiries: ${error.message})`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 950 },
});
const page = await context.newPage();

// ================================================================== the page

section('the service page');

await page.goto(`${BASE}/services/${SERVICE}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

check(
  'the service page renders',
  await page.getByRole('heading', { level: 1 }).isVisible(),
);

// It must be reachable WITHOUT an account — this page exists to be found.
check(
  'and is public — no sign-in wall in front of the money path',
  !page.url().includes('/sign-in'),
  page.url(),
);

check(
  'ServiceHero offers the primary action',
  await page.getByRole('link', { name: 'Start a project' }).isVisible(),
);
check(
  'CapabilityList is present',
  (await page.getByRole('heading', { name: 'What we do' }).count()) === 1,
);
check(
  'WorkGrid shows case studies',
  (await page.getByRole('heading', { name: 'Selected work' }).count()) === 1,
);

// §08 screen 17: "Pricing and checkout marked Soon; enquiry is live."
check(
  'pricing is honest, and checkout is marked Soon',
  await page.getByText(/Checkout soon/i).isVisible(),
);

// ============================================================ THE CRITERION

section('enquiry submitted end-to-end');

await page.getByRole('link', { name: 'Start a project' }).click();
await page.waitForTimeout(500);

await page.getByLabel('Your name').fill('Dana Okafor');
await page.getByLabel('Email', { exact: true }).fill(`dana-${stamp}@example.com`);
await page.getByLabel('Company').fill('Okafor Studio');
await page.getByLabel('Budget').selectOption('£10k – £25k');
await page
  .getByLabel('About the project')
  .fill(
    `We are rebuilding our booking flow and need help with the design system first. Reference ${MARKER}.`,
  );

// Long enough that the timing check does not read this as a script.
await page.waitForTimeout(3500);
await page.getByRole('button', { name: 'Send enquiry' }).click();
await page.waitForTimeout(1500);

check(
  'the form confirms it was received',
  await page.getByText(/that reached us/i).isVisible(),
);

const reference = await page
  .getByText(/^Reference enq_/)
  .innerText()
  .catch(() => '');
check(
  'and shows a reference the sender can quote',
  /enq_/.test(reference),
  reference,
);

// ---- the part that actually matters: it is stored, and it was posted.
const db = openDb();

const stored = db
  .prepare('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 1')
  .get();

check('THE ENQUIRY IS STORED', stored !== undefined);
check(
  'with everything the sender typed',
  stored?.name === 'Dana Okafor' &&
    stored?.company === 'Okafor Studio' &&
    stored?.budget === '£10k – £25k' &&
    stored?.message.includes(MARKER),
  stored ? `${stored.name} · ${stored.budget}` : 'missing',
);
check('and is filed as new, not spam', stored?.status === 'new', stored?.status);

const mail = db.prepare('SELECT * FROM outbox ORDER BY created_at').all();

check(
  'IT REACHED AN INBOX — mail is queued to the business',
  mail.some((m) => m.to_email.includes('creativedesignnetworks')),
  mail.map((m) => m.to_email).join(', ') || 'no mail',
);

const toBusiness = mail.find((m) => m.to_email.includes('creativedesignnetworks'));
check(
  'and the message carries what was written',
  Boolean(
    toBusiness?.body.includes(MARKER) && toBusiness?.body.includes('Dana Okafor'),
  ),
);
check(
  'and names the service, so a reply knows what it is about',
  Boolean(toBusiness?.subject.includes('Build With Us')),
  toBusiness?.subject,
);

/**
 * The sender gets an acknowledgement too. From their side, "did that go
 * anywhere?" is answered by an email or by nothing at all.
 */
check(
  'the sender is sent a copy',
  mail.some((m) => m.to_email === `dana-${stamp}@example.com`),
);

db.close();

// ============================================================ spam and abuse

section('spam protection');

/**
 * The honeypot, driven the way a bot would: fill the hidden field directly.
 * A person never sees it, so no real interaction can produce this.
 */
await page.goto(`${BASE}/services/${SERVICE}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

const spamResult = await page.evaluate(
  async ({ slug, marker }) => {
    const response = await fetch('/api/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceSlug: slug,
        name: 'Bot',
        email: 'bot@example.com',
        message: `cheap seo services and backlink packages ${marker}-SPAM`,
        website: 'http://spam.example',
        elapsedMs: 120,
      }),
    });
    return { status: response.status, body: await response.json() };
  },
  { slug: SERVICE, marker: MARKER },
);

/**
 * The SAME response as a real submission. Telling a bot which message tripped
 * the filter is how it learns to get past it; telling a misclassified person
 * their message looks like spam is worse than useless.
 */
check(
  'a spam submission gets the same answer as a real one',
  spamResult.status === 200 && spamResult.body.ok === true,
  `HTTP ${spamResult.status}`,
);

const db2 = openDb();
const spamRow = db2
  .prepare(
    `SELECT * FROM enquiries WHERE status = 'spam' ORDER BY created_at DESC LIMIT 1`,
  )
  .get();

check(
  'but it is FILED as spam, not delivered',
  spamRow !== undefined,
  spamRow?.spam_reason,
);
check(
  'and nothing was emailed about it',
  !db2
    .prepare('SELECT * FROM outbox')
    .all()
    .some((m) => m.body.includes(`${MARKER}-SPAM`)),
);

/**
 * Filed, never discarded. A false positive is a lost customer, and the only
 * way to find one is to be able to read what was filtered.
 */
check(
  'spam is still readable, so a false positive can be found',
  typeof spamRow?.message === 'string' && spamRow.message.includes('SPAM'),
);

db2.close();

// Rate limit.
const flood = [];
for (let i = 0; i < 5; i++) {
  flood.push(
    await page.evaluate(
      async ({ slug, n }) => {
        const response = await fetch('/api/enquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceSlug: slug,
            name: `Flood ${n}`,
            email: `flood${n}@example.com`,
            message:
              'This is a perfectly ordinary enquiry about a project we have.',
            elapsedMs: 20000,
          }),
        });
        return response.status;
      },
      { slug: SERVICE, n: i },
    ),
  );
}

check('a flood from one sender is stopped', flood.includes(400), flood.join(','));

// ------------------------------------------------------------ preserving input

section('failure preserves what was typed');

await page.goto(`${BASE}/services/${SERVICE}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

const TYPED = 'Six sentences I do not want to lose to a flaky connection.';
await page.getByLabel('Your name').fill('Rate Limited');
await page.getByLabel('Email', { exact: true }).fill('rate@example.com');
await page.getByLabel('About the project').fill(TYPED);
await page.waitForTimeout(3500);
await page.getByRole('button', { name: 'Send enquiry' }).click();
await page.waitForTimeout(1500);

// This sender is over the limit from the flood above, so submission fails.
/**
 * `.first()` matters: a rejected submit renders the form-level error AND the
 * field-level one, so an unqualified role lookup is a strict-mode violation
 * that a `.catch()` quietly turns into "no alert".
 */
const alert = page.getByRole('alert').first();
check(
  'a rejected submission says why',
  await alert.isVisible().catch(() => false),
  await alert.innerText().catch(() => '—'),
);

// §08 screen 17: "Form submit failure preserves entries."
check(
  'AND KEEPS EVERYTHING TYPED',
  (await page.getByLabel('About the project').inputValue()) === TYPED &&
    (await page.getByLabel('Your name').inputValue()) === 'Rate Limited',
);

// ============================================================== the inbox

section('the inbox is staff-only');

const inbox = await page.evaluate(async () => {
  const response = await fetch('/api/enquiries');
  return response.status;
});
check(
  "a visitor cannot read other people's enquiries",
  inbox === 404,
  `HTTP ${inbox} (404, not 403)`,
);

await browser.close();

console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
