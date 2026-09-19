import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { capabilitiesOnMap } from '@/lib/permissions/resolve';
import { enqueue } from '@/lib/jobs/queue';
import { registerHandler } from '@/lib/jobs/worker';
import { runAgent } from './runtime';

/**
 * Workflows.
 *
 * ── Steps are data, not code ────────────────────────────────────────────────
 *
 * A workflow is a validated JSON array. That is what makes it authorable in a
 * visual builder, storable per map, and safe to run — the alternative, storing
 * something evaluable, would mean a user-authored workflow is user-authored
 * code running on our server.
 *
 * ── The cursor is why a run can be resumed ──────────────────────────────────
 *
 * `workflow_runs.cursor` is the index of the NEXT step. A run blocked on an
 * approval, or retried after a crash, continues from there rather than
 * restarting — restarting would repeat every side effect the completed steps
 * already had, which for an agent step means doing the work twice.
 *
 * ── Approval is a hard stop ─────────────────────────────────────────────────
 *
 * An `approve` step parks the run and creates a row someone has to decide. The
 * run does not poll, spin or time out into proceeding; nothing happens until a
 * person acts. A default of "proceed after an hour" would make the approval
 * decorative.
 */

/** A step, as stored. */
export const stepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent'),
    agentId: z.string().max(60),
    goal: z.string().max(2000),
  }),
  z.object({
    type: z.literal('approve'),
    prompt: z.string().max(500),
  }),
  z.object({
    type: z.literal('condition'),
    /** A context key to test. */
    key: z.string().max(80),
    equals: z.string().max(200),
    /**
     * Where to jump when the test FAILS.
     *
     * An absolute index rather than a relative offset: a visual builder edits
     * the list, and a relative jump silently points somewhere else the moment
     * a step above it is inserted.
     */
    elseGoto: z.number().int().min(0).max(50),
  }),
  z.object({
    type: z.literal('set'),
    key: z.string().max(80),
    value: z.string().max(500),
  }),
]);

export const stepsSchema = z.array(stepSchema).max(50);

export type Step = z.infer<typeof stepSchema>;

export interface Workflow {
  id: string;
  mapId: string;
  ownerId: string;
  name: string;
  trigger: 'manual' | 'event';
  triggerOn: string | null;
  enabled: boolean;
  steps: Step[];
}

interface WorkflowRow {
  id: string;
  map_id: string;
  owner_id: string;
  name: string;
  trigger: string;
  trigger_on: string | null;
  enabled: number;
  steps: string;
}

function hydrate(row: WorkflowRow): Workflow {
  const parsed = stepsSchema.safeParse(JSON.parse(row.steps || '[]'));

  return {
    id: row.id,
    mapId: row.map_id,
    ownerId: row.owner_id,
    name: row.name,
    trigger: row.trigger === 'event' ? 'event' : 'manual',
    triggerOn: row.trigger_on,
    enabled: row.enabled === 1,
    /*
     * Invalid stored steps read as an EMPTY workflow, not as a crash.
     *
     * Steps are validated on write, so this should not happen — but a workflow
     * whose definition cannot be parsed must do nothing rather than take down
     * the page that lists it, and an empty step list is the safe reading.
     */
    steps: parsed.success ? parsed.data : [],
  };
}

export interface WorkflowResult {
  ok: boolean;
  workflow?: Workflow;
  error?: string;
}

export function createWorkflow(
  ctx: AuthContext,
  input: {
    mapId: string;
    name: string;
    steps: unknown;
    trigger?: 'manual' | 'event';
    triggerOn?: string;
  },
  db: Database = getDb(),
): WorkflowResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  // Authoring a workflow means authoring automated writes, so the bar is the
  // capability that hands out permissions, not merely the one that edits.
  if (!capabilitiesOnMap(ctx, input.mapId, db).changeRoles) {
    return { ok: false, error: 'Not found' };
  }

  const parsed = stepsSchema.safeParse(input.steps);
  if (!parsed.success) {
    return { ok: false, error: 'That workflow has an invalid step' };
  }

  const id = `wf_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  db.prepare(
    `INSERT INTO workflows (id, map_id, owner_id, name, trigger, trigger_on, steps)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.mapId,
    ctx.userId,
    input.name.slice(0, 120),
    input.trigger ?? 'manual',
    input.triggerOn ?? null,
    JSON.stringify(parsed.data),
  );

  return {
    ok: true,
    workflow: hydrate(
      db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow,
    ),
  };
}

export function getWorkflow(
  ctx: AuthContext,
  workflowId: string,
  db: Database = getDb(),
): Workflow | null {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as
    WorkflowRow | undefined;

  if (!row) return null;
  if (!capabilitiesOnMap(ctx, row.map_id, db).view) return null;

  return hydrate(row);
}

