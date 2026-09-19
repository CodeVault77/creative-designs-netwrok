import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { canOnNode } from '@/lib/permissions/resolve';
import { toolCall } from './gateway';
import { renderPrompt } from './prompts';

/**
 * The assistant: node generation, expansion and summarisation.
 *
 * ── It never writes to a map ────────────────────────────────────────────────
 *
 * Every function here produces a PROPOSAL. A person accepts or rejects it, and
 * only the accept touches `map_nodes`. That is not a formality — it is what
 * makes the phase's "attributable and reversible" true:
 *
 *   attributable  every proposal keeps the `ai_calls` row that produced it, so
 *                 a bad suggestion traces to a model, a prompt version and a
 *                 cost;
 *   reversible    rejecting is the default and costs nothing, and accepting
 *                 leaves the proposal on the record, so what the model
 *                 suggested is still visible after it was applied.
 *
 * An assistant that wrote directly would be reversible only through undo,
 * which is a per-session buffer, not a record.
 */

export type ProposalKind = 'generate' | 'expand' | 'summarise';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface Proposal {
  id: string;
  mapId: string;
  nodeId: string | null;
  userId: string;
  kind: ProposalKind;
  payload: unknown;
  status: ProposalStatus;
  callId: string | null;
  createdAt: string;
}

interface ProposalRow {
  id: string;
  map_id: string;
  node_id: string | null;
  user_id: string;
  kind: string;
  payload: string;
  status: string;
  call_id: string | null;
  created_at: string;
}

function hydrate(row: ProposalRow): Proposal {
  return {
    id: row.id,
    mapId: row.map_id,
    nodeId: row.node_id,
    userId: row.user_id,
    kind: row.kind as ProposalKind,
    /*
     * Parsed defensively.
     *
     * The column is text and the writer is this file, so it should always be
     * valid JSON — but a proposal that cannot be parsed must not take down the
     * list that shows it. An empty payload renders as a proposal with nothing
     * to apply, which is visible and harmless.
     */
    payload: (() => {
      try {
        return JSON.parse(row.payload) as unknown;
      } catch {
        return null;
      }
    })(),
    status: row.status as ProposalStatus,
    callId: row.call_id,
    createdAt: row.created_at,
  };
}

// The shapes the model is asked for, and the shapes we accept back.

const childrenSchema = z.object({
  children: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        summary: z.string().max(280).optional(),
      }),
    )
    .max(8),
});

const summarySchema = z.object({
  summary: z.string().max(280),
  /** The model's own signal that the text was too thin. */
  insufficient: z.boolean().optional(),
});

export interface ProposalResult {
  ok: boolean;
  proposal?: Proposal;
  error?: string;
}

