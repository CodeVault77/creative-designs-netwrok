import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { MAX_BATCH, pull, push } from '@/lib/sync/repo';

export const dynamic = 'force-dynamic';

/**
 * Offline sync: push what a device did, pull what it missed.
 *
 * ── Both halves in one round trip ───────────────────────────────────────────
 *
 * A device coming back online has operations to send AND a gap to fill. Doing
 * them as two requests opens a window where its own writes exist on the server
 * and not yet in its own state. Combining them means a device always receives
 * its own operations back in the response that accepted them, which is what
 * makes its convergence check meaningful.
 */

const clockSchema = z.object({
  millis: z.number().int().min(0),
  count: z.number().int().min(0),
  deviceId: z.string().min(1).max(80),
});

const schema = z.object({
  mapId: z.string().min(1).max(80),
  deviceId: z.string().min(1).max(80),
  /** The highest sequence this device has already applied. */
  after: z.number().int().min(0).default(0),
  ops: z
    .array(
      z.object({
        kind: z.enum(['create_node', 'set_field', 'delete_node']),
        nodeId: z.string().min(1).max(80),
        field: z.string().max(60).default(''),
        value: z.unknown(),
        clock: clockSchema,
      }),
    )
    .max(MAX_BATCH)
    .default([]),
});

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

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the request' }, { status: 400 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const input = parsed.data;

  if (input.ops.length > 0) {
    const pushed = push(ctx, {
      mapId: input.mapId,
      deviceId: input.deviceId,
      /*
       * `value` is normalised to null when absent.
       *
       * `z.unknown()` makes the property OPTIONAL, so a client omitting it
       * produces `{}` rather than `{ value: undefined }` — and an operation
       * with no value at all is not the same as one setting null, which is a
       * real value a field can hold. Filling it in here means the CRDT never
       * has to distinguish "absent" from "null".
       */
      ops: input.ops.map((op) => ({ ...op, value: op.value ?? null })),
    });

    if (!pushed.ok) {
      return NextResponse.json({ error: pushed.error }, { status: 404 });
    }
  }

  /*
   * The pull runs from the sequence the DEVICE reported, not from the one the
   * push just produced. Using the latter would skip everything another device
   * wrote in between — the exact writes this device most needs.
   */
  const pulled = pull(ctx, {
    mapId: input.mapId,
    deviceId: input.deviceId,
    after: input.after,
  });

  if (!pulled.ok) {
    return NextResponse.json({ error: pulled.error }, { status: 404 });
  }

  return NextResponse.json({ ops: pulled.ops, seq: pulled.seq, more: pulled.more });
}
