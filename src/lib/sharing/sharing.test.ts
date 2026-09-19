import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  ROLE_RANK,
  canAssignRole,
  canRemoveMember,
  capabilitiesFor,
  isRole,
  type Role,
} from './roles';
import {
  DETAIL_FIELDS,
  NotVisibleError,
  buildSharePayload,
  canSeeNodeDetail,
  canViewMap,
  privateSubtreeIds,
  type StoredMap,
  type Viewer,
} from './payload';
import type { DraftNode } from '@/lib/editor/types';

/**
 * §20's acceptance criterion for this phase is a security review:
 * "no private node data in any shared response body". §15 adds the rule that
 * makes it real: "**Never** ship a client-side filter for this."
 *
 * So these tests assert on the PAYLOAD OBJECT — the exact thing that gets
 * serialised and sent — rather than on what a component renders. A test that
 * checks the UI hides a field would pass while the field sits in the network
 * tab, which is the failure the criterion exists to prevent.
 */

function node(id: string, overrides: Partial<DraftNode> = {}): DraftNode {
  return {
    id,
    map_id: 'm1',
    parent_id: 'root',
    slot: 0,
    title: `Node ${id}`,
    description: `Secret description of ${id}`,
    href: `https://secret.example/${id}`,
    icon: '★',
    payload: { secret: `payload-${id}` },
    family: 'create',
    type: 'topic',
    status: 'active',
    visibility: 'inherit',
    weight: 0.5,
    ...overrides,
  };
}

function makeMap(overrides: Partial<StoredMap> = {}): StoredMap {
  const nodes: Record<string, DraftNode> = {
    root: node('root', { parent_id: null, title: 'Root' }),
    a: node('a'),
    b: node('b'),
  };

  return {
    id: 'm1',
    title: 'Map',
    family: 'create',
    visibility: 'link',
    nodeViewable: true,
    rootId: 'root',
    nodes,
    version: 3,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ownerId: 'owner-1',
    ownerHandle: 'owner',
    ...overrides,
  };
}

const STRANGER: Viewer = {
  userId: null,
  isStaff: false,
  role: null,
  viaShareLink: true,
};
const OWNER: Viewer = {
  userId: 'owner-1',
  isStaff: false,
  role: 'owner',
  viaShareLink: false,
};
const MEMBER: Viewer = {
  userId: 'member-1',
  isStaff: false,
  role: 'editor',
  viaShareLink: false,
};
const STAFF: Viewer = {
  userId: 'staff-1',
  isStaff: true,
  role: null,
  viaShareLink: false,
};

/** Serialises exactly as the response body would, then looks for the secret. */
function bodyContains(payload: unknown, needle: string): boolean {
  return JSON.stringify(payload).includes(needle);
}

// ------------------------------------------------------- node-viewable: off

describe('node-viewable OFF — the High risk', () => {
  const map = makeMap({ nodeViewable: false });

  it('sends structure but no detail', () => {
    const payload = buildSharePayload(map, STRANGER);

    expect(Object.keys(payload.nodes)).toHaveLength(3);
    expect(payload.nodes['a']!.title).toBe('Node a');
    expect(payload.nodes['a']!.slot).toBe(0);
    expect(payload.nodes['a']!.family).toBe('create');
  });

  it.each(DETAIL_FIELDS)('omits %s from every node', (field) => {
    const payload = buildSharePayload(map, STRANGER);
    for (const shared of Object.values(payload.nodes)) {
      expect(shared[field as keyof typeof shared]).toBeUndefined();
    }
  });

  it('leaves NO trace of the withheld values in the serialised body', () => {
    // The assertion that matters. Not "the component hides it" — the string
    // is not in the bytes that leave the server.
    const payload = buildSharePayload(map, STRANGER);
    const body = JSON.stringify(payload);

    expect(body).not.toContain('Secret description');
    expect(body).not.toContain('secret.example');
    expect(body).not.toContain('payload-a');
    expect(body).not.toContain('★');
  });

  it('marks each node locked so the UI knows why there is nothing to open', () => {
    const payload = buildSharePayload(map, STRANGER);
    expect(payload.nodes['a']!.locked).toBe(true);
  });

  it('still gives the owner everything', () => {
    // node-viewable is a setting about people you shared WITH, not about
    // people already inside.
    const payload = buildSharePayload(map, OWNER);
    expect(payload.nodes['a']!.description).toBe('Secret description of a');
  });

  it('still gives a member everything', () => {
    const payload = buildSharePayload(map, MEMBER);
    expect(payload.nodes['a']!.href).toBe('https://secret.example/a');
  });
});

describe('node-viewable ON', () => {
  it('includes detail for a stranger with the link', () => {
    const payload = buildSharePayload(makeMap({ nodeViewable: true }), STRANGER);
    expect(payload.nodes['a']!.description).toBe('Secret description of a');
    expect(payload.nodes['a']!.locked).toBeUndefined();
  });
});

// ------------------------------------------------------------ private nodes

