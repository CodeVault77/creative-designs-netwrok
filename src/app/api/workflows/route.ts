import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT, type AuthContext } from '@/lib/db/repo';
import {
  createWorkflow,
  startWorkflow,
  stepsSchema,
  workflowsOnMap,
} from '@/lib/agents/workflows';
import { TRIGGERABLE_EVENTS, isTriggerableEvent } from '@/lib/agents/repo';

export const dynamic = 'force-dynamic';

/**
 * Workflows on a map.
 *
 * `steps` is validated by the same zod schema the engine uses, so the builder
 * cannot save a shape the runner would then choke on — one definition of what
 * a valid workflow is, not two that must be kept in agreement.
 */

const createSchema = z.object({
  mapId: z.string().max(60),
  name: z.string().min(1).max(120),
  steps: stepsSchema,
  trigger: z.enum(['manual', 'event']).optional(),
  triggerOn: z.string().max(60).optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  const ctx: AuthContext = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const mapId = new URL(request.url).searchParams.get('mapId');
  if (!mapId) {
    return NextResponse.json({ error: 'Which map?' }, { status: 400 });
  }

  return NextResponse.json({
    workflows: workflowsOnMap(ctx, mapId),
    // The builder needs the allowlist; an arbitrary event type is refused.
    triggerableEvents: TRIGGERABLE_EVENTS,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'That workflow has an invalid step' },
      { status: 400 },
    );
  }

  /*
   * An event trigger must name an allowlisted event.
   *
   * Checked here as well as in the repo: subscribing to an arbitrary internal
   * event type would turn every one of them into a public trigger surface the
   * moment something depended on it.
   */
  if (
    parsed.data.trigger === 'event' &&
    (!parsed.data.triggerOn || !isTriggerableEvent(parsed.data.triggerOn))
  ) {
    return NextResponse.json(
      { error: 'That event cannot start a workflow' },
      { status: 400 },
    );
  }

  const result = createWorkflow(
    { userId: session.userId, isStaff: session.isStaff },
    parsed.data,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ workflow: result.workflow }, { status: 201 });
}

/** Start a run. The steps execute on the job runner. */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  let workflowId = '';
  try {
    const body = (await request.json()) as { workflowId?: unknown };
    workflowId = typeof body.workflowId === 'string' ? body.workflowId : '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const run = startWorkflow(
    { userId: session.userId, isStaff: session.isStaff },
    workflowId,
  );

  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ run });
}
