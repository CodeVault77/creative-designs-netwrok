import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';

/**
 * Collaboration: chat, presence, activity, notifications and soft locks.
 *
 * A peer of `repo.ts`, held to the same standard: an AuthContext first
 * argument, and access expressed as a SQL predicate rather than a check after
 * the rows come back.
 *
 * The organising idea for the whole phase is in `map_events`: **the socket is
 * a notification, never the source of truth.** Everything durable is a row
 * with a monotonic id, and the realtime channel only says "something happened,
 * catch up from N". §20 rates this phase's risk as reconnection, and the
 * acceptance criterion says "without data loss" — a design that pushes down a
 * channel and stores nothing loses whatever was in flight when the connection
 * dropped, and nobody notices until a message is missing.
 */

/** §15's roles, most privileged first. */
export type Role = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer';

const RANK: Record<Role, number> = {
  owner: 5,
  admin: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
};

/**
 * What each role may do, straight from §15's table.
 *
 * Expressed as a rank comparison rather than a set per capability, because
 * §15's roles are strictly ordered — every Admin power is an Editor power plus
 * more. A capability that ever breaks that ordering needs its own predicate
 * rather than a new rank.
 */
export const CAN = {
  view: (role: Role) => RANK[role] >= RANK.viewer,
  comment: (role: Role) => RANK[role] >= RANK.commenter,
  edit: (role: Role) => RANK[role] >= RANK.editor,
  invite: (role: Role) => RANK[role] >= RANK.admin,
  manage: (role: Role) => RANK[role] >= RANK.admin,
};

/**
 * The viewer's role on a map, or null if they cannot see it at all.
 *
 * One function, used by every route in this module, so "can this person be
 * here" is answered in exactly one place. Returning null rather than throwing,
 * because the caller renders 404 — a 403 confirms the map exists.
 */
export function roleOn(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): Role | null {
  const row = db
    .prepare(
      `SELECT maps.owner_id, maps.visibility, maps.org_id,
              (SELECT role FROM map_members
                WHERE map_members.map_id = maps.id
                  AND map_members.user_id = @userId) AS member_role,
              -- Organisation membership.
              --
              -- A map owned by an org is reachable by that org's members
              -- without each of them being added to map_members, which is the
              -- entire point of having organisations. Resolved in the same
              -- query so this stays one round trip.
              (SELECT role FROM organization_members
                WHERE organization_members.org_id = maps.org_id
                  AND organization_members.user_id = @userId) AS org_role
         FROM maps WHERE maps.id = @mapId`,
    )
    .get({ mapId, userId: ctx.userId }) as
    | {
        owner_id: string;
        visibility: string;
        org_id: string | null;
        member_role: string | null;
        org_role: string | null;
      }
    | undefined;

  if (!row) return null;
  if (ctx.userId && row.owner_id === ctx.userId) return 'owner';

  /*
   * A DIRECT map role beats an org role.
   *
   * Someone explicitly added to a map as a viewer stays a viewer even if they
   * are an editor of the owning org — the specific grant is the more
   * deliberate statement, and the alternative silently escalates them.
   */
  if (row.member_role) return row.member_role as Role;
  if (row.org_role) return row.org_role as Role;
  if (ctx.isStaff) return 'viewer';
  // A public or link-viewable map is readable by anyone, read-only (§15).
  if (row.visibility === 'public' || row.visibility === 'link') return 'viewer';
  return null;
}

// ------------------------------------------------------------------- events

