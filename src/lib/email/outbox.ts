import 'server-only';
import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db/client';
import { clientEnv } from '@/lib/env';

/**
 * The email outbox.
 *
 * §20 lists "invite email" as a P7 deliverable, and there is no email provider
 * configured — choosing one is a decision with cost, deliverability and
 * privacy implications that belongs with the product owner.
 *
 * The honest response is neither to pretend nor to drop the mail. Invites are
 * QUEUED in a table. When a provider is configured, `pendingEmails` has
 * everything waiting, so people already invited get delivered to rather than
 * silently lost.
 *
 * Until then the invite link is also handed back to the inviter in the UI, so
 * the feature genuinely works — you copy the link and send it yourself. That
 * is a much smaller lie than a "sent!" toast for mail that went nowhere.
 */

export interface OutboxMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: string;
  sentAt: string | null;
}

export function queueEmail(
  to: string,
  subject: string,
  body: string,
  /**
   * Injectable so a caller running against a test database queues into THAT
   * database. Without it, anything that sends mail is untestable in isolation:
   * the row lands in the real dev file and the assertion sees an empty outbox.
   */
  db: Database = getDb(),
): string {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO outbox (id, to_email, subject, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, to, subject, body, new Date().toISOString());
  return id;
}

export function pendingEmails(
  limit = 50,
  /*
   * Injectable, like `queueEmail`. Without it the drain reads the real dev
   * database no matter which one the caller passed, so the whole send path is
   * untestable in isolation — the assertion looks at an empty outbox while the
   * rows sit somewhere else.
   */
  db: Database = getDb(),
): OutboxMessage[] {
  const rows = db
    .prepare(
      'SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY created_at ASC LIMIT ?',
    )
    .all(limit) as {
    id: string;
    to_email: string;
    subject: string;
    body: string;
    created_at: string;
    sent_at: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    to: row.to_email,
    subject: row.subject,
    body: row.body,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  }));
}

export function markSent(id: string, db: Database = getDb()): void {
  db.prepare('UPDATE outbox SET sent_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

export function inviteEmail(
  mapTitle: string,
  inviterName: string,
  role: string,
  acceptUrl: string,
): { subject: string; body: string } {
  return {
    subject: `${inviterName} shared "${mapTitle}" with you`,
    // Plain text. An HTML template is separate work with its own rendering
    // and deliverability problems, and this has to be readable either way.
    body: [
      `${inviterName} invited you to "${mapTitle}" on Creative Design Networks as ${role}.`,
      '',
      acceptUrl,
      '',
      'This link expires in 14 days. If you were not expecting it, ignore this message.',
    ].join('\n'),
  };
}

export function acceptUrlFor(token: string): string {
  return `${trimSlash(clientEnv.NEXT_PUBLIC_SITE_URL)}/invite/${encodeURIComponent(token)}`;
}

export function shareUrlFor(token: string): string {
  return `${trimSlash(clientEnv.NEXT_PUBLIC_SITE_URL)}/s/${encodeURIComponent(token)}`;
}

function trimSlash(url: string): string {
  return url.replace(/\/$/, '');
}
