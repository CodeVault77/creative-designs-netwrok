/**
 * The role matrix from §15.
 *
 * | Role      | View | Edit | Invite | Change roles    | Privacy | Delete |
 * | Owner     | yes  | yes  | yes    | yes             | yes     | yes    |
 * | Admin     | yes  | yes  | yes    | yes (below own) | yes     | —      |
 * | Editor    | yes  | yes  | —      | —               | —       | —      |
 * | Commenter | yes  | —    | —      | —               | —       | —      |
 * | Viewer    | yes  | —    | —      | —               | —       | —      |
 *
 * Pure and data-driven so the matrix can be read at a glance and asserted
 * cell by cell. Permission logic scattered through route handlers is how a
 * role quietly gains a capability nobody granted it.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer';

/** Ranked, so "below own" comparisons are a number rather than a special case. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 5,
  admin: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
};

/** Roles that can be assigned. Owner is transferred, never granted. */
export const ASSIGNABLE_ROLES: readonly Role[] = [
  'admin',
  'editor',
  'commenter',
  'viewer',
] as const;

export interface Capabilities {
  view: boolean;
  editNodes: boolean;
  comment: boolean;
  invite: boolean;
  changeRoles: boolean;
  changePrivacy: boolean;
  deleteMap: boolean;
  transferOwnership: boolean;
}

const NONE: Capabilities = {
  view: false,
  editNodes: false,
  comment: false,
  invite: false,
  changeRoles: false,
  changePrivacy: false,
  deleteMap: false,
  transferOwnership: false,
};

const MATRIX: Record<Role, Capabilities> = {
  owner: {
    view: true,
    editNodes: true,
    comment: true,
    invite: true,
    changeRoles: true,
    changePrivacy: true,
    deleteMap: true,
    transferOwnership: true,
  },
  admin: {
    view: true,
    editNodes: true,
    comment: true,
    invite: true,
    changeRoles: true,
    changePrivacy: true,
    // §15: Admin has no delete. Deleting a map is the one action with no undo
    // and no partial form, so it stays with the single person who owns it.
    deleteMap: false,
    transferOwnership: false,
  },
  editor: {
    view: true,
    editNodes: true,
    comment: true,
    invite: false,
    changeRoles: false,
    changePrivacy: false,
    deleteMap: false,
    transferOwnership: false,
  },
  commenter: {
    view: true,
    editNodes: false,
    comment: true,
    invite: false,
    changeRoles: false,
    changePrivacy: false,
    deleteMap: false,
    transferOwnership: false,
  },
  viewer: {
    view: true,
    editNodes: false,
    comment: false,
    invite: false,
    changeRoles: false,
    changePrivacy: false,
    deleteMap: false,
    transferOwnership: false,
  },
};

export function capabilitiesFor(role: Role | null): Capabilities {
  return role ? MATRIX[role] : NONE;
}

/**
 * Whether `actor` may set someone's role to `target`.
 *
 * §15: an Admin may change roles "below own". Two rules follow, and both are
 * the kind of thing that is obvious once stated and absent from most
 * implementations:
 *
 *   - an Admin cannot promote anyone to Admin or Owner, otherwise the ceiling
 *     is not a ceiling — one Admin could mint another and privilege escalates
 *     sideways;
 *   - an Admin cannot demote another Admin, or two Admins can remove each
 *     other and the outcome depends on who clicks first.
 */
export function canAssignRole(
  actorRole: Role | null,
  targetCurrentRole: Role | null,
  targetNewRole: Role,
): boolean {
  if (!actorRole) return false;
  if (!capabilitiesFor(actorRole).changeRoles) return false;

  // Owner is transferred through its own confirmed flow, never assigned here.
  if (targetNewRole === 'owner') return false;
  // Nobody may change the owner's role.
  if (targetCurrentRole === 'owner') return false;

  if (actorRole === 'owner') return true;

  // Admin: strictly below own rank, in both the current and the new role.
  const actorRank = ROLE_RANK[actorRole];
  if (ROLE_RANK[targetNewRole] >= actorRank) return false;
  if (targetCurrentRole && ROLE_RANK[targetCurrentRole] >= actorRank) return false;

  return true;
}

/** Whether `actor` may remove a member. Anyone may remove themselves. */
export function canRemoveMember(
  actorRole: Role | null,
  actorUserId: string,
  targetRole: Role | null,
  targetUserId: string,
): boolean {
  // Leaving a map you were invited to needs no permission.
  if (actorUserId === targetUserId && targetRole !== 'owner') return true;

  if (!actorRole || !capabilitiesFor(actorRole).changeRoles) return false;
  // The owner is never removable; the map would have no owner.
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;

  return targetRole ? ROLE_RANK[targetRole] < ROLE_RANK[actorRole] : true;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full control, including deleting the map',
  admin: 'Can edit, invite and manage people',
  editor: 'Can edit the map',
  commenter: 'Can read and comment',
  viewer: 'Can read',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in ROLE_RANK;
}
