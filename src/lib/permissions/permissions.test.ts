import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, type AuthContext } from '@/lib/db/repo';
import { createDraft } from '@/lib/editor/draft';
import { roleOn } from '@/lib/collab/repo';
import {
  addMember,
  createOrganization,
  membersOf,
  organizationsFor,
  orgRoleOf,
  removeMember,
  setMapOrganization,
  slugify,
} from '@/lib/orgs/repo';
import {
  capabilitiesOnMap,
  capabilitiesOnNode,
  canOnNode,
  grantsOnResource,
  revokeGrant,
  setGrant,
} from './resolve';

/**
 * Phase 3's definition of done, as two sentences:
 *
 *   an organisation owns maps
 *   a user's permissions on a single node can differ from their map role
 *
 * Both were impossible before. Ownership was user-scoped everywhere, and
 * `Capabilities` was a fixed struct attached to a whole map — there was no
 * vocabulary for "everything except that one node".
 */

let db: Database;
let owner: AuthContext;
let colleague: AuthContext;
let stranger: AuthContext;
let mapId: string;
let nodeId: string;

function user(id: string, handle: string): AuthContext {
  const row = createUser(
    {
      id,
      email: `${handle}@example.com`,
      passwordHash: 'x',
      handle,
      displayName: handle[0]!.toUpperCase() + handle.slice(1),
    },
    db,
  );
  return { userId: row.id, isStaff: false };
}

beforeEach(() => {
  db = createTestDb();

  owner = user('u_owner', 'owner');
  colleague = user('u_mate', 'mate');
  stranger = user('u_other', 'other');

  mapId = 'm_studio';
  const draft = createDraft(mapId, 'Studio OS', 'create');
  createMap(owner, draft, db);

  nodeId = 'node-secret';
  db.prepare(
    `INSERT INTO map_nodes
       (id, map_id, parent_id, slot, title, family, type, status, visibility)
     VALUES (?, ?, NULL, 0, 'Secret', 'create', 'topic', 'active', 'inherit')`,
  ).run(nodeId, mapId);
});

// -------------------------------------------------------------- organisations

describe('organisations', () => {
  it('makes the creator the owner and a member in one transaction', () => {
    const result = createOrganization(owner, 'Acme Studio', db);

    expect(result.ok).toBe(true);
    expect(result.org?.slug).toBe('acme-studio');
    // An org whose owner is not a member is a state nothing else can read.
    expect(orgRoleOf(owner, result.org!.id, db)).toBe('owner');
    expect(membersOf(owner, result.org!.id, db)).toHaveLength(1);
  });

  it('resolves slug collisions instead of failing', () => {
    const first = createOrganization(owner, 'Acme', db);
    const second = createOrganization(colleague, 'Acme', db);

    expect(first.org?.slug).toBe('acme');
    expect(second.ok).toBe(true);
    expect(second.org?.slug).not.toBe('acme');
  });

  it('slugifies names that are all punctuation to something usable', () => {
    expect(slugify('!!!')).toBe('org');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
  });

  /**
   * The headline: an organisation owns maps.
   *
   * A member who was never added to `map_members` can reach a map the org
   * owns — which is the entire point, and what makes orgs more than a label.
   */
  it('gives org members access to a map the org owns', () => {
    const org = createOrganization(owner, 'Acme', db).org!;
    addMember(owner, org.id, colleague.userId!, 'editor', db);

    // Before the map belongs to the org, the colleague is nobody.
    expect(roleOn(colleague, mapId, db)).toBeNull();

    expect(setMapOrganization(owner, mapId, org.id, db)).toBe(true);

    expect(roleOn(colleague, mapId, db)).toBe('editor');
    expect(capabilitiesOnMap(colleague, mapId, db).editNodes).toBe(true);

    // Someone outside the org still sees nothing.
    expect(roleOn(stranger, mapId, db)).toBeNull();
  });

  it('lets a direct map role beat an org role', () => {
    const org = createOrganization(owner, 'Acme', db).org!;
    addMember(owner, org.id, colleague.userId!, 'editor', db);
    setMapOrganization(owner, mapId, org.id, db);

    db.prepare(
      `INSERT INTO map_members (map_id, user_id, role, added_at)
       VALUES (?, ?, 'viewer', datetime('now'))`,
    ).run(mapId, colleague.userId);

    /*
     * Explicitly added as a viewer, so a viewer they stay. The specific grant
     * is the more deliberate statement; the alternative silently escalates
     * someone because of a group they happen to be in.
     */
    expect(roleOn(colleague, mapId, db)).toBe('viewer');
  });

  it('refuses to give a map to an organisation you are not in', () => {
    const org = createOrganization(colleague, 'Theirs', db).org!;
    expect(setMapOrganization(owner, mapId, org.id, db)).toBe(false);
  });

  it('will not let an admin mint another owner', () => {
    const org = createOrganization(owner, 'Acme', db).org!;
    addMember(owner, org.id, colleague.userId!, 'admin', db);

    // Same escalation rule as the map role matrix, for the same reason.
    expect(addMember(colleague, org.id, stranger.userId!, 'owner', db)).toBe(false);
    expect(addMember(colleague, org.id, stranger.userId!, 'editor', db)).toBe(true);
  });

  it('never removes the owner', () => {
    const org = createOrganization(owner, 'Acme', db).org!;
    expect(removeMember(owner, org.id, owner.userId!, db)).toBe(false);
  });

  it('lists only the organisations you belong to', () => {
    createOrganization(owner, 'Mine', db);
    createOrganization(colleague, 'Theirs', db);

    expect(organizationsFor(owner, db).map((o) => o.name)).toEqual(['Mine']);
  });
});

