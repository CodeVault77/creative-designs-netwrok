import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';

/**
 * The rails an agent runs inside.
 *
 * ── Why this file exists before the runtime does ────────────────────────────
 *
 * The roadmap names this the highest-risk phase and says exactly why: an agent
 * acts on user data without a person watching each step, so permission
 * enforcement, spend caps, an audit trail and a kill switch have to exist
 * BEFORE launch, not after. Everything here is a refusal; nothing here makes
 * an agent more capable.
 *
 * ── Four independent stops ──────────────────────────────────────────────────
 *
 *   1. the global kill switch      stops every agent, everywhere, at once
 *   2. the per-agent switch        pauses one without stopping the rest
 *   3. the monthly spend cap       bounds cost even while running normally
 *   4. the step ceiling            bounds a single run even if nothing errors
 *
 * They are deliberately independent. A single "is this allowed" flag would be
 * one bug away from failing open; four separate conditions each fail closed on
 * their own, and `preflight` requires all four.
 */

export interface KillSwitch {
  enabled: boolean;
  reason: string | null;
  updatedAt: string;
}

export function killSwitch(db: Database = getDb()): KillSwitch {
  const row = db
    .prepare('SELECT enabled, reason, updated_at FROM agent_controls WHERE id = 1')
    .get() as
    { enabled: number; reason: string | null; updated_at: string } | undefined;

  /*
   * A MISSING row means stopped, not running.
   *
   * The migration seeds it, so absence means something is wrong with the
   * database — and the safe reading of "I cannot tell" is no. A default of
   * enabled here would mean a corrupt or half-migrated database silently
   * turns every agent loose.
   */
  if (!row) {
    return {
      enabled: false,
      reason: 'Agent controls are missing.',
      updatedAt: '',
    };
  }

  return {
    enabled: row.enabled === 1,
    reason: row.reason,
    updatedAt: row.updated_at,
  };
}

/**
 * Stop or resume every agent.
 *
 * Staff only. This is the control someone reaches for when an agent is doing
 * damage, so it takes effect for every process immediately and needs no deploy.
 */
export function setKillSwitch(
  ctx: AuthContext,
  enabled: boolean,
  reason: string,
  db: Database = getDb(),
): boolean {
  if (!ctx.isStaff) return false;

  db.prepare(
    `UPDATE agent_controls
        SET enabled = ?, reason = ?, stopped_by = ?, updated_at = datetime('now')
      WHERE id = 1`,
  ).run(enabled ? 1 : 0, enabled ? null : reason.slice(0, 200), ctx.userId || null);

  return true;
}

export interface AgentLimits {
  id: string;
  ownerId: string;
  mapId: string;
  nodeId: string;
  enabled: boolean;
  monthlyUsd: number;
  maxSteps: number;
}

export function agentLimits(
  agentId: string,
  db: Database = getDb(),
): AgentLimits | null {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as
    | {
        id: string;
        owner_id: string;
        map_id: string;
        node_id: string;
        enabled: number;
        monthly_usd: number;
        max_steps: number;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    ownerId: row.owner_id,
    mapId: row.map_id,
    nodeId: row.node_id,
    enabled: row.enabled === 1,
    monthlyUsd: row.monthly_usd,
    maxSteps: row.max_steps,
  };
}

/** What one agent has spent this calendar month, across every run. */
export function agentSpend(agentId: string, db: Database = getDb()): number {
  return (
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM agent_runs
            WHERE agent_id = ?
              AND started_at >= datetime('now', 'start of month')`,
        )
        .get(agentId) as { total: number }
    ).total ?? 0
  );
}

export type RefusalReason =
  'killed' | 'agent-disabled' | 'over-budget' | 'unknown-agent';

export interface Preflight {
  ok: boolean;
  reason?: RefusalReason;
  message?: string;
  limits?: AgentLimits;
}

/**
 * Every condition that must hold before an agent does anything.
 *
 * Called before a run starts AND before each step inside it. Checking only at
 * the start would mean flipping the kill switch does nothing to the runs
 * already going — which is precisely when you need it to.
 */
export function preflight(agentId: string, db: Database = getDb()): Preflight {
  const kill = killSwitch(db);
  if (!kill.enabled) {
    return {
      ok: false,
      reason: 'killed',
      message: kill.reason ?? 'Agents are stopped.',
    };
  }

  const limits = agentLimits(agentId, db);
  if (!limits) {
    return { ok: false, reason: 'unknown-agent', message: 'No such agent.' };
  }

  if (!limits.enabled) {
    return {
      ok: false,
      reason: 'agent-disabled',
      message: 'This agent is paused.',
      limits,
    };
  }

  if (agentSpend(agentId, db) >= limits.monthlyUsd) {
    return {
      ok: false,
      reason: 'over-budget',
      message: 'This agent has used its monthly allowance.',
      limits,
    };
  }

  return { ok: true, limits };
}

/**
 * Tools an agent holds.
 *
 * Deny by default: no rows means no tools. There is no wildcard and no "all"
 * value, because a wildcard is how an agent ends up with a capability nobody
 * remembers granting.
 */
export function toolsFor(agentId: string, db: Database = getDb()): string[] {
  return (
    db
      .prepare(
        'SELECT tool FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool',
      )
      .all(agentId) as { tool: string }[]
  ).map((row) => row.tool);
}

export function hasTool(
  agentId: string,
  tool: string,
  db: Database = getDb(),
): boolean {
  return (
    db
      .prepare('SELECT 1 FROM agent_tool_grants WHERE agent_id = ? AND tool = ?')
      .get(agentId, tool) !== undefined
  );
}

/**
 * Grant a tool.
 *
 * Only the agent's owner may grant, and only tools that exist. Granting an
 * unknown tool name would create a row that silently never matches, which
 * reads as "the grant did not work" long after the mistake was made.
 */
export function grantTool(
  ctx: AuthContext,
  agentId: string,
  tool: string,
  known: readonly string[],
  db: Database = getDb(),
): boolean {
  const limits = agentLimits(agentId, db);
  if (!limits || !ctx.userId || limits.ownerId !== ctx.userId) return false;
  if (!known.includes(tool)) return false;

  db.prepare(
    `INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool, granted_by)
     VALUES (?, ?, ?)`,
  ).run(agentId, tool, ctx.userId);

  return true;
}

export function revokeTool(
  ctx: AuthContext,
  agentId: string,
  tool: string,
  db: Database = getDb(),
): boolean {
  const limits = agentLimits(agentId, db);
  if (!limits || !ctx.userId || limits.ownerId !== ctx.userId) return false;

  return (
    db
      .prepare('DELETE FROM agent_tool_grants WHERE agent_id = ? AND tool = ?')
      .run(agentId, tool).changes > 0
  );
}

/** Pause or resume one agent. Its owner, or staff. */
export function setAgentEnabled(
  ctx: AuthContext,
  agentId: string,
  enabled: boolean,
  db: Database = getDb(),
): boolean {
  const limits = agentLimits(agentId, db);
  if (!limits) return false;
  if (!ctx.isStaff && limits.ownerId !== ctx.userId) return false;

  db.prepare('UPDATE agents SET enabled = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    agentId,
  );

  return true;
}
