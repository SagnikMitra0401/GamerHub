const mongoose = require('mongoose');

const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Community = require('../models/Community');
const Party = require('../models/Party');
const Invitation = require('../models/Invitation');
const Notification = require('../models/Notification');
const SquadChat = require('../models/SquadChat');
const SquadChatMessage = require('../models/SquadChatMessage');

const generateToken = require('../utils/generateToken');
const { clearAuthCookie } = require('./authController');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { idOf, isBlockedBetween } = require('../utils/privacy');
const { disconnectUser } = require('../config/socket');

const DELETION_GRACE_DAYS = 30;
const EXPORT_ROW_LIMIT = 5000;

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

/** Public summary of the account's privacy surface. */
const getAccount = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('username email profileType status privacySettings blockedUsers deletionRequestedAt sessionVersion createdAt')
      .lean();
    if (!user) throw notFound('User not found');

    const blocked = await User.find({ _id: { $in: user.blockedUsers || [] } })
      .select('username level')
      .lean();

    res.status(200).json({
      status: user.status,
      profileType: user.profileType,
      privacySettings: user.privacySettings,
      deletionRequestedAt: user.deletionRequestedAt,
      deletionGraceDays: DELETION_GRACE_DAYS,
      blockedUsers: blocked.map((u) => ({ _id: String(u._id), username: u.username, level: u.level }))
    });
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/users/privacy-settings */
const updatePrivacySettings = async (req, res, next) => {
  try {
    const { sanitizePrivacyPatch } = require('../utils/privacy');
    const { ok, value, errors } = sanitizePrivacyPatch(req.body);
    if (!ok) throw badRequest(errors[0], { details: errors });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: Object.fromEntries(Object.entries(value).map(([k, v]) => [`privacySettings.${k}`, v])) },
      { new: true, runValidators: true, select: 'privacySettings' }
    ).lean();

    res.status(200).json({ privacySettings: user.privacySettings });
  } catch (err) {
    next(err);
  }
};

/** POST /api/account/block/:userId */
const blockUser = async (req, res, next) => {
  try {
    const targetId = String(req.params.userId || '');
    if (!isId(targetId)) throw badRequest('Invalid user id');
    if (targetId === String(req.user._id)) throw badRequest('You cannot block yourself');

    const target = await User.findById(targetId).select('_id').lean();
    if (!target) throw notFound('User not found');

    // Blocking also drops the follow edges both ways: a blocked account must
    // not keep appearing in a feed because of an old follow.
    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { blockedUsers: target._id }, $pull: { following: target._id, followers: target._id } }
    );
    await User.updateOne(
      { _id: target._id },
      { $pull: { followers: req.user._id, following: req.user._id } }
    );

    res.status(200).json({ blocked: true, userId: targetId });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/account/block/:userId */
const unblockUser = async (req, res, next) => {
  try {
    const targetId = String(req.params.userId || '');
    if (!isId(targetId)) throw badRequest('Invalid user id');

    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: targetId } });
    res.status(200).json({ blocked: false, userId: targetId });
  } catch (err) {
    next(err);
  }
};

