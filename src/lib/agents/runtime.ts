import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { toolCall } from '@/lib/ai/gateway';
import { getTool, toolNames } from './tools';
import { hasTool, preflight, toolsFor, type AgentLimits } from './safety';

/**
 * Running an agent.
 *
 * ── The loop, and every way out of it ───────────────────────────────────────
 *
 * The agent is asked which tool to call; the tool runs; the result goes back;
 * repeat. Four things end the loop, and only one of them is the agent deciding
 * it is finished:
 *
 *   the agent calls `finish`          the intended ending
 *   the step ceiling is reached       a loop that never converges
 *   preflight fails mid-run           the kill switch, a pause, or the budget
 *   the model call fails              provider trouble, recorded and stopped
 *
 * Preflight runs before EVERY step, not just at the start. A kill switch that
 * only stopped runs from beginning is useless at the moment you reach for it —
 * the runs already going are exactly the ones doing damage.
 *
 * ── The agent never sees a tool it does not hold ────────────────────────────
 *
 * The tool list handed to the model is built from `agent_tool_grants`, so an
 * ungranted tool is not merely refused, it is not offered. The refusal path
 * still exists and is still recorded, because a model can name a tool nobody
 * offered it and that attempt is worth seeing.
 */

export interface RunResult {
  runId: string;
  status: 'ok' | 'failed' | 'halted' | 'refused';
  steps: number;
  costUsd: number;
  error?: string;
}

/** The step budget is also a cost ceiling; both are checked every iteration. */
const FINISH = 'finish';

function recordStep(
  runId: string,
  seq: number,
  tool: string,
  input: unknown,
  outcome: 'ok' | 'refused' | 'error',
  output: string,
  db: Database,
): void {
  db.prepare(
    `INSERT INTO agent_steps (id, run_id, seq, tool, input, outcome, output)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `stp_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    runId,
    seq,
    tool,
    JSON.stringify(input ?? {}).slice(0, 2000),
    outcome,
    output.slice(0, 2000),
  );
}

function finish(
  runId: string,
  status: RunResult['status'],
  steps: number,
  costUsd: number,
  error: string | undefined,
  db: Database,
): RunResult {
  db.prepare(
    `UPDATE agent_runs
        SET status = ?, steps = ?, cost_usd = ?, error = ?,
            finished_at = datetime('now')
      WHERE id = ?`,
  ).run(status, steps, costUsd, error ?? null, runId);

  return { runId, status, steps, costUsd, ...(error ? { error } : {}) };
}

/**
 * Run one agent to completion.
 *
 * `actor` is the agent's OWNER, not whoever triggered the run. Every tool
 * checks permission against it, so an agent triggered by a workflow someone
 * else started still cannot reach anything its owner could not.
 */
