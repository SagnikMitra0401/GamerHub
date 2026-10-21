/**
 * Client mirror of server/utils/permissions.js.
 * The server is authoritative; these values only drive which controls render.
 * Keep the capability strings in sync.
 */

export const CAP = Object.freeze({
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

export const ROLE_LEVELS = Object.freeze({ member: 0, moderator: 1, admin: 2, owner: 3 });

export const ROLE_LABELS = Object.freeze({
  owner: '👑 Owner',
  admin: '🛡️ Admin',
  moderator: '⚔️ Moderator',
  member: 'Member'
});

export const ROLE_COLORS = Object.freeze({
  owner: '#ffd700',
  admin: '#a855f7',
  moderator: '#3b82f6',
  member: 'var(--text-muted)'
});

export const roleLevel = (role) => ROLE_LEVELS[role] ?? -1;

export const roleAtLeast = (role, minRole) => {
  if (!minRole) return true;
  if (roleLevel(role) < 0) return false;
  return roleLevel(role) >= roleLevel(minRole);
};

export const hasCapability = (permissions, capability) =>
  Array.isArray(permissions) && permissions.includes(capability);

export const assignableRoles = (role) => {
  if (role === 'owner') return ['member', 'moderator', 'admin'];
  if (role === 'admin') return ['member', 'moderator'];
  return [];
};
