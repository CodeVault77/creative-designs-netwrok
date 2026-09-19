import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from './client';
import type { AuthContext } from './repo';
import {
  canAssignRole,
  canRemoveMember,
  isRole,
  type Role,
} from '@/lib/sharing/roles';

/**
 * Sharing: tokens, members, invites.
 *
 * Same contract as `repo.ts` — every function takes an AuthContext first, and
 * the raw handle never escapes. `chokepoint.test.ts` covers this file too.
 *
 * Tokens are stored HASHED. A share link and an invite link are both bearer
 * credentials: whoever holds the string gets the access. Storing them in
 * plaintext means a database dump is a set of working links, and unlike a
 * password nobody can change them.
 */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

// ------------------------------------------------------------- share tokens

export interface ShareLink {
  token: string;
  createdAt: string;
}

/**
 * Creates a share link, revoking any previous one.
 *
 * One live link per map. Several would each need their own revoke control and
 * their own "who has this" answer, and §08's share sheet has one Revoke
 * button — matching the model to the UI keeps both honest.
 */
export function createShareToken(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): ShareLink | null {
  const owns = db
    .prepare('SELECT 1 FROM maps WHERE id = ? AND owner_id = ?')
    .get(mapId, ctx.userId);
  if (!owns) return null;

  const token = newToken();
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    db.prepare(
      'UPDATE share_tokens SET revoked_at = ? WHERE map_id = ? AND revoked_at IS NULL',
    ).run(now, mapId);

    db.prepare(
      'INSERT INTO share_tokens (id, map_id, created_by, created_at) VALUES (?, ?, ?, ?)',
    ).run(hashToken(token), mapId, ctx.userId, now);
  });

  run();
  return { token, createdAt: now };
}

export function revokeShareTokens(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): boolean {
  const result = db
    .prepare(
      `UPDATE share_tokens SET revoked_at = ?
       WHERE map_id = ?
         AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM maps WHERE maps.id = ? AND maps.owner_id = ?)`,
    )
    .run(new Date().toISOString(), mapId, mapId, ctx.userId);

  return result.changes > 0;
}

