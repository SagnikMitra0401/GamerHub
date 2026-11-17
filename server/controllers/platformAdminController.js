/**
 * Platform administration: accounts, moderation cases, content and catalog.
 *
 * Every mutation is admin/staff gated at the route level, requires a reason
 * where it changes someone else's access, writes an immutable AuditLog row and
 * never touches passwords or session tokens in its response.
 */
const mongoose = require('mongoose');

const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Message = require('../models/Message');
const ForumPost = require('../models/ForumPost');
const Community = require('../models/Community');
const Report = require('../models/Report');
const DmReport = require('../models/DmReport');
const DmModerationAudit = require('../models/DmModerationAudit');
const Game = require('../models/Game');
const MediaAsset = require('../models/MediaAsset');
const AuditLog = require('../models/AuditLog');

const { recordPlatformAudit } = require('../utils/audit');
const { disconnectUser } = require('../config/socket');
const { PURPOSES, issueAccountToken } = require('../utils/accountTokens');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  verificationUrl,
  resetUrl
} = require('../utils/email');
const { STATUS_ACTIONS, moderationReason } = require('../utils/moderation');
const { sanitizeLine, escapeRegex } = require('../utils/sanitize');
const { badRequest, notFound, conflict, forbidden } = require('../utils/httpError');
const gameService = require('../services/gameService');
const igdb = require('../utils/gameProviders/igdb');

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const ROLES = ['user', 'moderator', 'admin'];
const REPORT_STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'];

const clampLimit = (raw, fallback = 25, max = 100) => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, max) : fallback;
};

const beforeCursor = (raw) => {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Only a page that filled its limit can have a successor. A short list is the
// end of the collection, not a cursor to an empty page.
const pageMeta = (items, limit) => ({
  nextBefore: items.length >= limit ? items[items.length - 1].createdAt : null
});

const publicUser = (user) => ({
  _id: String(user._id),
  username: user.username,
  email: user.email,
  role: user.role,
  status: user.status,
  profileType: user.profileType,
  level: user.level || 1,
  emailVerified: Boolean(user.emailVerifiedAt),
  createdAt: user.createdAt,
  lastActive: user.presence?.lastActive || null,
  moderation: user.moderation?.at
    ? {
        reason: user.moderation.reason || '',
        at: user.moderation.at,
        until: user.moderation.until || null
      }
    : null
});

// ─── Users ───────────────────────────────────────────────────────────────────

/** GET /api/admin/users?q=&status=&role=&verified=&before=&limit= */
const listUsers = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 25, 100);
    const filter = {};

    const q = sanitizeLine(req.query.q, 60);
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ username: pattern }, { email: pattern }];
    }
    if (['active', 'restricted', 'frozen', 'suspended', 'deletion_pending', 'deleted'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (ROLES.includes(req.query.role)) filter.role = req.query.role;
    if (req.query.verified === 'yes') filter.emailVerifiedAt = { $ne: null };
    if (req.query.verified === 'no') filter.emailVerifiedAt = null;

    const before = beforeCursor(req.query.before);
    if (before) filter.createdAt = { $lt: before };

    const [items, total] = await Promise.all([
      User.find(filter)
        .select('username email role status profileType level emailVerifiedAt createdAt presence.lastActive moderation')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    res.status(200).json({ items: items.map(publicUser), total, ...pageMeta(items, limit) });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/users/:id — account summary, activity counts and history. */
const getUserDetail = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('User not found');

    const user = await User.findById(req.params.id)
      .select('username email role status profileType level xp emailVerifiedAt createdAt updatedAt presence moderation bio frozenAt deletionRequestedAt')
      .lean();
    if (!user) throw notFound('User not found');

    const [posts, comments, messages, reportsAgainst, dmReportsAgainst, audit] = await Promise.all([
      Post.countDocuments({ userId: user._id }),
      Comment.countDocuments({ userId: user._id }),
      Message.countDocuments({ senderId: user._id, isDeleted: false }),
      Report.countDocuments({ targetType: 'member', targetId: user._id }),
      DmReport.countDocuments({ reportedUserId: user._id }),
      AuditLog.find({ actorId: user._id }).sort({ createdAt: -1 }).limit(10).lean()
    ]);

    res.status(200).json({
      user: publicUser(user),
      activity: { posts, comments, messages, reportsAgainst, dmReportsAgainst },
      audit: audit.map((entry) => ({
        _id: String(entry._id),
        actionType: entry.actionType,
        createdAt: entry.createdAt
      }))
    });
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/admin/users/:id/role  { role } */
const updateUserRole = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('User not found');
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role)) throw badRequest('role must be user, moderator or admin.');

    const target = await User.findById(req.params.id).select('_id username role status').lean();
    if (!target) throw notFound('User not found');

    if (String(target._id) === String(req.user._id)) {
      throw forbidden('You cannot change your own platform role.');
    }
    if (target.role === 'admin' && role !== 'admin') {
      const remaining = await User.countDocuments({ role: 'admin', _id: { $ne: target._id } });
      if (remaining === 0) throw conflict('There must always be at least one administrator.');
    }
    if (target.role === role) return res.status(200).json({ user: { _id: String(target._id), role } });

    await User.updateOne({ _id: target._id }, { $set: { role } });
    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_ROLE_UPDATE',
      targetId: target._id,
      targetModel: 'User',
      metadata: { from: target.role, to: role }
    });

    res.status(200).json({ user: { _id: String(target._id), role } });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/admin/users/:id/status  { action: restrict|suspend|reinstate, reason, until? }
 *
 * Suspension bumps the session version and evicts live sockets, so the change
 * is immediate rather than waiting for a cookie to expire.
 */
