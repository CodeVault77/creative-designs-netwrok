import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { issueKey, revokeInstallationKeys } from '@/lib/api/keys';
import { formatScopes, narrow, parseScopes, type Scope } from '@/lib/api/scopes';
import { checkUrl } from '@/lib/ingest/ssrf';
import { createEndpoint } from '@/lib/webhooks/endpoints';
import { loadPlugin } from './loader';
import { parseManifest, type PluginManifest } from './manifest';

/**
 * Plugins: publishing, reviewing, installing.
 *
 * ── Installing is the consent moment, and it is the only one ────────────────
 *
 * Everything a plugin can ever do is fixed when it is installed: the scopes
 * granted, and the events delivered. Nothing later widens that. In particular
 * a plugin cannot obtain more by publishing a new version — the installation
 * is FLAGGED for re-consent and keeps its old grant until a person agrees
 * again.
 *
 * That property is worth more than it first appears. It means "what can this
 * plugin do to my data" is answered by a row somebody agreed to, rather than
 * by the current contents of a manifest its author controls.
 */

export type PluginStatus = 'draft' | 'review' | 'published' | 'suspended';

export interface Plugin {
  id: string;
  slug: string;
  name: string;
  authorId: string;
  manifest: PluginManifest;
  version: string;
  status: PluginStatus;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PluginRow {
  id: string;
  slug: string;
  name: string;
  author_id: string;
  manifest: string;
  version: string;
  status: string;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

function hydrate(row: PluginRow): Plugin | null {
  let raw: unknown;
  try {
    raw = JSON.parse(row.manifest);
  } catch {
    return null;
  }

  const parsed = parseManifest(raw);

  /*
   * A stored manifest that no longer validates yields NULL rather than a
   * partial object. Manifests are validated before storage, so this happens
   * only when the schema itself has tightened — and a plugin whose contract we
   * can no longer read must not be presented as though we still understand it.
   */
  if (!parsed.ok || !parsed.manifest) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    authorId: row.author_id,
    manifest: parsed.manifest,
    version: row.version,
    status: row.status as PluginStatus,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PluginResult {
  ok: boolean;
  plugin?: Plugin;
  error?: string;
}

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Reserved slugs.
 *
 * A plugin called `cdn` or `official` contributes node types named
 * `cdn.something`, which reads as first-party. Impersonation is cheap to
 * prevent here and impossible to undo once it is installed on other people's
 * accounts.
 */
const RESERVED = new Set([
  'cdn',
  'system',
  'admin',
  'core',
  'official',
  'support',
  'creative-design-networks',
]);

/**
 * Validate a manifest for storage: shape, then the webhook URL's address.
 *
 * The SSRF check happens HERE as well as at endpoint creation, deliberately.
 * Catching it at publish time puts the refusal in front of the author, who can
 * fix it — rather than in front of an installer, who cannot.
 */
function validated(raw: unknown): {
  ok: boolean;
  manifest?: PluginManifest;
  error?: string;
} {
  const parsed = parseManifest(raw);
  if (!parsed.ok || !parsed.manifest) {
    return { ok: false, error: parsed.error ?? 'Invalid manifest' };
  }

  if (parsed.manifest.webhookUrl) {
    const verdict = checkUrl(parsed.manifest.webhookUrl);
    if (!verdict.ok) {
      return {
        ok: false,
        error: verdict.detail ?? 'That webhook URL cannot be used.',
      };
    }
  }

  return { ok: true, manifest: parsed.manifest };
}

/** Create a plugin the caller authors. */
export function createPlugin(
  ctx: AuthContext,
  input: { slug: string; manifest: unknown },
  db: Database = getDb(),
): PluginResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const slug = input.slug.trim().toLowerCase();

  if (!SLUG.test(slug)) {
    return {
      ok: false,
      error: 'A slug is 3–40 lower case letters, digits and dashes',
    };
  }
  if (RESERVED.has(slug)) return { ok: false, error: 'That name is reserved' };

  const check = validated(input.manifest);
  if (!check.ok || !check.manifest) return { ok: false, error: check.error };

  const id = `plg_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  try {
    db.prepare(
      `INSERT INTO plugins (id, slug, name, author_id, manifest, version, status)
       VALUES (@id, @slug, @name, @authorId, @manifest, @version, 'draft')`,
    ).run({
      id,
      slug,
      name: check.manifest.name,
      authorId: ctx.userId,
      manifest: JSON.stringify(check.manifest),
      version: check.manifest.version,
    });
  } catch (cause) {
    if (String(cause).includes('UNIQUE')) {
      // Not "forbidden": whether a slug belongs to someone else is not a
      // stranger's business, and "taken" is what the author must act on.
      return { ok: false, error: 'That slug is taken' };
    }
    throw cause;
  }

  return getPlugin(id, db);
}

/**
 * Replace a plugin's manifest. Returns it to draft.
 *
 * Without that, review is theatre: get a harmless manifest approved, then swap
 * in one asking for `maps:write` while keeping the approval.
 */
export function updateManifest(
  ctx: AuthContext,
  pluginId: string,
  manifest: unknown,
  db: Database = getDb(),
): PluginResult {
  const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(pluginId) as
    PluginRow | undefined;

  if (!row || row.author_id !== ctx.userId)
    return { ok: false, error: 'Not found' };

  if (row.status === 'suspended') {
    /*
     * A suspended plugin cannot be edited back into service by its author.
     * Suspension is a moderation decision, and letting a new version clear it
     * would make the decision advisory.
     */
    return { ok: false, error: 'This plugin is suspended. Contact us.' };
  }

  const check = validated(manifest);
  if (!check.ok || !check.manifest) return { ok: false, error: check.error };

  db.prepare(
    `UPDATE plugins SET name = @name, manifest = @manifest, version = @version,
            status = 'draft', updated_at = datetime('now')
      WHERE id = @id`,
  ).run({
    id: pluginId,
    name: check.manifest.name,
    manifest: JSON.stringify(check.manifest),
    version: check.manifest.version,
  });

  return getPlugin(pluginId, db);
}

export function getPlugin(pluginId: string, db: Database = getDb()): PluginResult {
  const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(pluginId) as
    PluginRow | undefined;

  if (!row) return { ok: false, error: 'Not found' };

  const plugin = hydrate(row);
  return plugin ? { ok: true, plugin } : { ok: false, error: 'Not readable' };
}

export function getPluginBySlug(
  slug: string,
  db: Database = getDb(),
): Plugin | null {
  const row = db.prepare('SELECT * FROM plugins WHERE slug = ?').get(slug) as
    PluginRow | undefined;

  return row ? hydrate(row) : null;
}

/** Submit for review. An author cannot publish their own plugin. */
export function submitForReview(
  ctx: AuthContext,
  pluginId: string,
  db: Database = getDb(),
): PluginResult {
  const changed = db
    .prepare(
      `UPDATE plugins SET status = 'review', updated_at = datetime('now')
        WHERE id = ? AND author_id = ? AND status = 'draft'`,
    )
    .run(pluginId, ctx.userId).changes;

  return changed > 0 ? getPlugin(pluginId, db) : { ok: false, error: 'Not found' };
}

/**
 * Approve, return to draft, or suspend. Staff only.
 *
 * Review stays a human step. An automated check cannot answer the question
 * that matters — whether what the plugin asks for matches what it says it
 * does — and a manifest requesting `maps:write` to "sync your calendar" is
 * syntactically perfect.
 */
export function review(
  ctx: AuthContext,
  pluginId: string,
  decision: 'published' | 'draft' | 'suspended',
  note = '',
  db: Database = getDb(),
): PluginResult {
  if (!ctx.isStaff) return { ok: false, error: 'Not found' };

  const changed = db
    .prepare(
      `UPDATE plugins SET status = @status, review_note = @note,
              updated_at = datetime('now')
        WHERE id = @id`,
    )
    .run({ id: pluginId, status: decision, note: note.slice(0, 500) }).changes;

  return changed > 0 ? getPlugin(pluginId, db) : { ok: false, error: 'Not found' };
}

/** The public catalogue: published plugins only. */
export function publishedPlugins(db: Database = getDb()): Plugin[] {
  const rows = db
    .prepare(
      `SELECT * FROM plugins WHERE status = 'published'
        ORDER BY updated_at DESC LIMIT 200`,
    )
    .all() as PluginRow[];

  return rows.map(hydrate).filter((plugin): plugin is Plugin => plugin !== null);
}

/** Everything awaiting review. Staff only. */
export function reviewQueue(ctx: AuthContext, db: Database = getDb()): Plugin[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(`SELECT * FROM plugins WHERE status = 'review' ORDER BY updated_at`)
    .all() as PluginRow[];

  return rows.map(hydrate).filter((plugin): plugin is Plugin => plugin !== null);
}

export function pluginsBy(ctx: AuthContext, db: Database = getDb()): Plugin[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare('SELECT * FROM plugins WHERE author_id = ? ORDER BY updated_at DESC')
    .all(ctx.userId) as PluginRow[];

  return rows.map(hydrate).filter((plugin): plugin is Plugin => plugin !== null);
}

// ------------------------------------------------------------- installations

export interface Installation {
  id: string;
  pluginId: string;
  pluginSlug: string;
  pluginName: string;
  userId: string;
  mapId: string | null;
  grantedScopes: Scope[];
  /** The manifest version consented to. */
  version: string;
  enabled: boolean;
  /**
   * Whether the CURRENT published manifest wants more than was granted.
   *
   * Computed, never stored: a stored flag would have to be recalculated for
   * every installation each time an author publishes, and the one that got
   * missed is the one that silently keeps a stale answer.
   */
  needsReconsent: boolean;
  createdAt: string;
}

interface InstallationRow {
  id: string;
  plugin_id: string;
  plugin_slug: string;
  plugin_name: string;
  plugin_manifest: string;
  plugin_status: string;
  user_id: string;
  map_id: string | null;
  granted_scopes: string;
  version: string;
  enabled: number;
  created_at: string;
}

const INSTALL_SELECT = `
  SELECT plugin_installations.*,
         plugins.slug     AS plugin_slug,
         plugins.name     AS plugin_name,
         plugins.manifest AS plugin_manifest,
         plugins.status   AS plugin_status
    FROM plugin_installations
    JOIN plugins ON plugins.id = plugin_installations.plugin_id
`;

function hydrateInstall(row: InstallationRow): Installation {
  const granted = parseScopes(row.granted_scopes);
  const held = new Set(granted);

  let wanted: Scope[] = [];
  try {
    const parsed = parseManifest(JSON.parse(row.plugin_manifest) as unknown);
    wanted = parsed.manifest?.scopes ?? [];
  } catch {
    wanted = [];
  }

  return {
    id: row.id,
    pluginId: row.plugin_id,
    pluginSlug: row.plugin_slug,
    pluginName: row.plugin_name,
    userId: row.user_id,
    mapId: row.map_id,
    grantedScopes: granted,
    version: row.version,
    enabled: row.enabled === 1,
    /*
     * Compared on SCOPES against the version the installer consented to, not
     * on the version string.
     *
     * A plugin that fixes a bug and bumps its version has not changed what it
     * can do, and demanding re-consent for every release trains people to
     * click through the one release that matters. And a grant deliberately
     * NARROWER than the manifest is a supported choice, not an unfinished
     * install — so the comparison is against what was asked for AT CONSENT
     * TIME, which is what `version` records.
     */
    needsReconsent:
      row.version !== rowManifestVersion(row) &&
      wanted.some((scope) => !held.has(scope)),
    createdAt: row.created_at,
  };
}

function rowManifestVersion(row: InstallationRow): string {
  try {
    const parsed = parseManifest(JSON.parse(row.plugin_manifest) as unknown);
    return parsed.manifest?.version ?? row.version;
  } catch {
    return row.version;
  }
}

export interface InstallResult {
  ok: boolean;
  installation?: Installation;
  /**
   * The plugin's API key, in clear, returned once.
   *
   * Absent when no scopes were granted: a key that can do nothing is still a
   * credential in circulation that looks like access.
   */
  apiKey?: string;
  error?: string;
}

/**
 * Install a plugin for the caller.
 *
 * ── Three things are created together ───────────────────────────────────────
 *
 * The installation row (the consent), the API key (how it acts) and the
 * webhook endpoint (how it learns). Together, because a half-installed plugin
 * is worse than an uninstalled one — a key with no installation is a
 * credential with no owner and no screen to revoke it from.
 */
export function install(
  ctx: AuthContext,
  input: {
    pluginId: string;
    /** What the installer is willing to allow. Intersected with the request. */
    grantScopes: readonly Scope[];
    mapId?: string | null;
  },
  db: Database = getDb(),
): InstallResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const found = getPlugin(input.pluginId, db);
  if (!found.ok || !found.plugin) return { ok: false, error: 'Not found' };

  const plugin = found.plugin;

  if (plugin.status !== 'published' && plugin.authorId !== ctx.userId) {
    /*
     * Only published plugins install — except for the author, so a draft can
     * be tested before review. That exception is safe precisely because the
     * scopes still resolve to the AUTHOR's own authority over their own maps.
     */
    return { ok: false, error: 'That plugin is not available' };
  }

  /*
   * THE INTERSECTION, and both terms matter:
   *
   *   plugin.manifest.scopes  what the plugin asked for, and what the consent
   *                           screen therefore showed;
   *   input.grantScopes       what the installer actually ticked.
   *
   * A third term — what the installer may themselves do — is deliberately NOT
   * applied here as a set operation, because it is not a set: it is per-map
   * and per-node, and it is enforced on every API call by the ordinary
   * repositories using the installer's own context. Snapshotting it into a
   * scope list would be a copy that goes stale the instant a share is revoked.
   */
  const granted = narrow(input.grantScopes, plugin.manifest.scopes);
  const id = `pin_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  try {
    db.prepare(
      `INSERT INTO plugin_installations
         (id, plugin_id, user_id, map_id, granted_scopes, version)
       VALUES (@id, @pluginId, @userId, @mapId, @scopes, @version)`,
    ).run({
      id,
      pluginId: plugin.id,
      userId: ctx.userId,
      mapId: input.mapId ?? null,
      scopes: formatScopes(granted),
      version: plugin.version,
    });
  } catch (cause) {
    if (String(cause).includes('UNIQUE')) {
      return { ok: false, error: 'Already installed' };
    }
    throw cause;
  }

  const apiKey = mintKey(ctx, plugin, granted, id, db);

  if (plugin.manifest.webhookUrl && plugin.manifest.events.length > 0) {
    /*
     * A refused endpoint does NOT fail the install.
     *
     * The URL is the plugin author's to fix, and rolling back an installation
     * because a third party's DNS is wrong is a worse outcome than a plugin
     * that works without events. The absence of an endpoint is visible to the
     * installer on their own webhooks screen.
     */
    createEndpoint(
      ctx,
      {
        url: plugin.manifest.webhookUrl,
        events: plugin.manifest.events,
        description: `${plugin.name} (plugin)`,
        installationId: id,
      },
      db,
    );
  }

  const row = db
    .prepare(`${INSTALL_SELECT} WHERE plugin_installations.id = ?`)
    .get(id) as InstallationRow;

  return { ok: true, installation: hydrateInstall(row), apiKey };
}

/** Issue the installation's key, or nothing when no scopes were granted. */
function mintKey(
  ctx: AuthContext,
  plugin: Plugin,
  granted: readonly Scope[],
  installationId: string,
  db: Database,
): string | undefined {
  if (granted.length === 0) return undefined;

  const issued = issueKey(
    ctx,
    {
      name: `${plugin.name} (plugin)`,
      scopes: granted,
      installationId,
    },
    db,
  );

  return issued.issued?.secret;
}

export function installationsFor(
  ctx: AuthContext,
  db: Database = getDb(),
): Installation[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `${INSTALL_SELECT} WHERE plugin_installations.user_id = ?
        ORDER BY plugin_installations.created_at DESC`,
    )
    .all(ctx.userId) as InstallationRow[];

  return rows.map(hydrateInstall);
}

export function getInstallation(
  ctx: AuthContext,
  installationId: string,
  db: Database = getDb(),
): Installation | null {
  const row = db
    .prepare(
      `${INSTALL_SELECT} WHERE plugin_installations.id = ?
         AND plugin_installations.user_id = ?`,
    )
    .get(installationId, ctx.userId) as InstallationRow | undefined;

  return row ? hydrateInstall(row) : null;
}

export interface ReconsentResult {
  ok: boolean;
  installation?: Installation;
  apiKey?: string;
  error?: string;
}

/**
 * Agree to a new version's permissions.
 *
 * The old key is REVOKED and a new one issued, rather than the old one's
 * scopes being edited. Two reasons, and the second is the important one:
 * a key's scope set is what its holder was told it had, and silently changing
 * it means a credential whose authority differs from what anyone recorded.
 * Revoking also forces the plugin author to notice — they must take the new
 * key — which is the point at which a human sees that permissions changed.
 */
export function reconsent(
  ctx: AuthContext,
  installationId: string,
  grantScopes: readonly Scope[],
  db: Database = getDb(),
): ReconsentResult {
  const current = getInstallation(ctx, installationId, db);
  if (!current) return { ok: false, error: 'Not found' };

  const found = getPlugin(current.pluginId, db);
  if (!found.ok || !found.plugin) return { ok: false, error: 'Not found' };

  const plugin = found.plugin;
  const granted = narrow(grantScopes, plugin.manifest.scopes);

  return db.transaction(() => {
    // Revoked first: a failure after this point leaves an installation with no
    // key, which is safe. The other order leaves two live keys, which is not.
    revokeInstallationKeys(installationId, db);

    db.prepare(
      `UPDATE plugin_installations SET granted_scopes = ?, version = ?
        WHERE id = ? AND user_id = ?`,
    ).run(formatScopes(granted), plugin.version, installationId, ctx.userId);

    const apiKey = mintKey(ctx, plugin, granted, installationId, db);
    const row = db
      .prepare(`${INSTALL_SELECT} WHERE plugin_installations.id = ?`)
      .get(installationId) as InstallationRow;

    return { ok: true, installation: hydrateInstall(row), apiKey };
  })();
}

export interface InstallationResult {
  ok: boolean;
  error?: string;
}

/**
 * Remove an installation and everything it authorised.
 *
 * One transaction. A key that outlives its installation is a credential nobody
 * can find in the UI and nobody knows to revoke — the kind of thing discovered
 * during an incident rather than before one.
 */
export function uninstall(
  ctx: AuthContext,
  installationId: string,
  db: Database = getDb(),
): InstallationResult {
  return db.transaction(() => {
    const changed = db
      .prepare('DELETE FROM plugin_installations WHERE id = ? AND user_id = ?')
      .run(installationId, ctx.userId).changes;

    if (changed === 0) return { ok: false, error: 'Not found' };

    revokeInstallationKeys(installationId, db);
    db.prepare('DELETE FROM webhook_endpoints WHERE installation_id = ?').run(
      installationId,
    );

    return { ok: true };
  })();
}

/**
 * Turn an installation off, or back on.
 *
 * Disabling REVOKES the key and deactivates the endpoint. A "disabled" plugin
 * that could still call the API would be a switch that does nothing, flicked
 * by someone who believed it had — which is worse than no switch, because they
 * stop looking.
 *
 * Re-enabling issues a fresh key, since the old one is gone for good. The
 * caller must show it, exactly as at install.
 */
export function setEnabled(
  ctx: AuthContext,
  installationId: string,
  enabled: boolean,
  db: Database = getDb(),
): ReconsentResult {
  const current = getInstallation(ctx, installationId, db);
  if (!current) return { ok: false, error: 'Not found' };

  return db.transaction(() => {
    db.prepare(
      'UPDATE plugin_installations SET enabled = ? WHERE id = ? AND user_id = ?',
    ).run(enabled ? 1 : 0, installationId, ctx.userId);

    db.prepare(
      'UPDATE webhook_endpoints SET active = ? WHERE installation_id = ?',
    ).run(enabled ? 1 : 0, installationId);

    revokeInstallationKeys(installationId, db);

    let apiKey: string | undefined;

    if (enabled) {
      const found = getPlugin(current.pluginId, db);
      if (found.plugin) {
        apiKey = mintKey(
          ctx,
          found.plugin,
          current.grantedScopes,
          installationId,
          db,
        );
      }
    }

    const row = db
      .prepare(`${INSTALL_SELECT} WHERE plugin_installations.id = ?`)
      .get(installationId) as InstallationRow;

    return { ok: true, installation: hydrateInstall(row), apiKey };
  })();
}

/**
 * Register the node types of every published plugin. Returns how many types.
 *
 * Per PUBLISHED plugin, not per installation. The registry is process-wide,
 * and a node carrying `acme.invoice` must render for anyone who can see the
 * map — including people who never installed the plugin. Otherwise a shared
 * map looks broken to the person it was shared with.
 */
export function loadInstalledPlugins(db: Database = getDb()): number {
  let types = 0;

  for (const plugin of publishedPlugins(db)) {
    types += loadPlugin(plugin.slug, plugin.manifest).registered.length;
  }

  return types;
}
