import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { roleOn } from '@/lib/collab/repo';
import { capabilitiesFor, type Capabilities } from '@/lib/sharing/roles';

/**
 * Permissions as (subject, action, resource).
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 *
 * It does not replace the role matrix. `lib/sharing/roles.ts` stays exactly as
 * it is and remains the default answer for every question — it encodes real
 * reasoning about privilege escalation (an admin cannot mint another admin,
 * cannot demote a peer) that took thought and must not be lost.
 *
 * ── What it adds ────────────────────────────────────────────────────────────
 *
 * An override layer. Roles answer "what may this person do on this map";
 * grants answer "…except on THIS node". That second question was previously
 * unanswerable: `Capabilities` is a fixed struct of eight booleans attached to
 * a whole map, so a viewer who should not see one node of an otherwise
 * readable map could not be described at all.
 *
 * ── Resolution order ────────────────────────────────────────────────────────
 *
 *   1. the map role's capabilities                       (the baseline)
 *   2. grants on the MAP, overriding the baseline
 *   3. grants on the NODE, overriding the map
 *
 * Deny wins within a level. A specific level always beats a general one, so a
 * node-level allow can restore something the map denied — otherwise "block
 * everyone except Sam from this node" would be impossible to express.
 */

export type Action = keyof Capabilities;
export type ResourceType = 'map' | 'node';
export type Effect = 'allow' | 'deny';

export interface Grant {
  id: string;
  subjectType: 'user' | 'org';
  subjectId: string;
  action: Action;
  resourceType: ResourceType;
  resourceId: string;
  effect: Effect;
  createdAt: string;
}

interface GrantRow {
  id: string;
  subject_type: string;
  subject_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  effect: string;
  created_at: string;
}

const ACTIONS: readonly Action[] = [
  'view',
  'editNodes',
  'comment',
  'invite',
  'changeRoles',
  'changePrivacy',
  'deleteMap',
  'transferOwnership',
];

export function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

function hydrate(row: GrantRow): Grant {
  return {
    id: row.id,
    subjectType: row.subject_type === 'org' ? 'org' : 'user',
    subjectId: row.subject_id,
    action: row.action as Action,
    resourceType: row.resource_type as ResourceType,
    resourceId: row.resource_id,
    effect: row.effect === 'deny' ? 'deny' : 'allow',
    createdAt: row.created_at,
  };
}

/**
 * Apply a level of grants over a baseline.
 *
 * Deny is applied after allow within the same level, so holding both resolves
 * to denied. The unique index makes that pair impossible in practice; the
 * ordering here means the behaviour is still defined if it ever occurs.
 */
function applyGrants(base: Capabilities, grants: Grant[]): Capabilities {
  const result = { ...base };

  for (const grant of grants) {
    if (grant.effect === 'allow') result[grant.action] = true;
  }
  for (const grant of grants) {
    if (grant.effect === 'deny') result[grant.action] = false;
  }

  return result;
}

/** Grants for one subject on one resource. */
function grantsFor(
  subjectId: string,
  resourceType: ResourceType,
  resourceId: string,
  db: Database,
): Grant[] {
  if (!subjectId) return [];

  const rows = db
    .prepare(
      `SELECT * FROM grants
        WHERE resource_type = @resourceType
          AND resource_id = @resourceId
          AND subject_id = @subjectId`,
    )
    .all({ resourceType, resourceId, subjectId }) as GrantRow[];

  return rows.filter((row) => isAction(row.action)).map(hydrate);
}

/**
 * What the caller may do on a map.
 *
 * Identical to `capabilitiesFor(roleOn(...))` when no grants exist, which is
 * the overwhelmingly common case — so adopting this everywhere changes no
 * behaviour until someone actually creates a grant.
 */
export function capabilitiesOnMap(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): Capabilities {
  const base = capabilitiesFor(roleOn(ctx, mapId, db));
  return applyGrants(base, grantsFor(ctx.userId, 'map', mapId, db));
}

/**
 * What the caller may do on ONE node.
 *
 * This is the capability the phase exists to provide: a user's permissions on a
 * single node can now differ from their permissions on the map that contains
 * it, in either direction.
 */
export function capabilitiesOnNode(
  ctx: AuthContext,
  nodeId: string,
  db: Database = getDb(),
): Capabilities {
  const row = db
    .prepare('SELECT map_id FROM map_nodes WHERE id = ?')
    .get(nodeId) as { map_id: string } | undefined;

  // No node, no permissions. Not an error: the caller renders 404 either way,
  // and distinguishing "gone" from "forbidden" is the oracle this codebase
  // consistently refuses to be.
  if (!row) return capabilitiesFor(null);

  const onMap = capabilitiesOnMap(ctx, row.map_id, db);
  return applyGrants(onMap, grantsFor(ctx.userId, 'node', nodeId, db));
}

