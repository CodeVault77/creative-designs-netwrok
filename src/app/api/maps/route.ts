import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import {
  countMapsOwned,
  createMap,
  listOwnedMaps,
  listSharedMaps,
  mapTitleTaken,
  type AuthContext,
} from '@/lib/db/repo';
import { draftFromTemplate, templateById } from '@/lib/editor/templates';
import { checkMapQuota } from '@/lib/quotas';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  /**
   * Optional. A blank name is filled in below rather than rejected.
   *
   * Requiring it made the create button dead until you typed something, with
   * nothing on screen saying so — you could pick a template and be left
   * looking at a greyed-out button. Naming a map is a rename away, and it is
   * far easier to do once you can see the thing you are naming.
   */
  title: z.string().trim().max(60),
  templateId: z.string().max(40).default('blank'),
});

/** GET /api/maps — screen 07, both tabs. */
export async function GET() {
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  return NextResponse.json({
    owned: listOwnedMaps(ctx),
    shared: listSharedMaps(ctx),
  });
}

/** POST /api/maps — screen 08. */
export async function POST(request: Request) {
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const { title, templateId } = parsed.data;

  const template = templateById(templateId);
  if (!template) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
  }
  if (template.soon) {
    return NextResponse.json(
      { error: 'That template is not ready yet' },
      { status: 409 },
    );
  }

  const quota = checkMapQuota(countMapsOwned(ctx));
  if (quota) {
    return NextResponse.json(
      { error: quota.message, quota: quota.quota },
      { status: 403 },
    );
  }

  // §08 screen 08 error state: "Name conflict inline." Only for a name the
  // user actually chose — a generated one is made unique instead of refused.
  if (title && mapTitleTaken(ctx, title)) {
    return NextResponse.json(
      { error: 'You already have a map with that name', field: 'title' },
      { status: 409 },
    );
  }

  const finalTitle = title || untitledName(ctx);

  const mapId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  createMap(ctx, draftFromTemplate(mapId, finalTitle, templateId));

  return NextResponse.json({ id: mapId }, { status: 201 });
}

/**
 * A unique fallback name: "Untitled map", then "Untitled map 2", and so on.
 *
 * Generated on the SERVER because only the server knows what the person
 * already has. A client-side default would collide on the second map and
 * surface as "You already have a map with that name" — an error about a name
 * the user never typed.
 *
 * Bounded so a pathological account cannot spin here; past the cap it falls
 * back to a timestamp, which is ugly but always unique and always creates.
 */
function untitledName(ctx: AuthContext): string {
  const base = 'Untitled map';
  if (!mapTitleTaken(ctx, base)) return base;

  for (let n = 2; n <= 50; n++) {
    const candidate = `${base} ${n}`;
    if (!mapTitleTaken(ctx, candidate)) return candidate;
  }

  return `${base} ${Date.now().toString(36)}`;
}
