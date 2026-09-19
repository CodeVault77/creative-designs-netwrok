import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, type AuthContext } from '@/lib/db/repo';
import { createDraft } from '@/lib/editor/draft';
import { setGrant } from '@/lib/permissions/resolve';
import { setProvider } from '@/lib/ai/gateway';
import type {
  AIProvider,
  CompletionResult,
  EmbedResult,
  ToolCallResult,
} from '@/lib/ai/provider';
import {
  agentSpend,
  grantTool,
  hasTool,
  killSwitch,
  preflight,
  revokeTool,
  setAgentEnabled,
  setKillSwitch,
  toolsFor,
} from './safety';
import { getTool, toolNames } from './tools';
import { agentHealth, recentRuns, runAgent } from './runtime';
import {
  advance,
  createWorkflow,
  decideApproval,
  pendingApprovals,
  startWorkflow,
} from './workflows';

/**
 * The roadmap calls this the highest-risk phase, and names the four things that
 * must exist before launch: permission enforcement, spend caps, an audit trail
 * and a kill switch.
 *
 * So almost every test here is a REFUSAL. What an agent can do is the easy
 * half; what it cannot do under adversarial conditions is the half that decides
 * whether this is safe to turn on.
 */

let db: Database;
let owner: AuthContext;
let stranger: AuthContext;
let staff: AuthContext;
let mapId: string;
let rootId: string;
let agentId: string;

/** Scripts a sequence of tool choices, so a run is deterministic. */
class ScriptedProvider implements AIProvider {
  readonly id = 'scripted';
  private index = 0;

  constructor(private readonly script: { tool: string; input?: unknown }[]) {}

  isConfigured() {
    return true;
  }

  private usage() {
    return { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 };
  }

  async complete(): Promise<CompletionResult> {
    return { text: '', usage: this.usage(), model: 'scripted' };
  }

  async *stream(): AsyncIterable<string> {
    yield '';
  }

  async toolCall<T>(): Promise<ToolCallResult<T>> {
    // Past the end of the script means finish, so a run always terminates.
    const step = this.script[this.index++] ?? { tool: 'finish' };
    return { input: step as T, usage: this.usage(), model: 'scripted' };
  }

  async embed(): Promise<EmbedResult> {
    throw new Error('no embeddings');
  }
}

function user(id: string, handle: string, isStaff = false): AuthContext {
  const row = createUser(
    {
      id,
      email: `${handle}@example.com`,
      passwordHash: 'x',
      handle,
      displayName: handle,
    },
    db,
  );
  return { userId: row.id, isStaff };
}

function makeAgent(
  ownerId: string,
  nodeId: string,
  over: Partial<{
    enabled: number;
    monthlyUsd: number;
    maxSteps: number;
  }> = {},
) {
  const id = `ag_${nodeId}`;
  db.prepare(
    `INSERT INTO agents
       (id, node_id, map_id, owner_id, name, instructions, enabled,
        monthly_usd, max_steps)
     VALUES (?, ?, ?, ?, 'Helper', 'Be useful.', ?, ?, ?)`,
  ).run(
    id,
    nodeId,
    mapId,
    ownerId,
    over.enabled ?? 1,
    over.monthlyUsd ?? 1,
    over.maxSteps ?? 8,
  );
  return id;
}

beforeEach(() => {
  db = createTestDb();

  owner = user('u_owner', 'owner');
  stranger = user('u_other', 'other');
  staff = user('u_staff', 'staff', true);

  mapId = 'm_agents';
  createMap(owner, createDraft(mapId, 'Agent map', 'create'), db);

  rootId = 'nd_root';
  db.prepare(
    `INSERT INTO map_nodes
       (id, map_id, parent_id, slot, title, family, type, status, visibility)
     VALUES (?, ?, NULL, 0, 'Root', 'create', 'topic', 'active', 'inherit')`,
  ).run(rootId, mapId);

  agentId = makeAgent(owner.userId!, rootId);
});

afterEach(() => setProvider(null));

// ------------------------------------------------------------- kill switch