export function canOnNode(
  ctx: AuthContext,
  nodeId: string,
  action: Action,
  db: Database = getDb(),
): boolean {
  return capabilitiesOnNode(ctx, nodeId, db)[action];
}

export interface GrantResult {
  ok: boolean;
  grant?: Grant;
  error?: string;
}

/**
 * Create or replace a grant.
 *
 * ── Who may grant ───────────────────────────────────────────────────────────
 *
 * Only someone who can `changeRoles` on the owning map. That is the same
 * authority that assigns roles, which is the right bar: a grant is a
 * permission change, and letting a mere editor mint them would route around
 * the role matrix's escalation rules entirely.
 */
export function setGrant(
  ctx: AuthContext,
  input: {
    subjectId: string;
    action: string;
    resourceType: ResourceType;
    resourceId: string;
    effect?: Effect;
    subjectType?: 'user' | 'org';
  },
  db: Database = getDb(),
): GrantResult {
  if (!isAction(input.action)) {
    return { ok: false, error: 'Unknown action' };
  }

  const mapId =
    input.resourceType === 'map'
      ? input.resourceId
      : ((
          db
            .prepare('SELECT map_id FROM map_nodes WHERE id = ?')
            .get(input.resourceId) as { map_id: string } | undefined
        )?.map_id ?? null);

  const refused = { ok: false, error: 'Cannot change permissions there' };
  if (!mapId) return refused;

  // Deliberately the ROLE's capability, not the resolved one: a grant must not
  // be usable to bootstrap the authority that creates more grants.
  if (!capabilitiesFor(roleOn(ctx, mapId, db)).changeRoles) return refused;

  const id = randomUUID();
  const effect = input.effect ?? 'allow';

  db.prepare(
    `INSERT INTO grants
       (id, subject_type, subject_id, action, resource_type, resource_id,
        effect, granted_by)
     VALUES (@id, @subjectType, @subjectId, @action, @resourceType,
             @resourceId, @effect, @grantedBy)
     ON CONFLICT(subject_type, subject_id, action, resource_type, resource_id)
       DO UPDATE SET effect = @effect, granted_by = @grantedBy`,
  ).run({
    id,
    subjectType: input.subjectType ?? 'user',
    subjectId: input.subjectId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    effect,
    grantedBy: ctx.userId || null,
  });

  const row = db
    .prepare(
      `SELECT * FROM grants
        WHERE subject_type = @subjectType AND subject_id = @subjectId
          AND action = @action AND resource_type = @resourceType
          AND resource_id = @resourceId`,
    )
    .get({
      subjectType: input.subjectType ?? 'user',
      subjectId: input.subjectId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    }) as GrantRow;

  return { ok: true, grant: hydrate(row) };
}

/** Remove a grant, returning the resource to whatever the role says. */
export function revokeGrant(
  ctx: AuthContext,
  grantId: string,
  db: Database = getDb(),
): boolean {
  const row = db.prepare('SELECT * FROM grants WHERE id = ?').get(grantId) as
    GrantRow | undefined;

  if (!row) return false;

  const mapId =
    row.resource_type === 'map'
      ? row.resource_id
      : ((
          db
            .prepare('SELECT map_id FROM map_nodes WHERE id = ?')
            .get(row.resource_id) as { map_id: string } | undefined
        )?.map_id ?? null);

  if (!mapId) return false;
  if (!capabilitiesFor(roleOn(ctx, mapId, db)).changeRoles) return false;

  return db.prepare('DELETE FROM grants WHERE id = ?').run(grantId).changes > 0;
}

/** Every grant on a resource. For the permissions UI. */
export function grantsOnResource(
  ctx: AuthContext,
  resourceType: ResourceType,
  resourceId: string,
  db: Database = getDb(),
): Grant[] {
  const mapId =
    resourceType === 'map'
      ? resourceId
      : ((
          db
            .prepare('SELECT map_id FROM map_nodes WHERE id = ?')
            .get(resourceId) as { map_id: string } | undefined
        )?.map_id ?? null);

  if (!mapId) return [];
  if (!capabilitiesFor(roleOn(ctx, mapId, db)).changeRoles) return [];

  const rows = db
    .prepare(
      `SELECT * FROM grants
        WHERE resource_type = ? AND resource_id = ?
        ORDER BY created_at`,
    )
    .all(resourceType, resourceId) as GrantRow[];

  return rows.filter((row) => isAction(row.action)).map(hydrate);
}
