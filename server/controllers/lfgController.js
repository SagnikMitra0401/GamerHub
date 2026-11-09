const mongoose = require('mongoose');
const Party = require('../models/Party');
const SquadChat = require('../models/SquadChat');
const User = require('../models/User');
const { getIO, evictUserFromSquadChat } = require('../config/socket');
const {
  ensureSquadChat,
  closeChatForSquad,
  addMemberToChat,
  removeMemberFromChat,
  toChatView
} = require('../utils/squadChatService');
const { notifyUser } = require('../utils/notify');
const {
  openSlots,
  normalizePartyInput,
  canRequestJoin,
  membershipOf,
  MAX_REQUEST_MESSAGE
} = require('../utils/partyRules');
const { sanitizeLine } = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { badRequest, notFound, forbidden, conflict } = require('../utils/httpError');
const { isPlatformAdmin } = require('../utils/permissions');

const LEADER_FIELDS = 'username level role presence status';
const MEMBER_FIELDS = 'username level role presence';

const POPULATE = [
  { path: 'leaderId', select: LEADER_FIELDS },
  { path: 'members.userId', select: MEMBER_FIELDS },
  { path: 'requests.userId', select: 'username level role' }
];

const { publicPresence } = require('../utils/presence');

/**
 * A squad card is public. Account state (frozen, deletion_pending) and the raw
 * presence are not: an 'invisible' player must read offline here too.
 */
function publicPlayer(user) {
  if (!user || typeof user !== 'object') return user;
  return {
    _id: user._id,
    username: user.username,
    level: user.level,
    role: user.role,
    presence: publicPresence(user.presence)
  };
}

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const idOf = (value) => (value && value._id ? String(value._id) : String(value || ''));

/** Public shape. Requests are visible to the leader only. */
function toPartyView(party, viewerId) {
  if (!party) return null;
  const viewer = String(viewerId || '');
  const leaderId = idOf(party.leaderId);
  const isLeader = viewer === leaderId;

  return {
    _id: String(party._id),
    gameTitle: party.gameTitle,
    gameThumbnail: party.gameThumbnail,
    activity: party.activity,
    maxSlots: party.maxSlots,
    openSlots: openSlots(party),
    status: party.status,
    state: party.state || 'recruiting',
    lockedAt: party.lockedAt || null,
    // The chat id is only meaningful to a participant; the service still
    // re-checks membership on every read, so this is not the access control.
    chatId: membershipOf(party, viewerId) === 'none' ? null : (party.chatId ? String(party.chatId) : null),
    // Enriched by attachChatMeta() when the caller is a participant.
    chat: null,
    requirements: party.requirements || { minRank: '', micRequired: false },
    leader: publicPlayer(party.leaderId),
    members: (party.members || []).map((m) => ({
      user: publicPlayer(m.userId),
      role: m.role,
      joinedAt: m.joinedAt
    })),
    requestCount: isLeader ? (party.requests || []).length : undefined,
    requests: isLeader
      ? (party.requests || []).map((r) => ({
          user: publicPlayer(r.userId),
          message: r.message,
          requestedAt: r.requestedAt
        }))
      : undefined,
    viewerMembership: membershipOf(party, viewerId),
    createdAt: party.createdAt,
    expiresAt: party.expiresAt
  };
}

/**
 * Attach the temporary chat summary (expiry countdown, refresh rights) to a
 * page of squad views, without a query per card.
 */
async function attachChatMeta(views, viewerId) {
  const chatIds = views.map((view) => view.chatId).filter(Boolean);
  if (!chatIds.length) return views;


  const chats = await SquadChat.find({ _id: { $in: chatIds } }).lean();
  const byId = new Map(chats.map((chat) => [String(chat._id), chat]));

  for (const view of views) {
    const chat = byId.get(view.chatId);
    view.chat = chat ? toChatView(chat, viewerId) : null;
  }
  return views;
}

