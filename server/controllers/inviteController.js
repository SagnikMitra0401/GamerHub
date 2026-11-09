const Community = require('../models/Community');
const CommunityInvite = require('../models/CommunityInvite');
const CommunityJoinRequest = require('../models/CommunityJoinRequest');

const { CHAT_POLICY } = require('../config/chatPolicy');
const { CAP, communityPermissions, resolveCommunityRole } = require('../utils/permissions');
const { badRequest, forbidden, notFound, conflict, HttpError } = require('../utils/httpError');
const { recordAudit } = require('../utils/audit');
const { emitToCommunity } = require('../config/socket');
const { notifyUser } = require('../utils/notify');
const { publicBaseUrl } = require('../utils/appUrl');
const {
  newInviteCode,
  normalizeInviteOptions,
  inviteStatus,
  INVITE_STATUS_MESSAGES
} = require('../utils/invites');

const INVITE_AUDIT_SCOPE = [
  'INVITE_CREATE',
  'INVITE_REVOKE',
  'INVITE_JOIN',
  'INVITE_REQUEST',
  'INVITE_APPROVE',
  'INVITE_DENY'
];

const isMemberOf = (community, userId) => !!resolveCommunityRole(community, userId);

const serializeInvite = (invite, base = '') => ({
  _id: invite._id,
  code: invite.code,
  role: invite.role,
  uses: invite.uses || 0,
  maxUses: invite.maxUses || 0,
  requiresApproval: !!invite.requiresApproval,
  expiresAt: invite.expiresAt || null,
  revokedAt: invite.revokedAt || null,
  createdAt: invite.createdAt,
  status: inviteStatus(invite),
  // Generated server-side so a copied link points at the deployed app even
  // when the manager is browsing a preview or localhost.
  url: base ? `${base}/join/${invite.code}` : null
});

async function loadManagedCommunity(communityId, userId) {
  const community = await Community.findById(communityId);
  if (!community) throw notFound('Community not found.');

  const { permissions } = communityPermissions(community, userId);
  if (!permissions.includes(CAP.ADD_MEMBERS)) {
    throw forbidden('You need the Admin or Owner role to manage invite links.');
  }
  return community;
}

const isBanned = (community, userId) =>
  (community.bannedUsers || []).some(
    (entry) => String(entry.userId?._id ?? entry.userId) === String(userId)
  );

const atMemberCap = (community) =>
  (community.members || []).length >= CHAT_POLICY.community.maxMembers;

/** Add a member only if they are not already in the list; true when added. */
async function addMember(communityId, userId, now = new Date()) {
  const result = await Community.updateOne(
    { _id: communityId, 'members.userId': { $ne: userId } },
    { $push: { members: { userId, role: 'member', joinedAt: now } } }
  );
  return result.modifiedCount > 0;
}

/**
 * Consume one use atomically, re-checking expiry and the use limit, so two
 * people racing for the last slot cannot both win.
 */
function consumeInviteUse(inviteId, now = new Date()) {
  return CommunityInvite.findOneAndUpdate(
    {
      _id: inviteId,
      revokedAt: null,
      $and: [
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
        { $or: [{ maxUses: 0 }, { $expr: { $lt: ['$uses', '$maxUses'] } }] }
      ]
    },
    { $inc: { uses: 1 } },
    { new: true }
  );
}

const refundInviteUse = (inviteId) =>
  CommunityInvite.updateOne({ _id: inviteId, uses: { $gt: 0 } }, { $inc: { uses: -1 } }).catch(() => {});

/** Owners and admins are the people who can action a join request. */
function notifyManagers(community, request) {
  const managerIds = (community.members || [])
    .filter((member) => member.role === 'owner' || member.role === 'admin')
    .map((member) => member.userId)
    .filter((id) => String(id) !== String(request.userId));

  for (const userId of managerIds) {
    notifyUser({
      userId,
      type: 'social',
      title: `${request.username || 'Someone'} asked to join ${community.name}`,
      message: 'Open Invite people to approve or decline the request.',
      actionUrl: `/communities/${community.slug}`,
      metadata: {
        kind: 'community_join_request',
        communityId: String(community._id),
        requestId: String(request._id)
      }
    });
  }
}

