import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { deleteAgent, getAgent, updateAgent } from '@/lib/agents/repo';
import { grantTool, revokeTool, setAgentEnabled } from '@/lib/agents/safety';
import {
  agentHealth,
  knownTools,
  recentRuns,
  runAgent,
} from '@/lib/agents/runtime';

export const dynamic = 'force-dynamic';

/**
 * One agent: read it, change it, grant it tools, run it, delete it.
 *
 * Grants and the enabled switch are PATCH operations rather than separate
 * routes because they are edits to the same object and share its permission
 * check. Splitting them would mean four files each re-deriving who may act.
 */

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  instructions: z.string().max(4000).optional(),
  monthlyUsd: z.number().min(0).max(20).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
  grantTool: z.string().max(60).optional(),
  revokeTool: z.string().max(60).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const agent = getAgent(ctx, agentId);
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    agent,
    runs: recentRuns(agentId, 20),
    health: agentHealth(agentId),
    tools: knownTools(),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const {
    grantTool: toGrant,
    revokeTool: toRevoke,
    enabled,
    ...fields
  } = parsed.data;

  if (toGrant && !grantTool(ctx, agentId, toGrant, knownTools())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (toRevoke && !revokeTool(ctx, agentId, toRevoke)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (enabled !== undefined && !setAgentEnabled(ctx, agentId, enabled)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (Object.keys(fields).length > 0) {
    const result = updateAgent(ctx, agentId, fields);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
  }

  const agent = getAgent(ctx, agentId);
  return NextResponse.json({ agent });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const removed = deleteAgent(
    { userId: session.userId, isStaff: session.isStaff },
    agentId,
  );

  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}

/**
 * Run the agent now.
 *
 * Executed inline rather than queued, because this is a person pressing Run and
 * watching for the answer — the step ceiling and the spend cap already bound
 * how long it can take. An event-triggered run goes through the job queue
 * instead, where nobody is waiting.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  // Must be able to SEE it before running it; the runtime then re-checks
  // everything else, including the kill switch.
  if (!getAgent(ctx, agentId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let goal = '';
  try {
    const body = (await request.json()) as { goal?: unknown };
    goal = typeof body.goal === 'string' ? body.goal.slice(0, 2000) : '';
  } catch {
    goal = '';
  }

  const result = await runAgent(agentId, 'manual', goal);

  return NextResponse.json({ run: result });
}
