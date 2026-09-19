import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import {
  deleteWorkflow,
  getWorkflow,
  stepsSchema,
  updateWorkflow,
} from '@/lib/agents/workflows';
import { isTriggerableEvent } from '@/lib/agents/repo';

export const dynamic = 'force-dynamic';

/** One workflow: read, edit, delete. */

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  steps: stepsSchema.optional(),
  trigger: z.enum(['manual', 'event']).optional(),
  triggerOn: z.string().max(60).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params;
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const workflow = getWorkflow(ctx, workflowId);
  if (!workflow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ workflow });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params;
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

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'That workflow has an invalid step' },
      { status: 400 },
    );
  }

  /*
   * An event trigger must still name an allowlisted event after an edit.
   *
   * Checked on update as well as create: otherwise a workflow could be created
   * as manual and then switched to an arbitrary event type, which is the same
   * hole with one more step in front of it.
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

  const result = updateWorkflow(
    { userId: session.userId, isStaff: session.isStaff },
    workflowId,
    parsed.data,
  );

  if (!result.ok) {
    const invalid = result.error === 'That workflow has an invalid step';
    return NextResponse.json(
      { error: result.error },
      { status: invalid ? 400 : 404 },
    );
  }

  return NextResponse.json({ workflow: result.workflow });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const removed = deleteWorkflow(
    { userId: session.userId, isStaff: session.isStaff },
    workflowId,
  );

  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}
