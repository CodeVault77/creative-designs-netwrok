import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { checkUrl } from '@/lib/ingest/ssrf';
import { record } from './audit';

/**
 * Organisation policy and white-label branding.
 *
 * ── White-label is four values, not a stylesheet ────────────────────────────
 *
 * The obvious way to build this is to let a customer supply CSS. It is also
 * the way that ends the product: customer CSS on our pages is arbitrary
 * content injection — `content:` can rewrite text, a positioned overlay can
 * put a fake sign-in field over a real one, and a background URL is a request
 * to a third party made by every viewer of that page.
 *
 * So the surface is four values with narrow types: a name, a logo URL, ONE
 * accent colour validated as a hex triple, and a support address. Everything
 * else stays ours. It is much less flexible, and every one of those values can
 * be rendered without trusting the customer.
 *
 * The accent is applied by setting a CSS custom property. The design system
 * already reads its colours from tokens, so one variable is genuinely enough
 * to rebrand the product — which is what makes the narrow surface acceptable
 * rather than merely safe.
 *
 * ── A custom domain must be proved, not claimed ─────────────────────────────
 *
 * Anyone can type `maps.google.com` into a form. Serving it would let them
 * host a page on somebody else's brand at our expense. A DNS TXT record with a
 * token only we issued is the proof, and nothing is served until it verifies.
 */

export interface OrgSettings {
  orgId: string;
  requireMfa: boolean;
  sessionHours: number;
  brandName: string;
  brandLogoUrl: string;
  brandAccent: string;
  brandSupportEmail: string;
  customDomain: string;
  /** The TXT value to publish. Shown until the domain verifies. */
  domainToken: string;
  domainVerified: boolean;
  updatedAt: string;
}

interface SettingsRow {
  org_id: string;
  require_mfa: number;
  session_hours: number;
  brand_name: string;
  brand_logo_url: string;
  brand_accent: string;
  brand_support_email: string;
  custom_domain: string;
  domain_token: string;
  domain_verified_at: string | null;
  updated_at: string;
}

const DEFAULTS: Omit<OrgSettings, 'orgId'> = {
  requireMfa: false,
  sessionHours: 0,
  brandName: '',
  brandLogoUrl: '',
  brandAccent: '',
  brandSupportEmail: '',
  customDomain: '',
  domainToken: '',
  domainVerified: false,
  updatedAt: '',
};

function hydrate(row: SettingsRow): OrgSettings {
  return {
    orgId: row.org_id,
    requireMfa: row.require_mfa === 1,
    sessionHours: row.session_hours,
    brandName: row.brand_name,
    brandLogoUrl: row.brand_logo_url,
    brandAccent: row.brand_accent,
    brandSupportEmail: row.brand_support_email,
    customDomain: row.custom_domain,
    domainToken: row.domain_token,
    domainVerified: Boolean(row.domain_verified_at),
    updatedAt: row.updated_at,
  };
}

/**
 * Settings for an organisation, defaulted when no row exists.
 *
 * Never returns null. An org with no settings row is an org using the
 * defaults, and forcing every caller to handle a null would mean every caller
 * inventing its own idea of what the defaults are.
 */
export function settingsFor(orgId: string, db: Database = getDb()): OrgSettings {
  const row = db
    .prepare('SELECT * FROM org_settings WHERE org_id = ?')
    .get(orgId) as SettingsRow | undefined;

  return row ? hydrate(row) : { orgId, ...DEFAULTS };
}

function isAdmin(orgRole: string | null): boolean {
  return orgRole === 'owner' || orgRole === 'admin';
}

export interface SettingsResult {
  ok: boolean;
  settings?: OrgSettings;
  error?: string;
}

