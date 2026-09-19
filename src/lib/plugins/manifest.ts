import { z } from 'zod';
import { isScope, type Scope } from '@/lib/api/scopes';

/**
 * The plugin manifest.
 *
 * ══ WHERE THE SANDBOX IS ════════════════════════════════════════════════════
 *
 * A plugin ships NO code that runs in this process. Not sandboxed code — no
 * code at all. That is the security design, and it deserves stating plainly,
 * because "plugin framework with sandboxing" reads like an instruction to
 * build an interpreter.
 *
 * The options for running a stranger's JavaScript inside a Node server:
 *
 *   `vm`               Not a security boundary. Node's own documentation says
 *                      so. Escaping it by walking the constructor chain is a
 *                      party trick, not a research result.
 *
 *   `isolated-vm`      A real V8 isolate, and genuinely much better. Still one
 *                      process: a plugin that allocates until the heap dies
 *                      takes the server with it, and every native binding is
 *                      another hole to audit. Its maintainers say plainly that
 *                      it is not a complete sandbox by itself.
 *
 *   A WASM runtime     Strong memory isolation and no ambient capability. But
 *                      a plugin that wants to call an HTTP API needs a host
 *                      function to do it, and once you have written host
 *                      functions for network, storage and time you have
 *                      rebuilt the operating system's job, badly.
 *
 *   Another process    A real boundary — which is exactly what a plugin
 *                      running on its author's own infrastructure already is,
 *                      at no cost and no risk to us.
 *
 * So the boundary is THE NETWORK, and it is absolute: separate machine,
 * separate process, separate operator, separate blast radius. A plugin that
 * loops forever burns its own CPU. A plugin that crashes crashes itself.
 *
 * ── What a plugin therefore is ──────────────────────────────────────────────
 *
 *   1. DECLARATIVE contributions — node types whose payloads are described in
 *      the restricted vocabulary below. Data, never code: WE compile a field
 *      list into a schema, and nothing the plugin wrote is executed.
 *
 *   2. An INBOUND channel — signed webhooks to the plugin's own server. How it
 *      learns that something happened.
 *
 *   3. An OUTBOUND channel — the public API, with a key whose scopes are
 *      `min(what the manifest asked for, what the installer granted)` and
 *      whose every call is still authorised as the installer. How it acts.
 *
 * The result: "what can this plugin do to my data" has a complete answer,
 * written down, that a person consented to. That is a stronger property than
 * any in-process sandbox provides, and it required no interpreter.
 *
 * ── The cost, stated honestly ───────────────────────────────────────────────
 *
 * A plugin cannot render custom UI on our canvas, and cannot run offline or at
 * low latency. Those are real limitations, and they are the price of a
 * boundary that actually holds. They can be relaxed later for REVIEWED plugins
 * — a signed bundle under a strict CSP — without changing anything here,
 * because the permission model is already the part that matters.
 */

/**
 * The field vocabulary a plugin may use.
 *
 * Deliberately tiny, and deliberately not "send us a JSON Schema". A JSON
 * Schema compiler is a large amount of attack surface: a regular expression
 * from a stranger is a denial-of-service vector on its own (catastrophic
 * backtracking), and `$ref` resolution reaches for the network in most
 * implementations. Seven field kinds cover what a node payload actually holds.
 */
const fieldSchema = z.object({
  /*
   * A field key becomes an OBJECT KEY in a stored payload, which is why the
   * pattern matters more than it looks: `__proto__` in that position is
   * prototype pollution with a schema in front of it. Requiring an identifier
   * that starts with a lower-case letter excludes it, and `constructor` and
   * every other dunder, by construction rather than by a blocklist someone
   * has to keep current.
   */
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-zA-Z0-9_]*$/, 'A field key is a lower camelCase identifier')
    .refine((key) => key !== 'constructor' && key !== 'prototype', {
      message: 'That field key is reserved',
    }),
  label: z.string().min(1).max(60),
  kind: z.enum([
    'string',
    'text',
    'number',
    'integer',
    'boolean',
    'url',
    'date',
    'select',
  ]),
  required: z.boolean().default(false),
  /** `select` only. Ignored for every other kind. */
  options: z.array(z.string().min(1).max(60)).max(50).default([]),
  /** `string` and `text` only. Capped so a plugin cannot ask for a novel. */
  maxLength: z.number().int().min(1).max(10_000).optional(),
});

export type PluginField = z.infer<typeof fieldSchema>;

const nodeTypeSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/, 'A type id is lower case with dashes'),
  label: z.string().min(1).max(40),
  description: z.string().max(200).default(''),
  /*
   * A GLYPH NAME, not an image.
   *
   * The pattern and the length cap are what stop a URL or an SVG ever reaching
   * the loader. A plugin-supplied image drawn on a public map is a tracking
   * pixel that fires for every viewer, and a plugin-supplied SVG is a script
   * tag with extra steps. An unknown name is allowed through here and falls
   * back to a safe glyph at load time, so a manifest is not rejected because
   * we renamed an icon.
   */
  icon: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[a-z][a-z0-9-]*$/),
  fields: z.array(fieldSchema).max(20).default([]),
});

