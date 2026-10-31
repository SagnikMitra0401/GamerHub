/**
 * Succession engine.
 *
 * When an owner leaves for good, a server must not be left without someone who
 * can administer it, and a squad must not lose its leader mid-session. These
 * functions are intentionally small and deterministic:
 *
 *   community owner -> admin -> moderator -> veteran member (earliest joined)
 *   squad leader    -> veteran member (earliest joined)
 *
 * A community with no remaining members is dissolved (it cannot be governed and
 * has no audience); a squad with no remaining members is closed.
 *
 * The selection helpers are pure so the ranking rules can be tested without a
 * database; the transfer helpers are idempotent and claim ownership with a
 * conditional update, so a concurrent deletion of the same owner cannot produce
 * two owners.
 */

const Community = require('../models/Community');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const ForumPost = require('../models/ForumPost');
const ForumReply = require('../models/ForumReply');
const Attachment = require('../models/Attachment');
const Report = require('../models/Report');
const Invitation = require('../models/Invitation');
const AuditLog = require('../models/AuditLog');
const Party = require('../models/Party');
const SquadChat = require('../models/SquadChat');
const User = require('../models/User');
const { recordAudit } = require('./audit');

const COMMUNITY_ROLE_WEIGHT = Object.freeze({ owner: 4, admin: 3, moderator: 2, member: 1 });
const SQUAD_ROLE_WEIGHT = Object.freeze({ leader: 1, member: 0 });

const idOf = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