const updateUserStatus = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('User not found');

    const action = String(req.body?.action || '');
    const nextStatus = STATUS_ACTIONS[action];
    if (!nextStatus) throw badRequest('action must be restrict, suspend or reinstate.');

    const reason = moderationReason(req.body?.reason);
    if (nextStatus !== 'active' && reason.length < 3) {
      throw badRequest('Give a reason (at least 3 characters) for this decision.');
    }

    const target = await User.findById(req.params.id)
      .select('_id username role status sessionVersion moderation')
      .lean();
    if (!target) throw notFound('User not found');

    if (String(target._id) === String(req.user._id)) {
      throw forbidden('You cannot change your own account state.');
    }
    if (target.role === 'admin' && nextStatus !== 'active') {
      const otherAdmins = await User.countDocuments({ role: 'admin', _id: { $ne: target._id } });
      if (otherAdmins === 0) throw conflict('This is the only administrator account.');
    }

    let until = null;
    if (action === 'suspend' && req.body?.until) {
      const parsed = new Date(req.body.until);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        throw badRequest('The suspension end date must be in the future.');
      }
      until = parsed;
    }

    const set = {
      status: nextStatus,
      moderation: {
        reason,
        byId: req.user._id,
        at: new Date(),
        until,
        previousStatus: action === 'reinstate' ? null : (target.moderation?.previousStatus || target.status)
      }
    };
    if (action === 'reinstate') {
      set.moderation = { reason, byId: req.user._id, at: new Date(), until: null, previousStatus: null };
    }

    const update = { $set: set };
    if (nextStatus !== 'active') update.$inc = { sessionVersion: 1 };
    await User.updateOne({ _id: target._id }, update);

    if (nextStatus !== 'active') disconnectUser(target._id);

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_STATUS_UPDATE',
      targetId: target._id,
      targetModel: 'User',
      metadata: { action, from: target.status, to: nextStatus, reason, until }
    });

    res.status(200).json({ user: { _id: String(target._id), status: nextStatus, moderation: set.moderation } });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/users/:id/logout-all */
const forceLogout = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('User not found');
    if (String(req.params.id) === String(req.user._id)) {
      throw badRequest('Use "Sign out everywhere" in your own settings instead.');
    }

    const target = await User.findByIdAndUpdate(
      req.params.id,
      { $inc: { sessionVersion: 1 } },
      { new: true, select: 'sessionVersion' }
    ).lean();
    if (!target) throw notFound('User not found');

    disconnectUser(req.params.id);
    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_FORCE_LOGOUT',
      targetId: req.params.id,
      targetModel: 'User',
      metadata: {}
    });

    res.status(200).json({ signedOut: true, sessionVersion: target.sessionVersion });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/users/:id/resend-verification */
