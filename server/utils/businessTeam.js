/**
 * Business shared-inbox membership.
 *
 * Access is a two-step handshake: an owner invites an exact handle, and the
 * invitee accepts. Only an active membership unlocks the owner's business
 * threads. Personal threads are never part of the query, even for the owner's
 * own conversations with the teammate.
 */
const BusinessProfile = require('../models/BusinessProfile');
const BusinessTeamMember = require('../models/BusinessTeamMember');
const User = require('../models/User');

const { badRequest, notFound, forbidden, conflict } = require('./httpError');
const { usernameFilter, normalizeUsername } = require('./username');
const { isBlockedBetween } = require('./privacy');
const { notifyUser } = require('./notify');

const TEAM_ROLES = Object.freeze(['viewer', 'agent']);
const MAX_TEAM_SIZE = 10;

const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));

function normalizeTeamRole(value) {
  return TEAM_ROLES.includes(value) ? value : null;
}

async function requireBusinessOwner(ownerId) {
  if (!isId(ownerId)) throw notFound('Business not found.');
  const owner = await User.findById(ownerId)
    .select('_id username profileType status')
    .lean();
  if (!owner || owner.profileType !== 'creator_business' || ['frozen', 'suspended', 'deleted', 'deletion_pending'].includes(owner.status)) {
    throw notFound('Business not found.');
  }
  const profile = await BusinessProfile.findOne({ userId: owner._id })
    .select('_id displayName')
    .lean();
  if (!profile) throw notFound('Business not found.');
  return { owner, profile };
}

async function requireTeamAccess({ ownerId, memberId, write = false }) {
  if (!isId(ownerId) || !isId(memberId)) throw notFound('Shared inbox not found.');
  const { owner } = await requireBusinessOwner(ownerId);
  const membership = await BusinessTeamMember.findOne({
    businessOwnerId: owner._id,
    memberId,
    status: 'active'
  }).lean();
  if (!membership) throw notFound('Shared inbox not found.');
  if (write && membership.role !== 'agent') {
    throw forbidden('Viewer access is read-only. Ask the owner for the agent role.', {
      code: 'TEAM_READ_ONLY'
    });
  }
  return { owner, membership, role: membership.role };
}

function memberView(row) {
  const member = row.memberId;
  return {
    _id: String(row._id),
    memberId: String(member?._id || row.memberId),
    username: member?.username || 'unknown',
    role: row.role,
    status: row.status,
    invitedAt: row.createdAt,
    respondedAt: row.respondedAt || null
  };
}

async function listOwnerTeam(ownerId) {
  await requireBusinessOwner(ownerId);
  const rows = await BusinessTeamMember.find({
    businessOwnerId: ownerId,
    status: { $ne: 'removed' }
  })
    .sort({ createdAt: 1 })
    .populate('memberId', 'username level status')
    .lean();

  return {
    items: rows.map(memberView),
    maxSize: MAX_TEAM_SIZE
  };
}

