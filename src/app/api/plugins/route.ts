import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { isScope, type Scope } from '@/lib/api/scopes';
import {
  createPlugin,
  install,
  installationsFor,
  pluginsBy,
  publishedPlugins,
  reconsent,
  review,
  reviewQueue,
  setEnabled,
  submitForReview,
  uninstall,
  updateManifest,
} from '@/lib/plugins/repo';

export const dynamic = 'force-dynamic';

/**
 * Plugins: authoring, reviewing and installing.
 *
 * ── One route, several verbs, one reason ────────────────────────────────────
 *
 * Everything here is a state change on a plugin or an installation, and every
 * one of them needs a session — because every one of them is either publishing
 * something under your name or granting somebody access to your data. Neither
 * belongs on the key-authenticated surface, so none of it is under `/api/v1`.
 */

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    slug: z.string().min(2).max(40),
    manifest: z.unknown(),
  }),
  z.object({
    action: z.literal('update'),
    pluginId: z.string().max(80),
    manifest: z.unknown(),
  }),
  z.object({ action: z.literal('submit'), pluginId: z.string().max(80) }),
  z.object({
    action: z.literal('review'),
    pluginId: z.string().max(80),
    decision: z.enum(['published', 'draft', 'suspended']),
    note: z.string().max(500).default(''),
  }),
  z.object({
    action: z.literal('install'),
    pluginId: z.string().max(80),
    scopes: z.array(z.string()).max(20).default([]),
    mapId: z.string().max(80).nullable().optional(),
  }),
  z.object({
    action: z.literal('reconsent'),
    installationId: z.string().max(80),
    scopes: z.array(z.string()).max(20).default([]),
  }),
  z.object({ action: z.literal('uninstall'), installationId: z.string().max(80) }),
  z.object({
    action: z.literal('enable'),
    installationId: z.string().max(80),
    enabled: z.boolean(),
  }),
]);

export async function GET() {
  const session = await getSession();
  const ctx = {
    userId: session?.userId ?? '',
    isStaff: session?.isStaff ?? false,
  };

  return NextResponse.json({
    // The catalogue is public; the rest is the caller's own.
    published: publishedPlugins(),
    mine: session ? pluginsBy(ctx) : [],
    installations: session ? installationsFor(ctx) : [],
    reviewQueue: session?.isStaff ? reviewQueue(ctx) : [],
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

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the request' }, { status: 400 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const input = parsed.data;

  /*
   * Scopes are filtered to known ones here and intersected with the manifest's
   * request inside the repository. Both, deliberately: this drops nonsense
   * early, and the repository enforces the rule that actually matters — a
   * plugin cannot be granted something it never asked for, because the consent
   * screen only showed what it asked for.
   */
  const grantScopes = (scopes: string[]): Scope[] =>
    scopes.filter((value): value is Scope => isScope(value));

  switch (input.action) {
    case 'create': {
      const result = createPlugin(ctx, {
        slug: input.slug,
        manifest: input.manifest,
      });
      return result.ok
        ? NextResponse.json({ plugin: result.plugin })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }

    case 'update': {
      const result = updateManifest(ctx, input.pluginId, input.manifest);
      return result.ok
        ? NextResponse.json({ plugin: result.plugin })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }

    case 'submit': {
      const result = submitForReview(ctx, input.pluginId);
      return result.ok
        ? NextResponse.json({ plugin: result.plugin })
        : NextResponse.json({ error: result.error }, { status: 404 });
    }

    case 'review': {
      if (!session.isStaff) {
        // 404 rather than 403, as every staff surface here does.
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const result = review(ctx, input.pluginId, input.decision, input.note);
      return result.ok
        ? NextResponse.json({ plugin: result.plugin })
        : NextResponse.json({ error: result.error }, { status: 404 });
    }

    case 'install': {
      const result = install(ctx, {
        pluginId: input.pluginId,
        grantScopes: grantScopes(input.scopes),
        mapId: input.mapId ?? null,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      // `apiKey` is present exactly once, on this response. The installer
      // passes it to the plugin; nobody can read it back.
      return NextResponse.json({
        installation: result.installation,
        apiKey: result.apiKey,
      });
    }

    case 'reconsent': {
      const result = reconsent(
        ctx,
        input.installationId,
        grantScopes(input.scopes),
      );
      return result.ok
        ? NextResponse.json({
            installation: result.installation,
            apiKey: result.apiKey,
          })
        : NextResponse.json({ error: result.error }, { status: 404 });
    }

    case 'uninstall': {
      const result = uninstall(ctx, input.installationId);
      return result.ok
        ? NextResponse.json({ installations: installationsFor(ctx) })
        : NextResponse.json({ error: result.error }, { status: 404 });
    }

    case 'enable': {
      const result = setEnabled(ctx, input.installationId, input.enabled);
      return result.ok
        ? NextResponse.json({ installations: installationsFor(ctx) })
        : NextResponse.json({ error: result.error }, { status: 404 });
    }
  }
}
