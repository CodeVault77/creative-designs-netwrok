import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { serverEnv } from '@/lib/env';
import { queueEmail } from '@/lib/email/outbox';
import { serviceBySlug } from './catalogue';
import { serviceById as marketingServiceById } from '@/config/services';
import { contact } from '@/config/contact';

/**
 * Enquiries — the first money path (§20 P12).
 *
 * The criterion is "enquiry submitted end-to-end and reaches an inbox", and
 * the order of operations is the whole design:
 *
 *   1. validate
 *   2. score for spam
 *   3. **write the row**
 *   4. queue the email
 *
 * The row is the record, not the email. An enquiry that exists only as a
 * queued message is one you lose the first time a provider bounces it — and
 * the person who sent it will never know, because from their side it
 * succeeded. Mail is best-effort; the table is not.
 */

export interface EnquiryInput {
  /**
   * A P12 service NODE slug ('build-with-us') or a marketing service category
   * id ('full-stack-web'). Both resolve — see `resolveService`.
   */
  serviceSlug: string;
  name: string;
  email: string;
  company?: string;
  budget?: string;
  message: string;
  /** Honeypot. Must be empty — see the note in `scoreSpam`. */
  website?: string;
  /** Milliseconds the form was on screen before submit. */
  elapsedMs?: number;

  // ---- Added by the marketing service-request form (roadmap §9.2). ----
  // All optional, so the P12 service-node form is unaffected.
  phone?: string;
  projectType?: string;
  timeline?: string;
  heardFrom?: string;
  /** Consent is legally meaningful: WHEN it was given, not just that it was. */
  consent?: boolean;
}

export interface SpamVerdict {
  spam: boolean;
  reason: string | null;
  /** 0–100. Kept on the row so a threshold change can be reasoned about later. */
  score: number;
}

/** Per-sender ceiling. Generous: a real person may legitimately send two. */
export const ENQUIRIES_PER_HOUR = 3;
export const ENQUIRIES_PER_DAY = 8;

export function clientHash(ip: string, userAgent = ''): string {
  const salt = serverEnv.INGEST_HASH_SALT;
  return createHash('sha256')
    .update(`enquiry:${salt}:${ip}:${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Spam scoring.
 *
 * Deliberately NOT a CAPTCHA. A CAPTCHA taxes every real customer to stop a
 * bot that will solve it anyway, and this is the form standing between the
 * business and its first revenue — the cost of a false negative (some junk in
 * an inbox) is far below the cost of a false positive (a customer who gave up).
 *
 * So: cheap signals, scored rather than absolute, and **nothing is ever thrown
 * away**. A message over the threshold is filed as spam and stays readable.
 */
export function scoreSpam(input: EnquiryInput): SpamVerdict {
  let score = 0;
  const reasons: string[] = [];

  /**
   * The honeypot: a field hidden from people and irresistible to form-filling
   * bots. Nothing legitimate ever puts text in it, so this one is decisive on
   * its own.
   */
  if (input.website && input.website.trim()) {
    score += 100;
    reasons.push('honeypot');
  }

  /**
   * Filled in impossibly fast. Reading a service page and writing a real
   * message takes longer than three seconds; a script takes none.
   *
   * Only counted when a timing was reported. A missing value means JavaScript
   * did not run, which is a reason to be lenient rather than suspicious.
   */
  if (input.elapsedMs !== undefined && input.elapsedMs < 3000) {
    score += 40;
    reasons.push('submitted too fast');
  }

  const message = input.message.toLowerCase();

  // Link stuffing. One link is normal; several is an advertisement.
  const links = (message.match(/https?:\/\//g) ?? []).length;
  if (links >= 3) {
    score += 30 + links * 5;
    reasons.push(`${links} links`);
  }

  /**
   * Links with nothing around them.
   *
   * Counted separately from the raw link count, because the two say different
   * things: three links inside a paragraph of context is a person showing
   * their work, while three links and eleven words is a drop. Scoring the
   * ratio rather than the count is what lets the plain count stay lenient.
   */
  if (links >= 2) {
    const prose = input.message.replace(/https?:\/\/\S+/g, '').trim();
    if (prose.length < 40) {
      score += 45;
      reasons.push('links with no context');
    }
  }

  // The classic bulk-outreach vocabulary. Weak individually, so weighted low.
  const phrases = [
    'seo services',
    'guest post',
    'backlink',
    'crypto',
    'forex',
    'increase your ranking',
    'dear sir/madam',
    'bulk email',
  ];
  const hits = phrases.filter((phrase) => message.includes(phrase));
  if (hits.length > 0) {
    score += hits.length * 20;
    reasons.push(hits[0]!);
  }

  // A message with no spaces of any length is machine output.
  if (input.message.length > 40 && !input.message.trim().includes(' ')) {
    score += 40;
    reasons.push('no word breaks');
  }

  // Repeated identical characters — "aaaaaaaaaa".
  if (/(.)\1{9,}/.test(input.message)) {
    score += 30;
    reasons.push('repeated characters');
  }

  return {
    spam: score >= 60,
    reason: reasons.length > 0 ? reasons.join(', ') : null,
    score: Math.min(score, 100),
  };
}

export interface RateVerdict {
  allowed: boolean;
  message?: string;
}

export function checkRate(client: string, db: Database = getDb()): RateVerdict {
  const count = (hours: number) =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM enquiries
            WHERE client_hash = ? AND created_at >= datetime('now', ?)`,
        )
        .get(client, `-${hours} hours`) as { n: number }
    ).n;

  if (count(1) >= ENQUIRIES_PER_HOUR) {
    return {
      allowed: false,
      message: "You've already sent us a few. We'll reply to those first.",
    };
  }
  if (count(24) >= ENQUIRIES_PER_DAY) {
    return {
      allowed: false,
      message: "You've reached today's limit. Email us directly if it's urgent.",
    };
  }
  return { allowed: true };
}