/** GET /api/account/blocked */
const listBlocked = async (req, res, next) => {
  try {
    const me = await User.findById(req.user._id).select('blockedUsers').lean();
    const users = await User.find({ _id: { $in: me?.blockedUsers || [] } })
      .select('username level')
      .lean();

    res.status(200).json({
      items: users.map((u) => ({ _id: String(u._id), username: u.username, level: u.level }))
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/account/data-export
 *
 * Everything the platform holds about the caller, and nothing about anybody
 * else: other people appear only as ids/usernames where the caller's own record
 * genuinely references them.
 */
const exportData = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const [user, posts, comments, communities, parties, chats, messages, sentInvites, receivedInvites, notifications] =
      await Promise.all([
        User.findById(userId).select('-passwordHash -__v').lean(),
        Post.find({ userId }).select('title content tags createdAt updatedAt').limit(EXPORT_ROW_LIMIT).lean(),
        Comment.find({ userId }).select('postId text createdAt').limit(EXPORT_ROW_LIMIT).lean(),
        Community.find({ 'members.userId': userId })
          .select('name slug members.$ createdAt')
          .limit(200)
          .lean(),
        Party.find({ $or: [{ leaderId: userId }, { 'members.userId': userId }] })
          .select('gameTitle activity status state maxSlots members createdAt')
          .limit(500)
          .lean(),
        SquadChat.find({ $or: [{ ownerUserId: userId }, { memberIds: userId }] })
          .select('squadId state expiresAt createdAt')
          .limit(200)
          .lean(),
        SquadChatMessage.find({ authorUserId: userId })
          .select('chatId squadId text createdAt isDeleted')
          .limit(EXPORT_ROW_LIMIT)
          .lean(),
        Invitation.find({ inviterUserId: userId })
          .select('recipientUserId targetType targetId status message createdAt')
          .limit(500)
          .lean(),
        Invitation.find({ recipientUserId: userId })
          .select('inviterUserId targetType targetId status message createdAt')
          .limit(500)
          .lean(),
        Notification.find({ userId })
          .select('type title message actionUrl createdAt read')
          .limit(1000)
          .lean()
      ]);

    const blockedIds = (user?.blockedUsers || []).map(String);
    const blockedUsers = await User.find({ _id: { $in: blockedIds } })
      .select('username')
      .lean();

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      account: {
        id: String(user?._id || userId),
        username: user?.username,
        email: user?.email,
        profileType: user?.profileType,
        status: user?.status,
        bio: user?.bio,
        preferredPlatforms: user?.preferredPlatforms,
        createdAt: user?.createdAt,
        gamerPassport: user?.gamerPassport,
        preferences: user?.preferences,
        privacySettings: user?.privacySettings,
        sessionVersion: user?.sessionVersion,
        deletionRequestedAt: user?.deletionRequestedAt
      },
      social: {
        following: (user?.following || []).map(String),
        followers: (user?.followers || []).map(String),
        savedPostIds: (user?.savedPosts || []).map(String),
        favouriteChannels: user?.favoriteChannels || [],
        blockedUsers: blockedUsers.map((u) => ({ id: String(u._id), username: u.username })),
        posts,
        comments
      },
      communities: communities.map((community) => ({
        id: String(community._id),
        name: community.name,
        slug: community.slug,
        role: community.members?.[0]?.role || null,
        joinedAt: community.members?.[0]?.joinedAt || null
      })),
      squads: {
        parties: parties.map((party) => ({
          id: String(party._id),
          gameTitle: party.gameTitle,
          activity: party.activity,
          status: party.status,
          state: party.state,
          maxSlots: party.maxSlots,
          createdAt: party.createdAt
        })),
        chats: chats.map((chat) => ({
          id: String(chat._id),
          squadId: String(chat.squadId),
          state: chat.state,
          expiresAt: chat.expiresAt,
          createdAt: chat.createdAt
        })),
        messages
      },
      invitations: { sent: sentInvites, received: receivedInvites },
      notifications
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gamerhub-export-${String(user?.username || 'account')}.json"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/account/deletion-request
 *
 * Schedules erasure, revokes every session and drops every live socket. The
 * account stays readable (so the owner can cancel) until the grace period ends.
 */
const requestDeletion = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('status deletionRequestedAt sessionVersion').lean();
    if (!user) throw notFound('User not found');

    if (user.status === 'deletion_pending' && user.deletionRequestedAt) {
      return res.status(200).json({
        status: 'deletion_pending',
        deletionRequestedAt: user.deletionRequestedAt,
        graceDays: DELETION_GRACE_DAYS
      });
    }
    if (user.status === 'deleted') throw conflict('This account has already been deleted');

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: { status: 'deletion_pending', deletionRequestedAt: new Date() },
        $inc: { sessionVersion: 1 }
      },
      { new: true, select: 'status deletionRequestedAt' }
    ).lean();

    clearAuthCookie(res);
    disconnectUser(req.user._id);

    res.status(200).json({
      status: updated.status,
      deletionRequestedAt: updated.deletionRequestedAt,
      graceDays: DELETION_GRACE_DAYS
    });
  } catch (err) {
    next(err);
  }
};

/** POST /api/account/deletion-cancel — change of mind inside the grace period. */
const cancelDeletion = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('status deletionRequestedAt sessionVersion').lean();
    if (!user) throw notFound('User not found');
    if (user.status === 'deleted') throw conflict('This account has already been deleted');

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { status: 'active', deletionRequestedAt: null } },
      { new: true, select: 'status sessionVersion' }
    ).lean();

    // The deletion request invalidated the old cookie; issue a fresh one so the
    // owner is not bounced to the login page after cancelling.
    const token = generateToken(res, req.user._id, updated.sessionVersion);
    res.status(200).json({ status: updated.status, token });
  } catch (err) {
    next(err);
  }
};

/** Shared helper used by the invitation controller (symmetric block check). */
const isBlockedPair = (a, b) => isBlockedBetween(a, b);

module.exports = {
  DELETION_GRACE_DAYS,
  getAccount,
  updatePrivacySettings,
  blockUser,
  unblockUser,
  listBlocked,
  exportData,
  requestDeletion,
  cancelDeletion,
  isBlockedPair,
  idOf
};
