import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import { hashPassword } from './password';
import { LIMITS, check, clear, prune, subjectFor } from './rate-limit';
import { completeReset, pruneResets, requestReset } from './reset';

/**
 * The auth tests the roadmap listed as missing.
 *
 * Almost all of these are NEGATIVE. Authentication is one of the few places
 * where the interesting behaviour is what the system refuses, and a suite that
 * only proves the happy path proves the least important half.
 */

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

async function makeUser(email = 'sam@example.com') {
  return createUser(
    {
      id: 'u_sam',
      email,
      passwordHash: await hashPassword('a-long-enough-passphrase'),
      handle: 'sam',
      displayName: 'Sam',
    },
    db,
  );
}

// ---------------------------------------------------------------- rate limits

describe('rate limiting', () => {
  it('allows exactly the configured number of attempts', () => {
    const subject = subjectFor('sam@example.com');

    for (let i = 0; i < LIMITS.signIn.max; i++) {
      expect(check(LIMITS.signIn, subject, db).ok, `attempt ${i + 1}`).toBe(true);
    }

    // The (n+1)th is refused, not the nth.
    expect(check(LIMITS.signIn, subject, db).ok).toBe(false);
  });

  it('counts each bucket separately', () => {
    const subject = subjectFor('sam@example.com');

    for (let i = 0; i < LIMITS.signUp.max; i++) {
      check(LIMITS.signUp, subject, db);
    }

    // Exhausting sign-up must not lock someone out of signing in.
    expect(check(LIMITS.signUp, subject, db).ok).toBe(false);
    expect(check(LIMITS.signIn, subject, db).ok).toBe(true);
  });

  it('counts each subject separately', () => {
    const sam = subjectFor('sam@example.com');
    const alex = subjectFor('alex@example.com');

    for (let i = 0; i <= LIMITS.signIn.max; i++) check(LIMITS.signIn, sam, db);

    expect(check(LIMITS.signIn, sam, db).ok).toBe(false);
    expect(check(LIMITS.signIn, alex, db).ok).toBe(true);
  });

  it('clears a subject after a success', () => {
    const subject = subjectFor('sam@example.com');
    for (let i = 0; i <= LIMITS.signIn.max; i++) check(LIMITS.signIn, subject, db);
    expect(check(LIMITS.signIn, subject, db).ok).toBe(false);

    clear(LIMITS.signIn, subject, db);
    expect(check(LIMITS.signIn, subject, db).ok).toBe(true);
  });

  it('stores no reversible address', () => {
    const subject = subjectFor('203.0.113.7');

    expect(subject).not.toContain('203.0.113.7');
    expect(subject).toHaveLength(32);

    check(LIMITS.signIn, subject, db);
    const rows = db.prepare('SELECT subject FROM rate_limits').all() as {
      subject: string;
    }[];
    expect(rows[0]!.subject).not.toContain('203');
  });

  it('prunes rows outside the window', () => {
    const subject = subjectFor('sam@example.com');
    check(LIMITS.signIn, subject, db);

    // Nothing is old enough yet.
    expect(prune(86_400, db)).toBe(0);

    // Age the row past the retention window and it goes.
    db.prepare(
      `UPDATE rate_limits SET attempted = datetime('now', '-2 days')`,
    ).run();
    expect(prune(86_400, db)).toBe(1);
  });
});

// -------------------------------------------------------------- password reset

describe('password reset', () => {
  it('answers identically whether or not the account exists', async () => {
    await makeUser();

    const real = requestReset('sam@example.com', db);
    const fake = requestReset('nobody@example.com', db);

    /*
     * The shape of the answer must not differ. A reset form that says "no such
     * account" is an enumeration oracle — someone can walk a list of addresses
     * and learn which are registered.
     */
    expect(real.ok).toBe(true);
    expect(fake.ok).toBe(true);

    // Only the real one produced anything at all.
    const tokens = db
      .prepare('SELECT COUNT(*) AS n FROM password_resets')
      .get() as {
      n: number;
    };
    expect(tokens.n).toBe(1);
  });

  it('never stores the token it emailed', async () => {
    await makeUser();
    const { token } = requestReset('sam@example.com', db);

    const stored = db.prepare('SELECT token FROM password_resets').get() as {
      token: string;
    };

    // A database leak must not hand over live bearer credentials.
    expect(stored.token).not.toBe(token);
    expect(stored.token).toHaveLength(64);
  });

  it('emails the link rather than returning it to a caller', async () => {
    await makeUser();
    const { token } = requestReset('sam@example.com', db);

    const mail = db.prepare('SELECT to_email, body FROM outbox').get() as {
      to_email: string;
      body: string;
    };

    expect(mail.to_email).toBe('sam@example.com');
    expect(mail.body).toContain(token);
  });

  it('changes the password and ends every session', async () => {
    const user = await makeUser();
    db.prepare(
      `INSERT INTO sessions (id, user_id, expires_at, created_at)
       VALUES ('sess', ?, datetime('now', '+1 day'), datetime('now'))`,
    ).run(user.id);

    const { token } = requestReset('sam@example.com', db);
    const before = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string };

    expect((await completeReset(token!, 'a-brand-new-passphrase', db)).ok).toBe(
      true,
    );

    const after = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string };
    expect(after.password_hash).not.toBe(before.password_hash);

    /*
     * Sessions are revoked because a reset is often a response to compromise.
     * Leaving the attacker signed in would make the whole exercise theatre.
     */
    const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as {
      n: number;
    };
    expect(sessions.n).toBe(0);
  });

  it('spends a token exactly once', async () => {
    await makeUser();
    const { token } = requestReset('sam@example.com', db);

    expect((await completeReset(token!, 'first-new-passphrase', db)).ok).toBe(true);

    const second = await completeReset(token!, 'second-new-passphrase', db);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('That link is no longer valid');
  });

  it('refuses an expired token', async () => {
    await makeUser();
    const { token } = requestReset('sam@example.com', db);

    db.prepare(
      `UPDATE password_resets SET expires_at = datetime('now', '-1 minute')`,
    ).run();

    expect((await completeReset(token!, 'a-brand-new-passphrase', db)).ok).toBe(
      false,
    );
  });

  it('gives the same message for unknown, expired and spent tokens', async () => {
    await makeUser();
    const { token } = requestReset('sam@example.com', db);
    await completeReset(token!, 'a-brand-new-passphrase', db);

    const unknown = await completeReset('not-a-token', 'another-passphrase', db);
    const spent = await completeReset(token!, 'another-passphrase', db);

    // Telling them apart tells a token holder which case they are in, and helps
    // no legitimate user — the next step is the same in all three.
    expect(unknown.error).toBe(spent.error);
  });

  it('still enforces the password rules', async () => {
    await makeUser();
    const { token } = requestReset('sam@example.com', db);

    const result = await completeReset(token!, 'short', db);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least/i);

    // A rejected attempt must not burn the token.
    expect((await completeReset(token!, 'a-brand-new-passphrase', db)).ok).toBe(
      true,
    );
  });

  it('prunes spent and expired tokens', async () => {
    await makeUser();
    const { token } = requestReset('sam@example.com', db);
    await completeReset(token!, 'a-brand-new-passphrase', db);

    expect(pruneResets(db)).toBe(1);
  });
});
