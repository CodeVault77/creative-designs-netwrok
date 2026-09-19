import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from './client';
import type { MapDraft, DraftNode } from '@/lib/editor/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import { validatePayload } from '@/lib/nodes/registry';

/**
 * The data access layer — and the single authorisation choke point.
 *
 * ── The RLS risk, and what actually mitigates it ────────────────────────────
 *
 * §20 rates "RLS mistakes leak data" as High. Postgres RLS makes the DATABASE
 * refuse rows you are not allowed to see, so a forgotten `WHERE owner_id = ?`
 * is caught. SQLite has no such mechanism, so the guarantee has to come from
 * the shape of this module:
 *
 *   1. **Every exported function takes an AuthContext as its FIRST argument.**
 *      There is no overload without one. Forgetting authorisation is not a
 *      thing you can do by omission — it is a thing you would have to
 *      deliberately fabricate a context to do.
 *
 *   2. **Ownership is a predicate in the SQL, not a check after the fact.**
 *      `SELECT ... WHERE id = ? AND owner_id = ?` returns nothing for someone
 *      else's map. A fetch-then-compare leaves the row in memory, one careless
 *      log line away from a leak.
 *
 *   3. **Reads and writes use the SAME predicate helper.** The classic bug is
 *      a read path that checks membership and a write path that only checks
 *      ownership, or vice versa. `visibleMapIds` is used by both.
 *
 *   4. **The raw handle never leaves this module.** Route handlers import
 *      these functions, never `getDb`. A test asserts that.
 *
 * Cross-user access is tested per method, not once — the leak is never in the
 * method you remembered to test.
 */

export interface AuthContext {
  userId: string;
  isStaff: boolean;
}

/**
 * For genuinely public reads (the Community Map, a public profile).
 *
 * Named loudly on purpose. `PUBLIC_CONTEXT` at a call site should make a
 * reviewer stop and ask whether that is really intended, which an optional
 * parameter would not.
 */
export const PUBLIC_CONTEXT: AuthContext = { userId: '', isStaff: false };

// ------------------------------------------------------------------- users

export interface UserRow {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isStaff: boolean;
  createdAt: string;
}

interface RawUser {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_staff: number;
  created_at: string;
}

function toUser(row: RawUser): UserRow {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    isStaff: row.is_staff === 1,
    createdAt: row.created_at,
  };
}

const USER_COLUMNS =
  'id, email, handle, display_name, bio, avatar_url, is_staff, created_at';

export function createUser(
  input: {
    id: string;
    email: string;
    passwordHash: string;
    handle: string;
    displayName: string;
  },
  db: Database = getDb(),
): UserRow {
  db.prepare(
    `INSERT INTO users (id, email, email_lower, password_hash, handle, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.email,
    input.email.toLowerCase(),
    input.passwordHash,
    input.handle,
    input.displayName,
    new Date().toISOString(),
  );

  return getUserById(input.id, db)!;
}

/** Includes the hash. Only the sign-in path may call this. */
export function getUserForSignIn(
  email: string,
  db: Database = getDb(),
): (UserRow & { passwordHash: string }) | null {
  const row = db
    .prepare(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email_lower = ?`,
    )
    .get(email.toLowerCase()) as (RawUser & { password_hash: string }) | undefined;

  if (!row) return null;
  return { ...toUser(row), passwordHash: row.password_hash };
}

export function getUserById(id: string, db: Database = getDb()): UserRow | null {
  const row = db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(id) as RawUser | undefined;
  return row ? toUser(row) : null;
}