describe('private nodes and their subtrees', () => {
  const map = makeMap({
    nodes: {
      root: node('root', { parent_id: null, title: 'Root' }),
      open: node('open', { title: 'Open branch' }),
      secret: node('secret', { visibility: 'private', title: 'Secret branch' }),
      child: node('child', { parent_id: 'secret', title: 'Under secret' }),
      grandchild: node('grandchild', { parent_id: 'child', title: 'Deeper' }),
    },
  });

  it('excludes a private node entirely', () => {
    const payload = buildSharePayload(map, STRANGER);
    expect(payload.nodes['secret']).toBeUndefined();
  });

  it('excludes its whole subtree, not just the node', () => {
    // Keeping the children would leave them dangling from a parent that is not
    // there — visible structure the owner meant to hide.
    const payload = buildSharePayload(map, STRANGER);
    expect(payload.nodes['child']).toBeUndefined();
    expect(payload.nodes['grandchild']).toBeUndefined();
  });

  it('leaves no trace of the hidden branch in the body', () => {
    const payload = buildSharePayload(map, STRANGER);
    expect(bodyContains(payload, 'Secret branch')).toBe(false);
    expect(bodyContains(payload, 'Under secret')).toBe(false);
    expect(bodyContains(payload, 'Deeper')).toBe(false);
  });

  it('keeps the rest of the map', () => {
    const payload = buildSharePayload(map, STRANGER);
    expect(payload.nodes['open']).toBeDefined();
    expect(payload.nodes['root']).toBeDefined();
  });

  it('reports how many nodes were withheld, so the UI can be honest', () => {
    expect(buildSharePayload(map, STRANGER).hiddenCount).toBe(3);
  });

  it('hides private nodes from MEMBERS too, not just strangers', () => {
    // A per-node override inside an already-shared map is pointless if the
    // people you shared with can still see it.
    const payload = buildSharePayload(map, MEMBER);
    expect(payload.nodes['secret']).toBeUndefined();
  });

  it('shows everything to the owner', () => {
    const payload = buildSharePayload(map, OWNER);
    expect(payload.nodes['secret']).toBeDefined();
    expect(payload.hiddenCount).toBe(0);
  });

  it('shows everything to staff, for moderation', () => {
    expect(buildSharePayload(map, STAFF).nodes['secret']).toBeDefined();
  });

  it('never hides the root, even if it is marked private', () => {
    // A map with no root renders as nothing, which reads as broken rather
    // than as private.
    const rootPrivate = makeMap({
      nodes: {
        root: node('root', { parent_id: null, visibility: 'private' }),
        a: node('a'),
      },
    });
    expect(buildSharePayload(rootPrivate, STRANGER).nodes['root']).toBeDefined();
  });

  it('combines with node-viewable off without leaking either way', () => {
    const both = makeMap({
      nodeViewable: false,
      nodes: {
        root: node('root', { parent_id: null }),
        secret: node('secret', { visibility: 'private' }),
        open: node('open'),
      },
    });

    const payload = buildSharePayload(both, STRANGER);
    expect(payload.nodes['secret']).toBeUndefined();
    expect(payload.nodes['open']!.description).toBeUndefined();
    expect(bodyContains(payload, 'Secret description')).toBe(false);
  });
});

// -------------------------------------------------------------- visibility

describe('who may see the map at all', () => {
  it('refuses a stranger on a private map', () => {
    const map = makeMap({ visibility: 'private' });
    expect(canViewMap(map, STRANGER)).toBe(false);
    expect(() => buildSharePayload(map, STRANGER)).toThrow(NotVisibleError);
  });

  it('lets a public map be read by anyone', () => {
    const map = makeMap({ visibility: 'public' });
    expect(canViewMap(map, { ...STRANGER, viaShareLink: false })).toBe(true);
  });

  it('requires the token for a link-viewable map', () => {
    // Otherwise "link" and "public" are the same setting, and knowing the id
    // is enough.
    const map = makeMap({ visibility: 'link' });
    expect(canViewMap(map, { ...STRANGER, viaShareLink: false })).toBe(false);
    expect(canViewMap(map, { ...STRANGER, viaShareLink: true })).toBe(true);
  });

  it('always lets the owner in, whatever the visibility', () => {
    expect(canViewMap(makeMap({ visibility: 'private' }), OWNER)).toBe(true);
  });

  it('always lets a member in', () => {
    expect(canViewMap(makeMap({ visibility: 'private' }), MEMBER)).toBe(true);
  });

  it('never puts the owner id in the payload', () => {
    // The handle is public; the internal id is not, and it is a join key
    // elsewhere.
    const payload = buildSharePayload(makeMap(), STRANGER);
    expect(bodyContains(payload, 'owner-1')).toBe(false);
    expect(payload.ownerHandle).toBe('owner');
  });
});