const joinedAt = (member) => {
  const time = new Date(member?.joinedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

/**
 * Sort eligible members by authority, then seniority, then id (stable ties).
 * @param {object[]} members
 * @param {string} departingUserId
 * @param {object} weights
 */
function orderSuccessors(members, departingUserId, weights = COMMUNITY_ROLE_WEIGHT) {
  const departing = String(departingUserId);
  return (Array.isArray(members) ? members : [])
    .filter((member) => member && idOf(member.userId) !== departing)
    .map((member) => ({
      userId: idOf(member.userId),
      role: member.role || 'member',
      joinedAt: member.joinedAt || null
    }))
    .filter((member) => member.userId)
    .sort((a, b) => {
      const byRole = (weights[b.role] ?? 0) - (weights[a.role] ?? 0);
      if (byRole !== 0) return byRole;
      const byAge = joinedAt(a) - joinedAt(b);
      if (byAge !== 0) return byAge;
      return a.userId.localeCompare(b.userId);
    });
}

/** The member who should own the server next, or null when nobody is left. */
function chooseCommunitySuccessor(community, departingUserId) {
  return orderSuccessors(community?.members, departingUserId, COMMUNITY_ROLE_WEIGHT)[0] || null;
}

/** The member who should lead the squad next, or null when nobody is left. */
function chooseSquadSuccessor(party, departingUserId) {
  return orderSuccessors(party?.members, departingUserId, SQUAD_ROLE_WEIGHT)[0] || null;
}

/** Delete a server and everything that belongs to it. */
async function dissolveCommunity(community) {
  const id = idOf(community);
  if (!id) return false;

  await Promise.all([
    Message.deleteMany({ communityId: id }),
    Channel.deleteMany({ communityId: id }),
    ForumPost.deleteMany({ communityId: id }),
    ForumReply.deleteMany({ communityId: id }),
    Attachment.deleteMany({ communityId: id }),
    Report.deleteMany({ communityId: id }),
    Invitation.deleteMany({ targetType: 'community_server', targetId: id }),
    AuditLog.deleteMany({ communityId: id })
  ]);
  const result = await Community.deleteOne({ _id: id });

  // Tell open tabs the room is gone. Required lazily so the socket module's
  // model imports cannot turn into a require cycle at startup.
  try {
    const { emitToCommunity } = require('../config/socket');
    emitToCommunity(id, 'community_deleted', { communityId: id, reason: 'owner_deleted_account' });
  } catch {
    // No live socket in tests / scripts.
  }

  return result.deletedCount > 0;
}

/**
 * Move a server to its next owner, or dissolve it when nobody is left.
 * Returns null when the caller is not the owner (nothing to do).
 */
async function transferCommunityOwnership(communityOrId, departingUserId) {
  const community = typeof communityOrId === 'object' && communityOrId?.members
    ? communityOrId
    : await Community.findById(communityOrId).lean();
  if (!community) return null;
  if (idOf(community.ownerId) !== String(departingUserId)) return null;

  const successor = chooseCommunitySuccessor(community, departingUserId);
  if (!successor) {
    const dissolved = await dissolveCommunity(community);
    return {
      communityId: idOf(community._id),
      name: community.name,
      dissolved,
      successor: null
    };
  }

  // Conditional claim: if another worker already transferred it, the old owner
  // no longer matches and this update is a no-op.
  const updated = await Community.findOneAndUpdate(
    { _id: community._id, ownerId: departingUserId, 'members.userId': successor.userId },
    { $set: { ownerId: successor.userId, 'members.$.role': 'owner' } },
    { new: true, projection: { name: 1 } }
  ).lean();
  if (!updated) return null;

  await recordAudit({
    communityId: community._id,
    actorId: departingUserId,
    actionType: 'OWNER_TRANSFER',
    targetId: successor.userId,
    targetModel: 'User',
    metadata: {
      reason: 'account_deletion',
      previousOwner: String(departingUserId),
      successorRole: successor.role
    }
  });

  return {
    communityId: idOf(community._id),
    name: community.name,
    dissolved: false,
    successor: { userId: successor.userId, role: 'owner' }
  };
}

/**
 * Move a squad to its next leader, or close it when nobody is left.
 * The temporary chat's refresh right moves with the leadership.
 */
async function transferSquadLeadership(partyOrId, departingUserId) {
  const party = typeof partyOrId === 'object' && partyOrId?.members
    ? partyOrId
    : await Party.findById(partyOrId).lean();
  if (!party) return null;
  if (idOf(party.leaderId) !== String(departingUserId)) return null;

  const successor = chooseSquadSuccessor(party, departingUserId);
  if (!successor) {
    await Party.updateOne(
      { _id: party._id },
      {
        $set: { status: 'closed', state: 'cancelled', completedAt: new Date() },
        $pull: { members: { userId: departingUserId } }
      }
    );
    await SquadChat.updateMany(
      { squadId: party._id, state: { $ne: 'expired' } },
      { $set: { state: 'closed' } }
    );
    return {
      partyId: idOf(party._id),
      gameTitle: party.gameTitle,
      dissolved: true,
      successor: null
    };
  }

  const nextLeader = await User.findById(successor.userId).select('username').lean();
  const updated = await Party.findOneAndUpdate(
    { _id: party._id, leaderId: departingUserId, 'members.userId': successor.userId },
    { $set: { leaderId: successor.userId, 'members.$.role': 'leader' } },
    { new: true, projection: { gameTitle: 1 } }
  ).lean();
  if (!updated) return null;

  await SquadChat.updateOne(
    { squadId: party._id },
    {
      $set: {
        ownerUserId: successor.userId,
        ownerUsername: nextLeader?.username || ''
      }
    }
  );

  return {
    partyId: idOf(party._id),
    gameTitle: updated.gameTitle,
    dissolved: false,
    successor: { userId: successor.userId, username: nextLeader?.username || null }
  };
}

/**
 * Preview what would happen if this account were erased right now.
 * Read-only and safe to call from the settings UI before a destructive action.
 */
async function planSuccessionForUser(userId) {
  const [communities, parties] = await Promise.all([
    Community.find({ ownerId: userId }).select('name members').lean(),
    Party.find({ leaderId: userId, status: { $ne: 'closed' } })
      .select('gameTitle members state')
      .lean()
  ]);

  const successorIds = [];
  const communityPlan = communities.map((community) => {
    const successor = chooseCommunitySuccessor(community, userId);
    if (successor) successorIds.push(successor.userId);
    return {
      id: String(community._id),
      name: community.name,
      memberCount: community.members?.length || 0,
      action: successor ? 'transfer' : 'dissolve',
      successor: successor ? { userId: successor.userId, username: null } : null
    };
  });

  const squadPlan = parties.map((party) => {
    const successor = chooseSquadSuccessor(party, userId);
    if (successor) successorIds.push(successor.userId);
    return {
      id: String(party._id),
      gameTitle: party.gameTitle,
      memberCount: party.members?.length || 0,
      action: successor ? 'transfer' : 'close',
      successor: successor ? { userId: successor.userId, username: null } : null
    };
  });

  if (successorIds.length) {
    const users = await User.find({ _id: { $in: successorIds } })
      .select('username')
      .lean();
    const names = new Map(users.map((user) => [String(user._id), user.username]));
    for (const entry of [...communityPlan, ...squadPlan]) {
      if (entry.successor) entry.successor.username = names.get(entry.successor.userId) || null;
    }
  }

  return {
    communities: communityPlan,
    squads: squadPlan,
    dissolves: communityPlan.filter((entry) => entry.action === 'dissolve').length,
    closes: squadPlan.filter((entry) => entry.action === 'close').length
  };
}

/** Apply succession for every server and squad this account owns or leads. */
async function transferAllForUser(userId) {
  const [communities, parties] = await Promise.all([
    Community.find({ ownerId: userId }).select('name members ownerId').lean(),
    Party.find({ leaderId: userId, status: { $ne: 'closed' } })
      .select('gameTitle members leaderId status')
      .lean()
  ]);

  const summary = { communities: [], squads: [] };

  for (const community of communities) {
    const result = await transferCommunityOwnership(community, userId);
    if (result) summary.communities.push(result);
  }
  for (const party of parties) {
    const result = await transferSquadLeadership(party, userId);
    if (result) summary.squads.push(result);
  }

  return summary;
}

module.exports = {
  COMMUNITY_ROLE_WEIGHT,
  SQUAD_ROLE_WEIGHT,
  orderSuccessors,
  chooseCommunitySuccessor,
  chooseSquadSuccessor,
  dissolveCommunity,
  transferCommunityOwnership,
  transferSquadLeadership,
  planSuccessionForUser,
  transferAllForUser
};