/**
 * Workflows on a map.
 *
 * Here rather than in the route: `chokepoint.test.ts` keeps everything under
 * app/ off the database handle, and it is right to — a route that queries
 * directly is a route that re-derives visibility, which is how a workflow on a
 * map someone cannot see ends up in their list.
 */
export function workflowsOnMap(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): Workflow[] {
  if (!capabilitiesOnMap(ctx, mapId, db).view) return [];

  const rows = db
    .prepare('SELECT * FROM workflows WHERE map_id = ? ORDER BY created_at')
    .all(mapId) as WorkflowRow[];

  return rows.map(hydrate);
}

/**
 * Change a workflow.
 *
 * Same bar as creating one: editing steps is editing what runs automatically,
 * so `changeRoles` rather than `editNodes`. Steps are re-validated against the
 * same schema the runner uses, so the builder cannot save a shape the engine
 * would then choke on.
 */
export function updateWorkflow(
  ctx: AuthContext,
  workflowId: string,
  patch: {
    name?: string;
    steps?: unknown;
    trigger?: 'manual' | 'event';
    triggerOn?: string | null;
    enabled?: boolean;
  },
  db: Database = getDb(),
): WorkflowResult {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as
    WorkflowRow | undefined;

  if (!row) return { ok: false, error: 'Not found' };
  if (!capabilitiesOnMap(ctx, row.map_id, db).changeRoles) {
    return { ok: false, error: 'Not found' };
  }

  let steps: string | null = null;
  if (patch.steps !== undefined) {
    const parsed = stepsSchema.safeParse(patch.steps);
    if (!parsed.success) {
      return { ok: false, error: 'That workflow has an invalid step' };
    }
    steps = JSON.stringify(parsed.data);
  }

  db.prepare(
    `UPDATE workflows SET
       name = COALESCE(@name, name),
       steps = COALESCE(@steps, steps),
       trigger = COALESCE(@trigger, trigger),
       trigger_on = CASE WHEN @triggerOnSet = 1 THEN @triggerOn ELSE trigger_on END,
       enabled = COALESCE(@enabled, enabled)
     WHERE id = @id`,
  ).run({
    id: workflowId,
    name: patch.name?.slice(0, 120) ?? null,
    steps,
    trigger: patch.trigger ?? null,
    /*
     * `triggerOn` needs an explicit "was it supplied" flag.
     *
     * COALESCE cannot distinguish "leave it alone" from "clear it", and
     * switching a workflow from an event trigger back to manual has to clear
     * it — otherwise it keeps a stale event name that the trigger query would
     * still match on.
     */
    triggerOnSet: patch.triggerOn === undefined ? 0 : 1,
    triggerOn: patch.triggerOn ?? null,
    enabled: patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
  });

  const updated = db
    .prepare('SELECT * FROM workflows WHERE id = ?')
    .get(workflowId) as WorkflowRow;

  return { ok: true, workflow: hydrate(updated) };
}

export function deleteWorkflow(
  ctx: AuthContext,
  workflowId: string,
  db: Database = getDb(),
): boolean {
  const row = db
    .prepare('SELECT map_id FROM workflows WHERE id = ?')
    .get(workflowId) as { map_id: string } | undefined;

  if (!row) return false;
  if (!capabilitiesOnMap(ctx, row.map_id, db).changeRoles) return false;

  return (
    db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId).changes > 0
  );
}

export interface RunState {
  runId: string;
  status: 'running' | 'ok' | 'failed' | 'awaiting_approval' | 'halted';
  cursor: number;
  error?: string;
}

