import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { createUser, getUserById } from '@/lib/db/repo';
import { open, seal } from '@/lib/auth/secrets';
import { checkUrl } from '@/lib/ingest/ssrf';
import { record } from './audit';
import {
  authorizationUrl,
  createPkce,
  discover,
  exchangeCode,
  fetchJwks,
  verifyIdToken,
  OidcError,
  type IdentityClaims,
} from './oidc';

/**
 * Single sign-on.
 *
 * ── OIDC only. SAML is deliberately absent ──────────────────────────────────
 *
 * Every enterprise SSO conversation asks for SAML, and this does not implement
 * it — see ADR-0010 for the full argument. Briefly: SAML authentication turns
 * on verifying an XML digital signature over a document the attacker supplies,
 * and XML signature wrapping has produced authentication bypasses in almost
 * every implementation that has ever been audited, including several written
 * by people who do this full time. A half-correct SAML implementation is worse
 * than none, because it is trusted. Every provider an enterprise buyer is
 * likely to have — Okta, Entra, Google Workspace, Ping, JumpCloud, Auth0 —
 * speaks OIDC, which is JSON and JWS and has one signature over one string.
 *
 * ── The identity is the subject, never the email ────────────────────────────
 *
 * `sso_identities` keys on the provider's `sub` claim. Emails change when
 * people marry, get promoted into a new alias, or leave and their address is
 * reassigned to somebody else — and that last one is an account takeover if
 * email is the key. The email is used ONCE, to link an existing account at
 * first sign-in, and only when the provider says it is verified.
 */

export interface SsoConnection {
  id: string;
  orgId: string;
  name: string;
  issuer: string;
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  emailDomain: string;
  enforced: boolean;
  active: boolean;
  createdAt: string;
}

interface ConnectionRow {
  id: string;
  org_id: string;
  name: string;
  issuer: string;
  client_id: string;
  client_secret_cipher: string;
  authorize_url: string;
  token_url: string;
  jwks_url: string;
  email_domain: string;
  enforced: number;
  active: number;
  created_at: string;
}