// --------------------------------------------------------------------- grants

describe('grants', () => {
  it('changes nothing when no grants exist', () => {
    // Adopting the resolver everywhere must be a no-op until someone uses it.
    const fromRole = capabilitiesOnMap(owner, mapId, db);
    expect(fromRole.editNodes).toBe(true);
    expect(capabilitiesOnNode(owner, nodeId, db)).toEqual(fromRole);
  });

  /**
   * The second half of the definition of done.
   *
   * A viewer can read the map but is denied one node of it — the common real
   * case, and the one a fixed per-map capability struct cannot express at all.
   */
  it('denies a single node to someone who can read the map', () => {
    db.prepare(
      `INSERT INTO map_members (map_id, user_id, role, added_at)
       VALUES (?, ?, 'viewer', datetime('now'))`,
    ).run(mapId, colleague.userId);

    expect(capabilitiesOnMap(colleague, mapId, db).view).toBe(true);
    expect(canOnNode(colleague, nodeId, 'view', db)).toBe(true);

    setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'view',
        resourceType: 'node',
        resourceId: nodeId,
        effect: 'deny',
      },
      db,
    );

    expect(canOnNode(colleague, nodeId, 'view', db)).toBe(false);
    // The rest of the map is untouched.
    expect(capabilitiesOnMap(colleague, mapId, db).view).toBe(true);
  });

  it('lets a node-level allow restore what the map denied', () => {
    db.prepare(
      `INSERT INTO map_members (map_id, user_id, role, added_at)
       VALUES (?, ?, 'viewer', datetime('now'))`,
    ).run(mapId, colleague.userId);

    setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'editNodes',
        resourceType: 'map',
        resourceId: mapId,
        effect: 'deny',
      },
      db,
    );
    setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'editNodes',
        resourceType: 'node',
        resourceId: nodeId,
        effect: 'allow',
      },
      db,
    );

    // Specific beats general, or "everyone out except Sam" is inexpressible.
    expect(canOnNode(colleague, nodeId, 'editNodes', db)).toBe(true);
    expect(capabilitiesOnMap(colleague, mapId, db).editNodes).toBe(false);
  });

  it('lets deny win over allow at the same level', () => {
    setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'view',
        resourceType: 'node',
        resourceId: nodeId,
        effect: 'allow',
      },
      db,
    );
    // The unique index makes this an update, not a second row.
    setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'view',
        resourceType: 'node',
        resourceId: nodeId,
        effect: 'deny',
      },
      db,
    );

    expect(grantsOnResource(owner, 'node', nodeId, db)).toHaveLength(1);
    expect(canOnNode(colleague, nodeId, 'view', db)).toBe(false);
  });

  it('only lets someone who can change roles create a grant', () => {
    db.prepare(
      `INSERT INTO map_members (map_id, user_id, role, added_at)
       VALUES (?, ?, 'editor', datetime('now'))`,
    ).run(mapId, colleague.userId);

    // An editor may edit nodes but must not be able to hand out permissions.
    const result = setGrant(
      colleague,
      {
        subjectId: stranger.userId!,
        action: 'view',
        resourceType: 'node',
        resourceId: nodeId,
      },
      db,
    );

    expect(result.ok).toBe(false);
  });

  it('will not let a granted capability bootstrap more grants', () => {
    setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'changeRoles',
        resourceType: 'map',
        resourceId: mapId,
        effect: 'allow',
      },
      db,
    );

    /*
     * The grant says they may change roles, and the resolver agrees. Creating
     * grants deliberately checks the ROLE instead, so a permission cannot be
     * used to widen itself.
     */
    expect(capabilitiesOnMap(colleague, mapId, db).changeRoles).toBe(true);

    const escalation = setGrant(
      colleague,
      {
        subjectId: stranger.userId!,
        action: 'deleteMap',
        resourceType: 'map',
        resourceId: mapId,
      },
      db,
    );

    expect(escalation.ok).toBe(false);
  });

  it('rejects an action that is not a real capability', () => {
    const result = setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'launchMissiles',
        resourceType: 'node',
        resourceId: nodeId,
      },
      db,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unknown action');
  });

  it('returns the resource to its role when a grant is revoked', () => {
    const created = setGrant(
      owner,
      {
        subjectId: colleague.userId!,
        action: 'view',
        resourceType: 'node',
        resourceId: nodeId,
        effect: 'deny',
      },
      db,
    );

    expect(revokeGrant(owner, created.grant!.id, db)).toBe(true);
    expect(grantsOnResource(owner, 'node', nodeId, db)).toHaveLength(0);
  });

  it('gives a missing node no permissions rather than throwing', () => {
    expect(capabilitiesOnNode(owner, 'does-not-exist', db).view).toBe(false);
  });
});