const resendVerification = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('User not found');
    const target = await User.findById(req.params.id)
      .select('_id username email emailVerifiedAt status')
      .lean();
    if (!target) throw notFound('User not found');
    if (target.emailVerifiedAt) throw conflict('That account is already verified.');
    if (['suspended', 'deleted'].includes(target.status)) {
      throw conflict('That account cannot be verified in its current state.');
    }

    const token = await issueAccountToken(target._id, PURPOSES.VERIFY_EMAIL);
    await sendVerificationEmail({
      to: target.email,
      username: target.username,
      url: verificationUrl(req, token)
    });

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_EMAIL_RESEND',
      targetId: target._id,
      targetModel: 'User',
      metadata: { kind: 'verify_email' }
    });

    res.status(200).json({ sent: true });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/users/:id/send-password-reset */
const sendPasswordReset = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('User not found');
    const target = await User.findById(req.params.id)
      .select('_id username email status hasLocalPassword')
      .lean();
    if (!target) throw notFound('User not found');
    if (target.hasLocalPassword === false) {
      throw conflict('That account signs in with Google and has no password to reset.');
    }
    if (['suspended', 'deleted'].includes(target.status)) {
      throw conflict('That account cannot reset a password in its current state.');
    }

    const token = await issueAccountToken(target._id, PURPOSES.RESET_PASSWORD);
    await sendPasswordResetEmail({
      to: target.email,
      username: target.username,
      url: resetUrl(req, token)
    });

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_EMAIL_RESEND',
      targetId: target._id,
      targetModel: 'User',
      metadata: { kind: 'reset_password' }
    });

    res.status(200).json({ sent: true });
  } catch (err) {
    next(err);
  }
};

// ─── Moderation cases ────────────────────────────────────────────────────────

/** Hydrate the content a community report points at, in one batch per type. */
async function communityPreviews(reports) {
  const byType = (type) => reports.filter((report) => report.targetType === type);
  const messageIds = byType('message').map((report) => report.targetId);
  const forumIds = byType('forumPost').map((report) => report.targetId);
  const memberIds = byType('member').map((report) => report.targetId);

  const [messages, forums, members] = await Promise.all([
    messageIds.length ? Message.find({ _id: { $in: messageIds } }).select('_id text senderId createdAt').lean() : [],
    forumIds.length ? ForumPost.find({ _id: { $in: forumIds } }).select('_id title body authorId createdAt isDeleted').lean() : [],
    memberIds.length ? User.find({ _id: { $in: memberIds } }).select('_id username level status').lean() : []
  ]);

  return {
    message: new Map(messages.map((item) => [String(item._id), item])),
    forumPost: new Map(forums.map((item) => [String(item._id), item])),
    member: new Map(members.map((item) => [String(item._id), item]))
  };
}

/** GET /api/admin/cases?status=open&source=all|dm|community&before=&limit= */
const listCases = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 20, 60);
    const status = REPORT_STATUSES.includes(req.query.status) ? req.query.status : 'open';
    const source = ['dm', 'community'].includes(req.query.source) ? req.query.source : 'all';
    const before = beforeCursor(req.query.before);
    const dateFilter = before ? { createdAt: { $lt: before } } : {};

    const [dmReports, communityReports, dmTotal, communityTotal] = await Promise.all([
      source === 'community'
        ? []
        : DmReport.find({ status, ...dateFilter })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('reporterId', 'username')
            .populate('reportedUserId', 'username')
            .lean(),
      source === 'dm'
        ? []
        : Report.find({ status, ...dateFilter })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('reporterId', 'username')
            .populate('communityId', 'name slug')
            .lean(),
      source === 'community' ? 0 : DmReport.countDocuments({ status }),
      source === 'dm' ? 0 : Report.countDocuments({ status })
    ]);

    const previews = await communityPreviews(communityReports);

    const items = [
      ...dmReports.map((report) => ({
        id: String(report._id),
        source: 'dm',
        targetType: 'conversation',
        reason: report.reason,
        note: report.note || '',
        status: report.status,
        createdAt: report.createdAt,
        reporter: report.reporterId?.username ? { username: report.reporterId.username } : null,
        reported: report.reportedUserId?.username ? { username: report.reportedUserId.username } : null,
        community: null,
        preview: (report.messageIds || []).length
          ? [{ kind: 'message', text: `${report.messageIds.length} reported message(s)` }]
          : []
      })),
      ...communityReports.map((report) => {
        const target = previews[report.targetType]?.get(String(report.targetId));
        return {
          id: String(report._id),
          source: 'community',
          targetType: report.targetType,
          reason: report.reason,
          note: report.note || '',
          status: report.status,
          createdAt: report.createdAt,
          reporter: report.reporterId?.username ? { username: report.reporterId.username } : null,
          reported: report.targetType === 'member' && target?.username ? { username: target.username } : null,
          community: report.communityId
            ? { name: report.communityId.name, slug: report.communityId.slug }
            : null,
          preview: target
            ? [{
                kind: report.targetType,
                text: target.text || target.title || target.username || '',
                deleted: Boolean(target.isDeleted)
              }]
            : []
        };
      })
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);

    res.status(200).json({
      items,
      counts: { dm: dmTotal, community: communityTotal },
      ...pageMeta(items, limit)
    });
  } catch (err) {
    next(err);
  }
};

