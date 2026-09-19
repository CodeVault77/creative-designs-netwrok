import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import { authenticate, listKeys } from '@/lib/api/keys';
import { listEndpoints } from '@/lib/webhooks/endpoints';
import { nodeTypeDef, validatePayload } from '@/lib/nodes/registry';
import { parseManifest, payloadSchemaFor } from './manifest';
import { loadPlugin, namespacedType, pluginSlugOf } from './loader';
import {
  createPlugin,
  getInstallation,
  install,
  installationsFor,
  loadInstalledPlugins,
  publishedPlugins,
  reconsent,
  review,
  setEnabled,
  submitForReview,
  uninstall,
  updateManifest,
} from './repo';

/**
 * Plugin tests.
 *
 * The plugin system's whole security argument is that a plugin holds no
 * authority except what an installer consented to, through a key that acts as
 * that installer and can be revoked. So most of what follows tries to break
 * that in the four ways it could break:
 *
 *   - a plugin taking a scope it never asked for;
 *   - a plugin taking a scope the installer never granted;
 *   - a new version quietly widening an old consent;
 *   - a removed plugin keeping a working key.
 */

let db: Database;
let author: { userId: string; isStaff: boolean };
let installer: { userId: string; isStaff: boolean };
let staff: { userId: string; isStaff: boolean };

const MANIFEST = {
  name: 'Acme Invoices',
  version: '1.0.0',
  summary: 'Invoices as nodes.',
  scopes: ['maps:read', 'nodes:write'],
  events: ['map.created'],
  webhookUrl: 'https://acme.example.com/hooks',
  nodeTypes: [
    {
      id: 'invoice',
      label: 'invoice',
      description: 'An invoice.',
      icon: 'card',
      fields: [
        { key: 'reference', label: 'Reference', kind: 'string', required: true },
        { key: 'amountCents', label: 'Amount', kind: 'number' },
        {
          key: 'status',
          label: 'Status',
          kind: 'select',
          options: ['open', 'paid'],
        },
      ],
    },
  ],
};

beforeEach(() => {
  db = createTestDb();

  for (const [id, handle] of [
    ['u_author', 'author'],
    ['u_installer', 'installer'],
    ['u_staff', 'staffer'],
  ] as const) {
    createUser(
      {
        id,
        email: `${handle}@example.com`,
        passwordHash: 'x',
        handle,
        displayName: handle,
      },
      db,
    );
  }

  author = { userId: 'u_author', isStaff: false };
  installer = { userId: 'u_installer', isStaff: false };
  staff = { userId: 'u_staff', isStaff: true };
});

function publishedPlugin() {
  const created = createPlugin(author, { slug: 'acme', manifest: MANIFEST }, db);
  submitForReview(author, created.plugin!.id, db);
  review(staff, created.plugin!.id, 'published', 'Looks fine', db);
  return created.plugin!.id;
}

// ------------------------------------------------------------------- manifest

