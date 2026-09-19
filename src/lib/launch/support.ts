import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { queueEmail } from '@/lib/email/outbox';

/**
 * The support inbox (§20 P14).
 *
 * Kept separate from `enquiries` (P12) on purpose. An enquiry is a sales lead
 * and a support message is someone stuck; merging them means the queue that
 * must be answered in an hour shares a list with the one answered in two days,
 * and both end up getting the worse of the two treatments.
 */

export const SUPPORT_INBOX = 'support@creativedesignnetworks.com';

export const SUPPORT_TOPICS = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'account', label: 'Account or sign-in' },
  { value: 'data', label: 'A map or my data' },
  { value: 'billing', label: 'Billing' },
  { value: 'feedback', label: 'Feedback or a request' },
  { value: 'other', label: 'Something else' },
] as const;

export const SUPPORT_TOPIC_VALUES = SUPPORT_TOPICS.map((topic) => topic.value);

export const MAX_SUPPORT_MESSAGE = 4000;
export const SUPPORT_PER_HOUR = 5;

export interface SupportRow {
  id: string;
  email: string;
  topic: string;
  message: string;
  route: string;
  userAgent: string;
  status: string;
  createdAt: string;
}

export function submitSupport(
  ctx: AuthContext,
  input: {
    email: string;
    topic: string;
    message: string;
    route?: string;
    userAgent?: string;
    clientHash: string;
  },
  db: Database = getDb(),
): { ok: boolean; id?: string; error?: string } {
  const email = input.email.trim().slice(0, 200);
  const message = input.message.trim().slice(0, MAX_SUPPORT_MESSAGE);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'We need an email address to reply to' };
  }
  if (message.length < 10) {
    return { ok: false, error: 'Tell us a little more about what happened' };
  }

  const topic = SUPPORT_TOPIC_VALUES.includes(
    input.topic as (typeof SUPPORT_TOPIC_VALUES)[number],
  )
    ? input.topic
    : 'other';

  const recent = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM support_messages
          WHERE client_hash = ? AND created_at >= datetime('now', '-1 hour')`,
      )
      .get(input.clientHash) as { n: number }
  ).n;

  if (recent >= SUPPORT_PER_HOUR) {
    return {
      ok: false,
      error: "You've sent us a few already — we'll reply to those first.",
    };
  }

  const id = `sup_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  // The row before the mail, for the same reason as P12: mail is best-effort,
  // and a support request that exists only as a queued email is one you lose.
  db.prepare(
    `INSERT INTO support_messages
       (id, user_id, email, topic, message, route, user_agent, client_hash)
     VALUES (@id, @userId, @email, @topic, @message, @route, @userAgent, @clientHash)`,
  ).run({
    id,
    userId: ctx.userId || null,
    email,
    topic,
    message,
    // The single most useful field in a support queue, and the one users never
    // think to include.
    route: (input.route ?? '').slice(0, 200),
    userAgent: (input.userAgent ?? '').slice(0, 300),
    clientHash: input.clientHash,
  });

  queueEmail(
    SUPPORT_INBOX,
    `[support/${topic}] ${email}`,
    [
      `From: ${email}`,
      ctx.userId ? `Account: ${ctx.userId}` : 'Not signed in',
      input.route ? `Was on: ${input.route}` : '',
      '',
      message,
      '',
      `Reference: ${id}`,
    ]
      .filter(Boolean)
      .join('\n'),
    db,
  );

  queueEmail(
    email,
    'We got your message',
    [
      'Thanks — a person will read this and reply.',
      '',
      'What you sent:',
      message,
      '',
      `Reference: ${id}`,
    ].join('\n'),
    db,
  );

  return { ok: true, id };
}

export function listSupport(
  ctx: AuthContext,
  status = 'open',
  db: Database = getDb(),
): SupportRow[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `SELECT * FROM support_messages
        WHERE (@status IS NULL OR status = @status)
        ORDER BY created_at DESC LIMIT 200`,
    )
    .all({ status: status || null }) as {
    id: string;
    email: string;
    topic: string;
    message: string;
    route: string;
    user_agent: string;
    status: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    topic: row.topic,
    message: row.message,
    route: row.route,
    userAgent: row.user_agent,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function closeSupport(
  ctx: AuthContext,
  id: string,
  db: Database = getDb(),
): boolean {
  if (!ctx.isStaff) return false;
  const result = db
    .prepare(`UPDATE support_messages SET status = 'closed' WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}
