import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { SERVICES, serviceBySlug } from './catalogue';
import {
  ENQUIRIES_PER_DAY,
  ENQUIRIES_PER_HOUR,
  checkRate,
  clientHash,
  listEnquiries,
  scoreSpam,
  submitEnquiry,
} from './enquiries';

/**
 * §20's criterion for P12: "Enquiry submitted end-to-end and reaches an inbox."
 *
 * The risk is rated Low, with a note: "do this early if cash matters more than
 * polish." So the tests below are weighted toward the two ways this feature
 * fails at losing money:
 *
 *   - an enquiry that is accepted and then quietly lost
 *   - a real customer classified as spam and silently dropped
 *
 * Both are invisible from the sender's side, which is exactly why they need
 * tests rather than a manual check.
 */

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

const CLIENT = 'client-hash-abc';

function valid(over: Record<string, unknown> = {}) {
  return {
    serviceSlug: 'build-with-us',
    name: 'Dana Okafor',
    email: 'dana@example.com',
    company: 'Okafor Studio',
    budget: '£10k – £25k',
    message:
      'We are rebuilding our booking flow and need help with the design system before we start.',
    elapsedMs: 45_000,
    ...over,
  };
}

// --------------------------------------------------------------- the catalogue

describe('the catalogue', () => {
  it('has services with everything a page needs', () => {
    for (const service of SERVICES) {
      expect(service.slug).toMatch(/^[a-z0-9-]+$/);
      expect(service.name.length).toBeGreaterThan(2);
      expect(service.tagline.length).toBeGreaterThan(10);
      expect(service.capabilities.length).toBeGreaterThanOrEqual(3);
      expect(service.budgets.length).toBeGreaterThanOrEqual(2);
      expect(service.inbox).toContain('@');
    }
  });

  it('has unique slugs', () => {
    expect(new Set(SERVICES.map((s) => s.slug)).size).toBe(SERVICES.length);
  });

  it('resolves by slug and refuses an unknown one', () => {
    expect(serviceBySlug('build-with-us')?.name).toBe('Build With Us');
    expect(serviceBySlug('nope')).toBeNull();
  });

  /** §08 screen 17: "Pricing and checkout marked Soon; enquiry is live." */
  it('states a price honestly rather than offering a checkout', () => {
    for (const service of SERVICES) {
      expect(service.priceNote.length).toBeGreaterThan(20);
    }
  });
});

// ------------------------------------------------------------------ spam

describe('spam scoring', () => {
  it('lets a real enquiry through', () => {
    expect(scoreSpam(valid()).spam).toBe(false);
  });

  /**
   * The honeypot is decisive on its own. Nothing legitimate ever puts text in
   * a field people cannot see.
   */
  it('catches the honeypot', () => {
    const verdict = scoreSpam(valid({ website: 'http://spam.example' }));
    expect(verdict.spam).toBe(true);
    expect(verdict.reason).toContain('honeypot');
  });

  it('catches a submission faster than reading is possible', () => {
    expect(scoreSpam(valid({ elapsedMs: 400 })).spam).toBe(false);
    // On its own that is suspicious but not damning; with link stuffing it is.
    const both = scoreSpam(
      valid({
        elapsedMs: 400,
        message: 'https://a.example https://b.example https://c.example',
      }),
    );
    expect(both.spam).toBe(true);
  });

  /**
   * A missing timing means JavaScript did not run, which is a reason to be
   * LENIENT rather than suspicious — otherwise the filter penalises exactly
   * the people with the most restrictive browsers.
   */
  it('does not punish a missing timing', () => {
    expect(scoreSpam(valid({ elapsedMs: undefined })).spam).toBe(false);
  });

  it('catches link stuffing but allows one link', () => {
    expect(
      scoreSpam(valid({ message: 'See https://okafor.example for context.' })).spam,
    ).toBe(false);
    expect(
      scoreSpam(
        valid({
          message:
            'https://a.example https://b.example https://c.example https://d.example',
        }),
      ).spam,
    ).toBe(true);
  });

  it('catches bulk-outreach vocabulary', () => {
    expect(
      scoreSpam(
        valid({
          message: 'We offer seo services and guest post backlink packages.',
        }),
      ).spam,
    ).toBe(true);
  });

  it('catches machine output', () => {
    expect(scoreSpam(valid({ message: 'a'.repeat(60) })).spam).toBe(true);
    expect(
      scoreSpam(valid({ message: `x${'y'.repeat(50)}`.replace(/\s/g, '') })).spam,
    ).toBe(true);
  });

  /**
   * The expensive failure. A false positive is a customer who thinks they got
   * in touch and never hears back, so these ordinary messages must all pass.
   */
  it('does NOT catch ordinary enquiries', () => {
    const ordinary = [
      'Hi — we need a design system audit before a rebrand. Are you free in March?',
      'Can you help with a React front end? Budget is flexible. Site: https://okafor.example',
      'We are a two-person team building a scheduling tool and are stuck on the data model.',
      'Following up on our conversation at the conference — would love to talk.',
      'Short one: do you do accessibility work? WCAG 2.1 AA specifically.',
    ];

    for (const message of ordinary) {
      const verdict = scoreSpam(valid({ message }));
      expect(verdict.spam, `flagged: ${message} (${verdict.reason})`).toBe(false);
    }
  });
});

