/**
 * Server moderation: reports, timeouts, bans and personal mutes.
 *
 * Hierarchy rules live in utils/permissions.js (`canModerateMember`), so a
 * moderator can never act on a peer or the owner. Every state change is audited
 * and pushed to the affected user — a timeout or ban must take effect in an
 * already-open tab, not on the next page load.
 */
const mongoose = require('mongoose');

const Community = require('../models/Community');
const Message = require('../models/Message');
const ForumPost = require('../models/ForumPost');
const Report = require('../models/Report');
const User = require('../models/User');

const {
  CAP,
  communityPermissions,
  canModerateMember,
  canKickCommunityMember,
  resolveCommunityRole
} = require('../utils/permissions');
const { sanitizeLine } = require('../utils/sanitize');
const { recordAudit } = require('../utils/audit');
const { parsePagination } = require('../utils/pagination');
const { badRequest, forbidden, notFound, conflict } = require('../utils/httpError');
const { emitToCommunity, evictUserFromCommunity, getIO } = require('../config/socket');
const { createSlidingWindowLimiter } = require('../utils/rateLimiter');
const { REPORT_REASONS, REPORT_TARGETS } = require('../models/Report');

/** Report bombing guard: per reporter, per community, per hour. */
const reportLimiter = createSlidingWindowLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

/** Client picks a duration; the server owns the allowed set. */
const TIMEOUT_DURATIONS_MINUTES = Object.freeze([5, 10, 60, 1440]);

const memberIdOf = (entry) => String(entry?.userId?._id ?? entry?.userId);

async function loadCommunity(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw badRequest('Invalid community id');
  const community = await Community.findById(id);
  if (!community) throw notFound('Community not found.');
  return community;
}

function requireCapability(community, userId, capability, message) {
  const { role, permissions } = communityPermissions(community, userId);
  if (!permissions.includes(capability)) {
    throw forbidden(message || 'You do not have permission to do that.');
  }
  return { role, permissions };
}

/** Internal helper shared by the report target checks. */
async function targetExists(community, targetType, targetId) {
  if (targetType === 'message') {
    return Message.exists({ _id: targetId, communityId: community._id, isDeleted: false });
  }
  if (targetType === 'forumPost') {
    return ForumPost.exists({ _id: targetId, communityId: community._id, isDeleted: false });
  }
  const isMember = (community.members || []).some((member) => memberIdOf(member) === String(targetId));
  return isMember ? targetId : null;
}

// ─── POST /api/communities/:id/reports ──────────────────────────────────────
const createReport = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);

    // Only members can report inside a server; the response is deliberately
    // generic so a caller cannot probe for someone else's membership.
    if (!resolveCommunityRole(community, req.user._id)) {
      throw forbidden('Join this server to report content.');
    }

    const budget = reportLimiter.consume(`${req.user._id}:${community._id}`);
    if (!budget.allowed) {
      throw badRequest('You have sent several reports recently. Try again later.');
    }

    const targetType = sanitizeLine(req.body.targetType, 20);
    if (!REPORT_TARGETS.includes(targetType)) throw badRequest('Invalid report target type.');

    if (!mongoose.Types.ObjectId.isValid(String(req.body.targetId))) {
      throw badRequest('Invalid report target.');
    }
    const targetId = req.body.targetId;

    const reason = sanitizeLine(req.body.reason, 30).toLowerCase();
    if (!REPORT_REASONS.includes(reason)) throw badRequest('Choose a reason for the report.');

    if (targetType === 'member' && String(targetId) === String(req.user._id)) {
      throw badRequest('You cannot report yourself.');
    }

    const exists = await targetExists(community, targetType, targetId);
    if (!exists) throw notFound('That content is no longer available.');

    try {
      await Report.create({
        communityId: community._id,
        reporterId: req.user._id,
        targetType,
        targetId,
        reason,
        note: sanitizeLine(req.body.note, 300)
      });
    } catch (err) {
      // Duplicate report (same reporter + target) is a silent no-op.
      if (err.code !== 11000) throw err;
    }

    res.status(201).json({ message: 'Report received. A moderator will review it.' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:id/reports ───────────────────────────────────────
const listReports = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(community, req.user._id, CAP.VIEW_REPORTS, 'You do not have permission to view reports.');

    const status = sanitizeLine(req.query.status, 20) || 'open';
    if (!['open', 'reviewed', 'dismissed', 'all'].includes(status)) {
      throw badRequest('Invalid report status filter.');
    }

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25, maxLimit: 50 });
    const filter = { communityId: community._id };
    if (status !== 'all') filter.status = status;

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reporterId', 'username')
        .populate('reviewedBy', 'username')
        .lean(),
      Report.countDocuments(filter)
    ]);

    // One bulk lookup per target type keeps the queue at three queries.
    const messageIds = reports.filter((r) => r.targetType === 'message').map((r) => r.targetId);
    const forumIds = reports.filter((r) => r.targetType === 'forumPost').map((r) => r.targetId);
    const memberIds = reports.filter((r) => r.targetType === 'member').map((r) => r.targetId);

    const [messages, posts, members] = await Promise.all([
      messageIds.length
        ? Message.find({ _id: { $in: messageIds } }).select('text channelId senderId createdAt').lean()
        : [],
      forumIds.length
        ? ForumPost.find({ _id: { $in: forumIds } }).select('title status authorId createdAt').lean()
        : [],
      memberIds.length
        ? User.find({ _id: { $in: memberIds } }).select('username level').lean()
        : []
    ]);

    const messageById = new Map(messages.map((row) => [String(row._id), row]));
    const postById = new Map(posts.map((row) => [String(row._id), row]));
    const memberById = new Map(members.map((row) => [String(row._id), row]));

    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({
      reports: reports.map((report) => {
        const id = String(report.targetId);
        let preview = null;
        if (report.targetType === 'message') {
          const row = messageById.get(id);
          preview = row ? { text: row.text, channelId: row.channelId, createdAt: row.createdAt } : null;
        } else if (report.targetType === 'forumPost') {
          const row = postById.get(id);
          preview = row ? { title: row.title, status: row.status, createdAt: row.createdAt } : null;
        } else {
          const row = memberById.get(id);
          preview = row ? { username: row.username, level: row.level } : null;
        }
        return {
          ...report,
          reporter: report.reporterId
            ? { _id: report.reporterId._id, username: report.reporterId.username }
            : null,
          reporterId: undefined,
          reviewedBy: report.reviewedBy
            ? { _id: report.reviewedBy._id, username: report.reviewedBy.username }
            : null,
          targetPreview: preview
        };
      }),
      total,
      page,
      hasMore: skip + reports.length < total
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/communities/:id/reports/:reportId ───────────────────────────
const reviewReport = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(community, req.user._id, CAP.VIEW_REPORTS, 'You do not have permission to review reports.');

    const status = sanitizeLine(req.body.status, 20);
    if (!['reviewed', 'dismissed'].includes(status)) {
      throw badRequest('A report can only be marked reviewed or dismissed.');
    }

    const report = await Report.findOne({ _id: req.params.reportId, communityId: community._id });
    if (!report) throw notFound('Report not found.');

    report.status = status;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    report.reviewNote = sanitizeLine(req.body.note, 300);
    await report.save();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'REPORT_REVIEWED',
      targetId: report._id,
      targetModel: 'Report',
      metadata: { status, targetType: report.targetType }
    });

    res.status(200).json({ reportId: String(report._id), status: report.status });
  } catch (err) {
    next(err);
  }
};

