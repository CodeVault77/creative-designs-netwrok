import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { canOnNode } from '@/lib/permissions/resolve';
import { buildRoute } from '@/lib/routes';

/**
 * Comments ON a node, and the mentions inside them.
 *
 * ── Why not map_messages ────────────────────────────────────────────────────
 *
 * `map_messages` is a chat for a whole map: a stream you read from the bottom,
 * where a message from an hour ago has scrolled away. A comment is attached to
 * one thing and is still there when you open that thing next week. They look
 * similar and behave nothing alike, so merging them would give both the worse
 * of the two treatments — which is the same argument `lib/launch/support.ts`
 * makes for keeping support out of `enquiries`.
 *
 * ── Permission is per NODE, not per map ─────────────────────────────────────
 *
 * Every read and write goes through `canOnNode`, so a node the caller has been
 * denied is one they can neither read nor comment on even when they can
 * otherwise use the map. That is the capability Phase 3 added, being used
 * rather than described.
 */

export const MAX_COMMENT = 4000;

export interface Comment {
  id: string;
  nodeId: string;
  mapId: string;
  authorId: string;
  authorHandle: string;
  authorName: string;
  body: string;
  mentions: string[];
  deleted: boolean;
  createdAt: string;
}

interface CommentRow {
  id: string;
  node_id: string;
  map_id: string;
  author_id: string;
  handle: string;
  display_name: string;
  body: string;
  deleted_at: string | null;
  created_at: string;
}

/**
 * Handles named in a comment.
 *
 * `@` followed by the same character set `users.handle` allows. Returned
 * lowercased and de-duplicated: mentioning someone three times in one comment
 * is one mention, not three notifications.
 *
 * Exported because the composer highlights them client-side, and two
 * implementations of "what counts as a mention" would eventually disagree
 * about a trailing full stop.
 */
export function extractHandles(body: string): string[] {
  const found = body.matchAll(/(^|[^\w@])@([a-z0-9][a-z0-9-]{1,38})/gi);
  return [...new Set([...found].map((match) => match[2]!.toLowerCase()))];
}

function hydrate(row: CommentRow, mentions: string[]): Comment {
  return {
    id: row.id,
    nodeId: row.node_id,
    mapId: row.map_id,
    authorId: row.author_id,
    authorHandle: row.handle,
    authorName: row.display_name,
    /*
     * A deleted comment keeps its row and loses its text.
     *
     * The tombstone is what stops a reply becoming an orphan answering
     * nothing — the thread still reads in order, with a visible gap.
     */
    body: row.deleted_at ? '' : row.body,
    mentions,
    deleted: row.deleted_at !== null,
    createdAt: row.created_at,
  };
}

export interface CommentResult {
  ok: boolean;
  comment?: Comment;
  error?: string;
}