/** A hex triple or six-digit hex, and nothing else. */
export function isHexColour(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

/**
 * Update policy and branding. Owners and admins only.
 *
 * Every field is validated to its own narrow shape here rather than at the
 * route, because there are two routes that write these and only one of them
 * would be remembered.
 */
export function updateSettings(
  ctx: AuthContext,
  orgId: string,
  orgRole: string | null,
  patch: {
    requireMfa?: boolean;
    sessionHours?: number;
    brandName?: string;
    brandLogoUrl?: string;
    brandAccent?: string;
    brandSupportEmail?: string;
  },
  db: Database = getDb(),
): SettingsResult {
  if (!isAdmin(orgRole) && !ctx.isStaff) return { ok: false, error: 'Not found' };

  if (patch.brandAccent && !isHexColour(patch.brandAccent)) {
    /*
     * The single most important line in this file.
     *
     * This value is interpolated into a CSS custom property. Anything that is
     * not a hex colour — `red; } body { display:none` — escapes the
     * declaration and becomes a stylesheet the customer wrote. The regex is
     * the boundary, so it is exact rather than lenient.
     */
    return { ok: false, error: 'An accent colour looks like #4F46E5' };
  }

  if (patch.brandLogoUrl) {
    const verdict = checkUrl(patch.brandLogoUrl);

    if (!verdict.ok) {
      return {
        ok: false,
        error: verdict.detail ?? 'That logo address is not allowed',
      };
    }

    if (!patch.brandLogoUrl.startsWith('https://')) {
      // An http image on an https page is mixed content: browsers block it,
      // so the logo silently fails to appear and looks like our bug.
      return { ok: false, error: 'A logo URL must be https' };
    }
  }

  db.prepare(
    /*
     * COALESCE on the INSERT as well as the UPDATE.
     *
     * A patch that sets only one field passes NULL for the rest, and every
     * column here is NOT NULL — so the first write for an organisation failed
     * outright while every subsequent one worked, because only the UPDATE half
     * had the COALESCE. The defaults are repeated here rather than relying on
     * the column defaults, because naming a column in an INSERT overrides its
     * default with whatever was bound, NULL included.
     */
    `INSERT INTO org_settings
       (org_id, require_mfa, session_hours, brand_name, brand_logo_url,
        brand_accent, brand_support_email)
     VALUES (@orgId, COALESCE(@requireMfa, 0), COALESCE(@sessionHours, 0),
             COALESCE(@brandName, ''), COALESCE(@brandLogoUrl, ''),
             COALESCE(@brandAccent, ''), COALESCE(@brandSupportEmail, ''))
     ON CONFLICT(org_id) DO UPDATE SET
       require_mfa = COALESCE(@requireMfa, require_mfa),
       session_hours = COALESCE(@sessionHours, session_hours),
       brand_name = COALESCE(@brandName, brand_name),
       brand_logo_url = COALESCE(@brandLogoUrl, brand_logo_url),
       brand_accent = COALESCE(@brandAccent, brand_accent),
       brand_support_email = COALESCE(@brandSupportEmail, brand_support_email),
       updated_at = datetime('now')`,
  ).run({
    orgId,
    requireMfa: patch.requireMfa === undefined ? null : patch.requireMfa ? 1 : 0,
    sessionHours:
      patch.sessionHours === undefined
        ? null
        : Math.max(0, Math.min(24 * 90, Math.round(patch.sessionHours))),
    brandName: patch.brandName?.slice(0, 60) ?? null,
    brandLogoUrl: patch.brandLogoUrl?.slice(0, 500) ?? null,
    brandAccent: patch.brandAccent?.trim() ?? null,
    brandSupportEmail: patch.brandSupportEmail?.slice(0, 200) ?? null,
  });

  record(
    {
      action:
        patch.brandName !== undefined ||
        patch.brandAccent !== undefined ||
        patch.brandLogoUrl !== undefined
          ? 'org.branding_changed'
          : 'org.settings_changed',
      actorId: ctx.userId,
      orgId,
      targetType: 'organization',
      targetId: orgId,
      metadata: { ...patch },
    },
    db,
  );

  return { ok: true, settings: settingsFor(orgId, db) };
}

/** The TXT record name a customer publishes. */
export const DOMAIN_TXT_NAME = '_cdn-verify';

export interface DomainResult {
  ok: boolean;
  /** What to publish, as `_cdn-verify.<domain> TXT "<value>"`. */
  token?: string;
  error?: string;
}

const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * Claim a custom domain. Issues the token; verification is separate.
 *
 * Claiming is not owning. The row is written with `domain_verified_at` NULL
 * and nothing serves that hostname until `verifyDomain` proves control, so a
 * claim on a domain somebody else owns is inert.
 */
export function claimDomain(
  ctx: AuthContext,
  orgId: string,
  orgRole: string | null,
  domain: string,
  db: Database = getDb(),
): DomainResult {
  if (!isAdmin(orgRole) && !ctx.isStaff) return { ok: false, error: 'Not found' };

  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  if (!HOSTNAME.test(clean)) {
    return { ok: false, error: 'That is not a hostname' };
  }

  const token = `cdn-verify-${randomBytes(16).toString('hex')}`;

  try {
    db.prepare(
      // Only the columns being set are named, so every other column takes its
      // schema default. The bug above cannot occur here for that reason — but
      // adding a column to this list without a COALESCE would reintroduce it.
      `INSERT INTO org_settings (org_id, custom_domain, domain_token)
       VALUES (@orgId, @domain, @token)
       ON CONFLICT(org_id) DO UPDATE SET
         custom_domain = excluded.custom_domain,
         domain_token = excluded.domain_token,
         -- A new claim resets verification. Otherwise changing the domain
         -- would inherit the previous one's proof.
         domain_verified_at = NULL,
         updated_at = datetime('now')`,
    ).run({ orgId, domain: clean, token });
  } catch (cause) {
    if (String(cause).includes('UNIQUE')) {
      return { ok: false, error: 'Another organisation has claimed that domain' };
    }
    throw cause;
  }

  return { ok: true, token };
}

/**
 * Prove control by finding the token in DNS.
 *
 * `resolver` is injected so tests need no network and so a deployment can
 * point it at its own resolver. The default is Node's, which uses the system
 * configuration.
 */
export async function verifyDomain(
  ctx: AuthContext,
  orgId: string,
  orgRole: string | null,
  db: Database = getDb(),
  resolver?: (name: string) => Promise<string[][]>,
): Promise<DomainResult> {
  if (!isAdmin(orgRole) && !ctx.isStaff) return { ok: false, error: 'Not found' };

  const settings = settingsFor(orgId, db);
  if (!settings.customDomain) return { ok: false, error: 'Claim a domain first' };

  const resolveTxt =
    resolver ??
    (async (name: string) => {
      const { resolveTxt: nodeResolve } = await import('node:dns/promises');
      return nodeResolve(name);
    });

  let records: string[][];

  try {
    records = await resolveTxt(`${DOMAIN_TXT_NAME}.${settings.customDomain}`);
  } catch {
    // NXDOMAIN and a timeout are the same answer to the person waiting: the
    // record is not there yet. DNS takes time to propagate and this will be
    // retried.
    return {
      ok: false,
      error: 'That record is not visible yet. DNS can take a while.',
    };
  }

  // A TXT record is an array of strings that a resolver may split; joining is
  // what the DNS spec expects, and a long token WILL be split at 255 bytes.
  const found = records.some((chunks) => chunks.join('') === settings.domainToken);

  if (!found) {
    return { ok: false, error: 'The record does not match. Check the value.' };
  }

  db.prepare(
    "UPDATE org_settings SET domain_verified_at = datetime('now') WHERE org_id = ?",
  ).run(orgId);

  record(
    {
      action: 'org.domain_verified',
      actorId: ctx.userId,
      orgId,
      targetType: 'organization',
      targetId: orgId,
      metadata: { domain: settings.customDomain },
    },
    db,
  );

  return { ok: true };
}

export interface Branding {
  name: string;
  logoUrl: string;
  accent: string;
  supportEmail: string;
}

/**
 * Branding for a hostname, or null for ours.
 *
 * Only a VERIFIED domain resolves. An unverified claim returns null, so a
 * pending claim renders the ordinary product rather than somebody else's brand.
 */
export function brandingForHost(
  hostname: string,
  db: Database = getDb(),
): Branding | null {
  const host = hostname.toLowerCase().split(':')[0] ?? '';
  if (!host) return null;

  const row = db
    .prepare(
      `SELECT * FROM org_settings
        WHERE custom_domain = ? AND domain_verified_at IS NOT NULL`,
    )
    .get(host) as SettingsRow | undefined;

  if (!row) return null;

  const settings = hydrate(row);

  return {
    name: settings.brandName,
    logoUrl: settings.brandLogoUrl,
    accent: settings.brandAccent,
    supportEmail: settings.brandSupportEmail,
  };
}

/**
 * The style attribute a branded page carries.
 *
 * Re-validates the colour on the way OUT as well as on the way in. That is not
 * redundant: this is the function that produces CSS, and it must be safe on
 * its own terms even if a row were ever written by something that skipped
 * `updateSettings` — a migration, a support script, a future endpoint. A
 * validator only enforced at one end is one refactor away from not being
 * enforced at all.
 */
export function accentStyle(branding: Branding | null): Record<string, string> {
  if (!branding?.accent || !isHexColour(branding.accent)) return {};

  return { '--brand-accent': branding.accent };
}