async function inviteTeamMember({ ownerId, username, role }) {
  const { owner, profile } = await requireBusinessOwner(ownerId);
  const parsedName = normalizeUsername(username);
  if (!parsedName.ok) throw badRequest(parsedName.reason);
  const normalizedRole = normalizeTeamRole(role);
  if (!normalizedRole) throw badRequest('Choose the viewer or agent role.');

  const target = await User.findOne(usernameFilter(parsedName.value))
    .select('_id username profileType status blockedUsers')
    .lean();
  if (!target) throw notFound('Player not found.');
  if (String(target._id) === String(owner._id)) throw badRequest('You are already the owner of this inbox.');
  if (['deleted', 'deletion_pending', 'suspended', 'frozen'].includes(target.status)) {
    throw badRequest('That account cannot join a shared inbox.');
  }
  if (isBlockedBetween(owner, target)) {
    throw forbidden('That player cannot be invited.', { code: 'TEAM_BLOCKED' });
  }

  const existing = await BusinessTeamMember.findOne({
    businessOwnerId: owner._id,
    memberId: target._id
  }).lean();
  if (existing?.status === 'active') {
    throw conflict('That player is already on the team.');
  }

  const count = await BusinessTeamMember.countDocuments({
    businessOwnerId: owner._id,
    status: { $in: ['invited', 'active'] }
  });
  if (count >= MAX_TEAM_SIZE) throw badRequest(`A team can have up to ${MAX_TEAM_SIZE} people.`);

  const membership = await BusinessTeamMember.findOneAndUpdate(
    { businessOwnerId: owner._id, memberId: target._id },
    {
      $set: {
        role: normalizedRole,
        status: 'invited',
        invitedById: owner._id,
        respondedAt: null
      }
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).populate('memberId', 'username level status');

  await notifyUser({
    userId: target._id,
    type: 'social',
    title: `@${owner.username} invited you to a shared inbox`,
    message: `${profile.displayName} wants you to help with business messages. Accept or decline in Messages.`,
    actionUrl: `/messages?teamInvite=${owner._id}`,
    metadata: { kind: 'business_team_invite', ownerId: String(owner._id) },
    dedupeKey: `business-team-invite:${owner._id}:${target._id}:${Date.now()}`
  });

  return memberView(membership.toObject());
}

async function respondToInvite({ ownerId, memberId, accept }) {
  if (typeof accept !== 'boolean') throw badRequest('Choose accept or decline.');
  const { owner, profile } = await requireBusinessOwner(ownerId);
  const membership = await BusinessTeamMember.findOne({
    businessOwnerId: owner._id,
    memberId,
    status: 'invited'
  });
  if (!membership) throw notFound('Invitation not found.');

  membership.status = accept ? 'active' : 'declined';
  membership.respondedAt = new Date();
  await membership.save();

  if (accept) {
    await notifyUser({
      userId: owner._id,
      type: 'social',
      title: 'Your shared inbox invitation was accepted',
      message: `${profile.displayName} now has a ${membership.role} seat.`,
      actionUrl: '/settings?tab=business',
      metadata: { kind: 'business_team_accepted', memberId: String(memberId) },
      dedupeKey: `business-team-accepted:${owner._id}:${memberId}`
    });
  }

  return { accepted: accept, ownerId: String(owner._id), role: membership.role };
}

async function updateTeamRole({ ownerId, memberId, role }) {
  await requireBusinessOwner(ownerId);
  const normalizedRole = normalizeTeamRole(role);
  if (!normalizedRole) throw badRequest('Choose the viewer or agent role.');
  const membership = await BusinessTeamMember.findOne({
    businessOwnerId: ownerId,
    memberId,
    status: { $in: ['invited', 'active'] }
  });
  if (!membership) throw notFound('Team member not found.');
  membership.role = normalizedRole;
  await membership.save();
  return { memberId: String(memberId), role: membership.role };
}

async function removeTeamMember({ ownerId, memberId, actorId }) {
  await requireBusinessOwner(ownerId);
  const membership = await BusinessTeamMember.findOne({
    businessOwnerId: ownerId,
    memberId,
    status: { $in: ['invited', 'active'] }
  });
  if (!membership) throw notFound('Team member not found.');
  if (String(actorId) !== String(ownerId) && String(actorId) !== String(memberId)) {
    throw forbidden('You cannot change this team.', { code: 'TEAM_NOT_OWNER' });
  }
  membership.status = 'removed';
  membership.respondedAt = new Date();
  await membership.save();
  return { removed: true, memberId: String(memberId) };
}

async function listWorkspaces(memberId) {
  const rows = await BusinessTeamMember.find({
    memberId,
    status: { $in: ['active', 'invited'] }
  })
    .sort({ updatedAt: -1 })
    .populate('businessOwnerId', 'username profileType status')
    .lean();

  const ownerIds = rows
    .map((row) => row.businessOwnerId?._id)
    .filter(Boolean);
  const profiles = ownerIds.length
    ? await BusinessProfile.find({ userId: { $in: ownerIds } })
        .select('userId displayName')
        .lean()
    : [];
  const names = new Map(profiles.map((profile) => [String(profile.userId), profile.displayName]));

  const visible = rows.filter((row) => {
    const owner = row.businessOwnerId;
    return owner && owner.profileType === 'creator_business' && owner.status === 'active';
  });

  const map = (row) => ({
    ownerId: String(row.businessOwnerId._id),
    username: row.businessOwnerId.username,
    displayName: names.get(String(row.businessOwnerId._id)) || row.businessOwnerId.username,
    role: row.role,
    status: row.status
  });

  return {
    teams: visible.filter((row) => row.status === 'active').map(map),
    invites: visible.filter((row) => row.status === 'invited').map(map)
  };
}

module.exports = {
  TEAM_ROLES,
  MAX_TEAM_SIZE,
  normalizeTeamRole,
  requireTeamAccess,
  listOwnerTeam,
  inviteTeamMember,
  respondToInvite,
  updateTeamRole,
  removeTeamMember,
  listWorkspaces
};