export function postComment(
  ctx: AuthContext,
  nodeId: string,
  body: string,
  db: Database = getDb(),
): CommentResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in to comment' };

  const text = body.trim().slice(0, MAX_COMMENT);
  if (!text) return { ok: false, error: 'Write something first' };

  // `comment`, not `editNodes`: commenting is its own capability, and the
  // whole point of the commenter role is that it stops short of editing.
  if (!canOnNode(ctx, nodeId, 'comment', db)) {
    return { ok: false, error: 'Not found' };
  }

  const node = db
    .prepare('SELECT map_id, title FROM map_nodes WHERE id = ?')
    .get(nodeId) as { map_id: string; title: string } | undefined;

  if (!node) return { ok: false, error: 'Not found' };

  const id = `cmt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const handles = extractHandles(text);

  const created = db.transaction(() => {
    db.prepare(
      `INSERT INTO node_comments (id, node_id, map_id, author_id, body)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, nodeId, node.map_id, ctx.userId, text);

    if (handles.length === 0) return [] as string[];

    /*
     * Resolve handles to real accounts, and keep only people who can actually
     * see this node.
     *
     * Two reasons, and the second matters more. A typo'd handle should not
     * create a dangling mention; and notifying someone about a node they have
     * been denied would leak both its existence and its title to them.
     */
    const placeholders = handles.map(() => '?').join(', ');
    const users = db
      .prepare(`SELECT id, handle FROM users WHERE handle IN (${placeholders})`)
      .all(...handles) as { id: string; handle: string }[];

    const mentioned: string[] = [];
    const link = db.prepare(
      'INSERT OR IGNORE INTO comment_mentions (comment_id, user_id) VALUES (?, ?)',
    );

    for (const user of users) {
      if (user.id === ctx.userId) continue;
      if (!canOnNode({ userId: user.id, isStaff: false }, nodeId, 'view', db)) {
        continue;
      }
      link.run(id, user.id);
      mentioned.push(user.id);
    }

    return mentioned;
  })();

  /*
   * Notify the mentioned, and only them.
   *
   * Deliberately NOT `fanOut`: that tells the whole map, which is right for a
   * chat message and wrong for a comment on one node — a busy map would
   * notify everybody about every remark. Being named is the signal.
   */
  if (created.length > 0) {
    const insert = db.prepare(
      `INSERT INTO notifications (id, user_id, map_id, actor_id, kind, body, href)
       VALUES (@id, @userId, @mapId, @actorId, 'mention', @body, @href)`,
    );

    db.transaction(() => {
      for (const userId of created) {
        insert.run({
          id: `ntf_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
          userId,
          mapId: node.map_id,
          actorId: ctx.userId,
          body: `mentioned you on ${node.title}`.slice(0, 200),
          href: buildRoute.mapEditorNode(node.map_id, nodeId),
        });
      }
    })();
  }

  const row = db
    .prepare(
      `SELECT node_comments.*, users.handle, users.display_name
         FROM node_comments
         JOIN users ON users.id = node_comments.author_id
        WHERE node_comments.id = ?`,
    )
    .get(id) as CommentRow;

  return { ok: true, comment: hydrate(row, created) };
}

/** A node's comments, oldest first. Empty for anyone who cannot see the node. */
export function listComments(
  ctx: AuthContext,
  nodeId: string,
  db: Database = getDb(),
): Comment[] {
  if (!canOnNode(ctx, nodeId, 'view', db)) return [];

  const rows = db
    .prepare(
      `SELECT node_comments.*, users.handle, users.display_name
         FROM node_comments
         JOIN users ON users.id = node_comments.author_id
        WHERE node_comments.node_id = ?
        ORDER BY node_comments.created_at
        LIMIT 500`,
    )
    .all(nodeId) as CommentRow[];

  if (rows.length === 0) return [];

  const mentions = db
    .prepare(
      `SELECT comment_id, user_id FROM comment_mentions
        WHERE comment_id IN (${rows.map(() => '?').join(', ')})`,
    )
    .all(...rows.map((row) => row.id)) as {
    comment_id: string;
    user_id: string;
  }[];

  const byComment = new Map<string, string[]>();
  for (const mention of mentions) {
    const list = byComment.get(mention.comment_id) ?? [];
    list.push(mention.user_id);
    byComment.set(mention.comment_id, list);
  }

  return rows.map((row) => hydrate(row, byComment.get(row.id) ?? []));
}

/**
 * Soft-delete a comment.
 *
 * The author may always remove their own. Someone who can `changeRoles` on the
 * map may remove anyone's — that is the moderation authority, and the same bar
 * used elsewhere for acting on other people's content.
 */
export function deleteComment(
  ctx: AuthContext,
  commentId: string,
  db: Database = getDb(),
): boolean {
  if (!ctx.userId) return false;

  const row = db
    .prepare('SELECT author_id, node_id FROM node_comments WHERE id = ?')
    .get(commentId) as { author_id: string; node_id: string } | undefined;

  if (!row) return false;

  const isAuthor = row.author_id === ctx.userId;
  const canModerate = canOnNode(ctx, row.node_id, 'changeRoles', db);

  if (!isAuthor && !canModerate) return false;

  return (
    db
      .prepare(
        `UPDATE node_comments SET deleted_at = datetime('now')
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(commentId).changes > 0
  );
}

/** How many live comments a node has. For the badge on the detail sheet. */
export function commentCount(
  ctx: AuthContext,
  nodeId: string,
  db: Database = getDb(),
): number {
  if (!canOnNode(ctx, nodeId, 'view', db)) return 0;

  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM node_comments
          WHERE node_id = ? AND deleted_at IS NULL`,
      )
      .get(nodeId) as { n: number }
  ).n;
}
