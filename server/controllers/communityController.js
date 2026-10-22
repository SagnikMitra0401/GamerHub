const mongoose = require('mongoose');

const Community = require('../models/Community');
const Channel   = require('../models/Channel');
const Message   = require('../models/Message');
const AuditLog  = require('../models/AuditLog');
const User      = require('../models/User');

const { CHAT_POLICY } = require('../config/chatPolicy');
const {
  CAP,
  COMMUNITY_ROLES,
  roleLevel,
  roleAtLeast,
  resolveCommunityRole,
  communityPermissions,
  canAssignCommunityRole,
  canKickCommunityMember
} = require('../utils/permissions');
const { sanitizeLine } = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const { publicPresence } = require('../utils/presence');
const { badRequest, forbidden, notFound, conflict } = require('../utils/httpError');
const { emitToCommunity, emitToChannel, evictUserFromCommunity } = require('../config/socket');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

async function loadCommunity(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    throw badRequest('Invalid community id');
  }
  const community = await Community.findById(id);
  if (!community) throw notFound('Community not found.');
  return community;
}

/** Throws unless the caller holds `capability` in the community. */
function requireCapability(community, userId, capability, message) {
  const { role, permissions } = communityPermissions(community, userId);
  if (!permissions.includes(capability)) {
    throw forbidden(message || 'You do not have permission to do that.');
  }
  return { role, permissions };
}

const channelName = (raw) =>
  sanitizeLine(String(raw || ''), CHAT_POLICY.channels.maxNameLength)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const sortMembers = (members = []) =>
  [...members].sort((a, b) => {
    const byRole = roleLevel(b.role) - roleLevel(a.role);
    if (byRole !== 0) return byRole;
    const aName = String(a.userId?.username || '');
    const bName = String(b.userId?.username || '');
    return aName.localeCompare(bName);
  });

const memberSummary = (entry) => ({
  userId: entry.userId?._id || entry.userId,
  username: entry.userId?.username || 'Unknown',
  level: entry.userId?.level ?? 1,
  role: entry.role,
  presence: publicPresence(entry.userId?.presence),
  joinedAt: entry.joinedAt
});

/** Replace raw presence on each populated member with its public projection. */
const withPublicPresence = (members = []) =>
  members.map((member) => {
    const user = member.userId;
    if (!user || typeof user !== 'object') return member;
    return { ...member, userId: { ...user, presence: publicPresence(user.presence) } };
  });

