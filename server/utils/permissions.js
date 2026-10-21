/**
 * Single source of truth for authorization.
 *
 * Two independent permission systems — never mix them:
 *   1. COMMUNITY (server) roles: owner / admin / moderator / member.
 *      These exist ONLY to maintain a Discord-style server (channels, roles,
 *      moderation inside that server). They grant no application-wide power.
 *   2. APPLICATION roles: user / moderator / admin.
 *      These are platform staff powers (moderate any post/comment, see any
 *      message). They do NOT silently promote you inside somebody's server.
 *
 * Community capabilities are derived from the member's role. Channel gates
 * (`minRoleToRead` / `minRoleToWrite`) are applied on top of capabilities, so a
 * capability alone is never enough to read or write a channel.
 */

const ROLE_LEVELS = Object.freeze({ member: 0, moderator: 1, admin: 2, owner: 3 });
const COMMUNITY_ROLES = Object.freeze(['member', 'moderator', 'admin', 'owner']);

const CAP = Object.freeze({
  VIEW_SERVER: 'VIEW_SERVER',
  VIEW_CHANNEL: 'VIEW_CHANNEL',
  SEND_MESSAGES: 'SEND_MESSAGES',
  DELETE_OWN_MESSAGE: 'DELETE_OWN_MESSAGE',
  MANAGE_MESSAGES: 'MANAGE_MESSAGES',
  BYPASS_SLOWMODE: 'BYPASS_SLOWMODE',
  ADD_MEMBERS: 'ADD_MEMBERS',
  KICK_MEMBERS: 'KICK_MEMBERS',
  MANAGE_ROLES: 'MANAGE_ROLES',
  MANAGE_CHANNELS: 'MANAGE_CHANNELS',
  VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',
  MANAGE_SERVER: 'MANAGE_SERVER'
});

const MEMBER_CAPS = Object.freeze([
  CAP.VIEW_SERVER,
  CAP.VIEW_CHANNEL,
  CAP.SEND_MESSAGES,
  CAP.DELETE_OWN_MESSAGE
]);

const MODERATOR_CAPS = Object.freeze([
  ...MEMBER_CAPS,
  CAP.MANAGE_MESSAGES,
  CAP.BYPASS_SLOWMODE
]);

const ADMIN_CAPS = Object.freeze([
  ...MODERATOR_CAPS,
  CAP.ADD_MEMBERS,
  CAP.KICK_MEMBERS,
  CAP.MANAGE_ROLES,
  CAP.MANAGE_CHANNELS,
  CAP.VIEW_AUDIT_LOG
]);

const OWNER_CAPS = Object.freeze([...ADMIN_CAPS, CAP.MANAGE_SERVER]);

/** Role -> capabilities. The only place these are defined. */
const ROLE_CAPABILITIES = Object.freeze({
  member: MEMBER_CAPS,
  moderator: MODERATOR_CAPS,
  admin: ADMIN_CAPS,
  owner: OWNER_CAPS
});

/** Application-wide capabilities. */
const APP_CAP = Object.freeze({
  MODERATE_CONTENT: 'MODERATE_CONTENT',
  ADMIN_PLATFORM: 'ADMIN_PLATFORM'
});

const roleLevel = (role) => ROLE_LEVELS[role] ?? -1;

/** True when `role` is at least as authoritative as `minRole`. */
function roleAtLeast(role, minRole) {
  if (!minRole) return true;
  if (roleLevel(role) < 0) return false;
  return roleLevel(role) >= roleLevel(minRole);
}

const isCommunityRole = (role) => COMMUNITY_ROLES.includes(role);

const capabilitiesForRole = (role) => ROLE_CAPABILITIES[role] || [];

function roleHasCapability(role, capability) {
  return capabilitiesForRole(role).includes(capability);
}

/** Works with plain docs, lean docs and populated docs. */
const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

/** The embedded member entry for a user, or null. */
function findMember(community, userId) {
  if (!community || !userId) return null;
  const id = String(userId);
  return (community.members || []).find((m) => idOf(m.userId) === id) || null;
}

/**
 * Resolve a user's role in a community.
 * `ownerId` wins over the embedded list so legacy servers (created before
 * members were stored) still resolve their owner correctly.
 */