export async function runAgent(
  agentId: string,
  trigger: 'manual' | 'workflow' | 'event',
  goal: string,
  db: Database = getDb(),
): Promise<RunResult> {
  const gate = preflight(agentId, db);

  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  db.prepare(
    'INSERT INTO agent_runs (id, agent_id, trigger, status) VALUES (?, ?, ?, ?)',
  ).run(runId, agentId, trigger, 'running');

  /*
   * A refused run still gets a row.
   *
   * "The agent did nothing because it is over budget" is exactly the thing
   * someone needs to see, and a refusal that leaves no trace looks identical
   * to an agent nobody triggered.
   */
  if (!gate.ok || !gate.limits) {
    return finish(runId, 'refused', 0, 0, gate.message, db);
  }

  const limits: AgentLimits = gate.limits;
  const actor: AuthContext = { userId: limits.ownerId, isStaff: false };

  const granted = toolsFor(agentId, db);
  if (granted.length === 0) {
    return finish(runId, 'refused', 0, 0, 'This agent has no tools.', db);
  }

  const agent = db
    .prepare('SELECT name, instructions FROM agents WHERE id = ?')
    .get(agentId) as { name: string; instructions: string };

  const available = granted
    .map((name) => getTool(name))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);

  const transcript: string[] = [`Goal: ${goal}`];
  let steps = 0;
  let costUsd = 0;

  while (steps < limits.maxSteps) {
    /*
     * Re-checked every iteration. This is the line that makes the kill switch
     * mean something for a run already in flight.
     */
    const midflight = preflight(agentId, db);
    if (!midflight.ok) {
      return finish(runId, 'halted', steps, costUsd, midflight.message, db);
    }

    const result = await toolCall<{
      tool?: string;
      input?: unknown;
      done?: boolean;
    }>(
      { userId: limits.ownerId, feature: 'assistant' },
      [
        `You are ${agent.name}.`,
        agent.instructions,
        '',
        transcript.join('\n'),
        '',
        'Choose one tool to call next, or finish.',
      ].join('\n'),
      {
        name: 'act',
        description: 'Call one tool, or finish.',
        schema: {
          type: 'object',
          required: ['tool'],
          properties: {
            tool: {
              type: 'string',
              // The model is offered only what the agent holds, plus finish.
              enum: [...available.map((tool) => tool.name), FINISH],
            },
            input: { type: 'object' },
          },
        },
      },
      undefined,
      db,
    );

    if (!result.ok || !result.value) {
      return finish(
        runId,
        'failed',
        steps,
        costUsd,
        result.error?.message ?? 'The model was unavailable.',
        db,
      );
    }

    costUsd += result.value.usage.costUsd;
    const choice = result.value.input;

    if (!choice?.tool || choice.tool === FINISH) {
      return finish(runId, 'ok', steps, costUsd, undefined, db);
    }

    steps++;

    /*
     * The grant is checked again here, even though the enum only offered
     * granted tools.
     *
     * A model can return a value outside an enum, and treating the schema as a
     * guarantee is how an ungranted tool gets called. The refusal is recorded
     * rather than silently ignored: an agent repeatedly reaching for something
     * it does not hold is a signal worth having.
     */
    if (!hasTool(agentId, choice.tool, db)) {
      recordStep(
        runId,
        steps,
        choice.tool,
        choice.input,
        'refused',
        'Not granted.',
        db,
      );
      transcript.push(`${choice.tool}: refused, not granted`);
      continue;
    }

    const tool = getTool(choice.tool);
    if (!tool) {
      recordStep(runId, steps, choice.tool, choice.input, 'error', 'Unknown.', db);
      transcript.push(`${choice.tool}: unknown tool`);
      continue;
    }

    let outcome: 'ok' | 'refused' | 'error' = 'ok';
    let output = '';

    try {
      const toolResult = tool.run(choice.input, {
        actor,
        agentId,
        mapId: limits.mapId,
        db,
      });
      outcome = toolResult.ok ? 'ok' : toolResult.refused ? 'refused' : 'error';
      output = toolResult.output;
    } catch (cause) {
      /*
       * A throwing tool must not take the run down.
       *
       * The step is recorded as an error, the agent is told, and the loop
       * continues — a crash here would leave the run row stuck in `running`
       * forever, which is worse than a failed step.
       */
      outcome = 'error';
      output = cause instanceof Error ? cause.message : String(cause);
    }

    recordStep(runId, steps, choice.tool, choice.input, outcome, output, db);
    transcript.push(`${choice.tool} -> ${output.slice(0, 400)}`);
  }

  // Fell out of the loop: the ceiling stopped it, not the agent.
  return finish(runId, 'halted', steps, costUsd, 'Step limit reached.', db);
}

export interface RunSummary {
  id: string;
  agentId: string;
  trigger: string;
  status: string;
  steps: number;
  costUsd: number;
  error: string | null;
  startedAt: string;
}

/** Recent runs for one agent. Owner or staff; enforced by the caller. */
export function recentRuns(
  agentId: string,
  limit = 50,
  db: Database = getDb(),
): RunSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_runs WHERE agent_id = ?
        ORDER BY started_at DESC LIMIT ?`,
    )
    .all(agentId, limit) as {
    id: string;
    agent_id: string;
    trigger: string;
    status: string;
    steps: number;
    cost_usd: number;
    error: string | null;
    started_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    trigger: row.trigger,
    status: row.status,
    steps: row.steps,
    costUsd: row.cost_usd,
    error: row.error,
    startedAt: row.started_at,
  }));
}

export interface AgentHealth {
  runs: number;
  failures: number;
  refusedSteps: number;
  costUsd: number;
}

/**
 * Monitoring.
 *
 * `refusedSteps` is the number worth watching: a rising count means an agent is
 * repeatedly reaching for tools it does not hold, which is either a
 * misconfiguration or something steering it.
 */
export function agentHealth(agentId: string, db: Database = getDb()): AgentHealth {
  const runs = db
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN status IN ('failed','halted') THEN 1 ELSE 0 END) AS bad,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM agent_runs WHERE agent_id = ?`,
    )
    .get(agentId) as { n: number; bad: number | null; cost: number };

  const refused = db
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_steps
        JOIN agent_runs ON agent_runs.id = agent_steps.run_id
       WHERE agent_runs.agent_id = ? AND agent_steps.outcome = 'refused'`,
    )
    .get(agentId) as { n: number };

  return {
    runs: runs.n,
    failures: runs.bad ?? 0,
    refusedSteps: refused.n,
    costUsd: runs.cost,
  };
}

/** Every tool name the system knows, for the grant UI. */
export function knownTools(): string[] {
  return toolNames();
}