function notifyRequester(request, community, approved) {
  notifyUser({
    userId: request.userId,
    type: 'social',
    title: approved
      ? `You're in ${community.name}`
      : `${community.name} declined your request`,
    message: approved
      ? 'Your join request was approved. Open the server to say hello.'
      : 'A server manager declined your join request.',
    actionUrl: approved ? `/communities/${community.slug}` : '/communities',
    metadata: {
      kind: approved ? 'community_join_approved' : 'community_join_denied',
      communityId: String(community._id)
    }
  });
}

// ─── POST /api/communities/:id/invites ──────────────────────────────────────
const createInvite = async (req, res, next) => {
  try {
    const community = await loadManagedCommunity(req.params.id, req.user._id);

    const parsed = normalizeInviteOptions(req.body || {});
    if (!parsed.ok) throw badRequest(parsed.errors[0]);

    const { maxUses, expiresInDays, requiresApproval } = parsed.value;
    const expiresAt = expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 86_400_000)
      : null;

    let invite = null;
    // Codes are random; retry only on the (astronomically rare) collision.
    for (let attempt = 0; attempt < 3 && !invite; attempt += 1) {
      try {
        invite = await CommunityInvite.create({
          code: newInviteCode(),
          communityId: community._id,
          createdBy: req.user._id,
          role: 'member',
          maxUses,
          expiresAt,
          requiresApproval
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }
    if (!invite) throw conflict('Could not create an invite link. Please try again.');

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'INVITE_CREATE',
      targetId: invite._id,
      targetModel: 'CommunityInvite',
      metadata: { code: invite.code, maxUses, expiresInDays, requiresApproval }
    });

    const base = publicBaseUrl(req);
    res.status(201).json({
      invite: serializeInvite(invite, base),
      path: `/join/${invite.code}`,
      url: invite ? `${base}/join/${invite.code}` : null
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:id/invites ───────────────────────────────────────
const listInvites = async (req, res, next) => {
  try {
    const community = await loadManagedCommunity(req.params.id, req.user._id);

    const [invites, pendingRequests] = await Promise.all([
      CommunityInvite.find({ communityId: community._id, revokedAt: null })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('createdBy', 'username')
        .lean(),
      CommunityJoinRequest.countDocuments({ communityId: community._id, status: 'pending' })
    ]);

    const base = publicBaseUrl(req);
    res.status(200).json({
      items: invites.map((invite) => ({
        ...serializeInvite(invite, base),
        createdBy: invite.createdBy?.username || 'unknown'
      })),
      pendingRequests
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/communities/:id/invites/:inviteId ──────────────────────────
const revokeInvite = async (req, res, next) => {
  try {
    const community = await loadManagedCommunity(req.params.id, req.user._id);

    const invite = await CommunityInvite.findOne({
      _id: req.params.inviteId,
      communityId: community._id
    });
    if (!invite) throw notFound('Invite link not found.');

    invite.revokedAt = new Date();
    await invite.save();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'INVITE_REVOKE',
      targetId: invite._id,
      targetModel: 'CommunityInvite',
      metadata: { code: invite.code }
    });

    res.status(200).json({ revoked: true, inviteId: String(invite._id) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/:id/join-requests ─────────────────────────────────
const listJoinRequests = async (req, res, next) => {
  try {
    const community = await loadManagedCommunity(req.params.id, req.user._id);

    const requests = await CommunityJoinRequest.find({
      communityId: community._id,
      status: 'pending'
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('userId', 'username level')
      .populate('inviteId', 'code')
      .lean();

    res.status(200).json({
      items: requests.map((request) => ({
        _id: String(request._id),
        userId: request.userId?._id ? String(request.userId._id) : String(request.userId),
        username: request.userId?.username || request.username || 'Unknown',
        level: request.userId?.level ?? 1,
        code: request.inviteId?.code || '',
        createdAt: request.createdAt
      }))
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/join-requests/:requestId/approve ─────────────
const approveJoinRequest = async (req, res, next) => {
  try {
    const community = await loadManagedCommunity(req.params.id, req.user._id);
    const now = new Date();

    // Claim the request first so two managers cannot approve it twice.
    const request = await CommunityJoinRequest.findOneAndUpdate(
      { _id: req.params.requestId, communityId: community._id, status: 'pending' },
      { $set: { status: 'approved', decidedBy: req.user._id, decidedAt: now } },
      { new: true }
    );
    if (!request) throw notFound('That join request is no longer pending.');

    const revert = () => CommunityJoinRequest.updateOne(
      { _id: request._id },
      { $set: { status: 'pending', decidedBy: null, decidedAt: null } }
    ).catch(() => {});

    const invite = await CommunityInvite.findById(request.inviteId).lean();
    if (!invite || inviteStatus(invite) !== 'active') {
      await revert();
      throw new HttpError(410, 'That invite link is no longer active. Create a fresh link and share it again.');
    }

    if (isBanned(community, request.userId)) {
      await revert();
      throw forbidden('That player is banned from this server.');
    }

    if (atMemberCap(community)) {
      await revert();
      throw conflict('This server has reached its member limit.');
    }

    const consumed = await consumeInviteUse(invite._id, now);
    if (!consumed) {
      await revert();
      throw new HttpError(410, INVITE_STATUS_MESSAGES.used_up);
    }

    const added = await addMember(community._id, request.userId, now);
    if (!added) await refundInviteUse(invite._id);

    const memberCount = (community.members || []).length + (added ? 1 : 0);
    if (added) {
      emitToCommunity(community._id, 'community_updated', {
        communityId: String(community._id),
        memberCount
      });
      emitToCommunity(community._id, 'member_added', {
        communityId: String(community._id),
        userId: String(request.userId),
        role: 'member',
        memberCount
      });
    }

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'INVITE_APPROVE',
      targetId: request.userId,
      targetModel: 'User',
      metadata: { code: invite.code, username: request.username, alreadyMember: !added }
    });

    notifyRequester(request, community, true);

    res.status(200).json({ approved: true, userId: String(request.userId), alreadyMember: !added });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/:id/join-requests/:requestId/deny ────────────────
const denyJoinRequest = async (req, res, next) => {
  try {
    const community = await loadManagedCommunity(req.params.id, req.user._id);

    const request = await CommunityJoinRequest.findOneAndUpdate(
      { _id: req.params.requestId, communityId: community._id, status: 'pending' },
      { $set: { status: 'denied', decidedBy: req.user._id, decidedAt: new Date() } },
      { new: true }
    );
    if (!request) throw notFound('That join request is no longer pending.');

    const invite = await CommunityInvite.findById(request.inviteId).select('code').lean();

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'INVITE_DENY',
      targetId: request.userId,
      targetModel: 'User',
      metadata: { code: invite?.code || '', username: request.username }
    });

    notifyRequester(request, community, false);

    res.status(200).json({ denied: true, userId: String(request.userId) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/communities/invites/:code (public) ────────────────────────────
// The code is the authorization: holding a valid link is what makes a private
// server visible. Only the public card is returned, never members or channels.
const getInvitePreview = async (req, res, next) => {
  try {
    const invite = await CommunityInvite.findOne({ code: String(req.params.code || '').trim() }).lean();
    if (!invite) throw notFound(INVITE_STATUS_MESSAGES.missing);

    const community = await Community.findById(invite.communityId)
      .select('name slug icon description members isPrivate')
      .lean();
    if (!community) throw notFound('Community not found.');

    // Members keep seeing the card after a link is used up or revoked, so a
    // revisit says "open the server" instead of claiming the invite is dead.
    const alreadyMember = !!req.user && isMemberOf(community, req.user._id);

    const status = inviteStatus(invite);
    if (!alreadyMember && status !== 'active') {
      return res.status(410).json({ message: INVITE_STATUS_MESSAGES[status], status });
    }

    const pendingRequest = !alreadyMember && req.user
      ? !!(await CommunityJoinRequest.exists({
        communityId: community._id,
        userId: req.user._id,
        status: 'pending'
      }))
      : false;

    const base = publicBaseUrl(req);
    res.status(200).json({
      code: invite.code,
      role: invite.role,
      uses: invite.uses || 0,
      maxUses: invite.maxUses || 0,
      expiresAt: invite.expiresAt || null,
      requiresApproval: !!invite.requiresApproval,
      status,
      alreadyMember,
      pendingRequest,
      canJoin: !!req.user && !alreadyMember,
      url: base ? `${base}/join/${invite.code}` : null,
      community: {
        name: community.name,
        slug: community.slug,
        icon: community.icon || '🎮',
        description: community.description || '',
        memberCount: (community.members || []).length,
        isPrivate: !!community.isPrivate
      }
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/communities/invites/:code/join ───────────────────────────────
const joinWithInvite = async (req, res, next) => {
  try {
    const invite = await CommunityInvite.findOne({ code: String(req.params.code || '').trim() });
    if (!invite) throw notFound(INVITE_STATUS_MESSAGES.missing);

    const community = await Community.findById(invite.communityId);
    if (!community) throw notFound('Community not found.');

    // Checked before the link's own state: following a spent link as an
    // existing member is a harmless no-op, not an error.
    const existingRole = resolveCommunityRole(community, req.user._id);
    if (existingRole) {
      return res.status(200).json({
        alreadyMember: true,
        slug: community.slug,
        role: existingRole
      });
    }

    const status = inviteStatus(invite);
    if (status !== 'active') {
      return res.status(410).json({ message: INVITE_STATUS_MESSAGES[status], status });
    }

    // A ban outlives leaving, kicking and re-inviting.
    if (isBanned(community, req.user._id)) {
      throw forbidden('You are banned from this server.');
    }

    if (atMemberCap(community)) {
      throw conflict('This server has reached its member limit.');
    }

    // Approval-gated links file a request instead of adding the person. One
    // pending request per person per server; asking twice is a no-op.
    if (invite.requiresApproval) {
      let createdNow = false;
      let request = await CommunityJoinRequest.findOne({
        communityId: community._id,
        userId: req.user._id,
        status: 'pending'
      });

      if (!request) {
        try {
          request = await CommunityJoinRequest.create({
            communityId: community._id,
            inviteId: invite._id,
            userId: req.user._id,
            username: req.user.username || ''
          });
          createdNow = true;
        } catch (err) {
          if (err.code !== 11000) throw err;
          request = await CommunityJoinRequest.findOne({
            communityId: community._id,
            userId: req.user._id,
            status: 'pending'
          });
        }

        recordAudit({
          communityId: community._id,
          actorId: req.user._id,
          actionType: 'INVITE_REQUEST',
          targetId: req.user._id,
          targetModel: 'User',
          metadata: { code: invite.code, username: req.user.username }
        });

        if (request) notifyManagers(community, request);
      }

      return res.status(202).json({
        pending: true,
        alreadyRequested: !createdNow,
        slug: community.slug,
        message: 'Request sent. A server manager will review it.'
      });
    }

    const now = new Date();
    const consumed = await consumeInviteUse(invite._id, now);
    if (!consumed) {
      return res.status(410).json({
        message: INVITE_STATUS_MESSAGES.used_up,
        status: 'used_up'
      });
    }

    const added = await addMember(community._id, req.user._id, now);
    if (!added) {
      // Membership appeared between the check and the write: give the use back.
      await refundInviteUse(invite._id);
      return res.status(200).json({
        alreadyMember: true,
        slug: community.slug,
        role: resolveCommunityRole(community, req.user._id) || 'member'
      });
    }

    const memberCount = (community.members || []).length + 1;
    emitToCommunity(community._id, 'community_updated', {
      communityId: String(community._id),
      memberCount
    });
    emitToCommunity(community._id, 'member_added', {
      communityId: String(community._id),
      userId: String(req.user._id),
      role: 'member',
      memberCount
    });

    recordAudit({
      communityId: community._id,
      actorId: req.user._id,
      actionType: 'INVITE_JOIN',
      targetId: req.user._id,
      targetModel: 'User',
      metadata: { code: invite.code, username: req.user.username, via: 'link' }
    });

    res.status(200).json({
      alreadyMember: false,
      slug: community.slug,
      role: 'member',
      uses: consumed.uses || 0,
      maxUses: consumed.maxUses || 0
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createInvite,
  listInvites,
  revokeInvite,
  listJoinRequests,
  approveJoinRequest,
  denyJoinRequest,
  getInvitePreview,
  joinWithInvite,
  INVITE_AUDIT_SCOPE
};