export interface MapEvent {
  id: number;
  mapId: string;
  actorId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Append an event and return its id.
 *
 * Everything that should wake another tab goes through here, so there is one
 * place where "did this get persisted before it was broadcast" is answerable.
 */
export function appendEvent(
  mapId: string,
  actorId: string | null,
  kind: string,
  payload: Record<string, unknown> = {},
  db: Database = getDb(),
): number {
  const result = db
    .prepare(
      `INSERT INTO map_events (map_id, actor_id, kind, payload)
       VALUES (?, ?, ?, ?)`,
    )
    .run(mapId, actorId, kind, JSON.stringify(payload));

  return Number(result.lastInsertRowid);
}

/**
 * Everything after `since`. The reconnect path.
 *
 * Capped, because a client that has been away for a week must not be handed
 * ten thousand rows in one response — it would stall the tab it is trying to
 * restore. Past the cap the caller reloads from scratch instead, which is why
 * `truncated` is reported rather than silently dropping the excess.
 */
export function eventsSince(
  ctx: AuthContext,
  mapId: string,
  since: number,
  db: Database = getDb(),
): { events: MapEvent[]; truncated: boolean } {
  if (!roleOn(ctx, mapId, db)) return { events: [], truncated: false };

  const LIMIT = 200;
  const rows = db
    .prepare(
      `SELECT * FROM map_events
        WHERE map_id = ? AND id > ?
        ORDER BY id LIMIT ?`,
    )
    .all(mapId, since, LIMIT + 1) as {
    id: number;
    map_id: string;
    actor_id: string | null;
    kind: string;
    payload: string;
    created_at: string;
  }[];

  const truncated = rows.length > LIMIT;

  return {
    events: (truncated ? rows.slice(0, LIMIT) : rows).map((row) => ({
      id: row.id,
      mapId: row.map_id,
      actorId: row.actor_id,
      kind: row.kind,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    })),
    truncated,
  };
}

/** The current head, so a fresh client knows where to resume from. */
export function latestEventId(mapId: string, db: Database = getDb()): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(id), 0) AS id FROM map_events WHERE map_id = ?')
    .get(mapId) as { id: number };
  return row.id;
}

// ------------------------------------------------------------------ messages

export interface ChatMessage {
  id: string;
  mapId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  body: string;
  nodeRef: string | null;
  nodeTitle: string | null;
  createdAt: string;
}

export const MAX_MESSAGE_LENGTH = 2000;

/**
 * §15: "Typing `#` mentions a node and posts a chip that recentres the map."
 *
 * The reference is resolved to a node id at post time and stored, so the chip
 * keeps working after the node is renamed. Storing the typed text instead
 * would leave a chip pointing at a title that no longer exists.
 */