describe('canSeeNodeDetail', () => {
  it.each([
    ['owner', OWNER, true],
    ['member', MEMBER, true],
    ['staff', STAFF, true],
    ['stranger', STRANGER, false],
  ])('with node-viewable off, %s -> %s', (_label, viewer, expected) => {
    expect(
      canSeeNodeDetail(makeMap({ nodeViewable: false }), viewer as Viewer),
    ).toBe(expected);
  });
});

describe('privateSubtreeIds', () => {
  it('is empty when nothing is private', () => {
    expect(privateSubtreeIds(makeMap(), STRANGER).size).toBe(0);
  });

  it('does not loop on a cycle', () => {
    const cyclic = makeMap({
      nodes: {
        root: node('root', { parent_id: null }),
        a: node('a', { parent_id: 'b', visibility: 'private' }),
        b: node('b', { parent_id: 'a' }),
      },
    });
    expect(() => privateSubtreeIds(cyclic, STRANGER)).not.toThrow();
  });
});

// -------------------------------------------------------------- role matrix

describe('the role matrix (§15)', () => {
  it.each([
    ['owner', 'deleteMap', true],
    ['admin', 'deleteMap', false],
    ['admin', 'invite', true],
    ['admin', 'changePrivacy', true],
    ['editor', 'editNodes', true],
    ['editor', 'invite', false],
    ['editor', 'changePrivacy', false],
    ['commenter', 'comment', true],
    ['commenter', 'editNodes', false],
    ['viewer', 'view', true],
    ['viewer', 'comment', false],
  ])('%s %s -> %s', (role, capability, expected) => {
    const caps = capabilitiesFor(role as Role);
    expect(caps[capability as keyof typeof caps]).toBe(expected);
  });

  it('gives a non-member nothing', () => {
    const caps = capabilitiesFor(null);
    expect(Object.values(caps).every((v) => v === false)).toBe(true);
  });

  it('lets only the owner transfer ownership', () => {
    expect(capabilitiesFor('owner').transferOwnership).toBe(true);
    expect(capabilitiesFor('admin').transferOwnership).toBe(false);
  });
});

describe('role assignment', () => {
  it('lets the owner assign any assignable role', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(canAssignRole('owner', 'viewer', role)).toBe(true);
    }
  });

  it('never assigns owner through the role menu', () => {
    // Transfer is its own confirmed flow; assignment here would leave a map
    // with two owners or none.
    expect(canAssignRole('owner', 'editor', 'owner' as Role)).toBe(false);
  });

  it('never changes the owner’s role', () => {
    expect(canAssignRole('owner', 'owner', 'viewer')).toBe(false);
    expect(canAssignRole('admin', 'owner', 'viewer')).toBe(false);
  });

  it('stops an admin promoting anyone to admin', () => {
    // Otherwise the ceiling is not a ceiling — one admin mints another and
    // privilege escalates sideways.
    expect(canAssignRole('admin', 'editor', 'admin')).toBe(false);
  });

  it('stops an admin demoting another admin', () => {
    // Two admins could otherwise remove each other, and the outcome depends
    // on who clicks first.
    expect(canAssignRole('admin', 'admin', 'viewer')).toBe(false);
  });

  it('lets an admin manage roles strictly below their own', () => {
    expect(canAssignRole('admin', 'viewer', 'editor')).toBe(true);
    expect(canAssignRole('admin', 'editor', 'commenter')).toBe(true);
  });

  it('gives editors, commenters and viewers no role powers at all', () => {
    for (const role of ['editor', 'commenter', 'viewer'] as Role[]) {
      expect(canAssignRole(role, 'viewer', 'editor')).toBe(false);
    }
  });

  it('gives a non-member no powers', () => {
    expect(canAssignRole(null, 'viewer', 'editor')).toBe(false);
  });
});

describe('member removal', () => {
  it('lets anyone remove themselves', () => {
    expect(canRemoveMember('viewer', 'u1', 'viewer', 'u1')).toBe(true);
  });

  it('never removes the owner', () => {
    // The map would have no owner.
    expect(canRemoveMember('owner', 'u1', 'owner', 'u1')).toBe(false);
    expect(canRemoveMember('admin', 'u2', 'owner', 'u1')).toBe(false);
  });

  it('lets the owner remove anyone else', () => {
    expect(canRemoveMember('owner', 'u1', 'admin', 'u2')).toBe(true);
  });

  it('lets an admin remove only below their rank', () => {
    expect(canRemoveMember('admin', 'u1', 'editor', 'u2')).toBe(true);
    expect(canRemoveMember('admin', 'u1', 'admin', 'u2')).toBe(false);
  });

  it('stops an editor removing anyone', () => {
    expect(canRemoveMember('editor', 'u1', 'viewer', 'u2')).toBe(false);
  });
});

describe('role helpers', () => {
  it('ranks roles consistently with the matrix', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeGreaterThan(ROLE_RANK.commenter);
    expect(ROLE_RANK.commenter).toBeGreaterThan(ROLE_RANK.viewer);
  });

  it('validates role strings from the wire', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it('does not offer owner as assignable', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('owner');
  });
});
