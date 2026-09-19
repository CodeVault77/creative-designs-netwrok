import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import { createOrganization } from '@/lib/orgs/repo';
import {
  AUDIT_ACTIONS,
  isAuditAction,
  queryOrg,
  querySelf,
  record,
  summarise,
  sweepRetention,
  toCsv,
} from './audit';
import {
  accentStyle,
  brandingForHost,
  claimDomain,
  isHexColour,
  settingsFor,
  updateSettings,
  verifyDomain,
} from './branding';
import {
  connectionForEmail,
  createConnection,
  ssoRequiredFor,
  updateConnection,
} from './sso';

/**
 * Enterprise tests: audit, branding, SSO configuration.
 *
 * Three things here can go badly wrong, and each gets a block:
 *
 *   the audit log     read by somebody it is not about, or forged;
 *   branding          customer-supplied text reaching CSS or a spreadsheet
 *                     formula;
 *   SSO enforcement   an organisation locking itself out with one click.
 */

let db: Database;
let owner: { userId: string; isStaff: boolean };
let member: { userId: string; isStaff: boolean };
let outsider: { userId: string; isStaff: boolean };
let staff: { userId: string; isStaff: boolean };
let orgId: string;

beforeEach(() => {
  db = createTestDb();

  for (const [id, handle] of [
    ['u_owner', 'owner'],
    ['u_member', 'member'],
    ['u_outsider', 'outsider'],
    ['u_staff', 'staffer'],
  ] as const) {
    createUser(
      {
        id,
        email: `${handle}@example.com`,
        passwordHash: 'x',
        handle,
        displayName: handle,
      },
      db,
    );
  }

  owner = { userId: 'u_owner', isStaff: false };
  member = { userId: 'u_member', isStaff: false };
  outsider = { userId: 'u_outsider', isStaff: false };
  staff = { userId: 'u_staff', isStaff: true };

  const org = createOrganization(owner, 'Example Co', db);
  orgId = org.org!.id;

  db.prepare(
    "INSERT INTO organization_members (org_id, user_id, role) VALUES (?, 'u_member', 'editor')",
  ).run(orgId);
});

// ---------------------------------------------------------------- audit log