/** Tombstone the reported content. Returns whether anything was changed. */
async function removeReportedContent(report) {
  if (report.targetType === 'message') {
    const result = await Message.updateOne(
      { _id: report.targetId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date(), text: '[removed by moderation]' } }
    );
    return result.modifiedCount > 0;
  }
  if (report.targetType === 'forumPost') {
    const result = await ForumPost.updateOne(
      { _id: report.targetId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  }
  return false;
}

/**
 * POST /api/admin/cases/:source/:id/resolve
 * { decision: dismiss|review|remove_content|suspend_author, note }
 */
const resolveCase = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('Case not found');
    const source = String(req.params.source || '');
    const decision = String(req.body?.decision || '');
    const note = sanitizeLine(req.body?.note, 500);

    if (!['dm', 'community'].includes(source)) throw badRequest('source must be dm or community.');
    if (!['dismiss', 'review', 'remove_content', 'suspend_author'].includes(decision)) {
      throw badRequest('decision must be dismiss, review, remove_content or suspend_author.');
    }
    if (decision === 'suspend_author' && note.length < 3) {
      throw badRequest('Give a reason before suspending the author.');
    }

    if (source === 'dm') {
      const report = await DmReport.findById(req.params.id);
      if (!report) throw notFound('Case not found');

      const status = decision === 'dismiss' ? 'dismissed' : decision === 'review' ? 'reviewed' : 'actioned';
      report.status = status;
      report.reviewedBy = req.user._id;
      report.reviewedAt = new Date();
      report.reviewNote = note;
      await report.save();
      await DmModerationAudit.create({
        reportId: report._id,
        actorId: req.user._id,
        status,
        note
      });

      await recordPlatformAudit({
        actorId: req.user._id,
        actionType: 'PLATFORM_REPORT_RESOLVE',
        targetId: report._id,
        targetModel: 'DmReport',
        metadata: { decision, note }
      });

      return res.status(200).json({ case: { id: String(report._id), source, status } });
    }

    const report = await Report.findById(req.params.id);
    if (!report) throw notFound('Case not found');

    let contentRemoved = false;
    if (decision === 'remove_content') {
      contentRemoved = await removeReportedContent(report);
    }

    let suspended = null;
    if (decision === 'suspend_author') {
      let authorId = null;
      if (report.targetType === 'message') {
        const message = await Message.findById(report.targetId).select('senderId').lean();
        authorId = message?.senderId;
      } else if (report.targetType === 'forumPost') {
        const thread = await ForumPost.findById(report.targetId).select('authorId').lean();
        authorId = thread?.authorId;
      } else if (report.targetType === 'member') {
        authorId = report.targetId;
      }

      const author = authorId
        ? await User.findById(authorId).select('_id role status').lean()
        : null;
      if (author && author.role !== 'admin' && String(author._id) !== String(req.user._id)) {
        await User.updateOne(
          { _id: author._id },
          {
            $set: {
              status: 'suspended',
              moderation: {
                reason: note,
                byId: req.user._id,
                at: new Date(),
                until: null,
                previousStatus: author.status
              }
            },
            $inc: { sessionVersion: 1 }
          }
        );
        disconnectUser(author._id);
        suspended = String(author._id);
      }
    }

    const status = decision === 'dismiss' ? 'dismissed' : 'reviewed';
    report.status = status;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    report.reviewNote = note;
    await report.save();

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_REPORT_RESOLVE',
      targetId: report._id,
      targetModel: 'Report',
      metadata: {
        decision,
        note,
        communityId: String(report.communityId),
        targetType: report.targetType,
        contentRemoved,
        suspended
      }
    });

    res.status(200).json({
      case: { id: String(report._id), source, status },
      contentRemoved,
      suspended
    });
  } catch (err) {
    next(err);
  }
};