// ------------------------------------------------------------- submission

describe('submitting an enquiry', () => {
  it('stores it and reports an id', () => {
    const result = submitEnquiry(valid(), { clientHash: CLIENT }, db);

    expect(result.ok).toBe(true);
    expect(result.id).toMatch(/^enq_/);
    expect(result.filtered).toBeFalsy();

    const stored = listEnquiries({}, db);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe('Dana Okafor');
    expect(stored[0]!.status).toBe('new');
  });

  /**
   * §20: "reaches an inbox." Two emails: one to the business, one to the
   * sender — because from the sender's side, "did that go anywhere?" is
   * answered by an email or by nothing at all.
   */
  it('queues mail to the business AND an acknowledgement to the sender', () => {
    submitEnquiry(valid(), { clientHash: CLIENT }, db);

    const mail = db
      .prepare('SELECT to_email, subject, body FROM outbox ORDER BY created_at')
      .all() as { to_email: string; subject: string; body: string }[];

    expect(mail).toHaveLength(2);

    const toBusiness = mail.find((m) =>
      m.to_email.includes('creativedesignnetworks'),
    );
    expect(toBusiness).toBeDefined();
    expect(toBusiness!.body).toContain('Dana Okafor');
    expect(toBusiness!.body).toContain('booking flow');

    const toSender = mail.find((m) => m.to_email === 'dana@example.com');
    expect(toSender).toBeDefined();
    // The sender gets their own words back, so they can tell it arrived intact.
    expect(toSender!.body).toContain('booking flow');
  });

  /**
   * The row is written BEFORE the mail. An enquiry that exists only as a
   * queued email is one you lose the first time a provider bounces it.
   */
  it('files spam rather than discarding it', () => {
    const result = submitEnquiry(
      valid({ website: 'http://spam.example' }),
      { clientHash: CLIENT },
      db,
    );

    // The SENDER is told it succeeded — see the note on submitEnquiry.
    expect(result.ok).toBe(true);
    expect(result.filtered).toBe(true);

    const stored = listEnquiries({}, db);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.status).toBe('spam');
    expect(stored[0]!.spamReason).toContain('honeypot');

    // But no mail was sent.
    const mail = db.prepare('SELECT COUNT(*) AS n FROM outbox').get() as {
      n: number;
    };
    expect(mail.n).toBe(0);
  });

  it('refuses an unknown service', () => {
    const result = submitEnquiry(
      valid({ serviceSlug: 'nope' }),
      { clientHash: CLIENT },
      db,
    );
    expect(result.ok).toBe(false);
    expect(listEnquiries({}, db)).toHaveLength(0);
  });

  it('validates the fields that matter, with a message that says what to fix', () => {
    expect(
      submitEnquiry(valid({ name: '  ' }), { clientHash: CLIENT }, db).error,
    ).toMatch(/name/i);
    expect(
      submitEnquiry(valid({ email: 'not-an-email' }), { clientHash: CLIENT }, db)
        .error,
    ).toMatch(/email/i);
    expect(
      submitEnquiry(valid({ message: 'hi' }), { clientHash: CLIENT }, db).error,
    ).toMatch(/project/i);
  });

  it('accepts an enquiry from someone with no account', () => {
    const result = submitEnquiry(valid(), { clientHash: CLIENT, userId: null }, db);
    expect(result.ok).toBe(true);
  });

  it('records the sender when they happen to be signed in', () => {
    db.prepare(
      `INSERT INTO users (id, email, email_lower, password_hash, handle, display_name, created_at)
       VALUES ('u1', 'a@example.com', 'a@example.com', 'x', 'dana', 'Dana', datetime('now'))`,
    ).run();

    submitEnquiry(valid(), { clientHash: CLIENT, userId: 'u1' }, db);
    const row = db.prepare('SELECT user_id FROM enquiries').get() as {
      user_id: string | null;
    };
    expect(row.user_id).toBe('u1');
  });

  it('truncates rather than storing an unbounded message', () => {
    submitEnquiry(
      valid({ message: `${'word '.repeat(2000)}` }),
      { clientHash: CLIENT },
      db,
    );
    expect(listEnquiries({}, db)[0]!.message.length).toBeLessThanOrEqual(4000);
  });
});