export function extractNodeRef(
  body: string,
  nodes: Record<string, { id: string; title: string }>,
): string | null {
  const match = body.match(/#([\w-]+)/);
  if (!match) return null;

  const token = match[1]!.toLowerCase();
  // An id match first: the composer inserts the real id when the user picks
  // from its list, and a title that happens to look like an id should not win.
  if (nodes[match[1]!]) return match[1]!;

  const byTitle = Object.values(nodes).find(
    (node) => node.title.toLowerCase().replace(/\s+/g, '-') === token,
  );
  return byTitle?.id ?? null;
}

export function postMessage(
  ctx: AuthContext,
  mapId: string,
  body: string,
  nodeRef: string | null,
  db: Database = getDb(),
): ChatMessage | null {
  const role = roleOn(ctx, mapId, db);
  // §15: Commenter and above. A Viewer on a public map must not be able to
  // post into someone else's map thread.
  if (!role || !CAN.comment(role)) return null;

  const trimmed = body.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!trimmed) return null;

  const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  db.prepare(
    `INSERT INTO map_messages (id, map_id, author_id, body, node_ref)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, mapId, ctx.userId, trimmed, nodeRef);

  appendEvent(mapId, ctx.userId, 'message', { messageId: id }, db);
  fanOut(ctx, mapId, 'message', trimmed.slice(0, 140), `/maps/${mapId}`, db);

  return getMessage(id, db);
}

function getMessage(id: string, db: Database): ChatMessage | null {
  const row = db
    .prepare(
      `SELECT map_messages.*, users.display_name, users.handle,
              (SELECT title FROM map_nodes WHERE map_nodes.id = map_messages.node_ref) AS node_title
         FROM map_messages
         JOIN users ON users.id = map_messages.author_id
        WHERE map_messages.id = ?`,
    )
    .get(id) as
    | {
        id: string;
        map_id: string;
        author_id: string;
        display_name: string;
        handle: string;
        body: string;
        node_ref: string | null;
        node_title: string | null;
        created_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    mapId: row.map_id,
    authorId: row.author_id,
    authorName: row.display_name,
    authorHandle: row.handle,
    body: row.body,
    nodeRef: row.node_ref,
    nodeTitle: row.node_title,
    createdAt: row.created_at,
  };
}

export function listMessages(
  ctx: AuthContext,
  mapId: string,
  limit = 50,
  db: Database = getDb(),
): ChatMessage[] {
  const role = roleOn(ctx, mapId, db);
  if (!role) return [];

  const rows = db
    .prepare(
      `SELECT map_messages.id FROM map_messages
        WHERE map_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(mapId, Math.min(limit, 200)) as { id: string }[];

  // Oldest first for rendering; newest first for the query, so the LIMIT takes
  // the most recent messages rather than the first ever sent.
  return rows
    .map((row) => getMessage(row.id, db))
    .filter((message): message is ChatMessage => message !== null)
    .reverse();
}

// ------------------------------------------------------------------ presence

export interface Presence {
  userId: string;
  name: string;
  handle: string;
  selectedId: string | null;
  lastSeen: string;
}

/**
 * How long a heartbeat counts for.
 *
 * Longer than the client's heartbeat interval by a wide margin, so one dropped
 * request does not make someone flicker out of the avatar stack and back in.
 */
export const PRESENCE_TTL_SECONDS = 45;

export function heartbeat(
  ctx: AuthContext,
  mapId: string,
  selectedId: string | null,
  db: Database = getDb(),
): void {
  if (!ctx.userId) return;
  if (!roleOn(ctx, mapId, db)) return;

  db.prepare(
    `INSERT INTO map_presence (map_id, user_id, selected_id, last_seen)
     VALUES (@mapId, @userId, @selectedId, datetime('now'))
     ON CONFLICT(map_id, user_id)
     DO UPDATE SET selected_id = @selectedId, last_seen = datetime('now')`,
  ).run({ mapId, userId: ctx.userId, selectedId });
}

export function listPresence(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): Presence[] {
  if (!roleOn(ctx, mapId, db)) return [];

  const rows = db
    .prepare(
      `SELECT map_presence.user_id, map_presence.selected_id, map_presence.last_seen,
              users.display_name, users.handle
         FROM map_presence
         JOIN users ON users.id = map_presence.user_id
        WHERE map_presence.map_id = ?
          AND map_presence.last_seen >= datetime('now', @window)
        ORDER BY map_presence.last_seen DESC`,
    )
    .all(mapId, { window: `-${PRESENCE_TTL_SECONDS} seconds` }) as {
    user_id: string;
    selected_id: string | null;
    last_seen: string;
    display_name: string;
    handle: string;
  }[];

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.display_name,
    handle: row.handle,
    selectedId: row.selected_id,
    lastSeen: row.last_seen,
  }));
}

// --------------------------------------------------------------- soft locks

export interface LockState {
  nodeId: string;
  userId: string;
  name: string;
  expiresAt: string;
}

/**
 * How long a lock survives without being renewed.
 *
 * SHORT on purpose. The acceptance criterion is "without lockout", and a lock
 * held by a browser whose laptop lid closed is exactly how a map becomes
 * permanently uneditable. A lock is a lease: the editor renews it while they
 * are typing, and it evaporates on its own if they stop.
 */
export const LOCK_TTL_SECONDS = 30;

/**
 * Try to take the lock on a node.
 *
 * Returns the CURRENT holder either way, so the caller can say "Sam is editing
 * this" (§15) rather than a bare refusal. Re-taking your own lock renews it,
 * which is what makes the renewal path the same call as the acquire path.
 */