// ─── Content ─────────────────────────────────────────────────────────────────

const visibilityFilter = (raw) => {
  if (raw === 'hidden') return { hiddenAt: { $ne: null } };
  if (raw === 'visible') return { hiddenAt: null };
  return {};
};

/** GET /api/admin/content/posts?q=&visibility=&before=&limit= */
const listPosts = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 20, 60);
    const filter = { ...visibilityFilter(req.query.visibility) };
    const q = sanitizeLine(req.query.q, 80);
    if (q) filter.title = new RegExp(escapeRegex(q), 'i');
    const before = beforeCursor(req.query.before);
    if (before) filter.createdAt = { $lt: before };

    const items = await Post.find(filter)
      .select('title tags likeCount commentCount hiddenAt createdAt userId mediaType')
      .populate('userId', 'username')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.status(200).json({
      items: items.map((post) => ({
        _id: String(post._id),
        title: post.title,
        tags: post.tags,
        likeCount: post.likeCount || 0,
        commentCount: post.commentCount || 0,
        hiddenAt: post.hiddenAt,
        createdAt: post.createdAt,
        mediaType: post.mediaType,
        author: post.userId?.username || null
      })),
      ...pageMeta(items, limit)
    });
  } catch (err) {
    next(err);
  }
};

const setPostVisibility = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('Post not found');
    const hidden = req.body?.hidden === true;
    const reason = moderationReason(req.body?.reason);
    if (hidden && reason.length < 3) throw badRequest('Give a reason before hiding content.');

    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $set: { hiddenAt: hidden ? new Date() : null, hiddenById: hidden ? req.user._id : null } },
      { new: true, select: 'hiddenAt title' }
    ).lean();
    if (!post) throw notFound('Post not found');

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: hidden ? 'PLATFORM_CONTENT_HIDE' : 'PLATFORM_CONTENT_RESTORE',
      targetId: req.params.id,
      targetModel: 'Post',
      metadata: { reason, title: post.title }
    });

    res.status(200).json({ post: { _id: String(post._id), hiddenAt: post.hiddenAt } });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/content/comments?before=&limit= */
const listComments = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 20, 60);
    const filter = { ...visibilityFilter(req.query.visibility) };
    const before = beforeCursor(req.query.before);
    if (before) filter.createdAt = { $lt: before };

    const items = await Comment.find(filter)
      .select('text postId hiddenAt createdAt userId')
      .populate('userId', 'username')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.status(200).json({
      items: items.map((comment) => ({
        _id: String(comment._id),
        text: comment.text,
        postId: String(comment.postId),
        hiddenAt: comment.hiddenAt,
        createdAt: comment.createdAt,
        author: comment.userId?.username || null
      })),
      ...pageMeta(items, limit)
    });
  } catch (err) {
    next(err);
  }
};

const setCommentVisibility = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('Comment not found');
    const hidden = req.body?.hidden === true;
    const reason = moderationReason(req.body?.reason);
    if (hidden && reason.length < 3) throw badRequest('Give a reason before hiding content.');

    const comment = await Comment.findByIdAndUpdate(
      req.params.id,
      { $set: { hiddenAt: hidden ? new Date() : null, hiddenById: hidden ? req.user._id : null } },
      { new: true, select: 'hiddenAt' }
    ).lean();
    if (!comment) throw notFound('Comment not found');

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: hidden ? 'PLATFORM_CONTENT_HIDE' : 'PLATFORM_CONTENT_RESTORE',
      targetId: req.params.id,
      targetModel: 'Comment',
      metadata: { reason }
    });

    res.status(200).json({ comment: { _id: String(comment._id), hiddenAt: comment.hiddenAt } });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/content/messages?communityId=&q=&before=&limit= */