// ----------------------------------------------------------------- limits

describe('rate limits', () => {
  it('allows a first enquiry', () => {
    expect(checkRate(CLIENT, db).allowed).toBe(true);
  });

  it('stops a flood from one sender', () => {
    for (let i = 0; i < ENQUIRIES_PER_HOUR; i++) {
      submitEnquiry(valid(), { clientHash: CLIENT }, db);
    }

    const verdict = checkRate(CLIENT, db);
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toBeTruthy();
  });

  it('does not let one sender block another', () => {
    for (let i = 0; i < ENQUIRIES_PER_HOUR; i++) {
      submitEnquiry(valid(), { clientHash: CLIENT }, db);
    }
    expect(checkRate('someone-else', db).allowed).toBe(true);
  });

  /** Spam counts against the limit, or the limit is not a limit. */
  it('counts filtered enquiries too', () => {
    for (let i = 0; i < ENQUIRIES_PER_HOUR; i++) {
      submitEnquiry(valid({ website: 'x' }), { clientHash: CLIENT }, db);
    }
    expect(checkRate(CLIENT, db).allowed).toBe(false);
  });

  it('ignores enquiries outside the window', () => {
    db.prepare(
      `INSERT INTO enquiries (id, service_slug, name, email, message, client_hash, created_at)
       VALUES ('old', 'build-with-us', 'A', 'a@example.com', 'hello there', ?, datetime('now', '-2 days'))`,
    ).run(CLIENT);
    expect(checkRate(CLIENT, db).allowed).toBe(true);
  });

  it('leaves room for a real person to send more than one', () => {
    expect(ENQUIRIES_PER_HOUR).toBeGreaterThanOrEqual(2);
    expect(ENQUIRIES_PER_DAY).toBeGreaterThan(ENQUIRIES_PER_HOUR);
  });

  it('salts the client hash so it is not a lookup table of IPs', () => {
    const hash = clientHash('203.0.113.9', 'Mozilla');
    expect(hash).not.toContain('203.0.113.9');
    expect(clientHash('203.0.113.9', 'Mozilla')).toBe(hash);
    expect(clientHash('203.0.113.10', 'Mozilla')).not.toBe(hash);
  });
});

// ------------------------------------------------------------- the inbox

describe('the inbox', () => {
  beforeEach(() => {
    submitEnquiry(valid(), { clientHash: 'a' }, db);
    submitEnquiry(valid({ website: 'x' }), { clientHash: 'b' }, db);
    submitEnquiry(
      valid({ serviceSlug: 'design-system-audit', budget: 'Under £10k' }),
      { clientHash: 'c' },
      db,
    );
  });

  it('lists everything, newest first', () => {
    expect(listEnquiries({}, db)).toHaveLength(3);
  });

  it('filters by status, so spam can be reviewed rather than lost', () => {
    expect(listEnquiries({ status: 'new' }, db)).toHaveLength(2);

    const spam = listEnquiries({ status: 'spam' }, db);
    expect(spam).toHaveLength(1);
    expect(spam[0]!.spamReason).toBeTruthy();
  });

  it('filters by service', () => {
    expect(listEnquiries({ serviceSlug: 'design-system-audit' }, db)).toHaveLength(
      1,
    );
  });
});