export type PluginNodeType = z.infer<typeof nodeTypeSchema>;

export const manifestSchema = z.object({
  name: z.string().min(2).max(60),
  version: z
    .string()
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, 'Version must look like 1.2.3'),
  summary: z.string().min(3).max(300),
  /** Where a person goes to read about it. Never called by us. */
  homepage: z.string().url().max(300).optional(),
  author: z.string().max(80).optional(),

  /**
   * What the plugin ASKS to be able to do.
   *
   * A request, never a grant. `install` intersects it with what the installer
   * allowed, and every call the resulting key makes is still authorised as the
   * installer by the ordinary repositories.
   */
  scopes: z
    .array(z.string())
    .max(50)
    .default([])
    /*
     * An unrecognised scope is DROPPED rather than rejected. A manifest naming
     * a scope this deployment has never heard of is a plugin built against a
     * newer version — refusing it outright would make every scope addition a
     * breaking change for everyone running behind, and keeping the name would
     * put a word nobody can evaluate on a consent screen.
     */
    .transform((values) => values.filter(isScope) as Scope[]),

  events: z.array(z.string().min(1).max(60)).max(40).default([]),

  /**
   * Where signed events are POSTed.
   *
   * Validated as a URL here and checked against the SSRF policy when the
   * plugin is created — see `webhooks/endpoints.ts` for why one check is not
   * enough.
   */
  webhookUrl: z.string().url().max(500).optional(),

  nodeTypes: z.array(nodeTypeSchema).max(20).default([]),
});

export type PluginManifest = z.infer<typeof manifestSchema>;

export interface ManifestResult {
  ok: boolean;
  manifest?: PluginManifest;
  error?: string;
}

/** Parse and validate, reporting the first problem in words an author can act on. */
export function parseManifest(raw: unknown): ManifestResult {
  const parsed = manifestSchema.safeParse(raw);

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join('.');

    return {
      ok: false,
      error: path
        ? `${path}: ${first?.message}`
        : (first?.message ?? 'Invalid manifest'),
    };
  }

  const manifest = parsed.data;

  /*
   * Events and a webhook URL are both-or-neither.
   *
   * Either half alone is a misconfiguration that LOOKS like it works: the
   * plugin installs, appears subscribed, and nothing is ever delivered — or an
   * endpoint is registered that no event will ever reach. Both are found weeks
   * later by an author who assumed the platform was broken.
   */
  if (manifest.events.length > 0 && !manifest.webhookUrl) {
    return { ok: false, error: 'Events were requested but there is no webhookUrl' };
  }
  if (manifest.webhookUrl && manifest.events.length === 0) {
    return { ok: false, error: 'A webhookUrl was given but no events' };
  }

  const ids = manifest.nodeTypes.map((type) => type.id);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'Two node types share an id' };
  }

  for (const type of manifest.nodeTypes) {
    const keys = type.fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length) {
      return { ok: false, error: `${type.id}: two fields share a key` };
    }
  }

  return { ok: true, manifest };
}

/**
 * Compile a declared node type into a payload schema.
 *
 * WE build the schema from the plugin's DESCRIPTION of it. The plugin supplies
 * no validator, no pattern and no expression — only which of seven kinds each
 * field is. There is nothing here a hostile manifest can turn into execution
 * or into a pathological regular expression.
 */
export function payloadSchemaFor(type: PluginNodeType): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of type.fields) {
    let schema: z.ZodTypeAny;

    switch (field.kind) {
      case 'string':
        schema = z.string().max(field.maxLength ?? 200);
        break;
      case 'text':
        schema = z.string().max(field.maxLength ?? 10_000);
        break;
      case 'number':
        schema = z.number().finite();
        break;
      case 'integer':
        schema = z.number().int();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'url':
        schema = z.string().url().max(500);
        break;
      case 'date':
        // ISO 8601 as text, matching how every other timestamp is stored here.
        schema = z.string().max(40);
        break;
      case 'select':
        /*
         * A select with no options degrades to a plain string.
         *
         * `z.enum([])` throws at CONSTRUCTION, not at validation — so a
         * manifest with an empty option list would crash whatever loaded it
         * rather than failing to validate. A manifest must never be able to
         * take the process down, so the empty case is handled rather than
         * merely rejected upstream.
         */
        schema =
          field.options.length > 0
            ? z.enum(field.options as [string, ...string[]])
            : z.string().max(200);
        break;
    }

    shape[field.key] = field.required ? schema : schema.optional();
  }

  /*
   * `passthrough`, for the same reason the built-in types use it: a payload
   * written by an older version of the plugin carries keys the current
   * manifest does not declare, and `strict` would DESTROY them on the next
   * save. Validation is worth having; deleting a user's data to get it is not.
   */
  return z.object(shape).passthrough();
}

/** The stored type id for a plugin's contribution: `<slug>.<type>`. */
export function namespacedType(slug: string, typeId: string): string {
  return `${slug}.${typeId}`;
}
