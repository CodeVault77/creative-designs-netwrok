import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import { submitEnquiry } from './enquiries';
import {
  getEntry,
  isClosed,
  listPipeline,
  overdue,
  summary,
  updateEntry,
} from './pipeline';

/**
 * Pipeline tests.
 *
 * Two failure modes are worth more than the rest of this file put together:
 *
 *   leaking   the pipeline holds other people's names, email addresses and
 *             what they said about their business. Every export is staff-only,
 *             so most of what follows is negative tests proving a signed-in
 *             non-staff user gets nothing rather than a filtered something.
 *
 *   lying     a stage that claims a quote was sent when no amount was ever
 *             recorded makes the summary wrong, and a wrong summary is worse
 *             than none because someone will act on it.
 */

let db: Database;
let staff: { userId: string; isStaff: true };
let outsider: { userId: string; isStaff: false };

function makeEnquiry(over: Record<string, unknown> = {}): string {
  const result = submitEnquiry(
    {
      serviceSlug: 'build-with-us',
      name: 'Dana Okafor',
      email: 'dana@example.com',
      company: 'Okafor Studio',
      budget: '£10k – £25k',
      message:
        'We are rebuilding our booking flow and need help with the design system.',
      elapsedMs: 45_000,
      ...over,
    } as Parameters<typeof submitEnquiry>[0],
    // A fresh client hash per call: the enquiry rate limiter is not what is
    // under test here, and reusing one would make the fourth fixture fail for
    // an unrelated reason.
    { clientHash: `client-${Math.random()}` },
    db,
  );

  if (!result.ok || !result.id) throw new Error(result.error ?? 'no id');
  return result.id;
}

beforeEach(() => {
  db = createTestDb();

  createUser(
    {
      id: 'u_staff',
      email: 'staff@example.com',
      passwordHash: 'x',
      handle: 'staffer',
      displayName: 'Staffer',
    },
    db,
  );

  createUser(
    {
      id: 'u_other',
      email: 'other@example.com',
      passwordHash: 'x',
      handle: 'other',
      displayName: 'Other',
    },
    db,
  );

  staff = { userId: 'u_staff', isStaff: true };
  outsider = { userId: 'u_other', isStaff: false };
});

// ------------------------------------------------------------------- exposure

describe('the pipeline is staff only', () => {
  it('gives a non-staff user nothing from any read', () => {
    const id = makeEnquiry();

    expect(listPipeline(outsider, {}, db)).toEqual([]);
    expect(getEntry(outsider, id, db)).toBeNull();
    expect(summary(outsider, db)).toEqual([]);
    expect(overdue(outsider, db)).toEqual([]);
  });

  it('refuses a write from a non-staff user and changes nothing', () => {
    const id = makeEnquiry();

    const result = updateEntry(outsider, id, { stage: 'won' }, db);

    expect(result.ok).toBe(false);
    expect(getEntry(staff, id, db)?.stage).toBe('lead');
  });

  it('says "Not found" rather than "not allowed"', () => {
    // The same answer a missing row gives, so the refusal does not confirm
    // that the enquiry exists.
    const id = makeEnquiry();

    expect(updateEntry(outsider, id, { stage: 'won' }, db).error).toBe('Not found');
    expect(updateEntry(outsider, 'enq_nope', { stage: 'won' }, db).error).toBe(
      'Not found',
    );
  });
});

// --------------------------------------------------------------------- stages

describe('stages', () => {
  it('starts a new enquiry as a lead', () => {
    const id = makeEnquiry();
    expect(getEntry(staff, id, db)?.stage).toBe('lead');
  });

  it('refuses a stage that is not one', () => {
    const id = makeEnquiry();

    const result = updateEntry(staff, id, { stage: 'negotiating' }, db);

    expect(result.ok).toBe(false);
    expect(getEntry(staff, id, db)?.stage).toBe('lead');
  });

  it('lets a deal move backwards', () => {
    // Deals stall and restart. A forward-only machine would make people lie
    // to it, and a pipeline nobody trusts is worse than a list.
    const id = makeEnquiry();

    updateEntry(staff, id, { stage: 'qualified' }, db);
    const back = updateEntry(staff, id, { stage: 'contacted' }, db);

    expect(back.ok).toBe(true);
    expect(back.entry?.stage).toBe('contacted');
  });

  it('drops closed deals out of the working list', () => {
    const open = makeEnquiry();
    const done = makeEnquiry({ email: 'won@example.com' });

    updateEntry(staff, done, { stage: 'won' }, db);

    const working = listPipeline(staff, {}, db).map((entry) => entry.id);

    expect(working).toContain(open);
    expect(working).not.toContain(done);
  });

  it('shows closed deals when asked for them', () => {
    const done = makeEnquiry();
    updateEntry(staff, done, { stage: 'lost' }, db);

    const all = listPipeline(staff, { includeClosed: true }, db).map((e) => e.id);

    expect(all).toContain(done);
  });

  it('knows which stages are closed', () => {
    expect(isClosed('won')).toBe(true);
    expect(isClosed('lost')).toBe(true);
    expect(isClosed('quoted')).toBe(false);
  });
});

// ---------------------------------------------------------------------- money