export function hasActiveShareToken(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM share_tokens
         WHERE map_id = ?
           AND revoked_at IS NULL
           AND EXISTS (SELECT 1 FROM maps WHERE maps.id = ? AND maps.owner_id = ?)`,
      )
      .get(mapId, mapId, ctx.userId) !== undefined
  );
}

/**
 * Resolves a share token to a map id.
 *
 * No AuthContext: the token IS the authorisation, exactly like a session
 * cookie. That is why it is hashed, single-purpose, and revocable.
 */
export function mapIdForShareToken(
  token: string,
  db: Database = getDb(),
): string | null {
  const row = db
    .prepare('SELECT map_id FROM share_tokens WHERE id = ? AND revoked_at IS NULL')
    .get(hashToken(token)) as { map_id: string } | undefined;

  return row?.map_id ?? null;
}

// ------------------------------------------------------------------ members

export interface MemberRow {
  userId: string;
  handle: string;
  displayName: string;
  role: Role;
  addedAt: string;
}

export function getRole(
  userId: string | null,
  mapId: string,
  db: Database = getDb(),
): Role | null {
  if (!userId) return null;

  const owner = db
    .prepare('SELECT 1 FROM maps WHERE id = ? AND owner_id = ?')
    .get(mapId, userId);
  if (owner) return 'owner';

  const row = db
    .prepare('SELECT role FROM map_members WHERE map_id = ? AND user_id = ?')
    .get(mapId, userId) as { role: string } | undefined;

  return row && isRole(row.role) ? row.role : null;
}

/** Members are visible to anyone who can view the map — you should know who else is here. */
export function listMembers(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): MemberRow[] {
  const viewerRole = getRole(ctx.userId, mapId, db);
  if (!viewerRole && !ctx.isStaff) return [];

  const owner = db
    .prepare(
      `SELECT users.id, users.handle, users.display_name, maps.created_at
       FROM maps JOIN users ON users.id = maps.owner_id WHERE maps.id = ?`,
    )
    .get(mapId) as
    | { id: string; handle: string; display_name: string; created_at: string }
    | undefined;

  const rows = db
    .prepare(
      `SELECT users.id, users.handle, users.display_name, map_members.role, map_members.added_at
       FROM map_members
       JOIN users ON users.id = map_members.user_id
       WHERE map_members.map_id = ?
       ORDER BY map_members.added_at ASC`,
    )
    .all(mapId) as {
    id: string;
    handle: string;
    display_name: string;
    role: string;
    added_at: string;
  }[];

  const members: MemberRow[] = rows
    .filter((row) => isRole(row.role))
    .map((row) => ({
      userId: row.id,
      handle: row.handle,
      displayName: row.display_name,
      role: row.role as Role,
      addedAt: row.added_at,
    }));

  // The owner is not a row in map_members — they are the map. Prepending
  // them here keeps the UI list complete without a phantom membership row
  // that could be deleted.
  if (owner) {
    members.unshift({
      userId: owner.id,
      handle: owner.handle,
      displayName: owner.display_name,
      role: 'owner',
      addedAt: owner.created_at,
    });
  }

  return members;
}

export function setMemberRole(
  ctx: AuthContext,
  mapId: string,
  targetUserId: string,
  newRole: Role,
  db: Database = getDb(),
): boolean {
  const actorRole = getRole(ctx.userId, mapId, db);
  const targetRole = getRole(targetUserId, mapId, db);

  // The whole decision is one call into the pure matrix, so the rules live in
  // one place and are tested cell by cell.
  if (!canAssignRole(actorRole, targetRole, newRole)) return false;

  const result = db
    .prepare('UPDATE map_members SET role = ? WHERE map_id = ? AND user_id = ?')
    .run(newRole, mapId, targetUserId);

  return result.changes > 0;
}

export function removeMember(
  ctx: AuthContext,
  mapId: string,
  targetUserId: string,
  db: Database = getDb(),
): boolean {
  const actorRole = getRole(ctx.userId, mapId, db);
  const targetRole = getRole(targetUserId, mapId, db);

  if (!canRemoveMember(actorRole, ctx.userId, targetRole, targetUserId))
    return false;

  const result = db
    .prepare('DELETE FROM map_members WHERE map_id = ? AND user_id = ?')
    .run(mapId, targetUserId);

  return result.changes > 0;
}

export function addMember(
  mapId: string,
  userId: string,
  role: Role,
  db: Database = getDb(),
): void {
  db.prepare(
    `INSERT INTO map_members (map_id, user_id, role, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(map_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(mapId, userId, role, new Date().toISOString());
}

// ------------------------------------------------------------------ invites

export interface InviteRow {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

const INVITE_TTL_DAYS = 14;

export interface CreatedInvite {
  id: string;
  token: string;
  email: string;
  role: Role;
}

export function createInvite(
  ctx: AuthContext,
  mapId: string,
  email: string,
  role: Role,
  db: Database = getDb(),
): CreatedInvite | null {
  const actorRole = getRole(ctx.userId, mapId, db);
  if (!actorRole) return null;

  // Inviting someone at a role you could not assign them is the same
  // escalation by another route, so it goes through the same check.
  if (!canAssignRole(actorRole, null, role)) return null;

  const token = newToken();
  const now = new Date();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO map_invites
       (id, map_id, email_lower, role, token, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     -- Re-inviting the same address replaces the pending invite rather than
     -- stacking duplicates, and issues a fresh token so the old link dies.
     ON CONFLICT(map_id, email_lower) WHERE accepted_at IS NULL
     DO UPDATE SET role = excluded.role, token = excluded.token,
                   created_at = excluded.created_at, expires_at = excluded.expires_at`,
  ).run(
    id,
    mapId,
    email.toLowerCase(),
    role,
    hashToken(token),
    ctx.userId,
    now.toISOString(),
    new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
  );

  return { id, token, email, role };
}

export function listPendingInvites(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): InviteRow[] {
  const actorRole = getRole(ctx.userId, mapId, db);
  // Pending invites reveal who the owner is trying to bring in, which is not
  // everyone's business — only people who can invite may see them.
  if (!actorRole || (actorRole !== 'owner' && actorRole !== 'admin')) return [];

  const rows = db
    .prepare(
      `SELECT id, email_lower, role, created_at, expires_at
       FROM map_invites
       WHERE map_id = ? AND accepted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(mapId) as {
    id: string;
    email_lower: string;
    role: string;
    created_at: string;
    expires_at: string;
  }[];

  return rows
    .filter((r) => isRole(r.role))
    .map((r) => ({
      id: r.id,
      email: r.email_lower,
      role: r.role as Role,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
}

export function revokeInvite(
  ctx: AuthContext,
  mapId: string,
  inviteId: string,
  db: Database = getDb(),
): boolean {
  const actorRole = getRole(ctx.userId, mapId, db);
  if (!actorRole || (actorRole !== 'owner' && actorRole !== 'admin')) return false;

  const result = db
    .prepare(
      'DELETE FROM map_invites WHERE id = ? AND map_id = ? AND accepted_at IS NULL',
    )
    .run(inviteId, mapId);

  return result.changes > 0;
}

export type AcceptResult =
  | { ok: true; mapId: string; role: Role }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * Accepts an invite.
 *
 * No AuthContext for the lookup — the token is the credential — but a userId
 * is required to become a member, so a signed-out click sends the person to
 * sign in and back.
 */
export function acceptInvite(
  token: string,
  userId: string,
  db: Database = getDb(),
): AcceptResult {
  const row = db
    .prepare(
      'SELECT id, map_id, role, expires_at, accepted_at FROM map_invites WHERE token = ?',
    )
    .get(hashToken(token)) as
    | {
        id: string;
        map_id: string;
        role: string;
        expires_at: string;
        accepted_at: string | null;
      }
    | undefined;

  if (!row || !isRole(row.role)) return { ok: false, reason: 'invalid' };
  if (row.accepted_at) return { ok: false, reason: 'used' };
  if (new Date(row.expires_at) < new Date())
    return { ok: false, reason: 'expired' };

  const role = row.role as Role;

  const run = db.transaction(() => {
    // The owner accepting their own invite would demote them to a member and
    // leave the map without an owner in the members list.
    const owner = db
      .prepare('SELECT 1 FROM maps WHERE id = ? AND owner_id = ?')
      .get(row.map_id, userId);

    if (!owner) addMember(row.map_id, userId, role, db);

    db.prepare(
      'UPDATE map_invites SET accepted_at = ?, accepted_by = ? WHERE id = ?',
    ).run(new Date().toISOString(), userId, row.id);
  });

  run();
  return { ok: true, mapId: row.map_id, role };
}

// ------------------------------------------------------------------ privacy

export function setVisibility(
  ctx: AuthContext,
  mapId: string,
  visibility: 'private' | 'link' | 'public',
  nodeViewable: boolean,
  db: Database = getDb(),
): boolean {
  const actorRole = getRole(ctx.userId, mapId, db);
  if (!actorRole) return false;
  // §15: privacy is Owner and Admin only. An Editor changing a map from
  // private to public is a data exposure they were never granted.
  if (actorRole !== 'owner' && actorRole !== 'admin') return false;

  const result = db
    .prepare('UPDATE maps SET visibility = ?, node_viewable = ? WHERE id = ?')
    .run(visibility, nodeViewable ? 1 : 0, mapId);

  return result.changes > 0;
}

export { hashToken as hashShareToken };