/** Broadcast a slot change to everyone watching the LFG board. */
function broadcastSlotUpdate(party) {
  if (!party) return;
  getIO()?.emit('lfg_slot_updated', {
    partyId: String(party._id),
    gameTitle: party.gameTitle,
    status: party.status,
    maxSlots: party.maxSlots,
    openSlots: openSlots(party),
    members: (party.members || []).map((m) => ({
      userId: idOf(m.userId),
      username: m.userId?.username || null
    }))
  });
}

// GET /api/lfg — open squads on the board
const listParties = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });

    const query = { status: 'open', expiresAt: { $gt: new Date() } };

    const game = sanitizeLine(req.query.game, 60);
    if (game) {
      // Escaped so a search string can never become a regex injection.
      const safe = game.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.gameTitle = { $regex: safe, $options: 'i' };
    }
    if (req.query.mic === '1' || req.query.mic === 'true') {
      query['requirements.micRequired'] = true;
    }

    // A frozen leader's squad is not a live invitation to play.
    const frozenLeaders = await User.distinct('_id', { status: 'frozen' });
    if (frozenLeaders.length) query.leaderId = { $nin: frozenLeaders };

    const [total, parties] = await Promise.all([
      Party.countDocuments(query),
      Party.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(POPULATE)
        .lean()
    ]);

    const items = await attachChatMeta(
      parties
        .map((p) => toPartyView(p, req.user?._id))
        .filter((p) => (req.query.openSlots === '1' ? p.openSlots > 0 : true)),
      req.user?._id
    );

    res.status(200).json({ items, total, page, limit });
  } catch (err) {
    next(err);
  }
};

