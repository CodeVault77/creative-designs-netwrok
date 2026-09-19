import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { canOnNode, capabilitiesOnMap } from '@/lib/permissions/resolve';
import { registerHandler } from '@/lib/jobs/worker';
import { subscribe } from '@/lib/jobs/events';
import { defineNodeType } from '@/lib/nodes/registry';
import { agentLimits } from './safety';
import { runAgent } from './runtime';
import { startWorkflowForEvent } from './workflows';

/**
 * Agents as nodes, and the wiring that lets an event start one.
 *
 * ── Why an agent IS a node ──────────────────────────────────────────────────
 *
 * Phase 2 built the node type registry precisely so a new kind of node is one
 * definition rather than an edit to a union every renderer switches on. An
 * agent is the first real test of that: it registers here, and the picker, the
 * detail sheet and the map renderer pick it up without knowing anything about
 * agents.
 *
 * The `agents` row holds what a node payload should not: grants, caps, the
 * per-agent switch. Those are operational and security-relevant, and burying
 * them in a free-form JSON column would put them beyond the reach of a foreign
 * key or an index.
 */

// --------------------------------------------------------------- node type

defineNodeType({
  id: 'agent',
  label: 'agent',
  description: 'Does work on this map, within the tools you grant it.',
  icon: 'spark',
  /*
   * `soon` rather than `available`.
   *
   * The engine is complete and tested, but an agent is the first thing in this
   * product that writes to a map without a person watching each step. §14's
   * rule applies exactly: showing the type communicates the ambition, and
   * badging it Soon stops it being a promise. Flipping this to `available` is
   * the deliberate decision to turn agents on, and it is one word.
   */
  availability: 'soon',
  payload: z.object({}).passthrough(),
  actions: [
    { id: 'open', label: 'Open', requires: 'view', mutates: false },
    /*
     * Running requires `editNodes`, not `view`.
     *
     * A run spends money and can write to the map, so the bar is the
     * capability that could make those writes by hand.
     */
    { id: 'run', label: 'Run', requires: 'editNodes', mutates: true },
  ],
});

// ------------------------------------------------------------------- repo

export interface Agent {
  id: string;
  nodeId: string;
  mapId: string;
  ownerId: string;
  name: string;
  instructions: string;
  enabled: boolean;
  monthlyUsd: number;
  maxSteps: number;
  tools: string[];
}

interface AgentRow {
  id: string;
  node_id: string;
  map_id: string;
  owner_id: string;
  name: string;
  instructions: string;
  enabled: number;
  monthly_usd: number;
  max_steps: number;
}

function hydrate(row: AgentRow, db: Database): Agent {
  const tools = (
    db
      .prepare(
        'SELECT tool FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool',
      )
      .all(row.id) as { tool: string }[]
  ).map((t) => t.tool);

  return {
    id: row.id,
    nodeId: row.node_id,
    mapId: row.map_id,
    ownerId: row.owner_id,
    name: row.name,
    instructions: row.instructions,
    enabled: row.enabled === 1,
    monthlyUsd: row.monthly_usd,
    maxSteps: row.max_steps,
    tools,
  };
}

export interface AgentResult {
  ok: boolean;
  agent?: Agent;
  error?: string;
}

/**
 * Create an agent on a node.
 *
 * Requires `changeRoles`, not `editNodes`. Creating an agent is creating
 * something that will make automated writes on your behalf — the same class of
 * decision as handing someone a role, and deliberately not something a plain
 * editor can do.
 */
export function createAgent(
  ctx: AuthContext,
  input: { nodeId: string; name: string; instructions?: string },
  db: Database = getDb(),
): AgentResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const node = db
    .prepare('SELECT map_id FROM map_nodes WHERE id = ?')
    .get(input.nodeId) as { map_id: string } | undefined;

  if (!node) return { ok: false, error: 'Not found' };
  if (!capabilitiesOnMap(ctx, node.map_id, db).changeRoles) {
    return { ok: false, error: 'Not found' };
  }

  const id = `ag_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  try {
    db.prepare(
      `INSERT INTO agents (id, node_id, map_id, owner_id, name, instructions)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.nodeId,
      node.map_id,
      ctx.userId,
      input.name.slice(0, 80),
      (input.instructions ?? '').slice(0, 4000),
    );
  } catch (cause) {
    // The unique index on node_id: one agent per node, so "run this node"
    // never has two possible meanings.
    if (String(cause).includes('UNIQUE')) {
      return { ok: false, error: 'That node already has an agent' };
    }
    throw cause;
  }

  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow;
  return { ok: true, agent: hydrate(row, db) };
}

/** Agents on a map the caller can see. */
export function agentsOnMap(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): Agent[] {
  if (!capabilitiesOnMap(ctx, mapId, db).view) return [];

  const rows = db
    .prepare('SELECT * FROM agents WHERE map_id = ? ORDER BY created_at')
    .all(mapId) as AgentRow[];

  // Filtered per node: an agent on a node the caller was denied is not theirs
  // to see, even on a map they can otherwise read.
  return rows
    .filter((row) => canOnNode(ctx, row.node_id, 'view', db))
    .map((row) => hydrate(row, db));
}