const listMessages = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 20, 60);
    const filter = {};
    if (req.query.visibility === 'hidden') filter.isDeleted = true;
    if (req.query.visibility === 'visible') filter.isDeleted = false;
    if (isId(req.query.communityId)) filter.communityId = req.query.communityId;
    const q = sanitizeLine(req.query.q, 80);
    if (q) filter.text = new RegExp(escapeRegex(q), 'i');
    const before = beforeCursor(req.query.before);
    if (before) filter.createdAt = { $lt: before };

    const items = await Message.find(filter)
      .select('text communityId channelId isDeleted deletedAt createdAt senderId')
      .populate('senderId', 'username')
      .populate('communityId', 'name slug')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.status(200).json({
      items: items.map((message) => ({
        _id: String(message._id),
        text: message.text,
        isDeleted: Boolean(message.isDeleted),
        deletedAt: message.deletedAt || null,
        createdAt: message.createdAt,
        author: message.senderId?.username || null,
        community: message.communityId
          ? { name: message.communityId.name, slug: message.communityId.slug }
          : null
      })),
      ...pageMeta(items, limit)
    });
  } catch (err) {
    next(err);
  }
};

const setMessageVisibility = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('Message not found');
    const hidden = req.body?.hidden === true;
    const reason = moderationReason(req.body?.reason);
    if (hidden && reason.length < 3) throw badRequest('Give a reason before hiding content.');

    const message = await Message.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          isDeleted: hidden,
          deletedAt: hidden ? new Date() : null,
          deletedBy: hidden ? req.user._id : null,
          ...(hidden
            ? { text: '[removed by moderation]' }
            : {})
        }
      },
      { new: true, select: 'isDeleted deletedAt communityId' }
    ).lean();
    if (!message) throw notFound('Message not found');

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: hidden ? 'PLATFORM_CONTENT_HIDE' : 'PLATFORM_CONTENT_RESTORE',
      targetId: req.params.id,
      targetModel: 'Message',
      metadata: { reason, communityId: String(message.communityId) }
    });

    res.status(200).json({ message: { _id: String(message._id), isDeleted: message.isDeleted } });
  } catch (err) {
    next(err);
  }
};

// ─── Audit ───────────────────────────────────────────────────────────────────

/** GET /api/admin/audit?action=&actor=&from=&to=&before=&limit= */
const listAudit = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 30, 100);
    const filter = {};

    const action = sanitizeLine(req.query.action, 40);
    if (action) filter.actionType = action;
    const before = beforeCursor(req.query.before);
    if (before) filter.createdAt = { $lt: before };
    const from = beforeCursor(req.query.from);
    const to = beforeCursor(req.query.to);
    if (from || to) {
      filter.createdAt = {
        ...(filter.createdAt || {}),
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {})
      };
    }

    const actor = sanitizeLine(req.query.actor, 20);
    if (actor) {
      const matches = await User.find({ username: new RegExp(escapeRegex(actor), 'i') })
        .select('_id')
        .limit(20)
        .lean();
      filter.actorId = { $in: matches.map((entry) => entry._id) };
    }

    const items = await AuditLog.find(filter)
      .populate('actorId', 'username role')
      .populate('communityId', 'name slug')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.status(200).json({
      items: items.map((entry) => ({
        _id: String(entry._id),
        actionType: entry.actionType,
        actor: entry.actorId?.username || 'deleted user',
        actorRole: entry.actorId?.role || null,
        community: entry.communityId?.name || null,
        targetModel: entry.targetModel,
        targetId: entry.targetId ? String(entry.targetId) : null,
        metadata: entry.metadata || {},
        createdAt: entry.createdAt
      })),
      ...pageMeta(items, limit)
    });
  } catch (err) {
    next(err);
  }
};

// ─── Catalog & storage ───────────────────────────────────────────────────────

