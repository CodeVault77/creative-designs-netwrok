import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import type { Role } from '@/lib/sharing/roles';

/**
 * Organisations.
 *
 * ── Why now, before anything needs it ───────────────────────────────────────
 *
 * Ownership is user-scoped throughout: `maps.owner_id` is a user, and every
 * visibility query in `lib/db/repo.ts` compares against one. Introducing an
 * owning entity later means revisiting each of those, plus every table added
 * in the meantime. The cost only rises, so this ships before the features that
 * will assume it.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 *
 * `maps.org_id` is NULLABLE and additive. Every existing map keeps a personal
 * owner and keeps working unchanged; org ownership is opt-in. No backfill, no
 * behaviour change on deploy — the conservative half of the "additive first"
 * rule in docs/04-environments.md.
 *
 * ── Roles reuse the map vocabulary ──────────────────────────────────────────
 *
 * Deliberately the same five names. Two role systems with different words for
 * the same idea is how "editor" comes to mean two things depending on which
 * screen you are looking at.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

function hydrate(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}

/**
 * URL-safe slug from a name.
 *
 * Collisions are resolved by the unique index and a suffix, not by a prior
 * lookup — two people creating "Acme" at the same moment both pass a SELECT.
 */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}

export interface OrgResult {
  ok: boolean;
  org?: Organization;
  error?: string;
}

export function createOrganization(
  ctx: AuthContext,
  name: string,
  db: Database = getDb(),
): OrgResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const trimmed = name.trim().slice(0, 80);
  if (trimmed.length < 2) {
    return { ok: false, error: 'Give the organisation a name' };
  }

  const base = slugify(trimmed);
  const id = randomUUID();

  /*
   * Retry on slug collision rather than checking first.
   *
   * Five attempts is enough that failing means something else is wrong; a
   * loop that never gives up would spin forever against a genuinely broken
   * index.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;

    try {
      const created = db.transaction(() => {
        db.prepare(
          'INSERT INTO organizations (id, name, slug, owner_id) VALUES (?, ?, ?, ?)',
        ).run(id, trimmed, slug, ctx.userId);

        // The creator is a member from the first moment, in the same
        // transaction. An org whose owner is not a member is a state nothing
        // else in the system knows how to read.
        db.prepare(
          'INSERT INTO organization_members (org_id, user_id, role) VALUES (?, ?, ?)',
        ).run(id, ctx.userId, 'owner');

        return db
          .prepare('SELECT * FROM organizations WHERE id = ?')
          .get(id) as OrgRow;
      })();

      return { ok: true, org: hydrate(created) };
    } catch (cause) {
      if (!String(cause).includes('UNIQUE')) throw cause;
    }
  }

  return { ok: false, error: 'Could not create that organisation' };
}

/** The caller's role in an org, or null if they are not a member. */
export function orgRoleOf(
  ctx: AuthContext,
  orgId: string,
  db: Database = getDb(),
): Role | null {
  if (!ctx.userId) return null;

  const row = db
    .prepare(
      `SELECT organizations.owner_id,
              (SELECT role FROM organization_members
                WHERE organization_members.org_id = organizations.id
                  AND organization_members.user_id = @userId) AS member_role
         FROM organizations WHERE organizations.id = @orgId`,
    )
    .get({ orgId, userId: ctx.userId }) as
    { owner_id: string; member_role: string | null } | undefined;

  if (!row) return null;
  if (row.owner_id === ctx.userId) return 'owner';
  return (row.member_role as Role | null) ?? null;
}

/** Organisations the caller belongs to. */
export function organizationsFor(
  ctx: AuthContext,
  db: Database = getDb(),
): Organization[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `SELECT organizations.* FROM organizations
        JOIN organization_members
          ON organization_members.org_id = organizations.id
        WHERE organization_members.user_id = ?
        ORDER BY organizations.created_at`,
    )
    .all(ctx.userId) as OrgRow[];

  return rows.map(hydrate);
}

export function addMember(
  ctx: AuthContext,
  orgId: string,
  userId: string,
  role: Role = 'editor',
  db: Database = getDb(),
): boolean {
  const actorRole = orgRoleOf(ctx, orgId, db);

  // Only owner and admin manage membership — the same bar the map role matrix
  // sets for `changeRoles`.
  if (actorRole !== 'owner' && actorRole !== 'admin') return false;

  // An admin cannot mint an owner. Same escalation rule as `canAssignRole` in
  // lib/sharing/roles.ts, for the same reason: otherwise the ceiling is not a
  // ceiling.
  if (role === 'owner' && actorRole !== 'owner') return false;

  db.prepare(
    `INSERT INTO organization_members (org_id, user_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(orgId, userId, role);

  return true;
}

export function removeMember(
  ctx: AuthContext,
  orgId: string,
  userId: string,
  db: Database = getDb(),
): boolean {
  const actorRole = orgRoleOf(ctx, orgId, db);
  if (actorRole !== 'owner' && actorRole !== 'admin') return false;

  const owner = db
    .prepare('SELECT owner_id FROM organizations WHERE id = ?')
    .get(orgId) as { owner_id: string } | undefined;

  // The owner cannot be removed. Ownership is transferred through its own
  // flow; removing them would leave an org nobody can administer.
  if (!owner || owner.owner_id === userId) return false;

  return (
    db
      .prepare('DELETE FROM organization_members WHERE org_id = ? AND user_id = ?')
      .run(orgId, userId).changes > 0
  );
}

/**
 * Move a map into an organisation, or back out of one.
 *
 * Only the map's owner may do this. It changes who can reach the map, so it is
 * the same class of decision as changing its visibility — not something an
 * editor should be able to do.
 */
export function setMapOrganization(
  ctx: AuthContext,
  mapId: string,
  orgId: string | null,
  db: Database = getDb(),
): boolean {
  const map = db.prepare('SELECT owner_id FROM maps WHERE id = ?').get(mapId) as
    { owner_id: string } | undefined;

  if (!map || !ctx.userId || map.owner_id !== ctx.userId) return false;

  // You cannot give a map to an organisation you are not in.
  if (orgId !== null && orgRoleOf(ctx, orgId, db) === null) return false;

  db.prepare('UPDATE maps SET org_id = ? WHERE id = ?').run(orgId, mapId);
  return true;
}

/** Members of an org. Visible to any member; membership is not secret within it. */
export function membersOf(
  ctx: AuthContext,
  orgId: string,
  db: Database = getDb(),
): { userId: string; role: Role; handle: string; displayName: string }[] {
  if (orgRoleOf(ctx, orgId, db) === null) return [];

  const rows = db
    .prepare(
      `SELECT organization_members.user_id, organization_members.role,
              users.handle, users.display_name
         FROM organization_members
         JOIN users ON users.id = organization_members.user_id
        WHERE organization_members.org_id = ?
        ORDER BY organization_members.added_at`,
    )
    .all(orgId) as {
    user_id: string;
    role: string;
    handle: string;
    display_name: string;
  }[];

  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role as Role,
    handle: row.handle,
    displayName: row.display_name,
  }));
}
