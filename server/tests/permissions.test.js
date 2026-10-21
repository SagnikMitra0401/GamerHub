const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAP,
  roleAtLeast,
  capabilitiesForRole,
  communityPermissions,
  resolveCommunityRole,
  canAssignCommunityRole,
  canKickCommunityMember,
  assignableRoles
} = require('../utils/permissions');

const makeCommunity = (overrides = {}) => ({
  ownerId: 'owner1',
  members: [
    { userId: 'owner1', role: 'owner' },
    { userId: 'admin1', role: 'admin' },
    { userId: 'mod1', role: 'moderator' },
    { userId: 'member1', role: 'member' }
  ],
  ...overrides
});

test('role hierarchy is strict', () => {
  assert.equal(roleAtLeast('owner', 'admin'), true);
  assert.equal(roleAtLeast('admin', 'admin'), true);
  assert.equal(roleAtLeast('moderator', 'admin'), false);
  assert.equal(roleAtLeast('member', 'moderator'), false);
  assert.equal(roleAtLeast(null, 'member'), false);
  assert.equal(roleAtLeast(undefined, 'member'), false);
});

test('capabilities are cumulative and maintenance-only', () => {
  const member = capabilitiesForRole('member');
  const mod = capabilitiesForRole('moderator');
  const admin = capabilitiesForRole('admin');
  const owner = capabilitiesForRole('owner');

  assert.ok(member.includes(CAP.SEND_MESSAGES));
  assert.ok(!member.includes(CAP.MANAGE_MESSAGES));

  assert.ok(mod.includes(CAP.MANAGE_MESSAGES));
  assert.ok(mod.includes(CAP.BYPASS_SLOWMODE));
  assert.ok(!mod.includes(CAP.MANAGE_ROLES));

  assert.ok(admin.includes(CAP.MANAGE_ROLES));
  assert.ok(admin.includes(CAP.KICK_MEMBERS));
  assert.ok(admin.includes(CAP.MANAGE_CHANNELS));
  assert.ok(!admin.includes(CAP.MANAGE_SERVER));

  assert.ok(owner.includes(CAP.MANAGE_SERVER));
});

test('resolveCommunityRole handles plain, populated and legacy documents', () => {
  assert.equal(resolveCommunityRole(makeCommunity(), 'admin1'), 'admin');
  assert.equal(resolveCommunityRole(makeCommunity(), 'nobody'), null);

  // Populated docs (what the API returns after .populate().lean())
  const populated = {
    ownerId: { _id: 'owner1' },
    members: [{ userId: { _id: 'member1', username: 'm' }, role: 'member' }]
  };
  assert.equal(resolveCommunityRole(populated, 'owner1'), 'owner');
  assert.equal(resolveCommunityRole(populated, 'member1'), 'member');

  // Legacy servers: owner not present in the embedded list
  assert.equal(resolveCommunityRole({ ownerId: 'owner1', members: [] }, 'owner1'), 'owner');
});

test('communityPermissions returns capabilities for members only', () => {
  const admin = communityPermissions(makeCommunity(), 'admin1');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.isMember, true);
  assert.ok(admin.permissions.includes(CAP.VIEW_CHANNEL));

  const outsider = communityPermissions(makeCommunity(), 'stranger');
  assert.equal(outsider.role, null);
  assert.equal(outsider.isMember, false);
  assert.deepEqual(outsider.permissions, []);
});

test('role assignment rules', () => {
  assert.equal(canAssignCommunityRole('owner', 'member', 'admin').ok, true);
  assert.equal(canAssignCommunityRole('admin', 'member', 'moderator').ok, true);

  // Admins cannot create peers or touch peers
  assert.equal(canAssignCommunityRole('admin', 'member', 'admin').ok, false);
  assert.equal(canAssignCommunityRole('admin', 'admin', 'member').ok, false);

  // Owners are immutable, ownership is not assignable
  assert.equal(canAssignCommunityRole('owner', 'owner', 'member').ok, false);
  assert.equal(canAssignCommunityRole('owner', 'member', 'owner').ok, false);

  // Moderators and members cannot manage roles
  assert.equal(canAssignCommunityRole('moderator', 'member', 'moderator').ok, false);
  assert.equal(canAssignCommunityRole('member', 'member', 'moderator').ok, false);
});

test('kick rules', () => {
  assert.equal(canKickCommunityMember('owner', 'admin').ok, true);
  assert.equal(canKickCommunityMember('admin', 'moderator').ok, true);

  assert.equal(canKickCommunityMember('admin', 'admin').ok, false);
  assert.equal(canKickCommunityMember('admin', 'owner').ok, false);
  assert.equal(canKickCommunityMember('owner', 'owner').ok, false);
  assert.equal(canKickCommunityMember('moderator', 'member').ok, false);
  assert.equal(canKickCommunityMember('owner', 'member', { self: true }).ok, false);
});

test('assignableRoles mirrors the rules above', () => {
  assert.deepEqual(assignableRoles('owner'), ['member', 'moderator', 'admin']);
  assert.deepEqual(assignableRoles('admin'), ['member', 'moderator']);
  assert.deepEqual(assignableRoles('moderator'), []);
  assert.deepEqual(assignableRoles(null), []);
});
