import 'server-only';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AuthContext } from '@/lib/db/repo';
import { canOnNode } from '@/lib/permissions/resolve';
import { neighboursOf } from '@/lib/graph/edges';

/**
 * The tools an agent may call.
 *
 * ── Two independent gates, and both must pass ───────────────────────────────
 *
 *   1. does this agent HOLD this tool?      (agent_tool_grants, deny by default)
 *   2. may its OWNER do this here?          (canOnNode, per resource)
 *
 * The second is the one that matters. An agent runs AS its owner, and a tool
 * grant narrows what the owner can do — it never widens it. So an agent granted
 * `update_node` still cannot touch a node its owner was denied, and revoking
 * the owner's access revokes the agent's in the same instant, with nothing to
 * remember to update.
 *
 * ── Why the write tools are so few ──────────────────────────────────────────
 *
 * Everything here is scoped to one map and one node at a time, and there is no
 * delete. An agent that can remove nodes is one prompt injection away from an
 * empty map, and the recovery story for that is a backup — which is not a
 * safety design. Additive-only means the worst case is noise a person removes,
 * not loss.
 */

export interface ToolContext {
  /** The agent's owner. Every permission check runs against this. */
  actor: AuthContext;
  agentId: string;
  mapId: string;
  db: Database;
}

export interface ToolResult {
  ok: boolean;
  /** Shown to the model as the tool's output. */
  output: string;
  /** Refused by permission rather than failed — recorded differently. */
  refused?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema handed to the provider. */
  schema: Record<string, unknown>;
  /** Whether the tool changes anything. Read-only tools are safe to grant widely. */
  mutates: boolean;
  run: (input: unknown, ctx: ToolContext) => ToolResult;
}

const tools = new Map<string, AgentTool>();

export function defineTool(tool: AgentTool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): AgentTool | undefined {
  return tools.get(name);
}

export function allTools(): AgentTool[] {
  return [...tools.values()];
}

export function toolNames(): string[] {
  return [...tools.keys()].sort();
}

// ------------------------------------------------------------------- tools

const readSchema = z.object({ nodeId: z.string().max(60) });

defineTool({
  name: 'read_node',
  description: 'Read one node: its title, description and type.',
  mutates: false,
  schema: {
    type: 'object',
    required: ['nodeId'],
    properties: { nodeId: { type: 'string' } },
  },
  run: (input, ctx) => {
    const parsed = readSchema.safeParse(input);
    if (!parsed.success) return { ok: false, output: 'Invalid input.' };

    // The owner's permission, on this specific node.
    if (!canOnNode(ctx.actor, parsed.data.nodeId, 'view', ctx.db)) {
      return { ok: false, refused: true, output: 'No such node.' };
    }

    const row = ctx.db
      .prepare(
        'SELECT title, description, type, map_id FROM map_nodes WHERE id = ?',
      )
      .get(parsed.data.nodeId) as
      | { title: string; description: string | null; type: string; map_id: string }
      | undefined;

    if (!row) return { ok: false, output: 'No such node.' };

    /*
     * Confined to the agent's own map.
     *
     * The owner may well have permission on a node in a different map, but an
     * agent scoped to one map reaching into another is lateral movement — and
     * the permission check alone would allow it.
     */
    if (row.map_id !== ctx.mapId) {
      return { ok: false, refused: true, output: 'No such node.' };
    }

    return {
      ok: true,
      output: JSON.stringify({
        title: row.title,
        description: row.description ?? '',
        type: row.type,
      }),
    };
  },
});

defineTool({
  name: 'list_children',
  description: 'List the children of a node.',
  mutates: false,
  schema: {
    type: 'object',
    required: ['nodeId'],
    properties: { nodeId: { type: 'string' } },
  },
  run: (input, ctx) => {
    const parsed = readSchema.safeParse(input);
    if (!parsed.success) return { ok: false, output: 'Invalid input.' };

    if (!canOnNode(ctx.actor, parsed.data.nodeId, 'view', ctx.db)) {
      return { ok: false, refused: true, output: 'No such node.' };
    }

    const rows = ctx.db
      .prepare(
        `SELECT id, title FROM map_nodes
          WHERE parent_id = ? AND map_id = ? ORDER BY slot LIMIT 50`,
      )
      .all(parsed.data.nodeId, ctx.mapId) as { id: string; title: string }[];

    return { ok: true, output: JSON.stringify(rows) };
  },
});

defineTool({
  name: 'list_edges',
  description: 'List the typed edges connected to a node.',
  mutates: false,
  schema: {
    type: 'object',
    required: ['nodeId'],
    properties: { nodeId: { type: 'string' } },
  },
  run: (input, ctx) => {
    const parsed = readSchema.safeParse(input);
    if (!parsed.success) return { ok: false, output: 'Invalid input.' };

    if (!canOnNode(ctx.actor, parsed.data.nodeId, 'view', ctx.db)) {
      return { ok: false, refused: true, output: 'No such node.' };
    }

    // neighboursOf already applies the owner's visibility, so an edge into a
    // map they cannot see does not appear.
    const neighbours = neighboursOf(ctx.actor, parsed.data.nodeId, ctx.db);

    return {
      ok: true,
      output: JSON.stringify(
        neighbours.slice(0, 50).map((n) => ({
          nodeId: n.nodeId,
          type: n.edge.type,
          direction: n.direction,
        })),
      ),
    };
  },
});

