const Community = require('../models/Community');
const Channel   = require('../models/Channel');
const Message   = require('../models/Message');
const AuditLog  = require('../models/AuditLog');

// ─── Utility ────────────────────────────────────────────────────────────────
function makeSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

// ─── POST /api/communities ───────────────────────────────────────────────────
// Create a community + auto-generate #general channel
const createCommunity = async (req, res, next) => {
  try {
    const { name, description, icon, isPrivate } = req.body;

    if (!name || name.trim().length < 3) {
      return res.status(400).json({ message: 'Community name must be at least 3 characters.' });
    }

    const rawSlug = makeSlug(name.trim());
    // Ensure slug uniqueness by appending a short random suffix if needed
    let slug = rawSlug;
    const exists = await Community.findOne({ slug });
    if (exists) slug = `${rawSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const community = await Community.create({
      name:        name.trim().slice(0, 40),
      slug,
      description: (description || '').trim().slice(0, 200),
      icon:        (icon || '🎮').trim().slice(0, 100),
      isPrivate:   !!isPrivate,
      ownerId:     req.user._id,
      members:     [{ userId: req.user._id, role: 'owner' }]
    });

    // Auto-create a #general text channel
    await Channel.create({
      communityId: community._id,
      name:        'general',
      topic:       'General chat for everyone',
      type:        'text',
      position:    0
    });

    res.status(201).json(community);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities ────────────────────────────────────────────────────
// List all public communities + communities the caller is a member of
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

    res.status(200).json(communities);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:slug ──────────────────────────────────────────────
// Get single community with its channels + caller's role
const getCommunityBySlug = async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: req.params.slug })
      .populate('ownerId', 'username level role')
      .populate('members.userId', 'username level role')
      .lean();

    if (!community) return res.status(404).json({ message: 'Community not found.' });

    // Private community: non-members cannot view it
    if (community.isPrivate) {
      const isMember = community.members.some(
        m => req.user && m.userId.toString() === req.user._id.toString()
      );
      if (!isMember) return res.status(403).json({ message: 'This is a private community.' });
    }

    // Fetch channels the caller is allowed to read
    const allChannels = await Channel.find({ communityId: community._id }).sort({ position: 1 }).lean();

    // Determine caller's community role
    const memberEntry = req.user
      ? community.members.find(m => {
          const mUid = typeof m.userId === 'object' && m.userId._id ? m.userId._id : m.userId;
          return mUid?.toString() === req.user._id?.toString();
        })
      : null;
    const callerRole = memberEntry?.role || null;

    // Filter channels by minRoleToRead
    const ROLE_LEVELS = { member: 0, moderator: 1, admin: 2, owner: 3 };
    const visibleChannels = allChannels.filter(ch => {
      if (!callerRole) return ch.minRoleToRead === 'member'; // public
      return (ROLE_LEVELS[callerRole] ?? -1) >= (ROLE_LEVELS[ch.minRoleToRead] ?? 0);
    });

    res.status(200).json({ community, channels: visibleChannels, callerRole });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/join ─────────────────────────────────────────
const joinCommunity = async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: 'Community not found.' });

    const alreadyMember = community.members.some(
      m => m.userId.toString() === req.user._id.toString()
    );
    if (alreadyMember) return res.status(400).json({ message: 'Already a member.' });

    community.members.push({ userId: req.user._id, role: 'member' });
    await community.save();

    res.status(200).json({ message: 'Joined successfully.', role: 'member' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/leave ────────────────────────────────────────
const leaveCommunity = async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: 'Community not found.' });

    // Owner cannot leave — must transfer ownership or delete
    if (community.ownerId.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Community owner cannot leave. Transfer ownership or delete the community.' });
    }

    community.members = community.members.filter(
      m => m.userId.toString() !== req.user._id.toString()
    );
    await community.save();

    res.status(200).json({ message: 'Left community.' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/communities/:id/members/:userId/role ────────────────────────
// Admins/Owners can update member roles (cannot exceed their own level)
const updateMemberRole = async (req, res, next) => {
  try {
    const { newRole } = req.body;
    const VALID_ROLES  = ['member', 'moderator', 'admin'];
    const ROLE_LEVELS  = { member: 0, moderator: 1, admin: 2, owner: 3 };

    if (!VALID_ROLES.includes(newRole)) {
      return res.status(400).json({ message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: 'Community not found.' });

    const callerEntry = community.members.find(m => m.userId.toString() === req.user._id.toString());
    if (!callerEntry) return res.status(403).json({ message: 'You are not a member of this community.' });

    const callerLevel = ROLE_LEVELS[callerEntry.role] ?? -1;
    // Must be at least admin to manage roles
    if (callerLevel < ROLE_LEVELS.admin) {
      return res.status(403).json({ message: 'You need Admin or Owner role to manage member roles.' });
    }

    // Cannot assign a role equal to or above your own (non-owners can't assign admin)
    if (ROLE_LEVELS[newRole] >= callerLevel && callerEntry.role !== 'owner') {
      return res.status(403).json({ message: 'You cannot assign a role equal to or higher than your own.' });
    }

    const targetEntry = community.members.find(m => m.userId.toString() === req.params.userId);
    if (!targetEntry) return res.status(404).json({ message: 'Target user is not a member of this community.' });

    // Cannot demote the owner
    if (targetEntry.role === 'owner') {
      return res.status(403).json({ message: 'Cannot change the owner\'s role.' });
    }

    targetEntry.role = newRole;
    await community.save();

    // Record immutable audit log
    await AuditLog.create({
      communityId: community._id,
      actorId:     req.user._id,
      actionType:  'ROLE_UPDATE',
      targetId:    req.params.userId,
      targetModel: 'User',
      metadata:    { newRole }
    }).catch(err => console.error('[AuditLog Error]', err.message));

    res.status(200).json({ message: `Role updated to ${newRole}.`, userId: req.params.userId, newRole });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/channels ─────────────────────────────────────
// Admin+ can create channels
const createChannel = async (req, res, next) => {
  try {
    const { name, topic, type, minRoleToRead, minRoleToWrite, slowModeSeconds, retentionDays, isProtected } = req.body;
    const ROLE_LEVELS = { member: 0, moderator: 1, admin: 2, owner: 3 };

    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: 'Community not found.' });

    const callerEntry = community.members.find(m => m.userId.toString() === req.user._id.toString());
    const callerLevel = ROLE_LEVELS[callerEntry?.role] ?? -1;

    if (callerLevel < ROLE_LEVELS.admin) {
      return res.status(403).json({ message: 'Only Admins and Owners can create channels.' });
    }

    if (!name || !/^[a-z0-9-]+$/.test(name.trim().toLowerCase())) {
      return res.status(400).json({ message: 'Channel name must use lowercase letters, numbers, and hyphens only.' });
    }

    const channel = await Channel.create({
      communityId:     community._id,
      name:            name.trim().toLowerCase().slice(0, 40),
      topic:           (topic || '').trim().slice(0, 100),
      type:            ['text', 'announcement'].includes(type) ? type : 'text',
      minRoleToRead:   ['member', 'moderator', 'admin', 'owner'].includes(minRoleToRead) ? minRoleToRead : 'member',
      minRoleToWrite:  ['member', 'moderator', 'admin', 'owner'].includes(minRoleToWrite) ? minRoleToWrite : 'member',
      slowModeSeconds: Number(slowModeSeconds) || 0,
      retentionDays:   Number(retentionDays) || 0,
      isProtected:     !!isProtected
    });

    // Record audit log
    await AuditLog.create({
      communityId: community._id,
      actorId:     req.user._id,
      actionType:  'CHANNEL_CREATE',
      targetId:    channel._id,
      targetModel: 'Channel',
      metadata:    { name: channel.name, type: channel.type }
    }).catch(err => console.error('[AuditLog Error]', err.message));

    res.status(201).json(channel);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A channel with that name already exists in this community.' });
    }
    next(err);
  }
};

// ─── GET /api/channels/:channelId/messages ───────────────────────────────────
// Anti-scraping, cursor-supported message history
const getChannelMessages = async (req, res, next) => {
  try {
    const ROLE_LEVELS = { member: 0, moderator: 1, admin: 2, owner: 3 };
    const channel = await Channel.findById(req.params.channelId);
    if (!channel) return res.status(404).json({ message: 'Channel not found.' });

    const community = await Community.findById(channel.communityId);
    if (!community) return res.status(404).json({ message: 'Community not found.' });

    const callerEntry = req.user
      ? community.members.find(m => m.userId.toString() === req.user._id.toString())
      : null;
    const callerLevel = ROLE_LEVELS[callerEntry?.role] ?? -1;
    const minReadLevel = ROLE_LEVELS[channel.minRoleToRead] ?? 0;

    if (callerLevel < minReadLevel) {
      return res.status(403).json({ message: 'You do not have permission to read this channel.' });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 50));
    const query = { channelId: channel._id };

    // Anti-scraping cursor: if `before` ID provided, query messages older than that ID
    if (req.query.before) {
      query._id = { $lt: req.query.before };
    }

    const messages = await Message.find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .populate('senderId', 'username level role medals')
      .lean();

    // Return in chronological order
    res.status(200).json(messages.reverse());
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/communities/:id ────────────────────────────────────────────
// Only owner can delete community
const deleteCommunity = async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: 'Community not found.' });

    if (community.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the community owner can delete this community.' });
    }

    const channels = await Channel.find({ communityId: community._id }).select('_id').lean();
    const channelIds = channels.map(c => c._id);

    // Clean up channels and all messages in those channels
    await Message.deleteMany({ channelId: { $in: channelIds } });
    await Channel.deleteMany({ communityId: community._id });
    await community.deleteOne();

    res.status(200).json({ message: 'Community deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createCommunity,
  getCommunities,
  getCommunityBySlug,
  joinCommunity,
  leaveCommunity,
  updateMemberRole,
  createChannel,
  getChannelMessages,
  deleteCommunity
};