export function acquireLock(
  ctx: AuthContext,
  mapId: string,
  nodeId: string,
  db: Database = getDb(),
): { ok: boolean; holder: LockState | null } {
  const role = roleOn(ctx, mapId, db);
  if (!role || !CAN.edit(role)) return { ok: false, holder: null };

  const run = db.transaction(() => {
    // Expired locks are cleared here rather than by a sweeper. There is no
    // background job in this deployment, and a lock nobody asks about does no
    // harm — so it is collected the moment it is in the way.
    db.prepare(
      `DELETE FROM node_locks
        WHERE map_id = ? AND node_id = ? AND expires_at <= datetime('now')`,
    ).run(mapId, nodeId);

    const existing = db
      .prepare('SELECT * FROM node_locks WHERE map_id = ? AND node_id = ?')
      .get(mapId, nodeId) as { user_id: string; expires_at: string } | undefined;

    if (existing && existing.user_id !== ctx.userId) return false;

    db.prepare(
      `INSERT INTO node_locks (map_id, node_id, user_id, expires_at)
       VALUES (@mapId, @nodeId, @userId, datetime('now', @ttl))
       ON CONFLICT(map_id, node_id)
       DO UPDATE SET user_id = @userId, expires_at = datetime('now', @ttl)`,
    ).run({
      mapId,
      nodeId,
      userId: ctx.userId,
      ttl: `+${LOCK_TTL_SECONDS} seconds`,
    });

    return true;
  });

  const ok = run();
  return { ok, holder: lockHolder(mapId, nodeId, db) };
}

export function releaseLock(
  ctx: AuthContext,
  mapId: string,
  nodeId: string,
  db: Database = getDb(),
): void {
  db.prepare(
    'DELETE FROM node_locks WHERE map_id = ? AND node_id = ? AND user_id = ?',
  ).run(mapId, nodeId, ctx.userId);
}

export function lockHolder(
  mapId: string,
  nodeId: string,
  db: Database = getDb(),
): LockState | null {
  const row = db
    .prepare(
      `SELECT node_locks.*, users.display_name
         FROM node_locks JOIN users ON users.id = node_locks.user_id
        WHERE map_id = ? AND node_id = ? AND expires_at > datetime('now')`,
    )
    .get(mapId, nodeId) as
    | { node_id: string; user_id: string; display_name: string; expires_at: string }
    | undefined;

  return row
    ? {
        nodeId: row.node_id,
        userId: row.user_id,
        name: row.display_name,
        expiresAt: row.expires_at,
      }
    : null;
}

/** Every live lock on a map, for painting the pulse on other people's nodes. */
export function listLocks(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): LockState[] {
  if (!roleOn(ctx, mapId, db)) return [];

  const rows = db
    .prepare(
      `SELECT node_locks.*, users.display_name
         FROM node_locks JOIN users ON users.id = node_locks.user_id
        WHERE map_id = ? AND expires_at > datetime('now')`,
    )
    .all(mapId) as {
    node_id: string;
    user_id: string;
    display_name: string;
    expires_at: string;
  }[];

  return rows.map((row) => ({
    nodeId: row.node_id,
    userId: row.user_id,
    name: row.display_name,
    expiresAt: row.expires_at,
  }));
}

// ------------------------------------------------------------------ activity

export interface ActivityRow {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string;
  createdAt: string;
}