function hydrate(row: ConnectionRow): SsoConnection {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    issuer: row.issuer,
    clientId: row.client_id,
    authorizeUrl: row.authorize_url,
    tokenUrl: row.token_url,
    jwksUrl: row.jwks_url,
    emailDomain: row.email_domain,
    enforced: row.enforced === 1,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

/** How long an in-flight authorisation attempt stays valid. */
export const STATE_TTL_SECONDS = 600;

function isAdmin(orgRole: string | null): boolean {
  return orgRole === 'owner' || orgRole === 'admin';
}

export interface ConnectionResult {
  ok: boolean;
  connection?: SsoConnection;
  error?: string;
}

/**
 * Create a connection. Org owners and admins only.
 *
 * Discovery runs HERE, at configuration time, rather than on every sign-in.
 * Two reasons: a typo in the issuer is caught by the person who made it, in
 * front of a form that can explain it — rather than by every employee at once,
 * at the sign-in screen, tomorrow morning. And a sign-in then does not depend
 * on the provider's discovery document being reachable at that instant.
 */
export async function createConnection(
  ctx: AuthContext,
  orgRole: string | null,
  input: {
    orgId: string;
    name: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    emailDomain?: string;
  },
  db: Database = getDb(),
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionResult> {
  if (!isAdmin(orgRole) && !ctx.isStaff) return { ok: false, error: 'Not found' };

  /*
   * The issuer is a URL an administrator supplies and this server then
   * fetches, on a schedule, from inside our network. That is the same
   * server-side request forgery shape as a webhook endpoint, so it goes
   * through the same policy module rather than a second one written here.
   */
  const verdict = checkUrl(input.issuer);
  if (!verdict.ok) {
    return {
      ok: false,
      error: verdict.detail ?? 'That issuer address is not allowed',
    };
  }

  if (!input.issuer.startsWith('https://')) {
    return { ok: false, error: 'An OIDC issuer must be https' };
  }

  let endpoints;
  try {
    endpoints = await discover(input.issuer, fetchImpl);
  } catch (cause) {
    const error = cause instanceof OidcError ? cause : null;
    return {
      ok: false,
      error:
        error?.code === 'issuer_mismatch'
          ? 'That provider reports a different issuer'
          : 'Could not read that provider’s configuration',
    };
  }

  const domain = (input.emailDomain ?? '').trim().toLowerCase().replace(/^@/, '');
  const id = `sso_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  try {
    db.prepare(
      `INSERT INTO sso_connections
         (id, org_id, name, issuer, client_id, client_secret_cipher,
          authorize_url, token_url, jwks_url, email_domain)
       VALUES (@id, @orgId, @name, @issuer, @clientId, @secret,
               @authorize, @token, @jwks, @domain)`,
    ).run({
      id,
      orgId: input.orgId,
      name: input.name.slice(0, 80),
      issuer: input.issuer.replace(/\/$/, ''),
      clientId: input.clientId.slice(0, 200),
      // Encrypted, not hashed: it must be sent to the provider on every token
      // exchange. See lib/auth/secrets.ts for why that decides the storage.
      secret: seal(input.clientSecret),
      authorize: endpoints.authorizationEndpoint,
      token: endpoints.tokenEndpoint,
      jwks: endpoints.jwksUri,
      domain,
    });
  } catch (cause) {
    if (String(cause).includes('UNIQUE')) {
      // Two orgs claiming one email domain would make routing ambiguous, and
      // whichever won would be signing in the other's staff.
      return {
        ok: false,
        error: 'Another organisation already claims that domain',
      };
    }
    throw cause;
  }

  record(
    {
      action: 'sso.connection_created',
      actorId: ctx.userId,
      orgId: input.orgId,
      targetType: 'sso_connection',
      targetId: id,
      metadata: { issuer: input.issuer, domain },
    },
    db,
  );

  return { ok: true, connection: getConnection(id, db) ?? undefined };
}

export function getConnection(
  connectionId: string,
  db: Database = getDb(),
): SsoConnection | null {
  const row = db
    .prepare('SELECT * FROM sso_connections WHERE id = ?')
    .get(connectionId) as ConnectionRow | undefined;

  return row ? hydrate(row) : null;
}

export function connectionsFor(
  ctx: AuthContext,
  orgId: string,
  orgRole: string | null,
  db: Database = getDb(),
): SsoConnection[] {
  if (!isAdmin(orgRole) && !ctx.isStaff) return [];

  const rows = db
    .prepare('SELECT * FROM sso_connections WHERE org_id = ? ORDER BY created_at')
    .all(orgId) as ConnectionRow[];

  return rows.map(hydrate);
}

/**
 * The connection an email address routes to, if any.
 *
 * Called from the sign-in screen with an address that may belong to nobody, so
 * it must not confirm whether an account exists — it answers only "is this
 * domain federated", which is a property of the domain and not of the person.
 */
export function connectionForEmail(
  email: string,
  db: Database = getDb(),
): SsoConnection | null {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;

  const row = db
    .prepare('SELECT * FROM sso_connections WHERE email_domain = ? AND active = 1')
    .get(domain) as ConnectionRow | undefined;

  return row ? hydrate(row) : null;
}

/**
 * Whether this person must use SSO rather than a password.
 *
 * ── The owner is exempt, deliberately ───────────────────────────────────────
 *
 * If enforcement covered everyone, a misconfigured connection would lock the
 * entire organisation out of its own account with no way back in — including
 * the person who would have to fix it. The owner keeping a password is the
 * break-glass path, and it is a smaller risk than an unrecoverable org.
 */
export function ssoRequiredFor(
  userId: string,
  email: string,
  db: Database = getDb(),
): SsoConnection | null {
  const connection = connectionForEmail(email, db);
  if (!connection?.enforced) return null;

  const owner = db
    .prepare('SELECT owner_id FROM organizations WHERE id = ?')
    .get(connection.orgId) as { owner_id: string } | undefined;

  if (owner?.owner_id === userId) return null;

  return connection;
}

export interface StartResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Begin a sign-in. Returns the URL to send the browser to.
 *
 * The state row is the CSRF defence for the callback: a callback carrying a
 * state we did not issue, or one already consumed, is refused. It is written
 * before the redirect and deleted the moment it is used.
 */
export function beginSignIn(
  connectionId: string,
  redirectUri: string,
  returnTo: string,
  db: Database = getDb(),
): StartResult {
  const connection = getConnection(connectionId, db);
  if (!connection?.active) return { ok: false, error: 'Not found' };

  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const pkce = createPkce();

  db.prepare(
    `INSERT INTO sso_states (state, connection_id, nonce, code_verifier, return_to, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
  ).run(
    state,
    connection.id,
    nonce,
    pkce.verifier,
    /*
     * Only a same-site path is stored. An open redirect on a sign-in callback
     * is a phishing primitive: land on the real product, authenticate for
     * real, and be bounced to an attacker's page that looks like the next
     * step. Anything not starting with a single slash is discarded.
     */
    /^\/[^/\\]/.test(returnTo) ? returnTo : '/app',
    `+${STATE_TTL_SECONDS} seconds`,
  );

  return {
    ok: true,
    url: authorizationUrl({
      authorizationEndpoint: connection.authorizeUrl,
      clientId: connection.clientId,
      redirectUri,
      state,
      nonce,
      codeChallenge: pkce.challenge,
    }),
  };
}

export interface CallbackResult {
  ok: boolean;
  userId?: string;
  connectionId?: string;
  returnTo?: string;
  /** True when this sign-in created the account. */
  provisioned?: boolean;
  error?: string;
}

interface StateRow {
  state: string;
  connection_id: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  expires_at: string;
}

/**
 * Complete a sign-in.
 *
 * The order below is the security of the whole feature, and each step must
 * come before the next:
 *
 *   1. consume the state — proves the callback answers a request WE made, and
 *      that it has not already been used;
 *   2. exchange the code with the PKCE verifier — proves the code belongs to
 *      the browser that started the flow;
 *   3. verify the ID token — proves the provider actually said this;
 *   4. only then, resolve or create the account.
 */
export async function completeSignIn(
  input: { state: string; code: string; redirectUri: string },
  db: Database = getDb(),
  fetchImpl: typeof fetch = fetch,
): Promise<CallbackResult> {
  /*
   * Consumed in one statement: SELECT then DELETE would let two concurrent
   * callbacks both read the same state and both proceed, which is exactly the
   * replay this row exists to prevent.
   */
  const stateRow = db
    .prepare('DELETE FROM sso_states WHERE state = ? RETURNING *')
    .get(input.state) as StateRow | undefined;

  if (!stateRow)
    return { ok: false, error: 'That sign-in link is no longer valid' };

  const expired = (
    db
      .prepare("SELECT (datetime('now') > datetime(?)) AS gone")
      .get(stateRow.expires_at) as { gone: number }
  ).gone;

  // Compared in SQL, not JavaScript: SQLite writes UTC with a space separator
  // and `new Date()` reads that as local time. The same bug was found in
  // password reset and in API key expiry; it is fixed the same way here.
  if (expired)
    return { ok: false, error: 'That sign-in took too long. Try again.' };

  const connection = getConnection(stateRow.connection_id, db);
  if (!connection?.active) return { ok: false, error: 'Not found' };

  const secretRow = db
    .prepare('SELECT client_secret_cipher FROM sso_connections WHERE id = ?')
    .get(connection.id) as { client_secret_cipher: string };

  let claims: IdentityClaims;

  try {
    const tokens = await exchangeCode(
      {
        tokenEndpoint: connection.tokenUrl,
        clientId: connection.clientId,
        clientSecret: open(secretRow.client_secret_cipher),
        code: input.code,
        codeVerifier: stateRow.code_verifier,
        redirectUri: input.redirectUri,
      },
      fetchImpl,
    );

    const keys = await fetchJwks(connection.jwksUrl, fetchImpl);

    claims = verifyIdToken(tokens.idToken, {
      issuer: connection.issuer,
      audience: connection.clientId,
      nonce: stateRow.nonce,
      keys,
    });
  } catch (cause) {
    const error = cause instanceof OidcError ? cause : null;

    /*
     * The specific failure is logged and never returned. "bad_audience" and
     * "bad_signature" tell an attacker probing a connection exactly which
     * check they have to defeat next; the person signing in cannot act on
     * either and only needs to know it did not work.
     */
    console.error('[sso] sign-in failed:', error?.code ?? String(cause));

    record(
      {
        action: 'auth.failed',
        orgId: connection.orgId,
        actorLabel: 'sso',
        targetType: 'sso_connection',
        targetId: connection.id,
        metadata: { reason: error?.code ?? 'unknown' },
      },
      db,
    );

    return { ok: false, error: 'Could not complete that sign-in' };
  }

  return resolveAccount(connection, claims, stateRow.return_to, db);
}

/**
 * Find or create the account behind a verified set of claims.
 *
 * ── The three cases, in order ───────────────────────────────────────────────
 *
 *   1. A known subject. Sign them in. This is almost every sign-in.
 *   2. An unknown subject with a VERIFIED email matching an existing account.
 *      Link them — the provider has vouched for the address.
 *   3. Neither. Create an account.
 *
 * Case 2 is where a mistake is expensive, which is why it insists on
 * `email_verified`. A provider that lets somebody claim an unverified address
 * would otherwise let them claim a colleague's account by typing their email
 * into a profile field.
 */
function resolveAccount(
  connection: SsoConnection,
  claims: IdentityClaims,
  returnTo: string,
  db: Database,
): CallbackResult {
  const existingIdentity = db
    .prepare(
      'SELECT user_id FROM sso_identities WHERE connection_id = ? AND subject = ?',
    )
    .get(connection.id, claims.subject) as { user_id: string } | undefined;

  if (existingIdentity) {
    db.prepare(
      "UPDATE sso_identities SET last_seen_at = datetime('now') WHERE connection_id = ? AND subject = ?",
    ).run(connection.id, claims.subject);

    record(
      {
        action: 'sso.signed_in',
        actorId: existingIdentity.user_id,
        orgId: connection.orgId,
        targetType: 'sso_connection',
        targetId: connection.id,
      },
      db,
    );

    return {
      ok: true,
      userId: existingIdentity.user_id,
      connectionId: connection.id,
      returnTo,
    };
  }

  /*
   * The email domain must match the connection's.
   *
   * A provider can assert any email it likes. Without this check, a
   * connection configured for example.com could sign somebody in as
   * somebody@rival.com — and if an account with that address already exists
   * here, case 2 below would hand it over.
   */
  const domain = claims.email.split('@')[1] ?? '';
  if (connection.emailDomain && domain !== connection.emailDomain) {
    console.error('[sso] refused a claim outside the connection’s domain');
    return { ok: false, error: 'That account is not part of this organisation' };
  }

  const byEmail = claims.email
    ? (db
        .prepare('SELECT id FROM users WHERE email_lower = ?')
        .get(claims.email) as { id: string } | undefined)
    : undefined;

  if (byEmail) {
    if (!claims.emailVerified) {
      return {
        ok: false,
        error: 'Your provider has not verified that email address',
      };
    }

    db.prepare(
      "INSERT INTO sso_identities (id, connection_id, subject, user_id, last_seen_at) VALUES (?, ?, ?, ?, datetime('now'))",
    ).run(randomUUID(), connection.id, claims.subject, byEmail.id);

    record(
      {
        action: 'sso.signed_in',
        actorId: byEmail.id,
        orgId: connection.orgId,
        metadata: { linked: true },
      },
      db,
    );

    return {
      ok: true,
      userId: byEmail.id,
      connectionId: connection.id,
      returnTo,
    };
  }

  if (!claims.email) {
    return { ok: false, error: 'Your provider did not share an email address' };
  }

  // ---- provision ----------------------------------------------------------

  const userId = randomUUID();
  const display = claims.name || claims.email.split('@')[0] || 'Member';

  db.transaction(() => {
    createUser(
      {
        id: userId,
        email: claims.email,
        /*
         * No password hash a password can ever produce.
         *
         * A provisioned account must not be reachable by the password form:
         * this row exists because an identity provider vouched for someone,
         * and the sentinel makes "sign in with a password" impossible rather
         * than merely unlikely. Setting a real password goes through the
         * ordinary reset flow, which proves control of the mailbox.
         */
        passwordHash: 'sso-only:no-password',
        handle: uniqueHandleFor(display, db),
        displayName: display.slice(0, 80),
      },
      db,
    );

    db.prepare(
      "INSERT INTO sso_identities (id, connection_id, subject, user_id, last_seen_at) VALUES (?, ?, ?, ?, datetime('now'))",
    ).run(randomUUID(), connection.id, claims.subject, userId);

    /*
     * Provisioned into the organisation as an editor.
     *
     * Membership is the point of SSO — an account that signed in through the
     * company's provider and then belonged to nothing would leave an admin
     * adding every employee by hand. Editor rather than admin: the provider
     * vouches for who somebody is, never for what they should be allowed to
     * do here.
     */
    db.prepare(
      `INSERT OR IGNORE INTO organization_members (org_id, user_id, role)
       VALUES (?, ?, 'editor')`,
    ).run(connection.orgId, userId);
  })();

  record(
    {
      action: 'sso.provisioned_user',
      actorId: userId,
      orgId: connection.orgId,
      actorLabel: claims.email,
      metadata: { subject: claims.subject },
    },
    db,
  );

  return {
    ok: true,
    userId,
    connectionId: connection.id,
    returnTo,
    provisioned: true,
  };
}

/** A handle nobody is using. Mirrors the one in `accounts.ts`. */
function uniqueHandleFor(seed: string, db: Database): string {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'member';

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`;
    const taken = db.prepare('SELECT 1 FROM users WHERE handle = ?').get(candidate);

    if (!taken) return candidate;
  }

  return `${base}-${randomBytes(4).toString('hex')}`;
}

export interface UpdateResult {
  ok: boolean;
  error?: string;
}

/** Turn enforcement on or off, or deactivate a connection. */
export function updateConnection(
  ctx: AuthContext,
  orgRole: string | null,
  connectionId: string,
  patch: { enforced?: boolean; active?: boolean; emailDomain?: string },
  db: Database = getDb(),
): UpdateResult {
  if (!isAdmin(orgRole) && !ctx.isStaff) return { ok: false, error: 'Not found' };

  const connection = getConnection(connectionId, db);
  if (!connection) return { ok: false, error: 'Not found' };

  /*
   * Enforcement cannot be switched on until somebody has actually signed in
   * through the connection.
   *
   * Without this, an administrator can enforce SSO on a misconfigured
   * connection and lock out their entire organisation in one click — having
   * never once proved the configuration works. Requiring one successful
   * sign-in makes that impossible to do by accident.
   */
  if (patch.enforced === true) {
    const proven = db
      .prepare('SELECT 1 FROM sso_identities WHERE connection_id = ? LIMIT 1')
      .get(connectionId);

    if (!proven) {
      return {
        ok: false,
        error: 'Sign in through this connection once before enforcing it',
      };
    }
  }

  db.prepare(
    `UPDATE sso_connections SET
       enforced = COALESCE(@enforced, enforced),
       active = COALESCE(@active, active),
       email_domain = COALESCE(@domain, email_domain)
     WHERE id = @id`,
  ).run({
    id: connectionId,
    enforced: patch.enforced === undefined ? null : patch.enforced ? 1 : 0,
    active: patch.active === undefined ? null : patch.active ? 1 : 0,
    domain:
      patch.emailDomain === undefined
        ? null
        : patch.emailDomain.trim().toLowerCase().replace(/^@/, ''),
  });

  record(
    {
      action: 'sso.connection_updated',
      actorId: ctx.userId,
      orgId: connection.orgId,
      targetType: 'sso_connection',
      targetId: connectionId,
      metadata: { ...patch },
    },
    db,
  );

  return { ok: true };
}

/**
 * Delete a connection, and every session it minted.
 *
 * Leaving those sessions alive would mean removing an identity provider had no
 * effect until each one expired — which for a compromised provider is the
 * whole emergency.
 */
export function deleteConnection(
  ctx: AuthContext,
  orgRole: string | null,
  connectionId: string,
  db: Database = getDb(),
): UpdateResult {
  if (!isAdmin(orgRole) && !ctx.isStaff) return { ok: false, error: 'Not found' };

  const connection = getConnection(connectionId, db);
  if (!connection) return { ok: false, error: 'Not found' };

  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE sso_connection_id = ?').run(
      connectionId,
    );
    db.prepare('DELETE FROM sso_connections WHERE id = ?').run(connectionId);
  })();

  record(
    {
      action: 'sso.connection_deleted',
      actorId: ctx.userId,
      orgId: connection.orgId,
      targetType: 'sso_connection',
      targetId: connectionId,
    },
    db,
  );

  return { ok: true };
}

/** Remove expired authorisation attempts. */
export function pruneStates(db: Database = getDb()): number {
  return db
    .prepare("DELETE FROM sso_states WHERE expires_at < datetime('now')")
    .run().changes;
}

/** Identities linked to one person, for their security screen. */
export function identitiesFor(
  userId: string,
  db: Database = getDb(),
): { connectionId: string; connectionName: string; lastSeenAt: string | null }[] {
  const rows = db
    .prepare(
      `SELECT sso_identities.connection_id, sso_identities.last_seen_at,
              sso_connections.name AS connection_name
         FROM sso_identities
         JOIN sso_connections ON sso_connections.id = sso_identities.connection_id
        WHERE sso_identities.user_id = ?`,
    )
    .all(userId) as {
    connection_id: string;
    connection_name: string;
    last_seen_at: string | null;
  }[];

  return rows.map((row) => ({
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    lastSeenAt: row.last_seen_at,
  }));
}

/** Whether an account can sign in with a password at all. */
export function hasPassword(userId: string, db: Database = getDb()): boolean {
  const user = getUserById(userId, db);
  return Boolean(user) && !isSsoOnlyHash(passwordHashOf(userId, db));
}

function passwordHashOf(userId: string, db: Database): string {
  const row = db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(userId) as { password_hash: string } | undefined;

  return row?.password_hash ?? '';
}

/** The sentinel a provisioned account carries instead of a password hash. */
export function isSsoOnlyHash(hash: string): boolean {
  return hash === 'sso-only:no-password';
}
