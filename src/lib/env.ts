import { z } from 'zod';

/**
 * Environment contract.
 *
 * Validated once, at module load. A missing or malformed variable crashes the
 * process at boot with a message naming the variable, instead of surfacing as
 * `undefined` inside a request six hours later.
 *
 * Two rules, both enforced by tests in env.test.ts:
 *   - Anything the browser needs is prefixed NEXT_PUBLIC_ and lives in
 *     `clientSchema`. Next.js inlines these at build time — they are public.
 *   - Secrets live in `serverSchema` and are never imported from a Client
 *     Component. Importing `serverEnv` into client code is a build error.
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Which deployed environment this process is. Drives analytics routing. */
  APP_ENV: z.enum(['local', 'preview', 'staging', 'production']).default('local'),

  /**
   * Link-to-Mind-Map's model key (§12).
   *
   * OPTIONAL on purpose. Without it the feature still works: the pipeline
   * falls back to the deterministic heading structurer, which needs no
   * network and costs nothing. Requiring the key would mean a fresh clone
   * cannot run the showcase feature at all.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  INGEST_MODEL: z.string().default('claude-sonnet-5'),

  /**
   * The hard monthly ceiling §20 requires, in US dollars. Crossing it
   * degrades to the free path rather than disabling the feature.
   */
  INGEST_MONTHLY_USD_CAP: z.coerce.number().positive().default(50),

  /**
   * Salt for hashing signed-out callers' IPs in the rate limiter. An unsalted
   * hash of an IPv4 address is reversible by brute force in seconds.
   */
  INGEST_HASH_SALT: z.string().min(8).default('cdn-local-development-salt'),

  /**
   * §20 P14: "Closed beta 20–50 users."
   *
   * OFF by default. Local development and CI must not need an invite code, and
   * a gate that has to be disabled to work on the product is a gate somebody
   * disables permanently.
   */
  /**
   * Email delivery.
   *
   * `log` prints and reports success, which is right for development and
   * catastrophic in production — so `emailProvider()` refuses to start with it
   * when NODE_ENV is production rather than silently dropping every message.
   */
  EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default('Creative Design Networks <noreply@localhost>'),

  /**
   * Shared secret for the job-drain endpoint.
   *
   * The scheduler that calls it is not a signed-in user, so the route cannot
   * use a session. Without this set, the endpoint accepts staff sessions only —
   * it never falls open.
   */
  JOB_RUNNER_TOKEN: z.string().min(16).optional(),

  /*
   * Stripe. Both optional: local development and CI must run without payment
   * credentials, and `UnconfiguredBilling` makes an unconfigured environment
   * fail loudly at the point of use rather than pretend a checkout worked.
   */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  /**
   * The key that encrypts secrets which must be READ BACK, not merely
   * compared: TOTP shared secrets and SSO client secrets.
   *
   * ── Why this is not optional in production ──────────────────────────────
   *
   * Passwords, sessions and recovery codes are hashed, because verifying them
   * only ever needs a comparison. A TOTP secret is different: computing the
   * expected six digits requires the original bytes, so it must be reversible
   * — which means it must be encrypted with a key that is NOT in the database
   * it protects. A dump of the database alone must not yield working second
   * factors.
   *
   * Optional here so a fresh clone runs, and `secretsKey()` refuses to start
   * in production without it rather than falling back to a default that would
   * be identical on every deployment in the world.
   *
   * 32 bytes, base64. Generate with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),

  /**
   * Hostname this deployment answers on, for white-label routing and for the
   * OIDC redirect URI. Derived from NEXT_PUBLIC_SITE_URL when unset.
   */
  ENTERPRISE_BASE_URL: z.string().url().optional(),

  BETA_MODE: z.enum(['open', 'closed']).default('open'),

  /** Shown on the health endpoint so a deploy can be identified in seconds. */
  APP_VERSION: z.string().default('dev'),
});

const clientSchema = z.object({
  /** Absolute origin, used to build shareable node links (§10: /n/<id>). */
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url('NEXT_PUBLIC_SITE_URL must be an absolute URL, e.g. http://localhost:3000')
    .default('http://localhost:3000'),

  /**
   * Analytics sink. `console` in local dev, `noop` in tests, `beacon` in any
   * deployed environment — see ADR-0009.
   *
   * Deployed environments MUST be `beacon`: §20 rates "launching without
   * instrumentation" as P14's High risk, and `console` means every event goes
   * to the browser console and nowhere else. `env.test.ts` asserts this.
   */
  NEXT_PUBLIC_ANALYTICS_PROVIDER: z
    .enum(['noop', 'console', 'beacon'])
    .default('console'),
});

function parse<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid ${label} environment configuration.\n${detail}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
  }

  return result.data;
}

/**
 * Client-safe configuration. Safe to import anywhere.
 *
 * Each variable is referenced by its full literal name because Next.js
 * replaces `process.env.NEXT_PUBLIC_*` at build time by static analysis —
 * dynamic access such as process.env[key] silently yields undefined.
 */
export const clientEnv = parse(
  clientSchema,
  {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_ANALYTICS_PROVIDER: process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER,
  },
  'client',
);

/**
 * Server-only configuration. Never import this from a Client Component.
 */
export const serverEnv = parse(
  serverSchema,
  {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    INGEST_MODEL: process.env.INGEST_MODEL,
    INGEST_MONTHLY_USD_CAP: process.env.INGEST_MONTHLY_USD_CAP,
    INGEST_HASH_SALT: process.env.INGEST_HASH_SALT,
    MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY,
    ENTERPRISE_BASE_URL: process.env.ENTERPRISE_BASE_URL,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    JOB_RUNNER_TOKEN: process.env.JOB_RUNNER_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    BETA_MODE: process.env.BETA_MODE,
    APP_VERSION: process.env.APP_VERSION,
  },
  'server',
);

export const isProduction = serverEnv.APP_ENV === 'production';

export { serverSchema, clientSchema };
