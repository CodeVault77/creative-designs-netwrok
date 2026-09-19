import 'server-only';
import { serverEnv } from '@/lib/env';

/**
 * Email delivery.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * `outbox.ts` has queued mail since P7 and nothing ever sent it. Invitations,
 * enquiry acknowledgements, support replies and newsletter confirmations were
 * all written to a table, reported to the user as sent, and never delivered.
 * This is the half that was missing.
 *
 * ── Why an interface ────────────────────────────────────────────────────────
 *
 * Deliverability is the kind of decision that gets revisited — a provider is
 * chosen, its reputation turns out to be poor for a particular market, and it
 * is swapped. One interface means that swap is a config change rather than a
 * search for every place mail is sent. It is also what makes the whole path
 * testable: the fake provider records instead of sending.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Everything queued today is plain text by design. */
  body: string;
}

export interface SendResult {
  ok: boolean;
  /** The provider's id for the message, when it returns one. */
  providerId?: string;
  error?: string;
  /**
   * Whether retrying could plausibly help.
   *
   * The queue needs this distinction: a 500 or a timeout is worth five
   * attempts, while a malformed address will fail identically every time and
   * should dead-letter immediately instead of occupying the worker for an hour.
   */
  retryable?: boolean;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

/**
 * Development provider: logs and reports success.
 *
 * Named `log`, not `noop`, because it is honest about what it does. The one
 * thing it must never be is the silent default in production — see
 * `emailProvider()`.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';

  send(message: EmailMessage): Promise<SendResult> {
    /*
     * `warn`, not `info`. The lint rule allows only warn and error, and warn is
     * the honest level anyway: mail that was composed and not actually sent is
     * a condition worth noticing in a log, not a routine event.
     */
    console.warn(
      `[email:log] NOT SENT to=${message.to} subject=${JSON.stringify(message.subject)}`,
    );
    return Promise.resolve({ ok: true, providerId: 'log' });
  }
}

/** Test provider: records what it was asked to send. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];

  /** Set to make every send fail, for exercising retry and dead-letter paths. */
  failWith: { error: string; retryable: boolean } | null = null;

  send(message: EmailMessage): Promise<SendResult> {
    if (this.failWith) {
      return Promise.resolve({
        ok: false,
        error: this.failWith.error,
        retryable: this.failWith.retryable,
      });
    }
    this.sent.push(message);
    return Promise.resolve({ ok: true, providerId: `mem_${this.sent.length}` });
  }
}

/**
 * Resend, over its HTTP API.
 *
 * Chosen over SMTP because it needs no dependency — `fetch` is enough — and
 * because an SMTP client would add a socket-level failure surface to a codebase
 * that currently has none. Swapping to SES or Postmark means one more class in
 * this file.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.body,
        }),
        // Without a timeout a hung connection holds a worker slot until the
        // lease expires — five minutes of the queue doing nothing.
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { id?: string };
        return { ok: true, ...(body.id ? { providerId: body.id } : {}) };
      }

      const detail = await response.text().catch(() => '');

      /*
       * 4xx is our fault and will not fix itself; 5xx and 429 are theirs and
       * might. Retrying a rejected address forever is how a queue fills with
       * work that can never succeed.
       */
      const retryable = response.status >= 500 || response.status === 429;

      return {
        ok: false,
        error: `${response.status} ${detail.slice(0, 200)}`,
        retryable,
      };
    } catch (cause) {
      // Network failure, DNS, timeout — all transient by nature.
      return {
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
        retryable: true,
      };
    }
  }
}

let override: EmailProvider | null = null;

/** Swap the provider in tests. Pass null to restore the configured one. */
export function setEmailProvider(provider: EmailProvider | null): void {
  override = provider;
}

/**
 * The configured provider.
 *
 * The rule that matters: **production never silently falls back to `log`.** A
 * misconfigured deployment that appears to send mail is the exact failure this
 * whole module exists to end, so a missing key in production throws at the
 * point of use rather than swallowing every message.
 */
export function emailProvider(): EmailProvider {
  if (override) return override;

  const configured = serverEnv.EMAIL_PROVIDER;

  if (configured === 'resend') {
    if (!serverEnv.RESEND_API_KEY) {
      throw new Error(
        'EMAIL_PROVIDER=resend but RESEND_API_KEY is not set — refusing to drop mail',
      );
    }
    return new ResendEmailProvider(serverEnv.RESEND_API_KEY, serverEnv.EMAIL_FROM);
  }

  if (serverEnv.NODE_ENV === 'production') {
    throw new Error(
      'EMAIL_PROVIDER is not configured in production — refusing to drop mail',
    );
  }

  return new LogEmailProvider();
}