describe('the manifest', () => {
  it('accepts a well-formed one', () => {
    expect(parseManifest(MANIFEST).ok).toBe(true);
  });

  it('refuses a field key that is not an identifier', () => {
    /*
     * A field key becomes an object key in a stored payload. `__proto__` in
     * that position is prototype pollution with a schema in front of it.
     */
    const result = parseManifest({
      ...MANIFEST,
      nodeTypes: [
        {
          ...MANIFEST.nodeTypes[0],
          fields: [{ key: '__proto__', label: 'X', kind: 'string' }],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a field kind it does not know', () => {
    // The vocabulary is fixed. Anything outside it would need a validator
    // nobody wrote, which is the door a JSON Schema compiler would open.
    const result = parseManifest({
      ...MANIFEST,
      nodeTypes: [
        {
          ...MANIFEST.nodeTypes[0],
          fields: [{ key: 'x', label: 'X', kind: 'regex' }],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('drops a scope that is not a real scope', () => {
    const result = parseManifest({ ...MANIFEST, scopes: ['maps:read', 'be:god'] });

    expect(result.manifest?.scopes).toEqual(['maps:read']);
  });

  it('refuses duplicate node type ids', () => {
    const result = parseManifest({
      ...MANIFEST,
      nodeTypes: [MANIFEST.nodeTypes[0], MANIFEST.nodeTypes[0]],
    });

    expect(result.ok).toBe(false);
  });

  it('refuses events with no URL, and a URL with no events', () => {
    // Either half alone is a misconfiguration that looks like it works.
    expect(parseManifest({ ...MANIFEST, webhookUrl: undefined }).ok).toBe(false);
    expect(parseManifest({ ...MANIFEST, events: [] }).ok).toBe(false);
  });

  it('refuses a version that is not a version', () => {
    expect(parseManifest({ ...MANIFEST, version: 'latest' }).ok).toBe(false);
  });
});

describe('the declared payload schema', () => {
  it('requires what the manifest marked required', () => {
    const parsed = parseManifest(MANIFEST);
    const schema = payloadSchemaFor(parsed.manifest!.nodeTypes[0]!);

    expect(schema.safeParse({ reference: 'INV-1' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('enforces a select’s options', () => {
    const parsed = parseManifest(MANIFEST);
    const schema = payloadSchemaFor(parsed.manifest!.nodeTypes[0]!);

    expect(schema.safeParse({ reference: 'A', status: 'paid' }).success).toBe(true);
    expect(schema.safeParse({ reference: 'A', status: 'void' }).success).toBe(
      false,
    );
  });

  it('keeps unknown keys rather than deleting them', () => {
    // Passthrough, for the same reason the built-ins use it: a stored payload
    // may carry keys written before the current manifest version, and strict
    // would destroy a user's data on the next save.
    const parsed = parseManifest(MANIFEST);
    const schema = payloadSchemaFor(parsed.manifest!.nodeTypes[0]!);

    const result = schema.safeParse({ reference: 'A', legacyField: 1 });

    expect(result.success).toBe(true);
    expect((result as { data: Record<string, unknown> }).data.legacyField).toBe(1);
  });

  it('degrades a select with no options to a plain string', () => {
    // `z.enum([])` throws at CONSTRUCTION, which would crash the loader rather
    // than fail validation — a manifest taking the process down.
    const parsed = parseManifest({
      ...MANIFEST,
      nodeTypes: [
        {
          ...MANIFEST.nodeTypes[0],
          fields: [{ key: 'x', label: 'X', kind: 'select', options: [] }],
        },
      ],
    });

    expect(() => payloadSchemaFor(parsed.manifest!.nodeTypes[0]!)).not.toThrow();
  });
});

// --------------------------------------------------------------------- loader

describe('loading contributions', () => {
  it('namespaces every type under the plugin slug', () => {
    const parsed = parseManifest(MANIFEST);
    const result = loadPlugin('acme', parsed.manifest!);

    expect(result.registered).toEqual(['acme.invoice']);
    expect(nodeTypeDef('acme.invoice')).toBeDefined();
  });

  it('cannot shadow a built-in type', () => {
    /*
     * The attack: declare a type called `note` and replace the built-in one
     * for everybody who installs the plugin. The namespace makes it
     * impossible — the id becomes `evil.note`, and `note` is untouched.
     */
    const parsed = parseManifest({
      ...MANIFEST,
      nodeTypes: [
        { id: 'note', label: 'note', description: '', icon: 'note', fields: [] },
      ],
    });

    loadPlugin('evil', parsed.manifest!);

    expect(nodeTypeDef('note')?.label).toBe('note');
    expect(nodeTypeDef('note')?.description).not.toBe('');
    expect(nodeTypeDef('evil.note')).toBeDefined();
  });

  it('falls back to a safe glyph for an icon it does not have', () => {
    const parsed = parseManifest({
      ...MANIFEST,
      nodeTypes: [{ ...MANIFEST.nodeTypes[0], id: 'thing', icon: 'rocket' }],
    });

    loadPlugin('acme', parsed.manifest!);

    expect(nodeTypeDef('acme.thing')?.icon).toBe('grid');
  });

  it('refuses an icon that is a URL rather than a glyph name', () => {
    /*
     * A plugin cannot supply an image. An arbitrary URL drawn on a public
     * map's canvas is a tracking pixel that fires for every viewer, and an
     * arbitrary SVG is a script tag with extra steps. The length cap on the
     * icon field is what stops a URL ever reaching the loader.
     */
    const parsed = parseManifest({
      ...MANIFEST,
      nodeTypes: [
        {
          ...MANIFEST.nodeTypes[0],
          icon: 'https://evil.example.com/pixel.gif',
        },
      ],
    });

    expect(parsed.ok).toBe(false);
  });

  it('gives a plugin type only read and edit actions', () => {
    const parsed = parseManifest(MANIFEST);
    loadPlugin('acme', parsed.manifest!);

    const actions = nodeTypeDef('acme.invoice')?.actions.map((a) => a.id);

    // A plugin cannot name a verb the platform would then execute.
    expect(actions).toEqual(['open', 'edit']);
  });

  it('validates a plugin payload through the ordinary registry', () => {
    const parsed = parseManifest(MANIFEST);
    loadPlugin('acme', parsed.manifest!);

    expect(validatePayload('acme.invoice', { reference: 'INV-1' }).ok).toBe(true);
    expect(validatePayload('acme.invoice', { amountCents: 1 }).ok).toBe(false);
  });

  it('names the plugin a type came from', () => {
    expect(namespacedType('acme', 'invoice')).toBe('acme.invoice');
    expect(pluginSlugOf('acme.invoice')).toBe('acme');
    expect(pluginSlugOf('note')).toBeNull();
  });
});

// ----------------------------------------------------------------- publishing

describe('publishing', () => {
  it('refuses a reserved slug', () => {
    // `cdn.something` would read as first-party. Impersonation is cheaper to
    // prevent than to moderate.
    expect(createPlugin(author, { slug: 'cdn', manifest: MANIFEST }, db).ok).toBe(
      false,
    );
  });

  it('refuses a webhook URL pointing inside our network', () => {
    expect(
      createPlugin(
        author,
        {
          slug: 'sneaky',
          manifest: { ...MANIFEST, webhookUrl: 'http://169.254.169.254/' },
        },
        db,
      ).ok,
    ).toBe(false);
  });

  it('refuses a duplicate slug', () => {
    createPlugin(author, { slug: 'acme', manifest: MANIFEST }, db);

    expect(createPlugin(author, { slug: 'acme', manifest: MANIFEST }, db).ok).toBe(
      false,
    );
  });

  it('keeps a draft out of the catalogue until staff publish it', () => {
    const created = createPlugin(author, { slug: 'acme', manifest: MANIFEST }, db);

    expect(publishedPlugins(db)).toHaveLength(0);

    submitForReview(author, created.plugin!.id, db);
    expect(publishedPlugins(db)).toHaveLength(0);

    review(staff, created.plugin!.id, 'published', '', db);
    expect(publishedPlugins(db)).toHaveLength(1);
  });

  it('will not let a non-staff user publish', () => {
    const created = createPlugin(author, { slug: 'acme', manifest: MANIFEST }, db);
    submitForReview(author, created.plugin!.id, db);

    expect(review(author, created.plugin!.id, 'published', '', db).ok).toBe(false);
    expect(publishedPlugins(db)).toHaveLength(0);
  });

  it('returns an edited plugin to draft', () => {
    /*
     * Otherwise review is theatre: get a harmless manifest approved, then swap
     * in one asking for maps:write.
     */
    const pluginId = publishedPlugin();

    updateManifest(
      author,
      pluginId,
      { ...MANIFEST, version: '1.1.0', scopes: ['maps:write'] },
      db,
    );

    expect(publishedPlugins(db)).toHaveLength(0);
  });

  it('lets staff suspend a published plugin', () => {
    const pluginId = publishedPlugin();

    review(staff, pluginId, 'suspended', 'Abusive', db);

    expect(publishedPlugins(db)).toHaveLength(0);
  });
});

// --------------------------------------------------------------- installation

describe('installing', () => {
  it('issues a key scoped to what was granted', () => {
    const pluginId = publishedPlugin();

    const result = install(installer, { pluginId, grantScopes: ['maps:read'] }, db);

    expect(result.ok).toBe(true);
    expect(result.apiKey).toMatch(/^cdn_live_/);

    const authed = authenticate(result.apiKey!, db);
    expect(authed.authed?.key.scopes).toEqual(['maps:read']);
    // The key acts as the INSTALLER, not the author.
    expect(authed.authed?.actor.userId).toBe('u_installer');
  });

  it('cannot be granted a scope the manifest never asked for', () => {
    /*
     * The consent screen showed what the manifest requested. Granting beyond
     * it would be consenting to something nobody was shown.
     */
    const pluginId = publishedPlugin();

    const result = install(
      installer,
      { pluginId, grantScopes: ['maps:read', 'agents:run'] },
      db,
    );

    expect(result.installation?.grantedScopes).toEqual(['maps:read']);
    expect(authenticate(result.apiKey!, db).authed?.key.scopes).not.toContain(
      'agents:run',
    );
  });

  it('grants less than the manifest asked for when the installer says so', () => {
    const pluginId = publishedPlugin();

    const result = install(installer, { pluginId, grantScopes: [] }, db);

    expect(result.ok).toBe(true);
    // No scopes means no key at all, rather than a key that can do nothing.
    expect(result.apiKey).toBeUndefined();
  });

  it('never grants staff, even to a staff member’s installation', () => {
    const pluginId = publishedPlugin();

    const result = install(staff, { pluginId, grantScopes: ['maps:read'] }, db);

    expect(authenticate(result.apiKey!, db).authed?.actor.isStaff).toBe(false);
  });

  it('creates the webhook endpoint the manifest declared', () => {
    const pluginId = publishedPlugin();

    install(installer, { pluginId, grantScopes: ['maps:read'] }, db);

    const endpoints = listEndpoints(installer, db);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.url).toBe('https://acme.example.com/hooks');
    expect(endpoints[0]?.events).toEqual(['map.created']);
  });

  it('refuses a second install of the same plugin', () => {
    const pluginId = publishedPlugin();

    install(installer, { pluginId, grantScopes: ['maps:read'] }, db);

    expect(
      install(installer, { pluginId, grantScopes: ['maps:read'] }, db).ok,
    ).toBe(false);
  });

  it('will not install an unpublished plugin for anyone but its author', () => {
    const created = createPlugin(author, { slug: 'acme', manifest: MANIFEST }, db);

    expect(
      install(installer, { pluginId: created.plugin!.id, grantScopes: [] }, db).ok,
    ).toBe(false);

    // The author can, which is how a plugin gets tested before review.
    expect(
      install(author, { pluginId: created.plugin!.id, grantScopes: [] }, db).ok,
    ).toBe(true);
  });

  it('does not show one person another’s installations', () => {
    const pluginId = publishedPlugin();
    install(installer, { pluginId, grantScopes: ['maps:read'] }, db);

    expect(installationsFor(author, db)).toHaveLength(0);
    expect(installationsFor(installer, db)).toHaveLength(1);
  });
});

describe('removing a plugin', () => {
  it('revokes its key and deletes its endpoint, in one act', () => {
    const pluginId = publishedPlugin();
    const installed = install(
      installer,
      { pluginId, grantScopes: ['maps:read'] },
      db,
    );

    expect(uninstall(installer, installed.installation!.id, db).ok).toBe(true);

    // A key that outlived its installation is a credential nobody can see in
    // the UI and nobody knows to revoke.
    expect(authenticate(installed.apiKey!, db).ok).toBe(false);
    expect(listEndpoints(installer, db)).toHaveLength(0);
  });

  it('will not let one person uninstall another’s installation', () => {
    const pluginId = publishedPlugin();
    const installed = install(
      installer,
      { pluginId, grantScopes: ['maps:read'] },
      db,
    );

    expect(uninstall(author, installed.installation!.id, db).ok).toBe(false);
    expect(authenticate(installed.apiKey!, db).ok).toBe(true);
  });

  it('revokes the key when the installation is disabled', () => {
    // A "disabled" plugin that could still call the API would be a switch
    // that does nothing, flicked by someone who believed it had.
    const pluginId = publishedPlugin();
    const installed = install(
      installer,
      { pluginId, grantScopes: ['maps:read'] },
      db,
    );

    setEnabled(installer, installed.installation!.id, false, db);

    expect(authenticate(installed.apiKey!, db).ok).toBe(false);
    expect(listEndpoints(installer, db)[0]?.active).toBe(false);
  });
});

describe('a new version cannot take more', () => {
  it('flags an installation for re-consent rather than widening it', () => {
    const pluginId = publishedPlugin();
    // Granted in full at this version, so nothing is outstanding.
    const installed = install(
      installer,
      { pluginId, grantScopes: ['maps:read', 'nodes:write'] },
      db,
    );

    expect(installed.installation?.needsReconsent).toBe(false);

    // The author asks for more.
    updateManifest(
      author,
      pluginId,
      { ...MANIFEST, version: '2.0.0', scopes: ['maps:read', 'maps:write'] },
      db,
    );
    submitForReview(author, pluginId, db);
    review(staff, pluginId, 'published', '', db);

    const after = getInstallation(installer, installed.installation!.id, db);

    expect(after?.needsReconsent).toBe(true);
    // The GRANT is unchanged until a person agrees.
    expect(after?.grantedScopes).toEqual(['maps:read', 'nodes:write']);
    expect(authenticate(installed.apiKey!, db).authed?.key.scopes).toEqual([
      'maps:read',
      'nodes:write',
    ]);
  });

  it('does not nag someone who deliberately granted less', () => {
    /*
     * Granting less than a manifest asks for is a supported choice, not an
     * unfinished install. Flagging it would put a banner on the screen that
     * never goes away — and a banner that never goes away is one nobody reads
     * by the time a version genuinely does want more.
     */
    const pluginId = publishedPlugin();

    const installed = install(
      installer,
      { pluginId, grantScopes: ['maps:read'] },
      db,
    );

    expect(installed.installation?.needsReconsent).toBe(false);
  });

  it('replaces the key when consent is given again', () => {
    const pluginId = publishedPlugin();
    const installed = install(
      installer,
      { pluginId, grantScopes: ['maps:read'] },
      db,
    );

    updateManifest(
      author,
      pluginId,
      { ...MANIFEST, version: '2.0.0', scopes: ['maps:read', 'maps:write'] },
      db,
    );
    submitForReview(author, pluginId, db);
    review(staff, pluginId, 'published', '', db);

    const again = reconsent(
      installer,
      installed.installation!.id,
      ['maps:read', 'maps:write'],
      db,
    );

    // The old key stops working: it carried the previous scope set.
    expect(authenticate(installed.apiKey!, db).ok).toBe(false);
    expect(authenticate(again.apiKey!, db).authed?.key.scopes).toEqual([
      'maps:read',
      'maps:write',
    ]);
    expect(
      getInstallation(installer, installed.installation!.id, db)?.needsReconsent,
    ).toBe(false);
  });

  it('leaves at most one live key per installation', () => {
    const pluginId = publishedPlugin();
    const installed = install(
      installer,
      { pluginId, grantScopes: ['maps:read'] },
      db,
    );

    reconsent(installer, installed.installation!.id, ['maps:read'], db);

    const live = listKeys(installer, db).filter((key) => !key.revokedAt);
    expect(live).toHaveLength(1);
  });
});

describe('start-up loading', () => {
  it('registers the types of every published plugin', () => {
    /*
     * Registration is per PUBLISHED plugin, not per installation: the registry
     * is process-wide and a node carrying `acme.invoice` must render for
     * anyone who can see the map, including people who never installed it.
     * Otherwise a shared map looks broken to the person it was shared with.
     */
    publishedPlugin();

    expect(loadInstalledPlugins(db)).toBeGreaterThan(0);
    expect(nodeTypeDef('acme.invoice')).toBeDefined();
  });
});