describe('the audit log', () => {
  it('records an action', () => {
    record(
      {
        action: 'org.member_added',
        actorId: 'u_owner',
        actorLabel: 'owner@example.com',
        orgId,
        targetType: 'user',
        targetId: 'u_member',
      },
      db,
    );

    const entries = queryOrg(owner, orgId, 'owner', {}, db);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('org.member_added');
  });

  it('is unreadable by a member who is not an admin', () => {
    /*
     * An audit log lists who did what and when. A non-admin member reading it
     * learns their colleagues' activity, which is not theirs to see.
     */
    record({ action: 'org.member_added', orgId, actorId: 'u_owner' }, db);

    expect(queryOrg(member, orgId, 'editor', {}, db)).toEqual([]);
    expect(summarise(member, orgId, 'editor', 30, db)).toEqual([]);
  });

  it('is unreadable by somebody outside the organisation', () => {
    record({ action: 'org.member_added', orgId, actorId: 'u_owner' }, db);

    expect(queryOrg(outsider, orgId, null, {}, db)).toEqual([]);
  });

  it('is readable by staff', () => {
    record({ action: 'org.member_added', orgId, actorId: 'u_owner' }, db);

    expect(queryOrg(staff, orgId, null, {}, db)).toHaveLength(1);
  });

  it('lets a person read their own trail whatever their role', () => {
    // It is about them. Withholding it would be withholding their own
    // security history.
    record({ action: 'auth.signed_in', actorId: 'u_member' }, db);

    expect(querySelf(member, 100, db)).toHaveLength(1);
    expect(querySelf(outsider, 100, db)).toHaveLength(0);
  });

  it('keeps the actor readable after the account is deleted', () => {
    /*
     * The reason `actor_label` is denormalised. Normalising would be correct
     * database design and useless here: "user 4a7f… removed a member" is not
     * an audit trail.
     */
    record(
      {
        action: 'org.member_removed',
        actorId: 'u_member',
        actorLabel: 'member@example.com',
        orgId,
      },
      db,
    );

    db.prepare('DELETE FROM users WHERE id = ?').run('u_member');

    const entry = queryOrg(owner, orgId, 'owner', {}, db)[0];

    expect(entry?.actorId).toBeNull();
    expect(entry?.actorLabel).toBe('member@example.com');
  });

  it('never stores a raw IP address', () => {
    record(
      {
        action: 'auth.signed_in',
        actorId: 'u_owner',
        orgId,
        clientIp: '203.0.113.9',
      },
      db,
    );

    const row = db.prepare('SELECT client_hash FROM audit_log LIMIT 1').get() as {
      client_hash: string;
    };

    expect(row.client_hash).not.toContain('203.0.113');
    expect(row.client_hash.length).toBeGreaterThan(10);
  });

  it('does not throw when a write fails', () => {
    /*
     * An audit write that failed the action it was recording would be the
     * worst possible trade: somebody unable to sign out because the log was
     * full. The failure is loud in stderr and the action proceeds.
     */
    db.prepare('DROP TABLE audit_log').run();

    expect(() =>
      record({ action: 'auth.signed_in', actorId: 'u_owner' }, db),
    ).not.toThrow();
  });

  it('filters by action', () => {
    record({ action: 'auth.signed_in', actorId: 'u_owner', orgId }, db);
    record({ action: 'mfa.enabled', actorId: 'u_owner', orgId }, db);

    expect(
      queryOrg(owner, orgId, 'owner', { action: 'mfa.enabled' }, db),
    ).toHaveLength(1);
  });

  it('recognises exactly the published vocabulary', () => {
    // A closed list, so an auditor filtering by action has stable terms and a
    // typo'd action is not a row nobody will ever find.
    expect(isAuditAction('auth.signed_in')).toBe(true);
    expect(isAuditAction('auth.did_a_thing')).toBe(false);
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(20);
  });

  it('summarises by action', () => {
    record({ action: 'auth.signed_in', actorId: 'u_owner', orgId }, db);
    record({ action: 'auth.signed_in', actorId: 'u_member', orgId }, db);
    record({ action: 'mfa.enabled', actorId: 'u_owner', orgId }, db);

    const summary = summarise(owner, orgId, 'owner', 30, db);

    expect(summary[0]).toEqual({ action: 'auth.signed_in', count: 2 });
  });

  it('sweeps only what is past the window, and says so', () => {
    record({ action: 'auth.signed_in', actorId: 'u_owner', orgId }, db);

    db.prepare(
      "UPDATE audit_log SET created_at = datetime('now', '-800 days')",
    ).run();

    record({ action: 'mfa.enabled', actorId: 'u_owner', orgId }, db);

    expect(sweepRetention(730, db)).toBe(1);

    expect(queryOrg(owner, orgId, 'owner', {}, db).map((e) => e.action)).toEqual([
      'mfa.enabled',
    ]);

    /*
     * The sweep records ITSELF — a log with a silent gap is worse than one
     * that says how many rows went and when — but with NO org id, because a
     * retention sweep is system-wide rather than something that happened to
     * one organisation. So it is deliberately absent from the org-scoped
     * query above and present in the table.
     */
    const swept = db
      .prepare(
        "SELECT org_id, metadata FROM audit_log WHERE action = 'audit.retention_swept'",
      )
      .get() as { org_id: string | null; metadata: string };

    expect(swept.org_id).toBeNull();
    expect(JSON.parse(swept.metadata)).toMatchObject({ removed: 1, days: 730 });
  });
});