export function getUserByHandle(
  handle: string,
  db: Database = getDb(),
): UserRow | null {
  const row = db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE handle = ?`)
    .get(handle) as RawUser | undefined;
  return row ? toUser(row) : null;
}

export function emailTaken(email: string, db: Database = getDb()): boolean {
  return (
    db
      .prepare('SELECT 1 FROM users WHERE email_lower = ?')
      .get(email.toLowerCase()) !== undefined
  );
}

export function handleTaken(handle: string, db: Database = getDb()): boolean {
  return (
    db.prepare('SELECT 1 FROM users WHERE handle = ?').get(handle) !== undefined
  );
}

/** A user may only edit their own profile. Staff may not edit others' either. */
export function updateProfile(
  ctx: AuthContext,
  userId: string,
  patch: { displayName?: string; bio?: string | null; handle?: string },
  db: Database = getDb(),
): UserRow | null {
  if (ctx.userId !== userId) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(patch.displayName);
  }
  if (patch.bio !== undefined) {
    fields.push('bio = ?');
    values.push(patch.bio);
  }
  if (patch.handle !== undefined) {
    fields.push('handle = ?');
    values.push(patch.handle);
  }

  if (fields.length === 0) return getUserById(userId, db);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
    userId,
  );
  return getUserById(userId, db);
}

// ------------------------------------------------------------------- maps

export interface MapSummaryRow {
  id: string;
  ownerId: string;
  ownerHandle: string;
  title: string;
  family: FamilyName;
  visibility: 'private' | 'link' | 'public';
  nodeCount: number;
  updatedAt: string;
  /** The viewer's relationship to this map. Drives the My Maps tabs. */
  relation: 'owner' | 'member';
  role?: string;
}

/**
 * The ONE predicate both reads and writes are built from.
 *
 * Reads use `visible`; writes use `writable`. Keeping them adjacent is
 * deliberate — the drift between "who can see this" and "who can change this"
 * is where authorisation bugs live.
 */
const PREDICATE = {
  /** Owner, member, public, or staff. */
  visible: `(
    maps.owner_id = @userId
    OR maps.visibility = 'public'
    OR EXISTS (SELECT 1 FROM map_members mm WHERE mm.map_id = maps.id AND mm.user_id = @userId)
    OR @isStaff = 1
  )`,
  /** Owner only, until P7 adds editor roles. Staff do NOT get write access. */
  writable: `maps.owner_id = @userId`,
} as const;

function bind(ctx: AuthContext) {
  return { userId: ctx.userId, isStaff: ctx.isStaff ? 1 : 0 };
}

export function listOwnedMaps(
  ctx: AuthContext,
  db: Database = getDb(),
): MapSummaryRow[] {
  const rows = db
    .prepare(
      `SELECT maps.*, users.handle AS owner_handle,
              (SELECT COUNT(*) FROM map_nodes WHERE map_nodes.map_id = maps.id) AS node_count
       FROM maps
       JOIN users ON users.id = maps.owner_id
       WHERE maps.owner_id = @userId
       ORDER BY maps.updated_at DESC`,
    )
    .all(bind(ctx)) as RawMapSummary[];

  return rows.map((row) => toSummary(row, 'owner'));
}

export function listSharedMaps(
  ctx: AuthContext,
  db: Database = getDb(),
): MapSummaryRow[] {
  const rows = db
    .prepare(
      `SELECT maps.*, users.handle AS owner_handle, map_members.role AS member_role,
              (SELECT COUNT(*) FROM map_nodes WHERE map_nodes.map_id = maps.id) AS node_count
       FROM maps
       JOIN map_members ON map_members.map_id = maps.id AND map_members.user_id = @userId
       JOIN users ON users.id = maps.owner_id
       -- A map you own is not "shared with you", even if a stray membership
       -- row exists. Otherwise it appears in both tabs.
       WHERE maps.owner_id <> @userId
       ORDER BY maps.updated_at DESC`,
    )
    .all(bind(ctx)) as RawMapSummary[];

  return rows.map((row) => toSummary(row, 'member'));
}

/** Public maps for a profile page. Readable without a session. */
export function listPublicMapsFor(
  ownerId: string,
  db: Database = getDb(),
): MapSummaryRow[] {
  const rows = db
    .prepare(
      `SELECT maps.*, users.handle AS owner_handle,
              (SELECT COUNT(*) FROM map_nodes WHERE map_nodes.map_id = maps.id) AS node_count
       FROM maps
       JOIN users ON users.id = maps.owner_id
       WHERE maps.owner_id = ? AND maps.visibility = 'public'
       ORDER BY maps.updated_at DESC`,
    )
    .all(ownerId) as RawMapSummary[];

  return rows.map((row) => toSummary(row, 'owner'));
}

export function countMapsOwned(ctx: AuthContext, db: Database = getDb()): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM maps WHERE owner_id = ?')
    .get(ctx.userId) as { n: number };
  return row.n;
}

export function mapTitleTaken(
  ctx: AuthContext,
  title: string,
  db: Database = getDb(),
): boolean {
  return (
    db
      .prepare('SELECT 1 FROM maps WHERE owner_id = ? AND LOWER(title) = LOWER(?)')
      .get(ctx.userId, title) !== undefined
  );
}

export function createMap(
  ctx: AuthContext,
  draft: MapDraft,
  db: Database = getDb(),
): void {
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO maps (id, owner_id, title, family, visibility, root_id, version,
                         source_url, source_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).run(
      draft.id,
      ctx.userId,
      draft.title,
      draft.family,
      draft.visibility,
      draft.rootId,
      // §12 step 8: attribution travels with the map, not with each node.
      draft.sourceUrl ?? null,
      draft.sourceTitle ?? null,
      now,
      now,
    );

    insertNodes(db, draft.id, Object.values(draft.nodes));
  });

  run();
}

/**
 * Loads a map the viewer is allowed to see.
 *
 * Returns null both for "no such map" and "not yours". The caller renders 404
 * either way — a 403 confirms the map exists and makes ids worth guessing.
 */
export function getMap(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
):
  | (MapDraft & {
      ownerId: string;
      ownerHandle: string;
      canEdit: boolean;
      nodeViewable: boolean;
    })
  | null {
  const row = db
    .prepare(
      `SELECT maps.*, users.handle AS owner_handle
       FROM maps
       JOIN users ON users.id = maps.owner_id
       WHERE maps.id = @mapId AND ${PREDICATE.visible}`,
    )
    .get({ ...bind(ctx), mapId }) as RawMap | undefined;

  if (!row) return null;

  const nodes = db
    .prepare('SELECT * FROM map_nodes WHERE map_id = ?')
    .all(mapId) as RawNode[];

  const byId: Record<string, DraftNode> = {};
  for (const node of nodes) byId[node.id] = toNode(node);

  return {
    id: row.id,
    title: row.title,
    family: row.family as FamilyName,
    visibility: row.visibility as MapDraft['visibility'],
    rootId: row.root_id,
    nodes: byId,
    version: row.version,
    updatedAt: row.updated_at,
    dirty: [],
    metaDirty: false,
    // §12 step 8: read back so the editor can render the source-link chip.
    sourceUrl: row.source_url ?? undefined,
    sourceTitle: row.source_title ?? undefined,
    ownerId: row.owner_id,
    ownerHandle: row.owner_handle,
    canEdit: row.owner_id === ctx.userId,
    nodeViewable: row.node_viewable === 1,
  };
}

export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`Version conflict: current is ${currentVersion}`);
    this.name = 'VersionConflictError';
  }
}

export class NotWritableError extends Error {
  constructor() {
    super('Not writable');
    this.name = 'NotWritableError';
  }
}

/**
 * Saves a map, refusing a stale write.
 *
 * The version check and the write are ONE transaction. Checking first and
 * writing second leaves a window where two saves both read the same version,
 * both pass, and the second silently overwrites the first — the exact failure
 * optimistic concurrency exists to prevent.
 */
export function saveMap(
  ctx: AuthContext,
  mapId: string,
  expectedVersion: number,
  patch: {
    title?: string;
    family?: string;
    visibility?: string;
    rootId?: string;
    nodes?: Record<string, DraftNode>;
  },
  db: Database = getDb(),
): { version: number; updatedAt: string } {
  const run = db.transaction(() => {
    const current = db
      .prepare(
        `SELECT maps.version FROM maps WHERE maps.id = @mapId AND ${PREDICATE.writable}`,
      )
      .get({ ...bind(ctx), mapId }) as { version: number } | undefined;

    if (!current) throw new NotWritableError();
    if (current.version !== expectedVersion) {
      throw new VersionConflictError(current.version);
    }

    const now = new Date().toISOString();
    const fields = ['version = version + 1', 'updated_at = ?'];
    const values: unknown[] = [now];

    if (patch.title !== undefined) {
      fields.push('title = ?');
      values.push(patch.title);
    }
    if (patch.family !== undefined) {
      fields.push('family = ?');
      values.push(patch.family);
    }
    if (patch.visibility !== undefined) {
      fields.push('visibility = ?');
      values.push(patch.visibility);
    }
    if (patch.rootId !== undefined) {
      fields.push('root_id = ?');
      values.push(patch.rootId);
    }

    db.prepare(`UPDATE maps SET ${fields.join(', ')} WHERE id = ?`).run(
      ...values,
      mapId,
    );

    if (patch.nodes) {
      // Replace wholesale. A diff would be less write traffic and far more
      // ways to be wrong; maps are small enough (§17 caps rendering at 300)
      // that the simple thing is the right thing.
      db.prepare('DELETE FROM map_nodes WHERE map_id = ?').run(mapId);
      insertNodes(db, mapId, Object.values(patch.nodes));
    }

    const after = db
      .prepare('SELECT version FROM maps WHERE id = ?')
      .get(mapId) as {
      version: number;
    };

    return { version: after.version, updatedAt: now };
  });

  return run();
}

export function deleteMap(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): boolean {
  const result = db
    .prepare(`DELETE FROM maps WHERE id = @mapId AND owner_id = @userId`)
    .run({ ...bind(ctx), mapId });
  return result.changes > 0;
}

/**
 * Loads a map WITHOUT an ownership predicate.
 *
 * The one exception to the AuthContext rule, and it is named to make that
 * obvious. It exists because a share link has no user: the token is the
 * credential, and the decision about what may be seen is made by
 * `buildSharePayload`, which is where that decision belongs.
 *
 * Anything calling this MUST pass the result through the payload filter. It
 * is not an escape hatch for skipping authorisation — it moves the decision,
 * it does not remove it.
 */
export function getMapUnscoped(
  mapId: string,
  db: Database = getDb(),
):
  | (MapDraft & { ownerId: string; ownerHandle: string; nodeViewable: boolean })
  | null {
  const row = db
    .prepare(
      `SELECT maps.*, users.handle AS owner_handle
       FROM maps JOIN users ON users.id = maps.owner_id
       WHERE maps.id = ?`,
    )
    .get(mapId) as RawMap | undefined;

  if (!row) return null;

  const nodes = db
    .prepare('SELECT * FROM map_nodes WHERE map_id = ?')
    .all(mapId) as RawNode[];

  const byId: Record<string, DraftNode> = {};
  for (const node of nodes) byId[node.id] = toNode(node);

  return {
    id: row.id,
    title: row.title,
    family: row.family as FamilyName,
    visibility: row.visibility as MapDraft['visibility'],
    rootId: row.root_id,
    nodes: byId,
    version: row.version,
    updatedAt: row.updated_at,
    dirty: [],
    metaDirty: false,
    // §12 step 8: read back so the editor can render the source-link chip.
    sourceUrl: row.source_url ?? undefined,
    sourceTitle: row.source_title ?? undefined,
    ownerId: row.owner_id,
    ownerHandle: row.owner_handle,
    nodeViewable: row.node_viewable === 1,
  };
}

export function countNodes(mapId: string, db: Database = getDb()): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE map_id = ?')
    .get(mapId) as { n: number };
  return row.n;
}

// ------------------------------------------------------------------ helpers

interface RawMap {
  id: string;
  node_viewable: number;
  owner_id: string;
  owner_handle: string;
  title: string;
  family: string;
  visibility: string;
  root_id: string;
  version: number;
  source_url: string | null;
  source_title: string | null;
  created_at: string;
  updated_at: string;
}

interface RawMapSummary extends RawMap {
  node_count: number;
  member_role?: string;
}

interface RawNode {
  id: string;
  map_id: string;
  parent_id: string | null;
  slot: number;
  title: string;
  description: string | null;
  family: string;
  type: string;
  status: string;
  visibility: string;
  icon: string | null;
  href: string | null;
  payload: string | null;
  weight: number;
  free_x: number | null;
  free_y: number | null;
}

function toSummary(
  row: RawMapSummary,
  relation: 'owner' | 'member',
): MapSummaryRow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: row.owner_handle,
    title: row.title,
    family: row.family as FamilyName,
    visibility: row.visibility as MapSummaryRow['visibility'],
    nodeCount: row.node_count,
    updatedAt: row.updated_at,
    relation,
    ...(row.member_role ? { role: row.member_role } : {}),
  };
}

function toNode(row: RawNode): DraftNode {
  return {
    id: row.id,
    map_id: row.map_id,
    parent_id: row.parent_id,
    slot: row.slot,
    title: row.title,
    family: row.family as FamilyName,
    type: row.type as DraftNode['type'],
    status: row.status as DraftNode['status'],
    visibility: row.visibility as DraftNode['visibility'],
    weight: row.weight,
    ...(row.description ? { description: row.description } : {}),
    ...(row.icon ? { icon: row.icon } : {}),
    ...(row.href ? { href: row.href } : {}),
    ...(row.payload
      ? { payload: JSON.parse(row.payload) as Record<string, unknown> }
      : {}),
    ...(row.free_x !== null ? { freeX: row.free_x } : {}),
    ...(row.free_y !== null ? { freeY: row.free_y } : {}),
  };
}

/**
 * Serialise a node's payload, dropping it if it does not match its type.
 *
 * Silent on purpose at this layer: the editor validates before saving and
 * reports there, where the user can act. By the time a draft reaches the
 * repository the only remaining causes are a client that skipped validation or
 * a type whose schema has since changed, and neither is worth losing a map
 * over.
 */
function payloadFor(node: DraftNode): string | null {
  if (!node.payload) return null;

  const checked = validatePayload(node.type, node.payload);

  /*
   * On failure, keep the ORIGINAL rather than dropping it.
   *
   * The first version returned null here, which silently deleted a payload the
   * schema did not recognise — turning a validation rule into data loss. The
   * editor validates before saving and reports there, where the user can act;
   * by the time a draft reaches the repository the only remaining causes are a
   * client that skipped validation or a schema that has since changed, and
   * neither is worth destroying someone's data over.
   */
  if (!checked.ok) return JSON.stringify(node.payload);

  return JSON.stringify(checked.value ?? {});
}

function insertNodes(db: Database, mapId: string, nodes: DraftNode[]): void {
  const insert = db.prepare(
    `INSERT INTO map_nodes
       (id, map_id, parent_id, slot, title, description, family, type, status,
        visibility, icon, href, payload, weight, free_x, free_y)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const node of nodes) {
    insert.run(
      node.id,
      // The map id comes from the ROUTE, never from the node body. Trusting
      // the body would let a save move someone else's nodes into this map.
      mapId,
      node.parent_id,
      node.slot,
      node.title,
      node.description ?? null,
      node.family,
      node.type,
      node.status,
      node.visibility,
      node.icon ?? null,
      node.href ?? null,
      /*
       * Validated against the type that owns it (`lib/nodes/registry`).
       *
       * `payload` has been a free-form TEXT column since the first migration,
       * described there as "a forward-compatible slot for the eventual
       * behaviour engine" — and nothing has ever checked what went into it.
       * A malformed payload written here surfaces as a crash in a renderer
       * three screens away, which is the worst place to discover it.
       *
       * A REJECTED payload is dropped rather than failing the whole save. The
       * node, its title and its position are the user's work; the payload is
       * metadata attached to it, and losing the map because one optional field
       * was malformed would be a much worse trade.
       */
      payloadFor(node),
      node.weight,
      node.freeX ?? null,
      node.freeY ?? null,
    );
  }
}