export interface EnquiryRecord {
  id: string;
  serviceSlug: string;
  name: string;
  email: string;
  company: string;
  budget: string;
  message: string;
  status: string;
  spamReason: string | null;
  createdAt: string;
}

export interface SubmitResult {
  ok: boolean;
  id?: string;
  /** True when the enquiry was filed as spam. The SENDER is not told. */
  filtered?: boolean;
  error?: string;
}

/**
 * Submit an enquiry.
 *
 * Note what a spam verdict does NOT do: it does not reject the request. The
 * sender gets the same confirmation either way, because telling a bot which
 * message tripped the filter is how it learns to get past it — and telling a
 * misclassified human "your message looks like spam" is worse than useless.
 */
/**
 * Where an enquiry came from, and where a reply should go.
 *
 * There are two catalogues in this codebase and they are different things: the
 * P12 service NODES (`lib/services/catalogue.ts`) are sales pages with their
 * own inbox, and the marketing service CATEGORIES (`config/services.ts`) are
 * the picker on the request form. Both can produce an enquiry.
 *
 * Resolving both here keeps ONE writer to the `enquiries` table. A second
 * function writing the same rows would be a second place for the
 * storage-before-email ordering to be got wrong, and that ordering is the
 * whole reason an enquiry is never lost.
 */
function resolveService(
  slug: string,
): { slug: string; name: string; inbox: string } | null {
  const node = serviceBySlug(slug);
  if (node) return { slug: node.slug, name: node.name, inbox: node.inbox };

  const category = marketingServiceById(slug);
  if (category) {
    return {
      slug: category.id,
      name: category.name,
      // OPEN DECISION OD-1. Empty until answered — the caller still stores the
      // row, so nothing is lost while the address is undecided.
      inbox: contact.email,
    };
  }

  // "Not sure yet" is a legitimate answer on the request form, and refusing it
  // would lose exactly the enquiries most in need of a conversation.
  if (slug === 'not-sure') {
    return { slug: 'not-sure', name: 'General enquiry', inbox: contact.email };
  }

  return null;
}