function resolveCommunityRole(community, userId) {
  if (!community || !userId) return null;
  if (idOf(community.ownerId) === String(userId)) return 'owner';
  return findMember(community, userId)?.role ?? null;
}

/**
 * Full permission context for one user in one community.
 * @returns {{role: string|null, isMember: boolean, isOwner: boolean, permissions: string[]}}
 */
function communityPermissions(community, userId) {
  const role = resolveCommunityRole(community, userId);
  return {
    role,
    isMember: !!role,
    isOwner: role === 'owner',
    permissions: role ? [...capabilitiesForRole(role)] : []
  };
}

const canInCommunity = (community, userId, capability) =>
  communityPermissions(community, userId).permissions.includes(capability);

/** Application-level capabilities for a platform role. */
function appCapabilitiesForRole(role) {
  if (role === 'admin') return [APP_CAP.MODERATE_CONTENT, APP_CAP.ADMIN_PLATFORM];
  if (role === 'moderator') return [APP_CAP.MODERATE_CONTENT];
  return [];
}

const isAppStaff = (user) =>
  appCapabilitiesForRole(user?.role).includes(APP_CAP.MODERATE_CONTENT);

const isPlatformAdmin = (user) =>
  appCapabilitiesForRole(user?.role).includes(APP_CAP.ADMIN_PLATFORM);

/**
 * Can `actorRole` change `targetRole` into `newRole`?
 * Rules (deliberately conservative, "minimum set of maintenance roles"):
 *  - only admin/owner can manage roles
 *  - the owner's role is immutable
 *  - admins cannot touch other admins and cannot grant admin
 *  - ownership cannot be handed out via this endpoint
 */
function canAssignCommunityRole(actorRole, targetRole, newRole) {
  if (!isCommunityRole(newRole) || newRole === 'owner') {
    return { ok: false, reason: 'Community role must be member, moderator or admin.' };
  }
  if (roleLevel(actorRole) < ROLE_LEVELS.admin) {
    return { ok: false, reason: 'You need the Admin or Owner role to manage members.' };
  }
  if (targetRole === 'owner') {
    return { ok: false, reason: "The owner's role cannot be changed." };
  }
  if (actorRole === 'admin') {
    if (roleLevel(targetRole) >= ROLE_LEVELS.admin) {
      return { ok: false, reason: 'Admins cannot manage other admins. Ask the owner.' };
    }
    if (roleLevel(newRole) >= ROLE_LEVELS.admin) {
      return { ok: false, reason: 'Only the owner can grant the Admin role.' };
    }
  }
  return { ok: true };
}

/**
 * Can `actorRole` kick `targetRole`?
 *  - admin/owner only, never the owner, never yourself (use Leave)
 *  - admins cannot kick other admins
 */
function canKickCommunityMember(actorRole, targetRole, { self = false } = {}) {
  if (self) return { ok: false, reason: 'Use Leave server to remove yourself.' };
  if (roleLevel(actorRole) < ROLE_LEVELS.admin) {
    return { ok: false, reason: 'You need the Admin or Owner role to kick members.' };
  }
  if (targetRole === 'owner') {
    return { ok: false, reason: 'The owner cannot be kicked.' };
  }
  if (actorRole === 'admin' && roleLevel(targetRole) >= ROLE_LEVELS.admin) {
    return { ok: false, reason: 'Admins cannot kick other admins.' };
  }
  return { ok: true };
}

/** Roles this actor is allowed to grant (used by the UI dropdown). */
function assignableRoles(actorRole) {
  if (actorRole === 'owner') return ['member', 'moderator', 'admin'];
  if (actorRole === 'admin') return ['member', 'moderator'];
  return [];
}

module.exports = {
  ROLE_LEVELS,
  COMMUNITY_ROLES,
  CAP,
  APP_CAP,
  ROLE_CAPABILITIES,
  roleLevel,
  roleAtLeast,
  isCommunityRole,
  capabilitiesForRole,
  roleHasCapability,
  idOf,
  findMember,
  resolveCommunityRole,
  communityPermissions,
  canInCommunity,
  appCapabilitiesForRole,
  isAppStaff,
  isPlatformAdmin,
  canAssignCommunityRole,
  canKickCommunityMember,
  assignableRoles
};
