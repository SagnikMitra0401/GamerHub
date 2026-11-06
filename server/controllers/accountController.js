const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Community = require('../models/Community');
const Party = require('../models/Party');
const Invitation = require('../models/Invitation');
const Notification = require('../models/Notification');
const SquadChat = require('../models/SquadChat');
const SquadChatMessage = require('../models/SquadChatMessage');
const Conversation = require('../models/Conversation');

const generateToken = require('../utils/generateToken');
const { normalizeUsername, usernameFilter } = require('../utils/username');
const { planSuccessionForUser } = require('../utils/succession');
const { eraseAccount } = require('../utils/accountErasure');
const { clearAuthCookie } = require('./authController');
const { badRequest, notFound, conflict, forbidden } = require('../utils/httpError');
const { idOf, isBlockedBetween } = require('../utils/privacy');
const { normalizeDmSettings, sanitizeDmSettingsPatch, REQUEST_LIMITS, DAY_MS } = require('../utils/dmPolicy');
const { disconnectUser, getIO, setUserFrozenState } = require('../config/socket');
const { invalidateVisibility } = require('../utils/visibility');

const DELETION_GRACE_DAYS = 30;
const EXPORT_ROW_LIMIT = 5000;

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

/** Public summary of the account's privacy surface. */
const getAccount = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select(
        'username email profileType status privacySettings dmSettings blockedUsers deletionRequestedAt ' +
        'createdAt authIdentities hasLocalPassword frozenAt feedResetAt preferences favoriteChannels'
      )
      .lean();
    if (!user) throw notFound('User not found');

    const blocked = await User.find({ _id: { $in: user.blockedUsers || [] } })
      .select('username level')
      .lean();

    res.status(200).json({
      username: user.username,
      email: user.email,
      status: user.status,
      profileType: user.profileType,
      createdAt: user.createdAt,
      hasLocalPassword: user.hasLocalPassword !== false,
      frozenAt: user.frozenAt,
      feedResetAt: user.feedResetAt,
      providers: [...new Set((user.authIdentities || []).map((identity) => identity.provider))],
      privacySettings: user.privacySettings,
      dmSettings: normalizeDmSettings(user.dmSettings),
      deletionRequestedAt: user.deletionRequestedAt,
      deletionGraceDays: DELETION_GRACE_DAYS,
      blockedUsers: blocked.map((u) => ({ _id: String(u._id), username: u.username, level: u.level })),
      feedSignals: {
        favoriteGames: (user.preferences?.favoriteGames || []).length,
        favoriteGenres: (user.preferences?.favoriteGenres || []).length,
        favoriteChannels: (user.favoriteChannels || []).length,
        platforms: user.preferences?.platforms || []
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/account/dm-settings
 *
 * Partial patch: only the matrix rows the client actually sent are written, so
 * an older client cannot reset rows it does not know about.
 */
const updateDmSettings = async (req, res, next) => {
  try {
    const parsed = sanitizeDmSettingsPatch(req.body);
    if (!parsed.ok) throw badRequest(parsed.errors[0]);

    const update = {};
    for (const [context, mode] of Object.entries(parsed.value.policy || {})) {
      update[`dmSettings.policy.${context}`] = mode;
    }
    if (parsed.value.digest !== undefined) update['dmSettings.digest'] = parsed.value.digest;
    if (parsed.value.readReceipts !== undefined) {
      update['dmSettings.readReceipts'] = parsed.value.readReceipts;
    }
    if (parsed.value.hiddenWords !== undefined) {
      update['dmSettings.hiddenWords'] = parsed.value.hiddenWords;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: update },
      { new: true, runValidators: true }
    )
      .select('dmSettings')
      .lean();
    if (!user) throw notFound('User not found');

    res.status(200).json({ dmSettings: normalizeDmSettings(user.dmSettings) });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/account/username
 *
 * Only the handle changes: `_id` stays put, so posts, follows and audit rows
 * keep pointing at the same account. The old handle becomes free immediately.
 */
const changeUsername = async (req, res, next) => {
  try {
    const parsed = normalizeUsername(req.body?.username);
    if (!parsed.ok) throw badRequest(parsed.reason);

    const me = await User.findById(req.user._id).select('username').lean();
    if (!me) throw notFound('User not found');
    if (me.username === parsed.value) {
      throw badRequest('That is already your username.');
    }

    const taken = await User.findOne(usernameFilter(parsed.value, req.user._id))
      .select('_id')
      .lean();
    if (taken) throw conflict('That username is already taken.');

    let updated;
    try {
      updated = await User.findByIdAndUpdate(
        req.user._id,
        { $set: { username: parsed.value } },
        { new: true, runValidators: true, projection: { username: 1 } }
      ).lean();
    } catch (err) {
      // The unique index is the final arbiter under a race.
      if (err.code === 11000) throw conflict('That username is already taken.');
      throw err;
    }

    // Snapshots exist because squad chat lives on its own connection and cannot
    // populate the identity model. A rename must not leave stale names there.
    await Promise.all([
      SquadChat.updateMany({ ownerUserId: req.user._id }, { $set: { ownerUsername: updated.username } }),
      SquadChatMessage.updateMany(
        { authorUserId: req.user._id },
        { $set: { authorUsername: updated.username } }
      )
    ]);

    res.status(200).json({ username: updated.username });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/account/feed-reset
 *
 * Restores the "For You" baseline. The ranker reads three affinity lists; those
 * are exactly what is cleared. Platform preference and follows are social data,
 * not ranking signals, so they are kept.
 */
const resetFeedRecommendations = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('preferences favoriteChannels')
      .lean();
    if (!user) throw notFound('User not found');

    const cleared = {
      favoriteGames: (user.preferences?.favoriteGames || []).length,
      favoriteGenres: (user.preferences?.favoriteGenres || []).length,
      favoriteChannels: (user.favoriteChannels || []).length
    };
    const resetAt = new Date();

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          'preferences.favoriteGames': [],
          'preferences.favoriteGenres': [],
          favoriteChannels: [],
          feedResetAt: resetAt
        }
      }
    );

    res.status(200).json({
      feedResetAt: resetAt,
      cleared,
      kept: { platforms: user.preferences?.platforms || [] }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Confirm a destructive action with the credential the account actually has.
 * Google-only accounts never set a password, so they confirm by typing their
 * exact username instead of a password they could not know.
 */
async function verifyOwner(req, body = {}, { requireConfirm = false } = {}) {
  const user = await User.findById(req.user._id)
    .select('_id username passwordHash hasLocalPassword status')
    .lean();
  if (!user) throw notFound('User not found');

  if (requireConfirm) {
    const typed = String(body.confirmUsername || '').trim();
    if (!typed || typed.toLowerCase() !== String(user.username).toLowerCase()) {
      throw badRequest('Type your username exactly to confirm.');
    }
  }

  if (user.hasLocalPassword !== false) {
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) throw badRequest('Enter your password to continue.');
    const matches = await bcrypt.compare(password, user.passwordHash).catch(() => false);
    if (!matches) throw forbidden('That password is not correct.');
  }

  return user;
}

/**
 * POST /api/account/freeze  { frozen, password?, confirmUsername? }
 *
 * Self-service stealth mode: while frozen the account can still sign in and
 * read (so it can be unfrozen), but its posts disappear from feeds, search and
 * profiles, its presence reads offline, and participation is refused by the
 * active-account guard.
 */
const setFreeze = async (req, res, next) => {
  try {
    const frozen = req.body?.frozen;
    if (typeof frozen !== 'boolean') throw badRequest('frozen must be true or false.');

    const user = await verifyOwner(req, req.body || {});

    if (['deleted', 'suspended', 'restricted'].includes(user.status)) {
      throw conflict('This account cannot be frozen.');
    }
    if (user.status === 'deletion_pending') {
      throw conflict('Cancel the scheduled deletion before freezing your account.');
    }
    if (frozen && user.status === 'frozen') {
      return res.status(200).json({ status: 'frozen', frozenAt: null });
    }
    if (!frozen && user.status !== 'frozen') {
      return res.status(200).json({ status: user.status, frozenAt: null });
    }

    const update = frozen
      ? {
          $set: {
            status: 'frozen',
            frozenAt: new Date(),
            'presence.status': 'offline',
            'presence.activeGame': ''
          }
        }
      : {
          $set: {
            status: 'active',
            frozenAt: null,
            'presence.lastActive': new Date()
          }
        };

    const updated = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      select: 'status frozenAt'
    }).lean();

    // Live sockets keep the status they saw at handshake; flip it in place so
    // the next message is refused without a per-message database read.
    setUserFrozenState(req.user._id, frozen);

    // The search visibility cache must not keep serving a profile that just
    // went into stealth mode (or one that just came back).
    invalidateVisibility();

    if (frozen) {
      getIO()?.emit('presence_change', {
        userId: String(req.user._id),
        username: user.username,
        status: 'offline',
        activeGame: ''
      });
    }

    res.status(200).json({ status: updated.status, frozenAt: updated.frozenAt });
  } catch (err) {
    next(err);
  }
};

/** GET /api/account/succession-preview — who inherits each server/squad. */
const getSuccessionPreview = async (req, res, next) => {
  try {
    res.status(200).json(await planSuccessionForUser(req.user._id));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/account/delete-now
 *
 * Immediate, password-confirmed erasure. Ownership transfers first, then the
 * account is anonymised and its personal content removed. Because the email is
 * released, signing up again with it creates a genuinely fresh account.
 */
const deleteAccountNow = async (req, res, next) => {
  try {
    const user = await verifyOwner(req, req.body || {}, { requireConfirm: true });
    if (user.status === 'deleted') throw conflict('This account has already been deleted.');

    const result = await eraseAccount(user);
    if (!result.erased) throw conflict('This account could not be deleted right now.');

    clearAuthCookie(res);
    disconnectUser(req.user._id);

    res.status(200).json({
      deleted: true,
      succession: result.succession
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

    // A block is also a conversation decision: stop delivery both ways and
    // leave a cooldown so unblocking cannot be used to instantly resume.
    await Conversation.updateMany(
      {
        participantIds: { $all: [req.user._id, target._id] },
        state: { $in: ['request', 'active'] }
      },
      {
        $set: {
          state: 'blocked',
          blockedBy: req.user._id,
          blockedAt: new Date(),
          retryAfter: new Date(Date.now() + REQUEST_LIMITS.cooldownDays * DAY_MS)
        }
      }
    );

    invalidateVisibility();
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
    await Conversation.updateMany(
      { participantIds: { $all: [req.user._id, targetId] }, state: 'blocked' },
      {
        $set: {
          state: 'declined',
          declinedAt: new Date(),
          retryAfter: new Date(Date.now() + REQUEST_LIMITS.cooldownDays * DAY_MS)
        }
      }
    );
    invalidateVisibility();
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
 * Succession is applied by the sweep at erasure time, not here.
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
  updateDmSettings,
  changeUsername,
  resetFeedRecommendations,
  setFreeze,
  getSuccessionPreview,
  deleteAccountNow,
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
