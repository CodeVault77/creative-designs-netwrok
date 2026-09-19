import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { agentsOnMap, createAgent } from '@/lib/agents/repo';
import { knownTools } from '@/lib/agents/runtime';

export const dynamic = 'force-dynamic';

/**
 * Agents on a map.
 *
 * Thin, like every route here. The repository owns permission, and it answers
 * "not found" rather than "forbidden" for anything the caller may not see —
 * so this file never has to decide which of those to say.
 */

const createSchema = z.object({
  nodeId: z.string().max(60),
  name: z.string().min(1).max(80),
  instructions: z.string().max(4000).optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const mapId = new URL(request.url).searchParams.get('mapId');
  if (!mapId) {
    return NextResponse.json({ error: 'Which map?' }, { status: 400 });
  }

  return NextResponse.json({
    agents: agentsOnMap(ctx, mapId),
    // The grant UI needs the full list of tool names, and it is not secret.
    tools: knownTools(),
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
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const result = createAgent(
    { userId: session.userId, isStaff: session.isStaff },
    parsed.data,
  );

  if (!result.ok) {
    /*
     * 404 for a permission failure, 409 for the one case that is genuinely a
     * conflict rather than an absence — a node that already has an agent.
     * Everything else stays indistinguishable from "no such node".
     */
    const conflict = result.error === 'That node already has an agent';
    return NextResponse.json(
      { error: result.error },
      { status: conflict ? 409 : 404 },
    );
  }

  return NextResponse.json({ agent: result.agent }, { status: 201 });
}