// ─── POST / DELETE /api/communities/:id/members/:userId/timeout ─────────────
const setTimeout_ = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    const { role: actorRole } = requireCapability(
      community, req.user._id, CAP.TIMEOUT_MEMBERS,
      'You do not have permission to time members out.'
    );

    if (!mongoose.Types.ObjectId.isValid(String(req.params.userId))) {
      throw badRequest('Invalid user id');
    }

    const targetEntry = (community.members || []).find(
      (member) => memberIdOf(member) === String(req.params.userId)
    );
    if (!targetEntry) throw notFound('That user is not a member of this server.');

    const permission = canModerateMember(actorRole, targetEntry.role, {
      self: memberIdOf(targetEntry) === String(req.user._id)
    });
    if (!permission.ok) throw forbidden(permission.reason);

    const durationMinutes = Number(req.body.durationMinutes);
    if (!TIMEOUT_DURATIONS_MINUTES.includes(durationMinutes)) {
      throw badRequest(`Duration must be one of: ${TIMEOUT_DURATIONS_MINUTES.join(', ')} minutes.`);
    }

    const timeoutUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
    await Community.updateOne(
      { _id: community._id, 'members.userId': targetEntry.userId },
      { $set: { 'members.$.timeoutUntil': timeoutUntil } }
    );

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'MEMBER_TIMEOUT',
      targetId: targetEntry.userId,
      targetModel: 'User',
      metadata: { durationMinutes, timeoutUntil }
    });

    getIO()?.to(`user:${String(targetEntry.userId)}`).emit('member_timed_out', {
      communityId: String(community._id),
      timeoutUntil
    });
    emitToCommunity(community._id, 'member_timed_out', {
      communityId: String(community._id),
      userId: String(targetEntry.userId),
      timeoutUntil
    });

    res.status(200).json({ userId: String(targetEntry.userId), timeoutUntil });
  } catch (err) {
    next(err);
  }
};

const liftTimeout = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    const { role: actorRole } = requireCapability(
      community, req.user._id, CAP.TIMEOUT_MEMBERS,
      'You do not have permission to lift timeouts.'
    );

    const targetEntry = (community.members || []).find(
      (member) => memberIdOf(member) === String(req.params.userId)
    );
    if (!targetEntry) throw notFound('That user is not a member of this server.');

    const permission = canModerateMember(actorRole, targetEntry.role, {
      self: memberIdOf(targetEntry) === String(req.user._id)
    });
    if (!permission.ok) throw forbidden(permission.reason);

    await Community.updateOne(
      { _id: community._id, 'members.userId': targetEntry.userId },
      { $set: { 'members.$.timeoutUntil': null } }
    );

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'MEMBER_TIMEOUT_LIFT',
      targetId: targetEntry.userId,
      targetModel: 'User',
      metadata: {}
    });

    emitToCommunity(community._id, 'member_timeout_lifted', {
      communityId: String(community._id),
      userId: String(targetEntry.userId)
    });

    res.status(200).json({ userId: String(targetEntry.userId), timeoutUntil: null });
  } catch (err) {
    next(err);
  }
};