/** Start a run. The work happens on the job runner, not in the request. */
export function startWorkflow(
  ctx: AuthContext,
  workflowId: string,
  db: Database = getDb(),
): RunState | null {
  const workflow = getWorkflow(ctx, workflowId, db);
  if (!workflow || !workflow.enabled) return null;

  if (!capabilitiesOnMap(ctx, workflow.mapId, db).editNodes) return null;

  const runId = `wfr_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  db.prepare(
    'INSERT INTO workflow_runs (id, workflow_id, status) VALUES (?, ?, ?)',
  ).run(runId, workflowId, 'running');

  /*
   * Queued rather than executed here.
   *
   * A workflow can call several agents, each of which makes model calls, so it
   * is unbounded in time — running it in the request would hold a connection
   * for minutes and lose everything if the client went away. The job runner
   * already gives retries with backoff and a dead-letter state.
   */
  enqueue('workflow.step', { runId }, {}, db);

  return { runId, status: 'running', cursor: 0 };
}

/**
 * Advance one run by one step.
 *
 * One step per job, not a loop over all of them. Each step is independently
 * retryable, an approval parks cleanly between two of them, and no single job
 * runs for minutes — the properties that make a workflow resumable rather than
 * all-or-nothing.
 */
export async function advance(
  runId: string,
  db: Database = getDb(),
): Promise<RunState> {
  const run = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId) as
    | {
        id: string;
        workflow_id: string;
        status: string;
        cursor: number;
        context: string;
      }
    | undefined;

  if (!run) return { runId, status: 'failed', cursor: 0, error: 'No such run' };

  if (run.status !== 'running') {
    return {
      runId,
      status: run.status as RunState['status'],
      cursor: run.cursor,
    };
  }

  const row = db
    .prepare('SELECT * FROM workflows WHERE id = ?')
    .get(run.workflow_id) as WorkflowRow | undefined;

  if (!row) return settle(runId, 'failed', run.cursor, 'Workflow is gone', db);

  const workflow = hydrate(row);
  const step = workflow.steps[run.cursor];

  // Past the end: finished.
  if (!step) return settle(runId, 'ok', run.cursor, undefined, db);

  let context: Record<string, string> = {};
  try {
    context = JSON.parse(run.context) as Record<string, string>;
  } catch {
    context = {};
  }

  switch (step.type) {
    case 'set': {
      context[step.key] = step.value;
      return next(runId, run.cursor + 1, context, db);
    }

    case 'condition': {
      const matches = context[step.key] === step.equals;
      /*
       * A failed condition JUMPS rather than ending the run, which is what
       * makes a branch expressible at all. Jumping backwards is allowed and is
       * how a retry loop is built; the step ceiling below is what stops it
       * becoming infinite.
       */
      return next(runId, matches ? run.cursor + 1 : step.elseGoto, context, db);
    }

    case 'approve': {
      db.prepare(
        `INSERT INTO workflow_approvals (id, run_id, step_index, prompt)
         VALUES (?, ?, ?, ?)`,
      ).run(
        `apv_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        runId,
        run.cursor,
        step.prompt,
      );

      db.prepare(
        `UPDATE workflow_runs SET status = 'awaiting_approval' WHERE id = ?`,
      ).run(runId);

      // No job is queued. Nothing moves until a person decides.
      return { runId, status: 'awaiting_approval', cursor: run.cursor };
    }

    case 'agent': {
      const result = await runAgent(step.agentId, 'workflow', step.goal, db);

      context[`step_${run.cursor}_status`] = result.status;

      /*
       * A refused or halted agent stops the workflow.
       *
       * Continuing past an agent that was killed or ran out of budget would
       * mean later steps act on work that never happened — and the most likely
       * reason for a refusal is that someone deliberately stopped it.
       */
      if (result.status === 'refused' || result.status === 'halted') {
        return settle(runId, 'halted', run.cursor, result.error, db);
      }

      if (result.status === 'failed') {
        return settle(runId, 'failed', run.cursor, result.error, db);
      }

      return next(runId, run.cursor + 1, context, db);
    }
  }
}

/** Move to the next step and queue the job that will run it. */
function next(
  runId: string,
  cursor: number,
  context: Record<string, string>,
  db: Database,
): RunState {
  /*
   * A ceiling on total steps executed, counted by the cursor's travel.
   *
   * A backward jump makes a loop, and a loop with a condition that never
   * becomes true would otherwise queue jobs forever. 200 is far more than any
   * legitimate workflow and small enough to notice.
   */
  const executed = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM jobs WHERE type = ? AND json_extract(payload, ?) = ?',
      )
      .get('workflow.step', '$.runId', runId) as { n: number }
  ).n;

  if (executed > 200) {
    return settle(runId, 'halted', cursor, 'Too many steps', db);
  }

  db.prepare('UPDATE workflow_runs SET cursor = ?, context = ? WHERE id = ?').run(
    cursor,
    JSON.stringify(context),
    runId,
  );

  enqueue('workflow.step', { runId }, {}, db);

  return { runId, status: 'running', cursor };
}

function settle(
  runId: string,
  status: RunState['status'],
  cursor: number,
  error: string | undefined,
  db: Database,
): RunState {
  db.prepare(
    `UPDATE workflow_runs
        SET status = ?, error = ?, finished_at = datetime('now')
      WHERE id = ?`,
  ).run(status, error ?? null, runId);

  return { runId, status, cursor, ...(error ? { error } : {}) };
}

export interface ApprovalResult {
  ok: boolean;
  error?: string;
}

/**
 * Decide a pending approval.
 *
 * Approving resumes the run from the step AFTER the approval; rejecting ends
 * it. Only someone who could have started the workflow may decide — otherwise
 * the approval is a gate anyone can open.
 */