/** §14: "Append-only log. Cheap to build, disproportionately trust-building." */
export function recordActivity(
  ctx: AuthContext,
  mapId: string,
  action: string,
  options: { targetType?: string; targetId?: string | null; detail?: string } = {},
  db: Database = getDb(),
): void {
  db.prepare(
    `INSERT INTO map_activity (id, map_id, actor_id, action, target_type, target_id, detail)
     VALUES (@id, @mapId, @actorId, @action, @targetType, @targetId, @detail)`,
  ).run({
    id: `act_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    mapId,
    actorId: ctx.userId || null,
    action,
    targetType: options.targetType ?? 'map',
    targetId: options.targetId ?? null,
    detail: (options.detail ?? '').slice(0, 200),
  });
}

export function listActivity(
  ctx: AuthContext,
  mapId: string,
  filter: { actorId?: string; action?: string } = {},
  db: Database = getDb(),
): ActivityRow[] {
  const role = roleOn(ctx, mapId, db);
  if (!role) return [];

  const rows = db
    .prepare(
      `SELECT map_activity.*, COALESCE(users.display_name, 'Someone') AS actor_name
         FROM map_activity
         LEFT JOIN users ON users.id = map_activity.actor_id
        WHERE map_activity.map_id = @mapId
          AND (@actorId IS NULL OR map_activity.actor_id = @actorId)
          AND (@action IS NULL OR map_activity.action = @action)
        ORDER BY map_activity.created_at DESC, map_activity.rowid DESC
        LIMIT 100`,
    )
    .all({
      mapId,
      actorId: filter.actorId ?? null,
      action: filter.action ?? null,
    }) as {
    id: string;
    actor_id: string | null;
    actor_name: string;
    action: string;
    target_type: string;
    target_id: string | null;
    detail: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

// ------------------------------------------------------------- notifications

export interface NotificationRow {
  id: string;
  mapId: string | null;
  actorName: string;
  kind: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
}

/**
 * Fan out to everyone on the map except the actor.
 *
 * Written at event time rather than derived on read: a feed computed by
 * querying every map you belong to gets slower the more maps you join, which
 * is backwards — the people with the most to read would wait the longest.
 */
export function fanOut(
  ctx: AuthContext,
  mapId: string,
  kind: string,
  body: string,
  href: string,
  db: Database = getDb(),
): void {
  const recipients = db
    .prepare(
      `SELECT owner_id AS user_id FROM maps WHERE id = @mapId
       UNION
       SELECT user_id FROM map_members WHERE map_id = @mapId`,
    )
    .all({ mapId }) as { user_id: string }[];

  const insert = db.prepare(
    `INSERT INTO notifications (id, user_id, map_id, actor_id, kind, body, href)
     VALUES (@id, @userId, @mapId, @actorId, @kind, @body, @href)`,
  );

  db.transaction(() => {
    for (const recipient of recipients) {
      // Nobody needs telling about their own action.
      if (recipient.user_id === ctx.userId) continue;
      insert.run({
        id: `ntf_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        userId: recipient.user_id,
        mapId,
        actorId: ctx.userId || null,
        kind,
        body: body.slice(0, 200),
        href,
      });
    }
  })();
}

export function listNotifications(
  ctx: AuthContext,
  db: Database = getDb(),
): NotificationRow[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `SELECT notifications.*, COALESCE(users.display_name, 'Someone') AS actor_name
         FROM notifications
         LEFT JOIN users ON users.id = notifications.actor_id
        WHERE notifications.user_id = ?
        ORDER BY notifications.created_at DESC
        LIMIT 50`,
    )
    .all(ctx.userId) as {
    id: string;
    map_id: string | null;
    actor_name: string;
    kind: string;
    body: string;
    href: string;
    read_at: string | null;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    mapId: row.map_id,
    actorName: row.actor_name,
    kind: row.kind,
    body: row.body,
    href: row.href,
    read: row.read_at !== null,
    createdAt: row.created_at,
  }));
}

export function markRead(
  ctx: AuthContext,
  ids: readonly string[] | 'all',
  db: Database = getDb(),
): void {
  if (!ctx.userId) return;

  if (ids === 'all') {
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now')
        WHERE user_id = ? AND read_at IS NULL`,
    ).run(ctx.userId);
    return;
  }

  const update = db.prepare(
    `UPDATE notifications SET read_at = datetime('now')
      WHERE id = ? AND user_id = ? AND read_at IS NULL`,
  );
  // Scoped by user_id as well as id: without it, knowing an id would let
  // anyone mark someone else's notification read.
  db.transaction(() => {
    for (const id of ids) update.run(id, ctx.userId);
  })();
}

export function unreadCount(ctx: AuthContext, db: Database = getDb()): number {
  if (!ctx.userId) return 0;
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    )
    .get(ctx.userId) as { n: number };
  return row.n;
}
