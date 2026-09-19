import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import { countMapsOwned, createMap, mapTitleTaken } from '@/lib/db/repo';
import { checkMapQuota } from '@/lib/quotas';
import { checkUrl } from '@/lib/ingest/ssrf';
import { MAX_NODES, type StructuredNode } from '@/lib/ingest/structure';
import { toDraft } from '@/lib/ingest/to-draft';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ingest/save — §12 steps 7 and 8.
 *
 * The structure arrives from the CLIENT, because the user has been editing it
 * on the preview screen: toggling nodes off, renaming, merging, reparenting.
 * That means none of it can be trusted, and the tree is re-validated and
 * re-clamped here rather than written as sent.
 *
 * A generated map is otherwise an ordinary map. It goes through `createMap`
 * with the same AuthContext and the same quota check as one built by hand,
 * because a second write path is a second place for ownership to go wrong.
 */

/**
 * Depth is bounded by the schema itself rather than by a recursive check after
 * parsing, so a deeply nested payload is rejected during parse instead of
 * being walked. `z.lazy` with no bound would happily recurse until the stack
 * runs out — a 10 MB nest of empty children is a cheap denial of service.
 */
/**
 * A summary that runs long is TRUNCATED, not rejected.
 *
 * Nobody typed these — they come out of the page — so refusing the entire map
 * because one description is a few characters over is a bad failure for the
 * user and a confusing one to debug. The title stays strict: it is the thing
 * the user edits, and silently cutting it would hide their own mistake.
 */
const summarySchema = z
  .string()
  .max(4000)
  .default('')
  .transform((value) => value.slice(0, 240));

const leafSchema = z.object({
  title: z.string().trim().min(1).max(60),
  summary: summarySchema,
  children: z.tuple([]).default([]),
});

const midSchema = z.object({
  title: z.string().trim().min(1).max(60),
  summary: summarySchema,
  children: z.array(leafSchema).max(12).default([]),
});

const rootSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: summarySchema,
  children: z.array(midSchema).max(12).default([]),
});

const schema = z.object({
  title: z.string().trim().min(1, 'Give the map a name').max(60),
  sourceUrl: z.string().trim().max(2048),
  structure: rootSchema,
  depth: z.union([z.literal(2), z.literal(3)]).default(3),
  excluded: z.array(z.string().max(40)).max(200).default([]),
});

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

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'That map could not be saved' },
      { status: 400 },
    );
  }

  const { title, structure, depth, excluded } = parsed.data;

  /**
   * The source URL is re-checked against the SSRF policy before it is stored.
   *
   * Not because we fetch it again — we do not — but because it is written into
   * every node's `href` and rendered as a link the user will click. Storing an
   * unvalidated URL here would turn the attribution chip into a way to plant
   * `javascript:` or an internal address in someone else's map.
   */
  const sourceVerdict = checkUrl(parsed.data.sourceUrl);
  const sourceUrl = sourceVerdict.ok ? parsed.data.sourceUrl : '';

  const quota = checkMapQuota(countMapsOwned(ctx));
  if (quota) {
    return NextResponse.json({ error: quota.message }, { status: 403 });
  }

  if (mapTitleTaken(ctx, title)) {
    return NextResponse.json(
      { error: 'You already have a map with that name' },
      { status: 409 },
    );
  }

  const mapId = `m_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const draft = toDraft(structure as StructuredNode, {
    mapId,
    title,
    sourceUrl,
    depth,
    excluded: new Set(excluded),
  });
  draft.sourceTitle = structure.title.slice(0, 200);

  // Belt and braces: the schema bounds breadth and depth, this bounds the
  // product of the two.
  if (Object.keys(draft.nodes).length > MAX_NODES) {
    return NextResponse.json({ error: 'That map is too large' }, { status: 400 });
  }

  createMap(ctx, draft);

  return NextResponse.json({
    id: mapId,
    title: draft.title,
    nodeCount: Object.keys(draft.nodes).length,
    // §12 step 9: "Standard share sheet; or 'Open in editor'. Reuse screens 11
    // and 09 exactly. No bespoke variants."
    editorHref: `/maps/${mapId}`,
  });
}
