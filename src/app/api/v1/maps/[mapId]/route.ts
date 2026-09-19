import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handle, preflight, readJson } from '@/lib/api/gateway';
import { apiGetMap, apiUpdateMap, apiWriteNode } from '@/lib/api/resources';

export const dynamic = 'force-dynamic';

/**
 * One map, through the public API.
 *
 * GET returns the map and every node. PATCH writes either the map's own fields
 * or one node, and both require the version the caller read.
 */

const patchSchema = z.object({
  /**
   * The version the client last read.
   *
   * Required, not optional with a fallback. A missing version could only
   * sensibly default to "whatever is current", which is precisely the
   * last-write-wins behaviour optimistic concurrency exists to remove — and a
   * default that quietly disables a safety check is worse than no check,
   * because it looks like one.
   */
  version: z.number().int().min(1),
  title: z.string().max(120).optional(),
  visibility: z.enum(['private', 'link', 'public']).optional(),
  node: z
    .object({
      id: z.string().max(80).optional(),
      parentId: z.string().max(80).nullable().optional(),
      title: z.string().max(60).optional(),
      description: z.string().max(2000).nullable().optional(),
      type: z.string().max(60).optional(),
      icon: z.string().max(40).nullable().optional(),
      href: z.string().max(500).nullable().optional(),
      payload: z.record(z.unknown()).optional(),
      weight: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  return handle(request, { scopes: ['maps:read'] }, ({ authed, db }) => {
    const map = apiGetMap(authed.actor, mapId, db);

    // 404 for "no such map" and "not yours" alike — the same rule the rest of
    // the application follows, and the reason map ids are not worth guessing.
    if (!map) return apiError(404, 'not_found', 'No such map.');

    return NextResponse.json({ data: map });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  return handle(request, { scopes: ['maps:write'] }, async ({ authed, db }) => {
    const body = await readJson(request);
    if (!body.ok) return body.error!;

    const parsed = patchSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(400, 'invalid_request', 'Check the request body.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const { version, node, ...mapPatch } = parsed.data;

    const result = node
      ? apiWriteNode(authed.actor, mapId, version, node, db)
      : apiUpdateMap(authed.actor, mapId, version, mapPatch, db);

    if (result.ok) return NextResponse.json({ data: result.map });

    switch (result.failure) {
      case 'conflict':
        /*
         * 409 with the current version, so a client can re-read and retry
         * rather than guess. Returning a bare 409 makes every integration
         * implement the same blind refetch loop.
         */
        return apiError(409, 'version_conflict', 'This map changed. Re-read it.', {
          currentVersion: result.currentVersion,
        });
      case 'invalid_payload':
        return apiError(422, 'invalid_payload', result.detail ?? 'Bad payload.');
      default:
        return apiError(404, 'not_found', 'No such map.');
    }
  });
}

export function OPTIONS() {
  return preflight();
}
