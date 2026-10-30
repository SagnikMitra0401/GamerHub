const mongoose = require('mongoose');

const User = require('../models/User');
const Party = require('../models/Party');
const Community = require('../models/Community');
const Invitation = require('../models/Invitation');
const SquadChat = require('../models/SquadChat');

const { notifyUser } = require('../utils/notify');
const { canInvite, containsId } = require('../utils/privacy');
const { openSlots } = require('../utils/partyRules');
const { communityPermissions, CAP } = require('../utils/permissions');
const { isOpen } = require('../utils/squadLifecycle');
const { sanitizeLine } = require('../utils/sanitize');
const { HttpError, badRequest, notFound, forbidden, conflict } = require('../utils/httpError');

const TARGET_TYPES = ['squad', 'community_server'];
const TTL_DAYS = 7;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const idOf = (value) => (value?._id ? String(value._id) : String(value || ''));

const toView = (invite) => ({
  _id: String(invite._id),
  status: invite.status,
  targetType: invite.targetType,
  targetId: String(invite.targetId),
  targetName: invite.targetName || '',
  message: invite.message || '',
  expiresAt: invite.expiresAt,
  createdAt: invite.createdAt,
  respondedAt: invite.respondedAt,
  inviter: { id: String(invite.inviterUserId), username: invite.inviterUsername || 'a player' }
});