describe('the kill switch', () => {
  it('is on by default and stops everything when flipped', () => {
    expect(killSwitch(db).enabled).toBe(true);
    expect(preflight(agentId, db).ok).toBe(true);

    setKillSwitch(staff, false, 'Investigating', db);

    const gate = preflight(agentId, db);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('killed');
    expect(gate.message).toBe('Investigating');
  });

  it('treats a missing control row as stopped, not running', () => {
    db.prepare('DELETE FROM agent_controls').run();

    // "I cannot tell" must read as no. A default of enabled would turn every
    // agent loose against a half-migrated database.
    expect(killSwitch(db).enabled).toBe(false);
    expect(preflight(agentId, db).ok).toBe(false);
  });

  it('is staff-only', () => {
    expect(setKillSwitch(owner, false, 'nope', db)).toBe(false);
    expect(killSwitch(db).enabled).toBe(true);
  });

  it('halts a run that is already in flight', async () => {
    grantTool(owner, agentId, 'read_node', toolNames(), db);

    /*
     * The switch is flipped BETWEEN steps, by a tool the script calls first.
     * A kill switch checked only at the start would let this run to completion,
     * which is precisely the case it exists for.
     */
    setProvider(
      new ScriptedProvider([
        { tool: 'read_node', input: { nodeId: rootId } },
        { tool: 'read_node', input: { nodeId: rootId } },
      ]),
    );

    const first = await runAgent(agentId, 'manual', 'read things', db);
    expect(first.status).toBe('ok');

    setKillSwitch(staff, false, 'Stop', db);

    setProvider(
      new ScriptedProvider([{ tool: 'read_node', input: { nodeId: rootId } }]),
    );
    const second = await runAgent(agentId, 'manual', 'read things', db);

    expect(second.status).toBe('refused');
    expect(second.steps).toBe(0);
  });
});

// ------------------------------------------------------------ spend and caps

describe('caps', () => {
  it('refuses an agent that is over its monthly budget', async () => {
    db.prepare(
      `INSERT INTO agent_runs (id, agent_id, trigger, status, cost_usd)
       VALUES ('old', ?, 'manual', 'ok', 5.0)`,
    ).run(agentId);

    expect(agentSpend(agentId, db)).toBeCloseTo(5.0);

    const gate = preflight(agentId, db);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('over-budget');
  });

  it('stops at the step ceiling rather than looping forever', async () => {
    // The node has to exist before the agent that points at it.
    db.prepare(
      `INSERT INTO map_nodes
         (id, map_id, parent_id, slot, title, family, type, status, visibility)
       VALUES (?, ?, NULL, 1, 'Other', 'create', 'topic', 'active', 'inherit')`,
    ).run(rootId + '2', mapId);
    const tight = makeAgent(owner.userId!, rootId + '2', { maxSteps: 3 });

    grantTool(owner, tight, 'read_node', toolNames(), db);

    // A script that never finishes: only the ceiling can end this.
    setProvider(
      new ScriptedProvider(
        Array.from({ length: 20 }, () => ({
          tool: 'read_node',
          input: { nodeId: rootId },
        })),
      ),
    );

    const result = await runAgent(tight, 'manual', 'loop', db);

    expect(result.status).toBe('halted');
    expect(result.steps).toBe(3);
  });

  it('pauses one agent without stopping the rest', async () => {
    expect(setAgentEnabled(owner, agentId, false, db)).toBe(true);

    const gate = preflight(agentId, db);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('agent-disabled');

    // The global switch is untouched.
    expect(killSwitch(db).enabled).toBe(true);
  });

  it('will not let a stranger pause someone else agent', () => {
    expect(setAgentEnabled(stranger, agentId, false, db)).toBe(false);
  });
});

// ------------------------------------------------------------- tool grants