export function getAgent(
  ctx: AuthContext,
  agentId: string,
  db: Database = getDb(),
): Agent | null {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as
    AgentRow | undefined;

  if (!row) return null;
  if (!canOnNode(ctx, row.node_id, 'view', db)) return null;

  return hydrate(row, db);
}

/** Change an agent's instructions or caps. Owner only. */
export function updateAgent(
  ctx: AuthContext,
  agentId: string,
  patch: {
    name?: string;
    instructions?: string;
    monthlyUsd?: number;
    maxSteps?: number;
  },
  db: Database = getDb(),
): AgentResult {
  const limits = agentLimits(agentId, db);
  if (!limits || !ctx.userId || limits.ownerId !== ctx.userId) {
    return { ok: false, error: 'Not found' };
  }

  db.prepare(
    `UPDATE agents SET
       name = COALESCE(@name, name),
       instructions = COALESCE(@instructions, instructions),
       /*
        * Caps are clamped, not trusted.
        *
        * These come from a form, and the whole point of a cap is that it
        * cannot be raised arbitrarily by whoever the agent is acting for.
        */
       monthly_usd = COALESCE(@monthlyUsd, monthly_usd),
       max_steps = COALESCE(@maxSteps, max_steps)
     WHERE id = @id`,
  ).run({
    id: agentId,
    name: patch.name?.slice(0, 80) ?? null,
    instructions: patch.instructions?.slice(0, 4000) ?? null,
    monthlyUsd:
      patch.monthlyUsd === undefined
        ? null
        : Math.max(0, Math.min(20, patch.monthlyUsd)),
    maxSteps:
      patch.maxSteps === undefined
        ? null
        : Math.max(1, Math.min(20, Math.round(patch.maxSteps))),
  });

  const row = db
    .prepare('SELECT * FROM agents WHERE id = ?')
    .get(agentId) as AgentRow;
  return { ok: true, agent: hydrate(row, db) };
}

export function deleteAgent(
  ctx: AuthContext,
  agentId: string,
  db: Database = getDb(),
): boolean {
  const limits = agentLimits(agentId, db);
  if (!limits || !ctx.userId || limits.ownerId !== ctx.userId) return false;

  return db.prepare('DELETE FROM agents WHERE id = ?').run(agentId).changes > 0;
}

// ------------------------------------------------------------ event wiring

/** The job that runs one agent, so a run survives a restart. */
export const AGENT_RUN_JOB = 'agent.run';

registerHandler(AGENT_RUN_JOB, async (payload, db) => {
  const agentId = typeof payload.agentId === 'string' ? payload.agentId : '';
  const goal = typeof payload.goal === 'string' ? payload.goal : '';
  if (!agentId) return;

  await runAgent(agentId, 'event', goal, db);
});

/**
 * The job that starts every workflow listening for an event type.
 *
 * ── Why one handler rather than one subscription per workflow ───────────────
 *
 * `subscribe` maps an event type to a JOB type, and subscriptions live in
 * process memory. Registering one subscription per workflow would mean the
 * mapping is rebuilt on every boot from whatever workflows happened to be
 * loaded, and a workflow created on one instance would never fire on another.
 *
 * One handler that queries the table has neither problem: the subscription set
 * is static, and which workflows run is answered from the database at the
 * moment the event fires.
 */
export const WORKFLOW_TRIGGER_JOB = 'workflow.trigger';

registerHandler(WORKFLOW_TRIGGER_JOB, async (payload, db) => {
  const eventType = typeof payload.eventType === 'string' ? payload.eventType : '';
  if (!eventType) return;

  startWorkflowForEvent(eventType, payload, db);
});

/**
 * Event types a workflow may be triggered by.
 *
 * An allowlist, not "any string". Subscribing to an arbitrary event type would
 * let a workflow fire on internal events that were never meant to be a public
 * trigger surface — and every one of those becomes an API the moment something
 * depends on it.
 */
export const TRIGGERABLE_EVENTS = [
  'node.created',
  'node.updated',
  'map.shared',
  'comment.posted',
] as const;

export type TriggerableEvent = (typeof TRIGGERABLE_EVENTS)[number];

export function isTriggerableEvent(value: string): value is TriggerableEvent {
  return (TRIGGERABLE_EVENTS as readonly string[]).includes(value);
}

/**
 * Connect the allowlisted event types to the trigger job.
 *
 * Called at module load. Idempotent — `subscribe` uses a Set — so importing
 * this module twice does not double-fire anything.
 */
for (const eventType of TRIGGERABLE_EVENTS) {
  subscribe(eventType, WORKFLOW_TRIGGER_JOB);
}