/** GET /api/admin/games?q=&status=&before=&limit= */
const listGames = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 25, 100);
    const filter = {};
    if (['published', 'provisional', 'hidden', 'merged'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const q = sanitizeLine(req.query.q, 80);
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: pattern }, { aliases: pattern }];
    }
    const before = beforeCursor(req.query.before);
    if (before) filter.createdAt = { $lt: before };

    const [items, total, counts] = await Promise.all([
      Game.find(filter)
        .select('slug title cover.url genres platforms releaseYear status stats externalIds createdAt')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Game.countDocuments(filter),
      Game.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);

    res.status(200).json({
      items: items.map((game) => ({
        _id: String(game._id),
        slug: game.slug,
        title: game.title,
        cover: game.cover?.url || null,
        genres: game.genres,
        platforms: game.platforms,
        releaseYear: game.releaseYear,
        status: game.status,
        stats: game.stats,
        externalIds: game.externalIds,
        createdAt: game.createdAt
      })),
      total,
      counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
      ...pageMeta(items, limit)
    });
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/admin/games/:id  { status, aliases? } */
const updateGame = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('Game not found');
    const set = {};

    if (req.body?.status !== undefined) {
      if (!['published', 'provisional', 'hidden'].includes(req.body.status)) {
        throw badRequest('status must be published, provisional or hidden.');
      }
      set.status = req.body.status;
    }
    if (req.body?.aliases !== undefined) {
      if (!Array.isArray(req.body.aliases)) throw badRequest('aliases must be an array.');
      const aliases = [...new Set(req.body.aliases
        .map((alias) => sanitizeLine(alias, 120))
        .filter(Boolean))].slice(0, 10);
      set.aliases = aliases;
      set.aliasKeys = aliases.map((alias) => require('../utils/gameRegistry').canonicalKey(alias)).filter(Boolean);
    }

    if (!Object.keys(set).length) throw badRequest('Nothing to update.');

    const game = await Game.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
    if (!game) throw notFound('Game not found');

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_GAME_UPDATE',
      targetId: game._id,
      targetModel: 'Game',
      metadata: { status: game.status, aliases: game.aliases }
    });

    res.status(200).json({ game: { _id: String(game._id), slug: game.slug, status: game.status, aliases: game.aliases } });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/games/:id/merge  { intoId } */
const mergeGame = async (req, res, next) => {
  try {
    if (!isId(req.params.id) || !isId(req.body?.intoId)) throw badRequest('Pick two games to merge.');
    if (String(req.params.id) === String(req.body.intoId)) throw badRequest('Pick two different games.');

    const result = await gameService.mergeGames(req.body.intoId, req.params.id);
    if (!result) throw notFound('Game not found');

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_GAME_MERGE',
      targetId: result.primary.id,
      targetModel: 'Game',
      metadata: { mergedId: result.mergedId }
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/games/sync  { provider: freetogame|igdb, query? } */
const syncGames = async (req, res, next) => {
  try {
    const provider = String(req.body?.provider || 'freetogame');
    if (!['freetogame', 'igdb'].includes(provider)) throw badRequest('provider must be freetogame or igdb.');
    if (provider === 'igdb' && !igdb.configured()) {
      throw badRequest('IGDB is not configured. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET.');
    }

    const query = sanitizeLine(req.body?.query, 80);
    const result = provider === 'igdb'
      ? await gameService.syncIgdbSearch(query || 'popular', { limit: 12 })
      : await gameService.syncFreeToPlay({ limit: Number(req.body?.limit) || 240 });

    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_GAME_SYNC',
      targetId: null,
      targetModel: 'Game',
      metadata: { provider, query: query || null, synced: result.synced }
    });

    res.status(200).json({ ...result, provider });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/storage — media ledger totals, no per-file contents. */
const getStorage = async (req, res, next) => {
  try {
    const [bySurface, totals, byStatus] = await Promise.all([
      MediaAsset.aggregate([
        { $group: { _id: '$surface', count: { $sum: 1 }, bytes: { $sum: '$bytes' } } },
        { $sort: { count: -1 } }
      ]),
      MediaAsset.aggregate([{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$bytes' } } }]),
      MediaAsset.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);

    res.status(200).json({
      totals: {
        assets: totals[0]?.count || 0,
        bytes: totals[0]?.bytes || 0
      },
      bySurface: bySurface.map((row) => ({
        surface: row._id || 'unknown',
        count: row.count,
        bytes: row.bytes
      })),
      byStatus: Object.fromEntries(byStatus.map((row) => [row._id, row.count]))
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listUsers,
  getUserDetail,
  updateUserRole,
  updateUserStatus,
  forceLogout,
  resendVerification,
  sendPasswordReset,
  listCases,
  resolveCase,
  listPosts,
  setPostVisibility,
  listComments,
  setCommentVisibility,
  listMessages,
  setMessageVisibility,
  listAudit,
  listGames,
  updateGame,
  mergeGame,
  syncGames,
  getStorage
};