const createSchema = z.object({
  parentId: z.string().max(60),
  title: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
});

defineTool({
  name: 'create_node',
  description: 'Add a child node under an existing node.',
  mutates: true,
  schema: {
    type: 'object',
    required: ['parentId', 'title'],
    properties: {
      parentId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
    },
  },
  run: (input, ctx) => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, output: 'Invalid input.' };

    if (!canOnNode(ctx.actor, parsed.data.parentId, 'editNodes', ctx.db)) {
      return { ok: false, refused: true, output: 'Cannot write there.' };
    }

    const parent = ctx.db
      .prepare('SELECT map_id, family FROM map_nodes WHERE id = ?')
      .get(parsed.data.parentId) as { map_id: string; family: string } | undefined;

    if (!parent || parent.map_id !== ctx.mapId) {
      return { ok: false, refused: true, output: 'Cannot write there.' };
    }

    /*
     * A ceiling on children, enforced here rather than trusted to the model.
     *
     * An agent in a loop appending to the same parent is the cheapest way to
     * make a map unusable, and it costs almost nothing per step — so the limit
     * has to be a refusal, not an instruction.
     */
    const count = (
      ctx.db
        .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE parent_id = ?')
        .get(parsed.data.parentId) as { n: number }
    ).n;

    if (count >= 50) {
      return { ok: false, output: 'That node already has too many children.' };
    }

    const id = `nd_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    ctx.db
      .prepare(
        `INSERT INTO map_nodes
           (id, map_id, parent_id, slot, title, description, family, type,
            status, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'topic', 'active', 'inherit')`,
      )
      .run(
        id,
        ctx.mapId,
        parsed.data.parentId,
        count,
        parsed.data.title,
        parsed.data.description ?? null,
        parent.family,
      );

    return { ok: true, output: JSON.stringify({ id }) };
  },
});

const updateSchema = z.object({
  nodeId: z.string().max(60),
  description: z.string().max(280),
});

defineTool({
  name: 'update_description',
  description: 'Set the description of a node.',
  mutates: true,
  schema: {
    type: 'object',
    required: ['nodeId', 'description'],
    properties: {
      nodeId: { type: 'string' },
      description: { type: 'string' },
    },
  },
  /*
   * Description only, deliberately.
   *
   * A tool that could rewrite titles would let one bad run make a map
   * unrecognisable, and titles are what people navigate by. A description is
   * additive information; a title is identity.
   */
  run: (input, ctx) => {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, output: 'Invalid input.' };

    if (!canOnNode(ctx.actor, parsed.data.nodeId, 'editNodes', ctx.db)) {
      return { ok: false, refused: true, output: 'Cannot write there.' };
    }

    const changed = ctx.db
      .prepare('UPDATE map_nodes SET description = ? WHERE id = ? AND map_id = ?')
      .run(parsed.data.description, parsed.data.nodeId, ctx.mapId).changes;

    return changed > 0
      ? { ok: true, output: 'Updated.' }
      : { ok: false, refused: true, output: 'Cannot write there.' };
  },
});

const memorySchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(2000).optional(),
});

defineTool({
  name: 'remember',
  description: 'Store a note for this agent to read on a later run.',
  mutates: true,
  schema: {
    type: 'object',
    required: ['key'],
    properties: { key: { type: 'string' }, value: { type: 'string' } },
  },
  run: (input, ctx) => {
    const parsed = memorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, output: 'Invalid input.' };

    /*
     * Scoped to `ctx.agentId`, which the runtime supplies and the model cannot
     * reach. There is deliberately no agentId in the tool schema: if the model
     * could name the agent, one agent could read and overwrite another memory.
     */
    if (parsed.data.value === undefined) {
      ctx.db
        .prepare('DELETE FROM agent_memory WHERE agent_id = ? AND key = ?')
        .run(ctx.agentId, parsed.data.key);
      return { ok: true, output: 'Forgotten.' };
    }

    const count = (
      ctx.db
        .prepare('SELECT COUNT(*) AS n FROM agent_memory WHERE agent_id = ?')
        .get(ctx.agentId) as { n: number }
    ).n;

    // Bounded, so memory cannot become unbounded storage paid for by us.
    if (count >= 100) {
      return { ok: false, output: 'Memory is full.' };
    }

    ctx.db
      .prepare(
        `INSERT INTO agent_memory (agent_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(agent_id, key) DO UPDATE SET
           value = excluded.value, updated_at = datetime('now')`,
      )
      .run(ctx.agentId, parsed.data.key, parsed.data.value);

    return { ok: true, output: 'Remembered.' };
  },
});

defineTool({
  name: 'recall',
  description: 'Read this agent notes.',
  mutates: false,
  schema: { type: 'object', properties: {} },
  run: (_input, ctx) => {
    const rows = ctx.db
      .prepare(
        'SELECT key, value FROM agent_memory WHERE agent_id = ? ORDER BY key LIMIT 100',
      )
      .all(ctx.agentId) as { key: string; value: string }[];

    return { ok: true, output: JSON.stringify(rows) };
  },
});