function store(
  ctx: AuthContext,
  input: {
    mapId: string;
    nodeId: string | null;
    kind: ProposalKind;
    payload: unknown;
    callId: string | null;
  },
  db: Database,
): Proposal {
  const id = `prp_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  db.prepare(
    `INSERT INTO ai_proposals (id, map_id, node_id, user_id, kind, payload, call_id)
     VALUES (@id, @mapId, @nodeId, @userId, @kind, @payload, @callId)`,
  ).run({
    id,
    mapId: input.mapId,
    nodeId: input.nodeId,
    userId: ctx.userId,
    kind: input.kind,
    payload: JSON.stringify(input.payload),
    callId: input.callId,
  });

  return hydrate(
    db.prepare('SELECT * FROM ai_proposals WHERE id = ?').get(id) as ProposalRow,
  );
}

/**
 * Suggest children for a node.
 *
 * Requires `editNodes` even though nothing is written yet. Producing a
 * proposal spends money and creates a row someone has to triage, so the bar is
 * the capability that could eventually apply it — not merely `view`.
 */
export async function proposeExpansion(
  ctx: AuthContext,
  nodeId: string,
  db: Database = getDb(),
): Promise<ProposalResult> {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };
  if (!canOnNode(ctx, nodeId, 'editNodes', db)) {
    return { ok: false, error: 'Not found' };
  }

  const node = db
    .prepare('SELECT map_id, title FROM map_nodes WHERE id = ?')
    .get(nodeId) as { map_id: string; title: string } | undefined;

  if (!node) return { ok: false, error: 'Not found' };

  const siblings = db
    .prepare('SELECT title FROM map_nodes WHERE parent_id = ? LIMIT 20')
    .all(nodeId) as { title: string }[];

  const prompt = renderPrompt('assistant.expand', {
    title: node.title,
    context: siblings.map((child) => child.title).join(', '),
    count: 5,
  });

  if (!prompt) return { ok: false, error: 'Assistant is unavailable' };

  const result = await toolCall(
    {
      userId: ctx.userId,
      feature: 'assistant',
      promptId: 'assistant.expand',
      promptVersion: prompt.version,
    },
    prompt.text,
    {
      name: 'suggest_children',
      description: 'Suggest child nodes for the given node.',
      schema: {
        type: 'object',
        required: ['children'],
        properties: {
          children: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title'],
              properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
    },
    prompt.system ? { system: prompt.system } : undefined,
    db,
  );

  if (!result.ok || !result.value) {
    return {
      ok: false,
      error: result.error?.message ?? 'Assistant is unavailable',
    };
  }

  /*
   * Validated with zod even though the tool schema was enforced.
   *
   * Schema enforcement covers shape; it does not cover OUR limits — a title of
   * 400 characters satisfies "type: string" and would still break the map.
   * The same reasoning `ingest/structure.ts` gives for double-checking.
   */
  const parsed = childrenSchema.safeParse(result.value.input);
  if (!parsed.success) {
    return { ok: false, error: 'The assistant answered in an unexpected shape' };
  }

  const existing = new Set(siblings.map((child) => child.title.toLowerCase()));
  const children = parsed.data.children.filter(
    (child) => !existing.has(child.title.toLowerCase()),
  );

  if (children.length === 0) {
    return { ok: false, error: 'Nothing new to suggest here' };
  }

  return {
    ok: true,
    proposal: store(
      ctx,
      {
        mapId: node.map_id,
        nodeId,
        kind: 'expand',
        payload: { children },
        callId: result.callId,
      },
      db,
    ),
  };
}

/** Suggest a one-sentence summary for a node that has none. */
export async function proposeSummary(
  ctx: AuthContext,
  nodeId: string,
  db: Database = getDb(),
): Promise<ProposalResult> {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };
  if (!canOnNode(ctx, nodeId, 'editNodes', db)) {
    return { ok: false, error: 'Not found' };
  }

  const node = db
    .prepare('SELECT map_id, title, description FROM map_nodes WHERE id = ?')
    .get(nodeId) as
    { map_id: string; title: string; description: string | null } | undefined;

  if (!node) return { ok: false, error: 'Not found' };

  const children = db
    .prepare('SELECT title FROM map_nodes WHERE parent_id = ? LIMIT 20')
    .all(nodeId) as { title: string }[];

  /*
   * The body is what the map already knows: the node's own description and its
   * children's titles. Deliberately NOT the whole map — a summary drawn from
   * unrelated branches describes the map, not the node.
   */
  const body = [node.description ?? '', children.map((c) => c.title).join(', ')]
    .filter(Boolean)
    .join('\n');

  if (!body.trim()) {
    return { ok: false, error: 'Not enough here to summarise yet' };
  }

  const prompt = renderPrompt('assistant.summarise', {
    title: node.title,
    body,
  });

  if (!prompt) return { ok: false, error: 'Assistant is unavailable' };

  const result = await toolCall(
    {
      userId: ctx.userId,
      feature: 'assistant',
      promptId: 'assistant.summarise',
      promptVersion: prompt.version,
    },
    prompt.text,
    {
      name: 'emit_summary',
      description: 'Emit a one-sentence summary of the node.',
      schema: {
        type: 'object',
        required: ['summary'],
        properties: {
          summary: { type: 'string' },
          insufficient: { type: 'boolean' },
        },
      },
    },
    prompt.system ? { system: prompt.system } : undefined,
    db,
  );

  if (!result.ok || !result.value) {
    return {
      ok: false,
      error: result.error?.message ?? 'Assistant is unavailable',
    };
  }

  const parsed = summarySchema.safeParse(result.value.input);
  if (!parsed.success) {
    return { ok: false, error: 'The assistant answered in an unexpected shape' };
  }

  // The model was asked to say when the text is too thin, and taking it at its
  // word beats storing a summary it has told us not to trust.
  if (parsed.data.insufficient || !parsed.data.summary.trim()) {
    return { ok: false, error: 'Not enough here to summarise yet' };
  }

  return {
    ok: true,
    proposal: store(
      ctx,
      {
        mapId: node.map_id,
        nodeId,
        kind: 'summarise',
        payload: { summary: parsed.data.summary },
        callId: result.callId,
      },
      db,
    ),
  };
}

export interface DecisionResult {
  ok: boolean;
  applied?: number;
  error?: string;
}

/**
 * Apply a pending proposal.
 *
 * Permission is re-checked HERE, not trusted from when the proposal was made.
 * A proposal can sit pending for days, and access can be revoked in between —
 * applying it on the strength of a check made last Tuesday would be a
 * permission bypass with a delay built in.
 */
export function acceptProposal(
  ctx: AuthContext,
  proposalId: string,
  db: Database = getDb(),
): DecisionResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const row = db
    .prepare('SELECT * FROM ai_proposals WHERE id = ?')
    .get(proposalId) as ProposalRow | undefined;

  if (!row || row.status !== 'pending') {
    return { ok: false, error: 'That suggestion is no longer available' };
  }

  const proposal = hydrate(row);

  if (!proposal.nodeId || !canOnNode(ctx, proposal.nodeId, 'editNodes', db)) {
    return { ok: false, error: 'Not found' };
  }

  const applied = db.transaction(() => {
    /*
     * Claim it first, conditionally.
     *
     * Two people pressing Accept at the same moment both pass the status check
     * above; only one can win a WHERE status = 'pending', so the children are
     * inserted once rather than twice.
     */
    const claimed = db
      .prepare(
        `UPDATE ai_proposals SET status = 'accepted', decided_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
      )
      .run(proposalId);

    if (claimed.changes === 0) return -1;

    if (proposal.kind === 'summarise') {
      const payload = proposal.payload as { summary?: string };
      db.prepare('UPDATE map_nodes SET description = ? WHERE id = ?').run(
        payload.summary ?? '',
        proposal.nodeId,
      );
      return 1;
    }

    const payload = proposal.payload as {
      children?: { title: string; summary?: string }[];
    };
    const children = payload.children ?? [];
    if (children.length === 0) return 0;

    const parent = db
      .prepare('SELECT map_id, family FROM map_nodes WHERE id = ?')
      .get(proposal.nodeId) as { map_id: string; family: string };

    const nextSlot = (
      db
        .prepare(
          'SELECT COALESCE(MAX(slot), -1) + 1 AS next FROM map_nodes WHERE parent_id = ?',
        )
        .get(proposal.nodeId) as { next: number }
    ).next;

    const insert = db.prepare(
      `INSERT INTO map_nodes
         (id, map_id, parent_id, slot, title, description, family, type,
          status, visibility)
       VALUES (@id, @mapId, @parentId, @slot, @title, @description, @family,
               'topic', 'active', 'inherit')`,
    );

    children.forEach((child, index) => {
      insert.run({
        id: `nd_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        mapId: parent.map_id,
        parentId: proposal.nodeId,
        slot: nextSlot + index,
        title: child.title,
        description: child.summary ?? null,
        // Inherits the parent's family: a suggestion is part of the branch it
        // was suggested for, not a new category.
        family: parent.family,
      });
    });

    return children.length;
  })();

  if (applied < 0) {
    return { ok: false, error: 'That suggestion is no longer available' };
  }

  return { ok: true, applied };
}

/** Reject a proposal. The row stays, so the suggestion remains on the record. */
export function rejectProposal(
  ctx: AuthContext,
  proposalId: string,
  db: Database = getDb(),
): DecisionResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const row = db
    .prepare('SELECT map_id, node_id FROM ai_proposals WHERE id = ?')
    .get(proposalId) as { map_id: string; node_id: string | null } | undefined;

  if (!row?.node_id || !canOnNode(ctx, row.node_id, 'editNodes', db)) {
    return { ok: false, error: 'Not found' };
  }

  const changed = db
    .prepare(
      `UPDATE ai_proposals SET status = 'rejected', decided_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    )
    .run(proposalId).changes;

  return changed > 0
    ? { ok: true, applied: 0 }
    : { ok: false, error: 'That suggestion is no longer available' };
}

/** Pending proposals on a map, for the review queue. */
export function pendingProposals(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): Proposal[] {
  const rows = db
    .prepare(
      `SELECT * FROM ai_proposals
        WHERE map_id = ? AND status = 'pending'
        ORDER BY created_at DESC LIMIT 100`,
    )
    .all(mapId) as ProposalRow[];

  // Filtered per node, not per map: a proposal on a node the caller has been
  // denied must not appear in their queue.
  return rows
    .map(hydrate)
    .filter(
      (proposal) =>
        proposal.nodeId && canOnNode(ctx, proposal.nodeId, 'editNodes', db),
    );
}