describe('quotes', () => {
  it('refuses to move to quoted with no amount', () => {
    // The stage IS the claim that a number was sent.
    const id = makeEnquiry();

    const result = updateEntry(staff, id, { stage: 'quoted' }, db);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/amount/i);
    expect(getEntry(staff, id, db)?.stage).toBe('lead');
  });

  it('accepts quoted when the amount comes with it', () => {
    const id = makeEnquiry();

    const result = updateEntry(
      staff,
      id,
      { stage: 'quoted', quotedCents: 1_250_000 },
      db,
    );

    expect(result.ok).toBe(true);
    expect(result.entry?.quotedCents).toBe(1_250_000);
  });

  it('refuses to clear the quote off a deal that is still at quoted', () => {
    // Otherwise the stage outlives the number it is asserting.
    const id = makeEnquiry();
    updateEntry(staff, id, { stage: 'quoted', quotedCents: 500_000 }, db);

    const cleared = updateEntry(staff, id, { quotedCents: null }, db);

    expect(cleared.ok).toBe(false);
    expect(getEntry(staff, id, db)?.quotedCents).toBe(500_000);
  });

  it('lets the quote be cleared once the deal has moved on', () => {
    const id = makeEnquiry();
    updateEntry(staff, id, { stage: 'quoted', quotedCents: 500_000 }, db);

    const result = updateEntry(staff, id, { stage: 'lost', quotedCents: null }, db);

    expect(result.ok).toBe(true);
    expect(result.entry?.quotedCents).toBeNull();
  });

  it('keeps amounts as whole cents', () => {
    const id = makeEnquiry();

    const result = updateEntry(
      staff,
      id,
      { stage: 'quoted', quotedCents: 1234.7 },
      db,
    );

    expect(result.entry?.quotedCents).toBe(1235);
  });

  it('sums only what was actually quoted', () => {
    const a = makeEnquiry();
    const b = makeEnquiry({ email: 'b@example.com' });
    const c = makeEnquiry({ email: 'c@example.com' });

    updateEntry(staff, a, { stage: 'quoted', quotedCents: 100_000 }, db);
    updateEntry(staff, b, { stage: 'quoted', quotedCents: 250_000 }, db);
    // c has a budget string and no quote. It must contribute nothing — a
    // range someone typed into a form is not a forecast.
    void c;

    const quoted = summary(staff, db).find((row) => row.stage === 'quoted');

    expect(quoted?.count).toBe(2);
    expect(quoted?.quotedCents).toBe(350_000);
  });

  it('reports every stage, including the empty ones', () => {
    makeEnquiry();

    const stages = summary(staff, db).map((row) => row.stage);

    expect(stages).toEqual([
      'lead',
      'contacted',
      'qualified',
      'quoted',
      'won',
      'lost',
    ]);
  });
});

// ------------------------------------------------------------------ ownership

describe('assignment', () => {
  it('assigns and resolves the handle', () => {
    const id = makeEnquiry();

    const result = updateEntry(staff, id, { ownerId: 'u_staff' }, db);

    expect(result.entry?.ownerId).toBe('u_staff');
    expect(result.entry?.ownerHandle).toBe('staffer');
  });

  it('unassigns when given an explicit null', () => {
    // The case COALESCE cannot express: "clear it" and "leave it" are
    // different instructions, and a released deal must actually be released.
    const id = makeEnquiry();
    updateEntry(staff, id, { ownerId: 'u_staff' }, db);

    const result = updateEntry(staff, id, { ownerId: null }, db);

    expect(result.entry?.ownerId).toBeNull();
  });

  it('leaves the owner alone when the field is not supplied', () => {
    const id = makeEnquiry();
    updateEntry(staff, id, { ownerId: 'u_staff' }, db);

    const result = updateEntry(staff, id, { stage: 'contacted' }, db);

    expect(result.entry?.ownerId).toBe('u_staff');
  });

  it('filters to one person', () => {
    const mine = makeEnquiry();
    const theirs = makeEnquiry({ email: 'theirs@example.com' });

    updateEntry(staff, mine, { ownerId: 'u_staff' }, db);
    void theirs;

    const list = listPipeline(staff, { ownerId: 'u_staff' }, db).map((e) => e.id);

    expect(list).toEqual([mine]);
  });
});

// ------------------------------------------------------------------ follow-up

describe('follow-ups', () => {
  it('lists a deal whose date has passed', () => {
    const id = makeEnquiry();

    updateEntry(staff, id, { nextActionAt: '2020-01-01' }, db);

    expect(overdue(staff, db).map((entry) => entry.id)).toEqual([id]);
  });

  it('does not call a future follow-up overdue', () => {
    const id = makeEnquiry();
    updateEntry(staff, id, { nextActionAt: '2999-01-01' }, db);

    expect(overdue(staff, db)).toEqual([]);
  });

  it('stops chasing a closed deal', () => {
    const id = makeEnquiry();
    updateEntry(staff, id, { nextActionAt: '2020-01-01' }, db);
    updateEntry(staff, id, { stage: 'lost' }, db);

    expect(overdue(staff, db)).toEqual([]);
  });

  it('puts unscheduled deals after scheduled ones', () => {
    // SQLite sorts NULL first by default, which would head a "what is next"
    // list with every deal that has no next action at all.
    const soon = makeEnquiry();
    const none = makeEnquiry({ email: 'none@example.com' });

    updateEntry(staff, soon, { nextActionAt: '2999-01-01' }, db);
    void none;

    expect(listPipeline(staff, {}, db)[0]?.id).toBe(soon);
  });
});

// -------------------------------------------------------------------- privacy

describe('spam', () => {
  it('stays out of the pipeline but is not destroyed', () => {
    // A false positive is a lost customer; the only way to find one is to be
    // able to look. So it is excluded from the working list and the summary,
    // and still readable by id.
    const id = makeEnquiry();
    db.prepare("UPDATE enquiries SET status = 'spam' WHERE id = ?").run(id);

    expect(listPipeline(staff, {}, db)).toEqual([]);
    expect(summary(staff, db).every((row) => row.count === 0)).toBe(true);
    expect(getEntry(staff, id, db)).not.toBeNull();
  });
});