export function submitEnquiry(
  input: EnquiryInput,
  meta: { clientHash: string; userId?: string | null },
  db: Database = getDb(),
): SubmitResult {
  const service = resolveService(input.serviceSlug);
  if (!service) return { ok: false, error: 'Unknown service' };

  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().slice(0, 200);
  const message = input.message.trim().slice(0, 4000);

  if (!name) return { ok: false, error: 'Tell us your name' };
  if (!isEmail(email)) return { ok: false, error: 'Check the email address' };
  if (message.length < 10) {
    return { ok: false, error: 'Tell us a little about the project' };
  }

  const rate = checkRate(meta.clientHash, db);
  if (!rate.allowed) return { ok: false, error: rate.message };

  const verdict = scoreSpam(input);
  const id = `enq_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  // The row first. Everything after this is best-effort.
  db.prepare(
    `INSERT INTO enquiries
       (id, service_slug, name, email, company, budget, message, user_id, client_hash,
        status, spam_reason, phone, project_type, timeline, heard_from, consent_at)
     VALUES (@id, @slug, @name, @email, @company, @budget, @message, @userId, @client,
             @status, @reason, @phone, @projectType, @timeline, @heardFrom, @consentAt)`,
  ).run({
    id,
    slug: service.slug,
    name,
    email,
    company: (input.company ?? '').trim().slice(0, 160),
    budget: (input.budget ?? '').slice(0, 40),
    message,
    userId: meta.userId ?? null,
    client: meta.clientHash,
    status: verdict.spam ? 'spam' : 'new',
    reason: verdict.reason,
    phone: (input.phone ?? '').trim().slice(0, 40),
    projectType: (input.projectType ?? '').slice(0, 40),
    timeline: (input.timeline ?? '').slice(0, 40),
    heardFrom: (input.heardFrom ?? '').slice(0, 40),
    consentAt: input.consent ? new Date().toISOString() : null,
  });

  if (!verdict.spam) {
    /**
     * Two emails, guarded SEPARATELY.
     *
     * The business inbox is an open decision (OD-1) and may be empty; the
     * sender's address never is. An earlier version guarded both on the
     * business inbox, which meant that while OD-1 was unanswered the person
     * who filled in the form got no acknowledgement either — and from their
     * side, "did that go anywhere?" is answered by an email or by nothing at
     * all. Caught by the Milestone C harness.
     */
    if (service.inbox) {
      queueEmail(
        service.inbox,
        `New enquiry — ${service.name} — ${name}`,
        [
          `${name} <${email}>`,
          input.phone ? `Phone/WhatsApp: ${input.phone}` : '',
          input.company ? `Company: ${input.company}` : '',
          input.budget ? `Budget: ${input.budget}` : '',
          input.projectType ? `Project type: ${input.projectType}` : '',
          input.timeline ? `Timeline: ${input.timeline}` : '',
          input.heardFrom ? `Heard via: ${input.heardFrom}` : '',
          '',
          message,
          '',
          `Service: ${service.name} (${service.slug})`,
          `Reference: ${id}`,
        ]
          .filter(Boolean)
          .join('\n'),
        db,
      );
    }

    /**
     * And an acknowledgement to the sender, because §20's criterion is about
     * an enquiry arriving — and from the sender's side, "did that go
     * anywhere?" is answered by an email or by nothing.
     */
    queueEmail(
      email,
      `We got your message — ${service.name}`,
      [
        `Thanks ${name.split(' ')[0] ?? name},`,
        '',
        'We have your enquiry and will reply within two working days.',
        '',
        'What you sent:',
        message,
        '',
        `Reference: ${id}`,
      ].join('\n'),
      db,
    );
  }

  return { ok: true, id, filtered: verdict.spam };
}

function isEmail(value: string): boolean {
  // Deliberately loose. A strict RFC 5322 pattern rejects valid addresses, and
  // the only real test of an address is sending to it.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** The business inbox view. Staff only — enforced by the route. */
export function listEnquiries(
  filter: { status?: string; serviceSlug?: string } = {},
  db: Database = getDb(),
): EnquiryRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM enquiries
        WHERE (@status IS NULL OR status = @status)
          AND (@slug IS NULL OR service_slug = @slug)
        ORDER BY created_at DESC
        LIMIT 200`,
    )
    .all({
      status: filter.status ?? null,
      slug: filter.serviceSlug ?? null,
    }) as {
    id: string;
    service_slug: string;
    name: string;
    email: string;
    company: string;
    budget: string;
    message: string;
    status: string;
    spam_reason: string | null;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    serviceSlug: row.service_slug,
    name: row.name,
    email: row.email,
    company: row.company,
    budget: row.budget,
    message: row.message,
    status: row.status,
    spamReason: row.spam_reason,
    createdAt: row.created_at,
  }));
}