// GET /api/lfg/mine — squads you lead or play in (any status)
const listMyParties = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const parties = await Party.find({
      $or: [{ leaderId: userId }, { 'members.userId': userId }],
      status: { $ne: 'closed' }
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate(POPULATE)
      .lean();

    res.status(200).json({
      items: await attachChatMeta(parties.map((p) => toPartyView(p, userId)), userId)
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/lfg — create a squad (creator becomes leader)
const createParty = async (req, res, next) => {
  try {
    const { ok, errors, value } = normalizePartyInput(req.body);
    if (!ok) throw badRequest(errors[0], { details: errors });

    const party = await Party.create({
      ...value,
      leaderId: req.user._id,
      members: [{ userId: req.user._id, role: 'leader', joinedAt: new Date() }],
      status: 'open'
    });

    const populated = await Party.findById(party._id).populate(POPULATE).lean();
    broadcastSlotUpdate(populated);
    res.status(201).json(toPartyView(populated, req.user._id));
  } catch (err) {
    next(err);
  }
};

// GET /api/lfg/:id
const getParty = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');
    const party = await Party.findById(req.params.id).populate(POPULATE).lean();
    if (!party) throw notFound('Squad not found');
    const view = toPartyView(party, req.user?._id);
    if (party.leaderId?.status === 'frozen' && view.viewerMembership === 'none') {
      throw notFound('Squad not found');
    }
    await attachChatMeta([view], req.user?._id);
    res.status(200).json(view);
  } catch (err) {
    next(err);
  }
};

// POST /api/lfg/:id/request — ask the leader for a slot
const requestJoin = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');

    const party = await Party.findById(req.params.id).lean();
    if (!party) throw notFound('Squad not found');

    const check = canRequestJoin(party, req.user._id);
    if (!check.ok) throw conflict(check.reason);

    const message = sanitizeLine(req.body?.message, MAX_REQUEST_MESSAGE);

    // Conditional update: two people clicking at once cannot overfill the queue.
    const updated = await Party.findOneAndUpdate(
      {
        _id: party._id,
        status: 'open',
        'requests.userId': { $ne: req.user._id },
        'members.userId': { $ne: req.user._id }
      },
      { $push: { requests: { userId: req.user._id, message, requestedAt: new Date() } } },
      { new: true }
    );

    if (!updated) throw conflict('That request could not be sent. The squad may have changed.');

    const leaderId = idOf(updated.leaderId);

    await notifyUser({
      userId: leaderId,
      type: 'lfg_request',
      title: `New squad request from @${req.user.username}`,
      message: `${req.user.username} wants to join your ${updated.gameTitle} squad${message ? `: “${message}”` : '.'}`,
      actionUrl: '/lfg',
      metadata: { partyId: String(updated._id), requesterId: String(req.user._id) }
    });

    getIO()?.to(`user:${leaderId}`).emit('lfg_join_request', {
      partyId: String(updated._id),
      gameTitle: updated.gameTitle,
      requester: { _id: String(req.user._id), username: req.user.username },
      message
    });

    res.status(200).json({ requested: true, partyId: String(updated._id) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/lfg/:id/respond — leader accepts or rejects a request
const respondToRequest = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');

    const applicantId = String(req.body?.userId || '');
    const action = String(req.body?.action || '');
    if (!isId(applicantId)) throw badRequest('Invalid applicant id');
    if (!['accept', 'reject'].includes(action)) throw badRequest('action must be accept or reject');

    const party = await Party.findById(req.params.id).lean();
    if (!party) throw notFound('Squad not found');

    if (idOf(party.leaderId) !== String(req.user._id)) {
      throw forbidden('Only the squad leader can respond to requests.');
    }
    if (party.status === 'closed') throw conflict('This squad is closed.');

    const request = (party.requests || []).find((r) => idOf(r.userId) === applicantId);
    if (!request) throw notFound('No pending request from that player.');

    if (action === 'reject') {
      const updated = await Party.findByIdAndUpdate(
        party._id,
        { $pull: { requests: { userId: applicantId } } },
        { new: true }
      ).populate(POPULATE).lean();

      broadcastSlotUpdate(updated);
      const rejectView = toPartyView(updated, req.user._id);
      await attachChatMeta([rejectView], req.user._id);
      return res.status(200).json({ ok: true, action, party: rejectView });
    }

    if (openSlots(party) <= 0) throw conflict('This squad is already full.');

    const joined = await Party.findOneAndUpdate(
      {
        _id: party._id,
        status: 'open',
        'requests.userId': applicantId,
        'members.userId': { $ne: applicantId }
      },
      {
        $pull: { requests: { userId: applicantId } },
        $push: { members: { userId: applicantId, role: 'member', joinedAt: new Date() } }
      },
      { new: true }
    );

    if (!joined) throw conflict('That player could not be added. The squad may have changed.');

    // New members join the temporary chat if it already exists.
    await addMemberToChat(joined._id, applicantId);

    // Fill the last seat -> the squad leaves the board and locks: the temporary
    // chat is created here, so the group can talk without a second action.
    if (joined.members.length >= joined.maxSlots && joined.status === 'open') {
      joined.status = 'full';
      if (joined.state === 'recruiting') {
        joined.state = 'locked';
        joined.lockedAt = new Date();
      }
      await joined.save();

      const chat = await ensureSquadChat({ party: joined, ownerUsername: req.user.username });
      if (chat && String(joined.chatId || '') !== String(chat._id)) {
        joined.chatId = chat._id;
        await joined.save();
      }
    }

    await notifyUser({
      userId: applicantId,
      type: 'lfg_accepted',
      title: `You joined a ${joined.gameTitle} squad`,
      message: `@${req.user.username} accepted your request. Check the LFG board for details.`,
      actionUrl: '/lfg',
      metadata: { partyId: String(joined._id), leaderId: String(req.user._id) }
    });

    const populated = await Party.findById(joined._id).populate(POPULATE).lean();
    broadcastSlotUpdate(populated);

    const acceptedView = toPartyView(populated, req.user._id);
    await attachChatMeta([acceptedView], req.user._id);

    res.status(200).json({ ok: true, action, party: acceptedView });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/lfg/:id — leader closes (or a platform admin removes) the squad
const closeParty = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');

    const party = await Party.findById(req.params.id).lean();
    if (!party) throw notFound('Squad not found');

    const isLeader = idOf(party.leaderId) === String(req.user._id);
    if (!isLeader && !isPlatformAdmin(req.user)) {
      throw forbidden('Only the squad leader can close this squad.');
    }

    await Party.updateOne(
      { _id: party._id },
      { $set: { status: 'closed', state: 'cancelled', completedAt: new Date() } }
    );

    // Closing a squad ends its temporary chat; the thread is not kept alive.
    const closedChat = await closeChatForSquad(party._id);
    if (closedChat) {
      getIO()?.to(`squad:${closedChat._id}`).emit('squad_chat_closed', {
        chatId: String(closedChat._id),
        reason: 'The squad was closed.'
      });
    }

    getIO()?.emit('lfg_slot_updated', {
      partyId: String(party._id),
      status: 'closed',
      openSlots: 0,
      maxSlots: party.maxSlots,
      members: []
    });

    res.status(200).json({ closed: true, partyId: String(party._id) });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/lfg/:id/lock — stop recruiting and open the 15-day chat.
 * `status` becomes 'full' because that is the existing board field for "not
 * accepting players"; `state` carries the real lifecycle value.
 */
const lockParty = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');

    const party = await Party.findById(req.params.id).lean();
    if (!party) throw notFound('Squad not found');
    if (idOf(party.leaderId) !== String(req.user._id)) {
      throw forbidden('Only the squad leader can lock this squad.');
    }
    if (party.status === 'closed' || party.state === 'cancelled') {
      throw conflict('This squad is closed.');
    }

    const chat = await ensureSquadChat({ party, ownerUsername: req.user.username });

    const updated = await Party.findByIdAndUpdate(
      party._id,
      {
        $set: {
          status: 'full',
          state: party.state === 'recruiting' ? 'locked' : party.state,
          lockedAt: party.lockedAt || new Date(),
          chatId: chat._id
        }
      },
      { new: true }
    ).populate(POPULATE).lean();

    broadcastSlotUpdate(updated);

    const view = toPartyView(updated, req.user._id);
    await attachChatMeta([view], req.user._id);
    res.status(200).json({ party: view, chat: toChatView(chat, req.user._id) });
  } catch (err) {
    next(err);
  }
};

/** POST /api/lfg/:id/unlock — go back to recruiting; the chat stays alive. */
const unlockParty = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');

    const party = await Party.findById(req.params.id).lean();
    if (!party) throw notFound('Squad not found');
    if (idOf(party.leaderId) !== String(req.user._id)) {
      throw forbidden('Only the squad leader can reopen this squad.');
    }
    if (party.status === 'closed' || party.state === 'cancelled') {
      throw conflict('This squad is closed and cannot be reopened.');
    }

    const updated = await Party.findByIdAndUpdate(
      party._id,
      { $set: { status: 'open', state: 'recruiting' } },
      { new: true }
    ).populate(POPULATE).lean();

    broadcastSlotUpdate(updated);
    const view = toPartyView(updated, req.user._id);
    await attachChatMeta([view], req.user._id);
    res.status(200).json({ party: view });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/lfg/:id/leave — a member leaves.
 * Eviction is immediate: the socket is pulled out of the squad room in the same
 * request, so a departed player never sees another line of squad chat.
 */
const leaveParty = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid squad id');

    const party = await Party.findById(req.params.id).lean();
    if (!party) throw notFound('Squad not found');

    if (idOf(party.leaderId) === String(req.user._id)) {
      throw badRequest('Close the squad instead of leaving it.');
    }
    if (!(party.members || []).some((m) => idOf(m.userId) === String(req.user._id))) {
      throw notFound('You are not in this squad.');
    }

    await Party.updateOne(
      { _id: party._id },
      { $pull: { members: { userId: req.user._id } } }
    );

    const chat = await removeMemberFromChat(party._id, req.user._id);
    if (chat) evictUserFromSquadChat(req.user._id, chat._id);

    await notifyUser({
      userId: idOf(party.leaderId),
      type: 'lfg_request',
      title: `@${req.user.username} left your squad`,
      message: `The ${party.gameTitle} squad has an open slot again.`,
      actionUrl: '/lfg',
      metadata: { partyId: String(party._id), departedId: String(req.user._id) }
    });

    const fresh = await Party.findById(party._id).populate(POPULATE).lean();
    broadcastSlotUpdate(fresh);

    res.status(200).json({ left: true, partyId: String(party._id) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listParties,
  listMyParties,
  createParty,
  getParty,
  requestJoin,
  respondToRequest,
  closeParty,
  lockParty,
  unlockParty,
  leaveParty
};
