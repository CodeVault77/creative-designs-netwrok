/**
 * API scopes.
 *
 * ── A scope narrows; it never widens ────────────────────────────────────────
 *
 * This is the single most important property in Phase 7, and it is worth
 * stating before the list. A key carrying `maps:write` does NOT let its bearer
 * write maps. It lets them write the maps its OWNER could already write, and
 * nothing else. Authorisation still runs through `repo.ts` and
 * `permissions/resolve.ts` with the owner's AuthContext; the scope is a second
 * gate in front of that, never a substitute for it.
 *
 * The consequence worth having: revoking someone's access to a map revokes it
 * for every key, plugin and agent acting on their behalf, in the same instant,
 * with nothing to remember to update.
 *
 * ── Why the vocabulary is small ─────────────────────────────────────────────
 *
 * Ten scopes people can reason about beat forty nobody reads. A consent screen
 * listing forty checkboxes is a consent screen everybody clicks through, and a
 * permission nobody read is not consent. Each scope below is a sentence a
 * person can evaluate in one pass.
 *
 * No client component may import this file's siblings, but the scope list
 * itself is safe and shared: the consent UI has to render exactly the strings
 * the server enforces, and two hand-kept copies of a permission list will
 * diverge.
 */

export const SCOPES = {
  'maps:read': 'See your maps and their nodes',
  'maps:write': 'Create and change your maps',
  'nodes:read': 'Read individual nodes',
  'nodes:write': 'Add and change nodes',
  'events:read': 'Receive events about your maps',
  'webhooks:manage': 'Manage its own webhook endpoints',
  'marketplace:read': 'Browse marketplace listings',
  'marketplace:write': 'Publish and update its own listings',
  'agents:read': 'See your agents and their runs',
  'agents:run': 'Start agent runs on your behalf',
} as const;

export type Scope = keyof typeof SCOPES;

export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/**
 * Scopes that let the holder CHANGE something.
 *
 * Kept as data rather than as a `.endsWith(':write')` convention, because
 * `agents:run` mutates and does not end in `write`, and a convention that is
 * wrong once is a convention nobody can rely on. The consent screen shows
 * these differently, and the API refuses them outright on a read-only key.
 */
export const MUTATING_SCOPES: readonly Scope[] = [
  'maps:write',
  'nodes:write',
  'webhooks:manage',
  'marketplace:write',
  'agents:run',
];

export function isScope(value: string): value is Scope {
  return Object.prototype.hasOwnProperty.call(SCOPES, value);
}

export function isMutating(scope: Scope): boolean {
  return MUTATING_SCOPES.includes(scope);
}

/** Parse a stored space-separated list, dropping anything unrecognised. */
export function parseScopes(stored: string): Scope[] {
  const seen = new Set<Scope>();

  for (const part of stored.split(/\s+/)) {
    /*
     * An unknown scope is DROPPED, not preserved and not an error.
     *
     * Rows outlive code: a scope removed in a later release leaves stored
     * strings naming it. Preserving it would let a name the server no longer
     * understands sit in a granted list looking meaningful; erroring would
     * lock the owner out of a key they can otherwise still use and revoke.
     * Dropping is the only option that fails closed AND stays usable.
     */
    if (isScope(part)) seen.add(part);
  }

  return [...seen].sort();
}

/** Serialise for storage. Sorted so two equal sets compare equal as strings. */
export function formatScopes(scopes: readonly Scope[]): string {
  return [...new Set(scopes)].sort().join(' ');
}

/**
 * The intersection of what was asked for and what may be given.
 *
 * Used at every point where one authority hands out a narrower one: issuing a
 * key, installing a plugin, re-consenting to a new manifest version. Written
 * once because doing it by hand at three call sites is how the fourth one
 * forgets.
 */
export function narrow(
  requested: readonly Scope[],
  ceiling: readonly Scope[],
): Scope[] {
  const allowed = new Set(ceiling);
  return [...new Set(requested)].filter((scope) => allowed.has(scope)).sort();
}

/** Whether a granted set covers everything required. */
export function covers(
  granted: readonly Scope[],
  required: readonly Scope[],
): boolean {
  const held = new Set(granted);
  return required.every((scope) => held.has(scope));
}