// ─── POST / DELETE /api/communities/:id/bans/:userId ────────────────────────
const banMember = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    const { role: actorRole } = requireCapability(
      community, req.user._id, CAP.KICK_MEMBERS,
      'You need the Admin or Owner role to ban members.'
    );

    const targetId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(targetId)) throw badRequest('Invalid user id');
    if (targetId === String(req.user._id)) throw badRequest('You cannot ban yourself.');

    const targetEntry = (community.members || []).find((member) => memberIdOf(member) === targetId);
    const targetRole = targetEntry?.role ?? 'member';

    const permission = canKickCommunityMember(actorRole, targetRole);
    if (!permission.ok) throw forbidden(permission.reason);

    const reason = sanitizeLine(req.body.reason, 200);

    const alreadyBanned = (community.bannedUsers || []).some(
      (ban) => memberIdOf(ban) === targetId
    );
    if (alreadyBanned) throw conflict('That user is already banned.');

    const memberId = targetEntry?.userId ?? targetId;
    // One update: the ban and the removal land together or not at all.
    await Community.updateOne(
      { _id: community._id },
      {
        $push: {
          bannedUsers: { userId: memberId, bannedBy: req.user._id, reason, bannedAt: new Date() }
        },
        $pull: { members: { userId: memberId } }
      }
    );

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'MEMBER_BAN',
      targetId: targetEntry?.userId ?? targetId,
      targetModel: 'User',
      metadata: { reason, previousRole: targetRole }
    });

    evictUserFromCommunity(targetId, community._id);
    emitToCommunity(community._id, 'member_banned', {
      communityId: String(community._id),
      userId: targetId
    });

    res.status(200).json({ message: 'Member banned.', userId: targetId });
  } catch (err) {
    next(err);
  }
};

const unbanMember = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(
      community, req.user._id, CAP.KICK_MEMBERS,
      'You need the Admin or Owner role to unban members.'
    );

    const targetId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(targetId)) throw badRequest('Invalid user id');

    const result = await Community.updateOne(
      { _id: community._id },
      { $pull: { bannedUsers: { userId: targetId } } }
    );
    if (!result.modifiedCount) throw notFound('That user is not banned.');

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'MEMBER_UNBAN',
      targetId,
      targetModel: 'User',
      metadata: {}
    });

    res.status(200).json({ message: 'Ban lifted.', userId: targetId });
  } catch (err) {
    next(err);
  }
};

const listBans = async (req, res, next) => {
  try {
    const community = await loadCommunity(req.params.id);
    requireCapability(
      community, req.user._id, CAP.KICK_MEMBERS,
      'You need the Admin or Owner role to view bans.'
    );

    const populated = await community.populate('bannedUsers.userId', 'username level');
    const bans = (populated.bannedUsers || [])
      .filter((ban) => ban.userId)
      .map((ban) => ({
        userId: ban.userId?._id || ban.userId,
        username: ban.userId?.username || 'Unknown',
        level: ban.userId?.level ?? 1,
        reason: ban.reason,
        bannedAt: ban.bannedAt
      }));

    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({ bans });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/users/:id/mute (personal, per-user) ──────────────────────────
const toggleMute = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) throw badRequest('Invalid user id');
    if (String(req.params.id) === String(req.user._id)) throw badRequest('You cannot mute yourself.');

    const target = await User.findById(req.params.id).select('_id username').lean();
    if (!target) throw notFound('User not found.');

    const me = await User.findById(req.user._id).select('mutedUsers').lean();
    const alreadyMuted = (me?.mutedUsers || []).some((id) => String(id) === String(target._id));

    await User.updateOne(
      { _id: req.user._id },
      alreadyMuted ? { $pull: { mutedUsers: target._id } } : { $addToSet: { mutedUsers: target._id } }
    );

    res.status(200).json({
      userId: String(target._id),
      muted: !alreadyMuted,
      mutedUsers: alreadyMuted
        ? (me.mutedUsers || []).map(String).filter((id) => id !== String(target._id))
        : [...(me?.mutedUsers || []).map(String), String(target._id)]
    });
  } catch (err) {
    next(err);
  }
};

const getMutedUsers = async (req, res, next) => {
  try {
    const me = await User.findById(req.user._id).select('mutedUsers').lean();
    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({ mutedUsers: (me?.mutedUsers || []).map(String) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createReport,
  listReports,
  reviewReport,
  setTimeout: setTimeout_,
  liftTimeout,
  banMember,
  unbanMember,
  listBans,
  toggleMute,
  getMutedUsers,
  TIMEOUT_DURATIONS_MINUTES
};