describe('the CSV export', () => {
  it('neutralises a formula', () => {
    /*
     * A field beginning =, +, - or @ is EXECUTED by Excel and Sheets when the
     * file is opened. An audit log is full of attacker-influenced strings — a
     * display name, a map title — so the export is a delivery mechanism for
     * that unless every such field is prefixed.
     */
    const csv = toCsv([
      {
        id: 'a1',
        orgId,
        actorId: 'u_x',
        actorLabel: '=HYPERLINK("http://evil.example.com","click")',
        action: 'auth.signed_in',
        targetType: '',
        targetId: '',
        metadata: {},
        createdAt: '2026-01-01 00:00:00',
      },
    ]);

    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it('escapes embedded quotes', () => {
    const csv = toCsv([
      {
        id: 'a1',
        orgId,
        actorId: null,
        actorLabel: 'says "hello"',
        action: 'auth.signed_in',
        targetType: '',
        targetId: '',
        metadata: {},
        createdAt: '2026-01-01 00:00:00',
      },
    ]);

    expect(csv).toContain('"says ""hello"""');
  });

  it('starts with a header row', () => {
    expect(toCsv([]).split('\r\n')[0]).toBe(
      'timestamp,action,actor,actor_id,target_type,target_id,metadata',
    );
  });
});

// ----------------------------------------------------------------- branding

describe('branding', () => {
  it('accepts a hex colour and nothing else', () => {
    expect(isHexColour('#4F46E5')).toBe(true);
    expect(isHexColour('#abc')).toBe(true);
    expect(isHexColour('red')).toBe(false);
    expect(isHexColour('#4F46E5; } body { display: none')).toBe(false);
  });

  it('refuses an accent that would escape the CSS declaration', () => {
    /*
     * The single most important assertion in this block. The value is
     * interpolated into a custom property — anything that is not a hex colour
     * closes the declaration and becomes a stylesheet the customer wrote,
     * which on our pages is arbitrary content injection.
     */
    const result = updateSettings(
      owner,
      orgId,
      'owner',
      { brandAccent: 'red; } body { display: none } .x {' },
      db,
    );

    expect(result.ok).toBe(false);
    expect(settingsFor(orgId, db).brandAccent).toBe('');
  });

  it('emits no style at all for an invalid stored accent', () => {
    // Re-validated on the way OUT. A validator enforced at only one end is one
    // refactor away from not being enforced.
    expect(
      accentStyle({ name: '', logoUrl: '', accent: 'red', supportEmail: '' }),
    ).toEqual({});
    expect(
      accentStyle({ name: '', logoUrl: '', accent: '#4F46E5', supportEmail: '' }),
    ).toEqual({ '--brand-accent': '#4F46E5' });
  });

  it('refuses a logo pointing inside our network', () => {
    for (const url of ['http://169.254.169.254/', 'http://localhost/logo.png']) {
      expect(
        updateSettings(owner, orgId, 'owner', { brandLogoUrl: url }, db).ok,
      ).toBe(false);
    }
  });

  it('refuses an http logo', () => {
    // Mixed content: browsers block it, so the logo silently fails to appear
    // and looks like our bug.
    expect(
      updateSettings(
        owner,
        orgId,
        'owner',
        { brandLogoUrl: 'http://example.com/logo.png' },
        db,
      ).ok,
    ).toBe(false);
  });

  it('refuses a change from a non-admin member', () => {
    expect(
      updateSettings(member, orgId, 'editor', { brandName: 'Theirs' }, db).ok,
    ).toBe(false);
    expect(settingsFor(orgId, db).brandName).toBe('');
  });

  it('defaults rather than returning null for an org with no row', () => {
    const settings = settingsFor(orgId, db);

    expect(settings.requireMfa).toBe(false);
    expect(settings.brandName).toBe('');
  });

  it('stores a policy change', () => {
    updateSettings(owner, orgId, 'owner', { requireMfa: true }, db);

    expect(settingsFor(orgId, db).requireMfa).toBe(true);
  });
});

describe('custom domains', () => {
  it('issues a token but serves nothing until verified', () => {
    /*
     * Claiming is not owning. Anyone can type `maps.google.com` into a form;
     * serving it would let them host a page on somebody else's brand at our
     * expense.
     */
    const claim = claimDomain(owner, orgId, 'owner', 'maps.example.com', db);

    expect(claim.ok).toBe(true);
    expect(claim.token).toMatch(/^cdn-verify-/);
    expect(brandingForHost('maps.example.com', db)).toBeNull();
  });

  it('serves the branding once the TXT record matches', async () => {
    const claim = claimDomain(owner, orgId, 'owner', 'maps.example.com', db);
    updateSettings(
      owner,
      orgId,
      'owner',
      { brandName: 'Example', brandAccent: '#123456' },
      db,
    );

    const result = await verifyDomain(owner, orgId, 'owner', db, async () => [
      [claim.token!],
    ]);

    expect(result.ok).toBe(true);
    expect(brandingForHost('maps.example.com', db)?.name).toBe('Example');
  });

  it('refuses a token that does not match', async () => {
    claimDomain(owner, orgId, 'owner', 'maps.example.com', db);

    const result = await verifyDomain(owner, orgId, 'owner', db, async () => [
      ['some-other-value'],
    ]);

    expect(result.ok).toBe(false);
    expect(brandingForHost('maps.example.com', db)).toBeNull();
  });

  it('joins a TXT record split across chunks', async () => {
    // A resolver may split a long TXT value at 255 bytes, and our token is
    // long enough for that to happen.
    const claim = claimDomain(owner, orgId, 'owner', 'maps.example.com', db);
    const token = claim.token!;

    const result = await verifyDomain(owner, orgId, 'owner', db, async () => [
      [token.slice(0, 10), token.slice(10)],
    ]);

    expect(result.ok).toBe(true);
  });

  it('reports a DNS failure as "not visible yet"', async () => {
    // NXDOMAIN and a timeout are the same answer to somebody waiting for
    // propagation, and the honest one.
    claimDomain(owner, orgId, 'owner', 'maps.example.com', db);

    const result = await verifyDomain(owner, orgId, 'owner', db, async () => {
      throw new Error('ENOTFOUND');
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DNS/i);
  });

  it('resets verification when the domain changes', async () => {
    const first = claimDomain(owner, orgId, 'owner', 'a.example.com', db);
    await verifyDomain(owner, orgId, 'owner', db, async () => [[first.token!]]);

    claimDomain(owner, orgId, 'owner', 'b.example.com', db);

    // Otherwise a new domain would inherit the previous one's proof.
    expect(brandingForHost('b.example.com', db)).toBeNull();
    expect(settingsFor(orgId, db).domainVerified).toBe(false);
  });

  it('refuses something that is not a hostname', () => {
    for (const bad of ['not a domain', 'localhost', '', 'http://']) {
      expect(claimDomain(owner, orgId, 'owner', bad, db).ok).toBe(false);
    }
  });

  it('refuses a claim from a non-admin', () => {
    expect(claimDomain(member, orgId, 'editor', 'maps.example.com', db).ok).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------- SSO

describe('SSO configuration', () => {
  const DISCOVERY = {
    issuer: 'https://idp.example.com',
    authorization_endpoint: 'https://idp.example.com/authorize',
    token_endpoint: 'https://idp.example.com/token',
    jwks_uri: 'https://idp.example.com/jwks',
  };

  const fetchOk = (async () =>
    new Response(JSON.stringify(DISCOVERY))) as unknown as typeof fetch;

  async function connect(domain = 'example.com') {
    return createConnection(
      owner,
      'owner',
      {
        orgId,
        name: 'Example IdP',
        issuer: 'https://idp.example.com',
        clientId: 'client-abc',
        clientSecret: 'shh',
        emailDomain: domain,
      },
      db,
      fetchOk,
    );
  }

  it('creates a connection and stores the secret encrypted', async () => {
    const result = await connect();

    expect(result.ok).toBe(true);

    const row = db
      .prepare('SELECT client_secret_cipher FROM sso_connections WHERE id = ?')
      .get(result.connection!.id) as { client_secret_cipher: string };

    expect(row.client_secret_cipher).not.toContain('shh');
  });

  it('refuses an issuer pointing inside our network', async () => {
    /*
     * An issuer is a URL an administrator supplies and this server then
     * fetches, repeatedly, from inside our network. Same SSRF shape as a
     * webhook endpoint, and it goes through the same policy module.
     */
    const result = await createConnection(
      owner,
      'owner',
      {
        orgId,
        name: 'Sneaky',
        issuer: 'http://169.254.169.254/',
        clientId: 'c',
        clientSecret: 's',
      },
      db,
      fetchOk,
    );

    expect(result.ok).toBe(false);
  });

  it('refuses an http issuer', async () => {
    const result = await createConnection(
      owner,
      'owner',
      {
        orgId,
        name: 'Insecure',
        issuer: 'http://idp.example.com',
        clientId: 'c',
        clientSecret: 's',
      },
      db,
      fetchOk,
    );

    expect(result.ok).toBe(false);
  });

  it('refuses a connection from a non-admin member', async () => {
    const result = await createConnection(
      member,
      'editor',
      {
        orgId,
        name: 'Theirs',
        issuer: 'https://idp.example.com',
        clientId: 'c',
        clientSecret: 's',
      },
      db,
      fetchOk,
    );

    expect(result.ok).toBe(false);
  });

  it('will not let two organisations claim one email domain', async () => {
    await connect('example.com');

    const other = createOrganization(member, 'Rival', db);

    const clash = await createConnection(
      member,
      'owner',
      {
        orgId: other.org!.id,
        name: 'Rival IdP',
        issuer: 'https://idp.example.com',
        clientId: 'c2',
        clientSecret: 's2',
        emailDomain: 'example.com',
      },
      db,
      fetchOk,
    );

    // Whichever won would be signing in the other organisation's staff.
    expect(clash.ok).toBe(false);
  });

  it('routes an address to its connection', async () => {
    await connect('example.com');

    expect(connectionForEmail('someone@example.com', db)?.name).toBe('Example IdP');
    expect(connectionForEmail('someone@elsewhere.com', db)).toBeNull();
  });

  it('will not enforce a connection nobody has ever used', async () => {
    /*
     * Without this, an admin can enforce SSO on a misconfigured connection and
     * lock out their whole organisation in one click, having never proved the
     * configuration works.
     */
    const created = await connect();

    const result = updateConnection(
      owner,
      'owner',
      created.connection!.id,
      { enforced: true },
      db,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sign in through this connection once/i);
  });

  it('enforces once somebody has signed in through it', async () => {
    const created = await connect();

    db.prepare(
      'INSERT INTO sso_identities (id, connection_id, subject, user_id) VALUES (?, ?, ?, ?)',
    ).run('id1', created.connection!.id, 'subject-1', 'u_member');

    expect(
      updateConnection(
        owner,
        'owner',
        created.connection!.id,
        { enforced: true },
        db,
      ).ok,
    ).toBe(true);

    expect(ssoRequiredFor('u_member', 'member@example.com', db)?.name).toBe(
      'Example IdP',
    );
  });

  it('exempts the organisation owner from enforcement', async () => {
    /*
     * The break-glass path. If enforcement covered everyone, a misconfigured
     * connection would lock the organisation out of its own account with no
     * way back in — including the person who would have to fix it.
     */
    const created = await connect();

    db.prepare(
      'INSERT INTO sso_identities (id, connection_id, subject, user_id) VALUES (?, ?, ?, ?)',
    ).run('id1', created.connection!.id, 'subject-1', 'u_member');

    updateConnection(
      owner,
      'owner',
      created.connection!.id,
      { enforced: true },
      db,
    );

    expect(ssoRequiredFor('u_owner', 'owner@example.com', db)).toBeNull();
  });

  it('does not enforce for an unfederated domain', async () => {
    await connect('example.com');

    expect(ssoRequiredFor('u_member', 'someone@elsewhere.com', db)).toBeNull();
  });
});