export function decideApproval(
  ctx: AuthContext,
  approvalId: string,
  approved: boolean,
  db: Database = getDb(),
): ApprovalResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const approval = db
    .prepare('SELECT * FROM workflow_approvals WHERE id = ?')
    .get(approvalId) as
    { id: string; run_id: string; step_index: number; status: string } | undefined;

  if (!approval || approval.status !== 'pending') {
    return { ok: false, error: 'That approval is no longer pending' };
  }

  const run = db
    .prepare('SELECT workflow_id FROM workflow_runs WHERE id = ?')
    .get(approval.run_id) as { workflow_id: string } | undefined;

  if (!run) return { ok: false, error: 'Not found' };

  const workflow = db
    .prepare('SELECT map_id FROM workflows WHERE id = ?')
    .get(run.workflow_id) as { map_id: string } | undefined;

  if (!workflow || !capabilitiesOnMap(ctx, workflow.map_id, db).editNodes) {
    return { ok: false, error: 'Not found' };
  }

  const claimed = db
    .prepare(
      `UPDATE workflow_approvals
          SET status = ?, decided_by = ?, decided_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    )
    .run(approved ? 'approved' : 'rejected', ctx.userId, approvalId).changes;

  // Two people deciding at once: only one wins.
  if (claimed === 0) {
    return { ok: false, error: 'That approval is no longer pending' };
  }

  if (!approved) {
    settle(approval.run_id, 'halted', approval.step_index, 'Rejected', db);
    return { ok: true };
  }

  db.prepare(
    `UPDATE workflow_runs SET status = 'running', cursor = ? WHERE id = ?`,
  ).run(approval.step_index + 1, approval.run_id);

  enqueue('workflow.step', { runId: approval.run_id }, {}, db);

  return { ok: true };
}

/** Pending approvals on a map, for the review queue. */
export function pendingApprovals(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): { id: string; prompt: string; runId: string; createdAt: string }[] {
  if (!capabilitiesOnMap(ctx, mapId, db).editNodes) return [];

  const rows = db
    .prepare(
      `SELECT workflow_approvals.id, workflow_approvals.prompt,
              workflow_approvals.run_id, workflow_approvals.created_at
         FROM workflow_approvals
         JOIN workflow_runs ON workflow_runs.id = workflow_approvals.run_id
         JOIN workflows ON workflows.id = workflow_runs.workflow_id
        WHERE workflows.map_id = ? AND workflow_approvals.status = 'pending'
        ORDER BY workflow_approvals.created_at`,
    )
    .all(mapId) as {
    id: string;
    prompt: string;
    run_id: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    runId: row.run_id,
    createdAt: row.created_at,
  }));
}

/**
 * Start every enabled workflow listening for an event type.
 *
 * ── Why this runs with no AuthContext ───────────────────────────────────────
 *
 * There is no user here — an event fired, and whoever caused it is not
 * necessarily the workflow's owner. So authorisation cannot come from the
 * caller, and it is taken from the workflow's OWNER instead: the run acts with
 * their permissions, exactly as a manual run by them would.
 *
 * That is the safe reading. The alternative — running with the permissions of
 * whoever triggered the event — would let anyone who can create a node cause
 * work to happen as somebody else.
 */
export function startWorkflowForEvent(
  eventType: string,
  payload: Record<string, unknown>,
  db: Database = getDb(),
): string[] {
  const rows = db
    .prepare(
      `SELECT * FROM workflows
        WHERE trigger = 'event' AND trigger_on = ? AND enabled = 1`,
    )
    .all(eventType) as WorkflowRow[];

  const started: string[] = [];

  for (const row of rows) {
    const owner: AuthContext = { userId: row.owner_id, isStaff: false };

    /*
     * The owner's permission is re-checked at fire time, not at authoring
     * time. A workflow written months ago by someone since removed from the
     * map must not keep running.
     */
    if (!capabilitiesOnMap(owner, row.map_id, db).editNodes) continue;

    const runId = `wfr_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    db.prepare(
      `INSERT INTO workflow_runs (id, workflow_id, status, context)
       VALUES (?, ?, 'running', ?)`,
    ).run(
      runId,
      row.id,
      /*
       * The event is seeded into the run's context, so a condition step can
       * branch on it. Only primitives are kept: a nested object would have to
       * be addressed with a path syntax the condition step does not have.
       */
      JSON.stringify(
        Object.fromEntries(
          Object.entries(payload)
            .filter(([, value]) => typeof value === 'string')
            .slice(0, 20),
        ),
      ),
    );

    enqueue('workflow.step', { runId }, {}, db);
    started.push(runId);
  }

  return started;
}

/**
 * The job type that advances a run.
 *
 * Registered at module load, the same way the outbox drain is. One step per
 * job, so the queue's retry-with-backoff and dead-letter behaviour applies to
 * each step independently — a model call failing on step four retries step
 * four, not the whole workflow.
 */
export const WORKFLOW_STEP_JOB = 'workflow.step';

registerHandler(WORKFLOW_STEP_JOB, async (payload, db) => {
  const runId = typeof payload.runId === 'string' ? payload.runId : '';
  if (!runId) return;

  await advance(runId, db);
});