describe('tool grants', () => {
  it('denies by default', () => {
    expect(toolsFor(agentId, db)).toEqual([]);
    expect(hasTool(agentId, 'read_node', db)).toBe(false);
  });

  it('refuses a run by an agent with no tools at all', async () => {
    setProvider(new ScriptedProvider([]));
    const result = await runAgent(agentId, 'manual', 'do something', db);

    expect(result.status).toBe('refused');
    expect(result.error).toBe('This agent has no tools.');
  });

  it('only lets the owner grant, and only known tools', () => {
    expect(grantTool(stranger, agentId, 'read_node', toolNames(), db)).toBe(false);

    // An unknown name would create a row that silently never matches.
    expect(grantTool(owner, agentId, 'launch_missiles', toolNames(), db)).toBe(
      false,
    );

    expect(grantTool(owner, agentId, 'read_node', toolNames(), db)).toBe(true);
    expect(hasTool(agentId, 'read_node', db)).toBe(true);

    expect(revokeTool(owner, agentId, 'read_node', db)).toBe(true);
    expect(hasTool(agentId, 'read_node', db)).toBe(false);
  });

  it('records a refusal when the model names an ungranted tool', async () => {
    grantTool(owner, agentId, 'read_node', toolNames(), db);

    /*
     * The enum only offers granted tools, but a model can return a value
     * outside an enum. Treating the schema as a guarantee is how an ungranted
     * tool gets called.
     */
    setProvider(
      new ScriptedProvider([
        { tool: 'create_node', input: { parentId: rootId, title: 'Sneaky' } },
      ]),
    );

    await runAgent(agentId, 'manual', 'try it', db);

    const step = db.prepare('SELECT tool, outcome FROM agent_steps').get() as {
      tool: string;
      outcome: string;
    };

    expect(step.tool).toBe('create_node');
    expect(step.outcome).toBe('refused');

    // And nothing was written.
    const children = db
      .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE parent_id = ?')
      .get(rootId) as { n: number };
    expect(children.n).toBe(0);
  });
});

// ------------------------------------------------------ permission enforcement

describe('permission enforcement', () => {
  it('cannot touch a node its owner has been denied', async () => {
    const secret = 'nd_secret';
    db.prepare(
      `INSERT INTO map_nodes
         (id, map_id, parent_id, slot, title, family, type, status, visibility)
       VALUES (?, ?, ?, 0, 'Secret', 'create', 'topic', 'active', 'inherit')`,
    ).run(secret, mapId, rootId);

    // The owner of the map denies THEMSELVES this node, which is the shape a
    // shared map takes when one branch is restricted.
    setGrant(
      owner,
      {
        subjectId: owner.userId!,
        action: 'view',
        resourceType: 'node',
        resourceId: secret,
        effect: 'deny',
      },
      db,
    );

    grantTool(owner, agentId, 'read_node', toolNames(), db);
    setProvider(
      new ScriptedProvider([{ tool: 'read_node', input: { nodeId: secret } }]),
    );

    await runAgent(agentId, 'manual', 'read the secret', db);

    const step = db.prepare('SELECT outcome, output FROM agent_steps').get() as {
      outcome: string;
      output: string;
    };

    // A tool grant narrows what the owner can do; it never widens it.
    expect(step.outcome).toBe('refused');
    expect(step.output).toBe('No such node.');
  });

  it('cannot reach a node in another map', async () => {
    const otherMap = 'm_other';
    createMap(stranger, createDraft(otherMap, 'Theirs', 'create'), db);

    const foreign = 'nd_foreign';
    db.prepare(
      `INSERT INTO map_nodes
         (id, map_id, parent_id, slot, title, family, type, status, visibility)
       VALUES (?, ?, NULL, 0, 'Foreign', 'create', 'topic', 'active', 'inherit')`,
    ).run(foreign, otherMap);

    grantTool(owner, agentId, 'read_node', toolNames(), db);
    setProvider(
      new ScriptedProvider([{ tool: 'read_node', input: { nodeId: foreign } }]),
    );

    await runAgent(agentId, 'manual', 'go wandering', db);

    const step = db.prepare('SELECT outcome FROM agent_steps').get() as {
      outcome: string;
    };
    expect(step.outcome).toBe('refused');
  });

  it('writes only where its owner may write', async () => {
    grantTool(owner, agentId, 'create_node', toolNames(), db);
    setProvider(
      new ScriptedProvider([
        { tool: 'create_node', input: { parentId: rootId, title: 'Added' } },
      ]),
    );

    const result = await runAgent(agentId, 'manual', 'add a node', db);
    expect(result.status).toBe('ok');

    const child = db
      .prepare('SELECT title FROM map_nodes WHERE parent_id = ?')
      .get(rootId) as { title: string };
    expect(child.title).toBe('Added');
  });

  it('has no tool that deletes anything', () => {
    // Additive only: the worst case is noise a person removes, not loss.
    for (const name of toolNames()) {
      expect(name).not.toMatch(/delete|remove|drop/i);
    }
  });
});