// ─── POST /api/communities ──────────────────────────────────────────────────
// Create a community + auto-generate #general channel
const createCommunity = async (req, res, next) => {
  try {
    const name = sanitizeLine(req.body.name, CHAT_POLICY.community.maxNameLength);
    const description = sanitizeLine(req.body.description, CHAT_POLICY.community.maxDescriptionLength);
    const icon = sanitizeLine(req.body.icon, 100) || '🎮';
    const isPrivate = !!req.body.isPrivate;

    if (name.length < CHAT_POLICY.community.minNameLength) {
      throw badRequest(`Community name must be at least ${CHAT_POLICY.community.minNameLength} characters.`);
    }

    const baseSlug = makeSlug(name) || 'community';
    let slug = baseSlug;
    for (let attempt = 0; attempt < 5 && (await Community.exists({ slug })); attempt += 1) {
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const community = await Community.create({
      name,
      slug,
      description,
      icon,
      isPrivate,
      ownerId: req.user._id,
      members: [{ userId: req.user._id, role: 'owner' }]
    });

    await Channel.create({
      communityId: community._id,
      name: 'general',
      topic: 'General chat for everyone',
      type: 'text',
      position: 0
    });

    res.status(201).json({
      ...community.toObject(),
      memberCount: 1,
      callerRole: 'owner',
      callerPermissions: communityPermissions(community, req.user._id).permissions
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities ───────────────────────────────────────────────────
const getCommunities = async (req, res, next) => {
  try {
    const filter = req.user
      ? { $or: [{ isPrivate: false }, { 'members.userId': req.user._id }] }
      : { isPrivate: false };

    const communities = await Community.find(filter)
      .select('name slug description icon banner ownerId members isPrivate createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Never expose the full member list here (member ids are not public data).
    const payload = communities.map((c) => {
      const role = resolveCommunityRole(c, req.user?._id);
      const { members, ...rest } = c;
      return {
        ...rest,
        memberCount: (members || []).length,
        callerRole: role,
        isMember: !!role
      };
    });

    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:slug ─────────────────────────────────────────────
const getCommunityBySlug = async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: String(req.params.slug).toLowerCase() })
      .populate('ownerId', 'username level role')
      .populate('members.userId', 'username level role medals presence')
      .lean();

    if (!community) throw notFound('Community not found.');

    const callerId = req.user?._id;
    const { role, permissions } = communityPermissions(community, callerId);

    // Private servers are invisible to non-members — including their owner
    // detection, which works on populated docs because resolveCommunityRole
    // unwraps `_id`.
    if (community.isPrivate && !role) {
      throw forbidden('This is a private community.');
    }

    const allChannels = await Channel.find({ communityId: community._id })
      .sort({ position: 1, name: 1 })
      .lean();

    const visibleChannels = allChannels.filter((ch) =>
      role ? roleAtLeast(role, ch.minRoleToRead) : ch.minRoleToRead === 'member'
    );

    const memberCount = (community.members || []).length;
    // Owners of an 'invisible' presence must still look offline to members.
    const members = withPublicPresence(sortMembers(community.members).slice(0, 100));

    res.status(200).json({
      community: { ...community, members, memberCount },
      channels: visibleChannels,
      callerRole: role,
      callerPermissions: permissions,
      memberCount
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:id/members ───────────────────────────────────────
const getCommunityMembers = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    if (!resolveCommunityRole(community, req.user._id)) {
      throw forbidden('Join this server to see its members.');
    }

    const { page, limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const q = sanitizeLine(req.query.q, 40).toLowerCase();

    const populated = await community.populate('members.userId', 'username level role presence');
    let members = sortMembers(populated.members);

    if (q) {
      members = members.filter((m) => String(m.userId?.username || '').toLowerCase().includes(q));
    }

    const total = members.length;
    const start = (page - 1) * limit;

    res.status(200).json({
      members: members.slice(start, start + limit).map(memberSummary),
      total,
      page,
      hasMore: start + limit < total
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/join ─────────────────────────────────────────
const joinCommunity = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);

    if (resolveCommunityRole(community, req.user._id)) {
      throw badRequest('You are already a member.');
    }
    if (community.isPrivate) {
      throw forbidden('This server is invite-only. Ask an admin to add you.');
    }
    if ((community.members || []).length >= CHAT_POLICY.community.maxMembers) {
      throw conflict('This server has reached its member limit.');
    }

    community.members.push({ userId: req.user._id, role: 'member' });
    await community.save();

    emitToCommunity(community._id, 'community_updated', {
      communityId: String(community._id),
      memberCount: community.members.length
    });

    res.status(200).json({ message: 'Joined successfully.', role: 'member' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/leave ────────────────────────────────────────
const leaveCommunity = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    const role = resolveCommunityRole(community, req.user._id);

    if (!role) throw badRequest('You are not a member of this server.');
    if (role === 'owner') {
      throw badRequest('The owner cannot leave. Transfer ownership or delete the server.');
    }

    community.members = community.members.filter(
      (m) => String(m.userId?._id ?? m.userId) !== String(req.user._id)
    );
    await community.save();

    evictUserFromCommunity(req.user._id, community._id);
    emitToCommunity(community._id, 'member_left', {
      communityId: String(community._id),
      userId: String(req.user._id),
      memberCount: community.members.length
    });

    res.status(200).json({ message: 'Left server.' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/members ──────────────────────────────────────
// Server admins can add a user directly (this is how private servers grow).
const addMember = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    const { role: actorRole } = requireCapability(
      community, req.user._id, CAP.ADD_MEMBERS,
      'You need the Admin or Owner role to add members.'
    );

    const username = sanitizeLine(req.body.username, 20);
    const newRole = sanitizeLine(req.body.role, 20) || 'member';
    if (!username) throw badRequest('Username is required.');

    const target = await User.findOne({ username }).select('_id username level').lean();
    if (!target) throw notFound('User not found.');
    if (resolveCommunityRole(community, target._id)) throw conflict('That user is already a member.');

    const assignment = canAssignCommunityRole(actorRole, 'member', newRole);
    if (!assignment.ok) throw forbidden(assignment.reason);

    if ((community.members || []).length >= CHAT_POLICY.community.maxMembers) {
      throw conflict('This server has reached its member limit.');
    }

    community.members.push({ userId: target._id, role: newRole });
    await community.save();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'MEMBER_ADD',
      targetId: target._id,
      targetModel: 'User',
      metadata: { username: target.username, role: newRole }
    });

    emitToCommunity(community._id, 'member_added', {
      communityId: String(community._id),
      userId: String(target._id),
      role: newRole,
      memberCount: community.members.length
    });

    res.status(201).json({
      member: { userId: target._id, username: target.username, level: target.level, role: newRole }
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/communities/:id/members/:userId/role ────────────────────────
const updateMemberRole = async (req, res, next) => {
  try {
    const newRole = sanitizeLine(req.body.newRole, 20).toLowerCase();
    if (!COMMUNITY_ROLES.includes(newRole)) {
      throw badRequest(`Invalid role. Must be one of: member, moderator, admin.`);
    }

    const community = await loadCommunity(req.params.id);
    const { role: actorRole } = requireCapability(
      community, req.user._id, CAP.MANAGE_ROLES,
      'You need the Admin or Owner role to manage roles.'
    );

    const targetEntry = community.members.find(
      (m) => String(m.userId?._id ?? m.userId) === String(req.params.userId)
    );
    if (!targetEntry) throw notFound('Target user is not a member of this server.');

    const assignment = canAssignCommunityRole(actorRole, targetEntry.role, newRole);
    if (!assignment.ok) throw forbidden(assignment.reason);

    const previousRole = targetEntry.role;
    targetEntry.role = newRole;
    await community.save();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'ROLE_UPDATE',
      targetId: targetEntry.userId,
      targetModel: 'User',
      metadata: { newRole, previousRole }
    });

    emitToCommunity(community._id, 'member_role_updated', {
      communityId: String(community._id),
      userId: String(targetEntry.userId?._id ?? targetEntry.userId),
      role: newRole
    });

    res.status(200).json({
      message: `Role updated to ${newRole}.`,
      userId: String(targetEntry.userId?._id ?? targetEntry.userId),
      newRole
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/communities/:id/members/:userId ────────────────────────────
const kickMember = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    const { role: actorRole } = requireCapability(
      community, req.user._id, CAP.KICK_MEMBERS,
      'You need the Admin or Owner role to kick members.'
    );

    const targetId = String(req.params.userId);
    const targetEntry = community.members.find(
      (m) => String(m.userId?._id ?? m.userId) === targetId
    );
    if (!targetEntry) throw notFound('Target user is not a member of this server.');

    const permission = canKickCommunityMember(actorRole, targetEntry.role, {
      self: targetId === String(req.user._id)
    });
    if (!permission.ok) throw forbidden(permission.reason);

    community.members = community.members.filter(
      (m) => String(m.userId?._id ?? m.userId) !== targetId
    );
    await community.save();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'MEMBER_KICK',
      targetId: targetEntry.userId,
      targetModel: 'User',
      metadata: { role: targetEntry.role }
    });

    evictUserFromCommunity(targetId, community._id);
    emitToCommunity(community._id, 'member_kicked', {
      communityId: String(community._id),
      userId: targetId,
      memberCount: community.members.length
    });

    res.status(200).json({ message: 'Member removed.', userId: targetId });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/communities/:id ─────────────────────────────────────────────
// Server settings (owner only — "minimum set of maintenance roles")
const updateCommunity = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(
      community, req.user._id, CAP.MANAGE_SERVER,
      'Only the owner can change server settings.'
    );

    const changes = {};

    if (req.body.name !== undefined) {
      const name = sanitizeLine(req.body.name, CHAT_POLICY.community.maxNameLength);
      if (name.length < CHAT_POLICY.community.minNameLength) {
        throw badRequest(`Community name must be at least ${CHAT_POLICY.community.minNameLength} characters.`);
      }
      changes.name = name;
    }
    if (req.body.description !== undefined) {
      changes.description = sanitizeLine(req.body.description, CHAT_POLICY.community.maxDescriptionLength);
    }
    if (req.body.icon !== undefined) {
      changes.icon = sanitizeLine(req.body.icon, 100) || '🎮';
    }
    if (req.body.isPrivate !== undefined) {
      changes.isPrivate = !!req.body.isPrivate;
    }

    if (!Object.keys(changes).length) throw badRequest('No updatable fields provided.');

    Object.assign(community, changes);
    await community.save();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'SETTINGS_UPDATE',
      targetId: community._id,
      targetModel: 'Community',
      metadata: { changes: Object.keys(changes) }
    });

    emitToCommunity(community._id, 'community_updated', {
      communityId: String(community._id),
      settingsChanged: true
    });

    res.status(200).json(community);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/communities/:id ────────────────────────────────────────────
const deleteCommunity = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    if (String(community.ownerId) !== String(req.user._id)) {
      throw forbidden('Only the server owner can delete this server.');
    }

    emitToCommunity(community._id, 'community_deleted', {
      communityId: String(community._id)
    });

    await Message.deleteMany({ communityId: community._id });
    await Channel.deleteMany({ communityId: community._id });
    await AuditLog.deleteMany({ communityId: community._id });
    await community.deleteOne();

    res.status(200).json({ message: 'Community deleted.' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/channels ─────────────────────────────────────
const createChannel = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(
      community, req.user._id, CAP.MANAGE_CHANNELS,
      'Only Admins and Owners can create channels.'
    );

    const name = channelName(req.body.name);
    if (!name || !CHAT_POLICY.channels.namePattern.test(name)) {
      throw badRequest('Channel name must use lowercase letters, numbers, and hyphens only.');
    }

    const channelCount = await Channel.countDocuments({ communityId: community._id });
    if (channelCount >= CHAT_POLICY.channels.maxPerCommunity) {
      throw conflict(`A server can have at most ${CHAT_POLICY.channels.maxPerCommunity} channels.`);
    }

    const rawRead = sanitizeLine(req.body.minRoleToRead, 20) || 'member';
    const rawWrite = sanitizeLine(req.body.minRoleToWrite, 20) || 'member';
    if (!COMMUNITY_ROLES.includes(rawRead) || !COMMUNITY_ROLES.includes(rawWrite)) {
      throw badRequest('Channel role gates must be member, moderator, admin or owner.');
    }
    // A channel you cannot read must never be writable.
    const minRoleToRead = rawRead;
    const minRoleToWrite = roleLevel(rawWrite) < roleLevel(rawRead) ? rawRead : rawWrite;

    const channel = await Channel.create({
      communityId: community._id,
      name,
      topic: sanitizeLine(req.body.topic, CHAT_POLICY.channels.maxTopicLength),
      type: ['text', 'announcement'].includes(req.body.type) ? req.body.type : 'text',
      position: Number.isFinite(Number(req.body.position)) ? Number(req.body.position) : channelCount,
      minRoleToRead: minRoleToRead,
      minRoleToWrite: minRoleToWrite,
      slowModeSeconds: Math.min(
        Math.max(Number(req.body.slowModeSeconds) || 0, CHAT_POLICY.slowmode.minSeconds),
        CHAT_POLICY.slowmode.maxSeconds
      ),
      retentionDays: Math.min(
        Math.max(Number(req.body.retentionDays) || 0, CHAT_POLICY.retention.minDays),
        CHAT_POLICY.retention.maxDays
      ),
      isProtected: !!req.body.isProtected
    });

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'CHANNEL_CREATE',
      targetId: channel._id,
      targetModel: 'Channel',
      metadata: { name: channel.name, type: channel.type }
    });

    emitToCommunity(community._id, 'channel_created', channel.toObject());

    res.status(201).json(channel);
  } catch (err) {
    if (err.code === 11000) {
      return next(conflict('A channel with that name already exists in this server.'));
    }
    next(err);
  }
};

// ─── PATCH /api/communities/:id/channels/:channelId ─────────────────────────
const updateChannel = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(
      community, req.user._id, CAP.MANAGE_CHANNELS,
      'Only Admins and Owners can change channels.'
    );

    if (!mongoose.Types.ObjectId.isValid(String(req.params.channelId))) {
      throw badRequest('Invalid channel id');
    }
    const channel = await Channel.findOne({
      _id: req.params.channelId,
      communityId: community._id
    });
    if (!channel) throw notFound('Channel not found.');

    const updates = {};

    if (req.body.topic !== undefined) {
      updates.topic = sanitizeLine(req.body.topic, CHAT_POLICY.channels.maxTopicLength);
    }
    if (req.body.type !== undefined) {
      if (!['text', 'announcement'].includes(req.body.type)) throw badRequest('Invalid channel type.');
      updates.type = req.body.type;
    }
    if (req.body.minRoleToRead !== undefined) {
      if (!COMMUNITY_ROLES.includes(req.body.minRoleToRead)) throw badRequest('Invalid read role gate.');
      updates.minRoleToRead = req.body.minRoleToRead;
    }
    if (req.body.minRoleToWrite !== undefined) {
      if (!COMMUNITY_ROLES.includes(req.body.minRoleToWrite)) throw badRequest('Invalid write role gate.');
      updates.minRoleToWrite = req.body.minRoleToWrite;
    }
    if (req.body.slowModeSeconds !== undefined) {
      const value = Number(req.body.slowModeSeconds);
      if (!Number.isFinite(value) || value < CHAT_POLICY.slowmode.minSeconds || value > CHAT_POLICY.slowmode.maxSeconds) {
        throw badRequest(`Slowmode must be between ${CHAT_POLICY.slowmode.minSeconds} and ${CHAT_POLICY.slowmode.maxSeconds} seconds.`);
      }
      updates.slowModeSeconds = Math.trunc(value);
    }
    if (req.body.retentionDays !== undefined) {
      const value = Number(req.body.retentionDays);
      if (!Number.isFinite(value) || value < CHAT_POLICY.retention.minDays || value > CHAT_POLICY.retention.maxDays) {
        throw badRequest(`Retention must be between ${CHAT_POLICY.retention.minDays} and ${CHAT_POLICY.retention.maxDays} days.`);
      }
      updates.retentionDays = Math.trunc(value);
    }
    if (req.body.isProtected !== undefined) updates.isProtected = !!req.body.isProtected;

    // Keep the read/write gates coherent.
    const readRole = updates.minRoleToRead ?? channel.minRoleToRead;
    const writeRole = updates.minRoleToWrite ?? channel.minRoleToWrite;
    if (roleLevel(writeRole) < roleLevel(readRole)) {
      updates.minRoleToWrite = readRole;
    }

    if (!Object.keys(updates).length) throw badRequest('No updatable fields provided.');

    Object.assign(channel, updates);
    await channel.save();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'CHANNEL_UPDATE',
      targetId: channel._id,
      targetModel: 'Channel',
      metadata: { fields: Object.keys(updates) }
    });

    emitToCommunity(community._id, 'channel_updated', channel.toObject());
    emitToChannel(channel._id, 'channel_updated', channel.toObject());

    res.status(200).json(channel);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/communities/:id/channels/:channelId ────────────────────────
const deleteChannel = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(
      community, req.user._id, CAP.MANAGE_CHANNELS,
      'Only Admins and Owners can delete channels.'
    );

    if (!mongoose.Types.ObjectId.isValid(String(req.params.channelId))) {
      throw badRequest('Invalid channel id');
    }
    const channel = await Channel.findOne({
      _id: req.params.channelId,
      communityId: community._id
    });
    if (!channel) throw notFound('Channel not found.');

    const channelCount = await Channel.countDocuments({ communityId: community._id });
    if (channelCount <= 1) {
      throw badRequest('A server must keep at least one channel.');
    }

    await Message.deleteMany({ channelId: channel._id });
    await channel.deleteOne();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'CHANNEL_DELETE',
      targetId: channel._id,
      targetModel: 'Channel',
      metadata: { name: channel.name }
    });

    emitToCommunity(community._id, 'channel_deleted', {
      communityId: String(community._id),
      channelId: String(channel._id)
    });

    res.status(200).json({ message: 'Channel deleted.', channelId: String(channel._id) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/channels/:channelId/messages ──────────────────────
const getChannelMessages = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.channelId))) {
      throw badRequest('Invalid channel id');
    }
    const channel = await Channel.findById(req.params.channelId).lean();
    if (!channel) throw notFound('Channel not found.');

    const community = await Community.findById(channel.communityId).lean();
    if (!community) throw notFound('Community not found.');

    const { role, permissions } = communityPermissions(community, req.user?._id);
    if (!permissions.includes(CAP.VIEW_CHANNEL) || !roleAtLeast(role, channel.minRoleToRead)) {
      throw forbidden('You do not have permission to read this channel.');
    }

    const { limit } = parsePagination(req.query, {
      defaultLimit: CHAT_POLICY.history.defaultLimit,
      maxLimit: CHAT_POLICY.history.maxLimit
    });

    const query = { channelId: channel._id };
    if (req.query.before) {
      if (!mongoose.Types.ObjectId.isValid(String(req.query.before))) {
        throw badRequest('Invalid cursor');
      }
      query._id = { $lt: req.query.before };
    }

    const messages = await Message.find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .populate('senderId', 'username level role medals')
      .lean();

    const hasMore = messages.length === limit;

    // Attach each sender's server role (platform role stays on senderId.role).
    const roleByUser = new Map(
      (community.members || []).map((m) => [String(m.userId?._id ?? m.userId), m.role])
    );
    const decorated = messages.reverse().map((message) => ({
      ...message,
      communityRole: roleByUser.get(String(message.senderId?._id ?? message.senderId)) || null
    }));

    res.status(200).json({ messages: decorated, hasMore });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:id/audit ─────────────────────────────────────────
const getAuditLog = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(
      community, req.user._id, CAP.VIEW_AUDIT_LOG,
      'Only Admins and Owners can view the audit log.'
    );

    const { limit } = parsePagination(req.query, {
      defaultLimit: CHAT_POLICY.audit.defaultLimit,
      maxLimit: CHAT_POLICY.audit.maxLimit
    });

    const query = { communityId: community._id };
    if (req.query.before) {
      if (!mongoose.Types.ObjectId.isValid(String(req.query.before))) {
        throw badRequest('Invalid cursor');
      }
      query._id = { $lt: req.query.before };
    }

    const entries = await AuditLog.find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .populate('actorId', 'username role')
      .lean();

    res.status(200).json({ entries, hasMore: entries.length === limit });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createCommunity,
  getCommunities,
  getCommunityBySlug,
  getCommunityMembers,
  joinCommunity,
  leaveCommunity,
  addMember,
  updateMemberRole,
  kickMember,
  updateCommunity,
  deleteCommunity,
  createChannel,
  updateChannel,
  deleteChannel,
  getChannelMessages,
  getAuditLog
};