/** Lazily flip stale pending invites; every read and response does this. */
async function expireStale(now = new Date()) {
  await Invitation.updateMany(
    { status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  ).catch(() => {});
}

/**
 * POST /api/invitations
 * Consent first: the recipient's privacy settings and both block lists are
 * checked before an invitation row is ever written.
 */
const createInvitation = async (req, res, next) => {
  try {
    const recipientId = String(req.body?.recipientUserId || req.body?.userId || '');
    const targetId = String(req.body?.targetId || '');
    const targetType = String(req.body?.targetType || '');

    if (!isId(recipientId)) throw badRequest('Invalid recipient');
    if (!isId(targetId)) throw badRequest('Invalid target');
    if (!TARGET_TYPES.includes(targetType)) {
      throw badRequest(`targetType must be one of: ${TARGET_TYPES.join(', ')}`);
    }

    const [recipient, inviter] = await Promise.all([
      User.findById(recipientId).select('_id username status privacySettings blockedUsers').lean(),
      User.findById(req.user._id).select('_id username following blockedUsers').lean()
    ]);
    if (!recipient) throw notFound('User not found');

    const followsRecipient = containsId(inviter?.following, recipient._id);
    const consent = canInvite({
      targetType,
      recipient,
      inviter,
      inviterFollowsRecipient: followsRecipient
    });
    if (!consent.ok) {
      const status = consent.code === 'NOT_FOUND' ? 404 : consent.code === 'SELF_INVITE' ? 409 : 403;
      throw new HttpError(status, consent.reason, { code: consent.code });
    }

    let targetName = '';

    if (targetType === 'squad') {
      const party = await Party.findById(targetId).select('_id gameTitle leaderId members status').lean();
      if (!party) throw notFound('Squad not found');
      if (idOf(party.leaderId) !== String(req.user._id)) {
        throw forbidden('Only the squad leader can invite players.');
      }
      if (party.status === 'closed') throw conflict('That squad is closed.');
      if ((party.members || []).some((m) => idOf(m.userId) === recipientId)) {
        throw conflict('That player is already in this squad.');
      }
      targetName = party.gameTitle;
    } else {
      const community = await Community.findById(targetId).select('_id name members ownerId').lean();
      if (!community) throw notFound('Server not found');
      const { permissions } = communityPermissions(community, req.user._id);
      if (!permissions.includes(CAP.ADD_MEMBERS)) {
        throw forbidden('You need the Admin or Owner role to invite players to this server.');
      }
      if ((community.members || []).some((m) => idOf(m.userId) === recipientId)) {
        throw conflict('That player is already a member of this server.');
      }
      targetName = community.name;
    }

    const message = sanitizeLine(req.body?.message, 200);
    const expiresAt = new Date(Date.now() + TTL_MS);

    let invitation;
    try {
      invitation = await Invitation.create({
        inviterUserId: req.user._id,
        inviterUsername: req.user.username,
        recipientUserId: recipient._id,
        targetType,
        targetId,
        targetName,
        message,
        expiresAt
      });
    } catch (err) {
      if (err.code === 11000) throw conflict('That player already has a pending invitation for this.');
      throw err;
    }

    notifyUser({
      userId: recipient._id,
      type: 'social',
      title: `${req.user.username} invited you`,
      message: targetType === 'squad'
        ? `Join their ${targetName} squad.`
        : `Join the ${targetName} server.`,
      actionUrl: targetType === 'squad' ? '/lfg' : '/communities',
      metadata: {
        kind: 'invitation',
        invitationId: String(invitation._id),
        targetType,
        targetId: String(targetId)
      }
    });

    res.status(201).json(toView(invitation));
  } catch (err) {
    next(err);
  }
};

/** GET /api/invitations/inbox — pending, unexpired, addressed to the caller. */
const listInbox = async (req, res, next) => {
  try {
    const now = new Date();
    await expireStale(now);

    const items = await Invitation.find({
      recipientUserId: req.user._id,
      status: 'pending',
      expiresAt: { $gt: now }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ items: items.map(toView) });
  } catch (err) {
    next(err);
  }
};

/** GET /api/invitations/sent — what the caller has sent, any state. */
const listSent = async (req, res, next) => {
  try {
    const items = await Invitation.find({ inviterUserId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ items: items.map(toView) });
  } catch (err) {
    next(err);
  }
};

/** Load an invitation addressed to the caller (never somebody else's). */
async function loadOwnInvitation(req) {
  if (!isId(req.params.id)) throw badRequest('Invalid invitation id');
  const invitation = await Invitation.findOne({
    _id: req.params.id,
    recipientUserId: req.user._id
  });
  if (!invitation) throw notFound('Invitation not found');
  return invitation;
}

async function acceptSquadInvite(invitation, userId) {
  const party = await Party.findById(invitation.targetId);
  if (!party || party.status === 'closed') {
    invitation.status = 'expired';
    await invitation.save();
    throw conflict('This squad is no longer available.');
  }

  const alreadyMember = (party.members || []).some((m) => idOf(m.userId) === String(userId));
  if (!alreadyMember) {
    if (openSlots(party) <= 0) {
      // A full squad can still honour an explicit invitation, but only when the
      // leader already opened the temporary chat — otherwise there is nowhere
      // to put the player.
      const chat = await SquadChat.findOne({ squadId: party._id, state: 'active' }).lean();
      if (!isOpen(chat)) throw conflict('This squad is full.');
      await SquadChat.updateOne({ _id: chat._id }, { $addToSet: { memberIds: userId } });
    } else {
      const joined = await Party.findOneAndUpdate(
        { _id: party._id, 'members.userId': { $ne: userId }, status: { $ne: 'closed' } },
        { $push: { members: { userId, role: 'member', joinedAt: new Date() } } },
        { new: true }
      );
      if (!joined) throw conflict('That squad changed while you were accepting. Try again.');
      if (joined.members.length >= joined.maxSlots && joined.status === 'open') {
        joined.status = 'full';
        await joined.save();
      }
      await SquadChat.updateOne({ squadId: party._id }, { $addToSet: { memberIds: userId } });
    }
  }

  return { targetType: 'squad', targetId: String(party._id), targetName: party.gameTitle, actionUrl: '/lfg' };
}

async function acceptServerInvite(invitation, userId) {
  const community = await Community.findById(invitation.targetId);
  if (!community) {
    invitation.status = 'expired';
    await invitation.save();
    throw notFound('That server no longer exists.');
  }

  const banned = (community.bannedUsers || []).some((b) => idOf(b.userId) === String(userId));
  if (banned) throw forbidden('You cannot join this server.');

  const isMember = (community.members || []).some((m) => idOf(m.userId) === String(userId));
  if (!isMember) {
    const updated = await Community.findOneAndUpdate(
      { _id: community._id, 'members.userId': { $ne: userId } },
      { $push: { members: { userId, role: 'member', joinedAt: new Date() } } },
      { new: true, select: 'slug name' }
    );
    if (!updated) throw conflict('You are already a member of this server.');
    return { targetType: 'community_server', targetId: String(community._id), targetName: community.name, actionUrl: `/communities/${updated.slug}` };
  }

  return { targetType: 'community_server', targetId: String(community._id), targetName: community.name, actionUrl: `/communities/${community.slug}` };
}

/** POST /api/invitations/:id/accept */
const acceptInvitation = async (req, res, next) => {
  try {
    const invitation = await loadOwnInvitation(req);

    if (invitation.status === 'accepted') {
      return res.status(200).json({ status: 'accepted', alreadyAccepted: true });
    }
    if (invitation.status !== 'pending') throw conflict('This invitation is no longer open.');
    if (new Date(invitation.expiresAt) <= new Date()) {
      invitation.status = 'expired';
      await invitation.save();
      throw conflict('This invitation has expired.');
    }

    const result = invitation.targetType === 'squad'
      ? await acceptSquadInvite(invitation, req.user._id)
      : await acceptServerInvite(invitation, req.user._id);

    invitation.status = 'accepted';
    invitation.respondedAt = new Date();
    await invitation.save();

    notifyUser({
      userId: invitation.inviterUserId,
      type: 'social',
      title: `${req.user.username} accepted your invitation`,
      message: result.targetName ? `${req.user.username} joined ${result.targetName}.` : '',
      actionUrl: result.actionUrl,
      metadata: { kind: 'invitation_accepted', invitationId: String(invitation._id) }
    });

    res.status(200).json({ status: 'accepted', ...result });
  } catch (err) {
    next(err);
  }
};

/** POST /api/invitations/:id/decline */
const declineInvitation = async (req, res, next) => {
  try {
    const invitation = await loadOwnInvitation(req);
    if (invitation.status !== 'pending') throw conflict('This invitation is no longer open.');

    invitation.status = 'declined';
    invitation.respondedAt = new Date();
    await invitation.save();

    // The inviter learns the outcome, never the reason and never a block state.
    notifyUser({
      userId: invitation.inviterUserId,
      type: 'social',
      title: `${req.user.username} declined your invitation`,
      actionUrl: invitation.targetType === 'squad' ? '/lfg' : '/communities',
      metadata: { kind: 'invitation_declined', invitationId: String(invitation._id) }
    });

    res.status(200).json({ status: 'declined' });
  } catch (err) {
    next(err);
  }
};

/** POST /api/invitations/:id/revoke — inviter withdraws a pending invitation. */
const revokeInvitation = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid invitation id');
    const invitation = await Invitation.findOne({
      _id: req.params.id,
      inviterUserId: req.user._id
    });
    if (!invitation) throw notFound('Invitation not found');
    if (invitation.status !== 'pending') throw conflict('Only a pending invitation can be revoked.');

    invitation.status = 'revoked';
    invitation.respondedAt = new Date();
    await invitation.save();

    res.status(200).json({ status: 'revoked' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/lfg/:id/server-migration
 *
 * Turns a squad into a set of independent server invitations. Nobody is added
 * automatically: each member accepts or declines on their own.
 */
const migrateSquadToServer = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');
    const communityId = String(req.body?.communityId || '');
    if (!isId(communityId)) throw badRequest('Invalid server');

    const [party, community, inviter] = await Promise.all([
      Party.findById(req.params.id).select('_id gameTitle leaderId members status').lean(),
      Community.findById(communityId).select('_id name members ownerId').lean(),
      User.findById(req.user._id).select('_id following blockedUsers').lean()
    ]);

    if (!party) throw notFound('Squad not found');
    if (!community) throw notFound('Server not found');
    if (idOf(party.leaderId) !== String(req.user._id)) {
      throw forbidden('Only the squad leader can migrate this squad.');
    }

    const { permissions } = communityPermissions(community, req.user._id);
    if (!permissions.includes(CAP.ADD_MEMBERS)) {
      throw forbidden('You need the Admin or Owner role in that server.');
    }

    await expireStale();

    const memberIds = (party.members || [])
      .map((m) => idOf(m.userId))
      .filter((id) => id !== String(req.user._id));

    const recipients = await User.find({ _id: { $in: memberIds } })
      .select('_id username status privacySettings blockedUsers')
      .lean();

    const created = [];
    const skipped = [];

    for (const recipient of recipients) {
      if ((community.members || []).some((m) => idOf(m.userId) === String(recipient._id))) {
        skipped.push({ userId: String(recipient._id), reason: 'already_member' });
        continue;
      }
      const consent = canInvite({
        targetType: 'community_server',
        recipient,
        inviter,
        inviterFollowsRecipient: containsId(inviter?.following, recipient._id)
      });
      if (!consent.ok) {
        skipped.push({ userId: String(recipient._id), reason: consent.code });
        continue;
      }

      try {
        const invitation = await Invitation.create({
          inviterUserId: req.user._id,
          inviterUsername: req.user.username,
          recipientUserId: recipient._id,
          targetType: 'community_server',
          targetId: community._id,
          targetName: community.name,
          message: `Your ${party.gameTitle} squad is moving to ${community.name}.`,
          expiresAt: new Date(Date.now() + TTL_MS)
        });
        created.push(String(invitation._id));

        notifyUser({
          userId: recipient._id,
          type: 'social',
          title: `${req.user.username} invited you to ${community.name}`,
          message: `Your ${party.gameTitle} squad is moving to this server.`,
          actionUrl: '/communities',
          metadata: { kind: 'invitation', invitationId: String(invitation._id), targetType: 'community_server' }
        });
      } catch (err) {
        if (err.code === 11000) {
          skipped.push({ userId: String(recipient._id), reason: 'already_invited' });
          continue;
        }
        throw err;
      }
    }

    res.status(200).json({
      invited: created.length,
      skipped,
      invitationIds: created,
      communityId: String(community._id)
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createInvitation,
  listInbox,
  listSent,
  acceptInvitation,
  declineInvitation,
  revokeInvitation,
  migrateSquadToServer,
  expireStale,
  TTL_DAYS
};