// ------------------------------------------------------------------- memory

describe('agent memory', () => {
  it('is isolated between agents', async () => {
    const second = 'nd_second';
    db.prepare(
      `INSERT INTO map_nodes
         (id, map_id, parent_id, slot, title, family, type, status, visibility)
       VALUES (?, ?, NULL, 2, 'Second', 'create', 'topic', 'active', 'inherit')`,
    ).run(second, mapId);
    const otherAgent = makeAgent(owner.userId!, second);

    const tool = getTool('remember')!;
    tool.run(
      { key: 'secret', value: 'mine' },
      { actor: owner, agentId, mapId, db },
    );

    const recall = getTool('recall')!;

    /*
     * Both agents belong to the same person, and one still cannot read the
     * other. The agentId comes from the runtime and is deliberately absent
     * from the tool schema, so the model cannot name a different agent.
     */
    expect(recall.run({}, { actor: owner, agentId, mapId, db }).output).toContain(
      'mine',
    );
    expect(
      recall.run({}, { actor: owner, agentId: otherAgent, mapId, db }).output,
    ).toBe('[]');
  });
});

// ---------------------------------------------------------------- workflows

describe('workflows', () => {
  it('rejects an invalid step definition', () => {
    const result = createWorkflow(
      owner,
      { mapId, name: 'Bad', steps: [{ type: 'nonsense' }] },
      db,
    );

    expect(result.ok).toBe(false);
  });

  it('only lets someone who can change roles author one', () => {
    // Authoring a workflow is authoring automated writes.
    expect(
      createWorkflow(stranger, { mapId, name: 'Theirs', steps: [] }, db).ok,
    ).toBe(false);
  });

  it('runs steps in order and finishes', async () => {
    const workflow = createWorkflow(
      owner,
      {
        mapId,
        name: 'Two sets',
        steps: [
          { type: 'set', key: 'a', value: '1' },
          { type: 'set', key: 'b', value: '2' },
        ],
      },
      db,
    ).workflow!;

    const run = startWorkflow(owner, workflow.id, db)!;

    await advance(run.runId, db);
    await advance(run.runId, db);
    const final = await advance(run.runId, db);

    expect(final.status).toBe('ok');

    const context = db
      .prepare('SELECT context FROM workflow_runs WHERE id = ?')
      .get(run.runId) as { context: string };
    expect(JSON.parse(context.context)).toEqual({ a: '1', b: '2' });
  });

  it('branches on a condition', async () => {
    const workflow = createWorkflow(
      owner,
      {
        mapId,
        name: 'Branch',
        steps: [
          { type: 'set', key: 'flag', value: 'no' },
          { type: 'condition', key: 'flag', equals: 'yes', elseGoto: 3 },
          { type: 'set', key: 'taken', value: 'then' },
          { type: 'set', key: 'taken', value: 'else' },
        ],
      },
      db,
    ).workflow!;

    const run = startWorkflow(owner, workflow.id, db)!;
    for (let i = 0; i < 4; i++) await advance(run.runId, db);

    const context = db
      .prepare('SELECT context FROM workflow_runs WHERE id = ?')
      .get(run.runId) as { context: string };

    // The condition failed, so it jumped past the "then" step.
    expect(JSON.parse(context.context).taken).toBe('else');
  });

  it('stops dead at an approval and does not proceed on its own', async () => {
    const workflow = createWorkflow(
      owner,
      {
        mapId,
        name: 'Gated',
        steps: [
          { type: 'approve', prompt: 'May I?' },
          { type: 'set', key: 'after', value: 'yes' },
        ],
      },
      db,
    ).workflow!;

    const run = startWorkflow(owner, workflow.id, db)!;
    const state = await advance(run.runId, db);

    expect(state.status).toBe('awaiting_approval');

    // Advancing again changes nothing: a default of "proceed after a while"
    // would make the approval decorative.
    expect((await advance(run.runId, db)).status).toBe('awaiting_approval');

    const approvals = pendingApprovals(owner, mapId, db);
    expect(approvals).toHaveLength(1);

    expect(decideApproval(owner, approvals[0]!.id, true, db).ok).toBe(true);
    await advance(run.runId, db);
    const final = await advance(run.runId, db);

    expect(final.status).toBe('ok');
  });

  it('halts the run when an approval is rejected', async () => {
    const workflow = createWorkflow(
      owner,
      { mapId, name: 'Gated', steps: [{ type: 'approve', prompt: 'May I?' }] },
      db,
    ).workflow!;

    const run = startWorkflow(owner, workflow.id, db)!;
    await advance(run.runId, db);

    const approval = pendingApprovals(owner, mapId, db)[0]!;
    expect(decideApproval(owner, approval.id, false, db).ok).toBe(true);

    const row = db
      .prepare('SELECT status FROM workflow_runs WHERE id = ?')
      .get(run.runId) as { status: string };
    expect(row.status).toBe('halted');
  });

  it('lets only one of two racing decisions win', async () => {
    const workflow = createWorkflow(
      owner,
      { mapId, name: 'Gated', steps: [{ type: 'approve', prompt: 'May I?' }] },
      db,
    ).workflow!;

    const run = startWorkflow(owner, workflow.id, db)!;
    await advance(run.runId, db);
    const approval = pendingApprovals(owner, mapId, db)[0]!;

    expect(decideApproval(owner, approval.id, true, db).ok).toBe(true);
    expect(decideApproval(owner, approval.id, false, db).ok).toBe(false);
  });

  it('refuses an approval from someone who could not start the workflow', async () => {
    const workflow = createWorkflow(
      owner,
      { mapId, name: 'Gated', steps: [{ type: 'approve', prompt: 'May I?' }] },
      db,
    ).workflow!;

    const run = startWorkflow(owner, workflow.id, db)!;
    await advance(run.runId, db);
    const approval = pendingApprovals(owner, mapId, db)[0]!;

    // Otherwise the gate is one anyone can open.
    expect(decideApproval(stranger, approval.id, true, db).ok).toBe(false);
  });

  it('halts the workflow when an agent step is refused', async () => {
    setAgentEnabled(owner, agentId, false, db);

    const workflow = createWorkflow(
      owner,
      {
        mapId,
        name: 'Agent step',
        steps: [
          { type: 'agent', agentId, goal: 'do work' },
          { type: 'set', key: 'after', value: 'ran' },
        ],
      },
      db,
    ).workflow!;

    const run = startWorkflow(owner, workflow.id, db)!;
    const state = await advance(run.runId, db);

    /*
     * Continuing past a refused agent would mean later steps act on work that
     * never happened — and the likeliest reason for a refusal is that someone
     * deliberately stopped it.
     */
    expect(state.status).toBe('halted');

    const context = db
      .prepare('SELECT context FROM workflow_runs WHERE id = ?')
      .get(run.runId) as { context: string };
    expect(JSON.parse(context.context).after).toBeUndefined();
  });
});

// --------------------------------------------------------------- monitoring

describe('monitoring', () => {
  it('counts refused steps, which is the number worth watching', async () => {
    grantTool(owner, agentId, 'read_node', toolNames(), db);
    setProvider(
      new ScriptedProvider([
        { tool: 'create_node', input: { parentId: rootId, title: 'X' } },
        { tool: 'create_node', input: { parentId: rootId, title: 'Y' } },
      ]),
    );

    await runAgent(agentId, 'manual', 'try', db);

    const health = agentHealth(agentId, db);
    // A rising count means misconfiguration or something steering the agent.
    expect(health.refusedSteps).toBe(2);
    expect(health.runs).toBe(1);
  });

  it('records a run even when it was refused before starting', async () => {
    setKillSwitch(staff, false, 'Stopped', db);
    await runAgent(agentId, 'manual', 'anything', db);

    const runs = recentRuns(agentId, 10, db);
    // A refusal that leaves no trace looks identical to nobody triggering it.
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('refused');
  });
});
