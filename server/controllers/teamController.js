const {
  listOwnerTeam,
  inviteTeamMember,
  respondToInvite,
  updateTeamRole,
  removeTeamMember,
  listWorkspaces,
  requireTeamAccess
} = require('../utils/businessTeam');
const {
  listTeamConversations,
  getTeamConversation,
  postTeamMessage,
  acceptTeamRequest,
  declineTeamRequest,
  markTeamRead
} = require('../utils/dmService');
const { getIO, evictUserFromBusinessThreads } = require('../config/socket');

const emitToParticipants = (conversationId, event, payload) => {
  getIO()?.to(`dm:${String(conversationId)}`).emit(event, payload);
};

/** GET /api/account/business/team */
const getBusinessTeam = async (req, res, next) => {
  try {
    res.status(200).json(await listOwnerTeam(req.user._id));
  } catch (err) {
    next(err);
  }
};

/** POST /api/account/business/team */
const inviteMember = async (req, res, next) => {
  try {
    const item = await inviteTeamMember({
      ownerId: req.user._id,
      username: req.body?.username,
      role: req.body?.role
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/account/business/team/:memberId */
const changeMemberRole = async (req, res, next) => {
  try {
    res.status(200).json(await updateTeamRole({
      ownerId: req.user._id,
      memberId: req.params.memberId,
      role: req.body?.role
    }));
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/account/business/team/:memberId */
const removeMember = async (req, res, next) => {
  try {
    const result = await removeTeamMember({
      ownerId: req.user._id,
      memberId: req.params.memberId,
      actorId: req.user._id
    });
    await evictUserFromBusinessThreads(req.params.memberId, req.user._id)
      .catch((err) => console.error('[Team] socket eviction failed:', err.message));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** GET /api/messages/team — active workspaces and pending invitations. */
const getWorkspaces = async (req, res, next) => {
  try {
    res.status(200).json(await listWorkspaces(req.user._id));
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/team/:ownerId/respond */
const respondInvite = async (req, res, next) => {
  try {
    res.status(200).json(await respondToInvite({
      ownerId: req.params.ownerId,
      memberId: req.user._id,
      accept: req.body?.accept
    }));
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/messages/team/:ownerId/leave */
const leaveTeam = async (req, res, next) => {
  try {
    const result = await removeTeamMember({
      ownerId: req.params.ownerId,
      memberId: req.user._id,
      actorId: req.user._id
    });
    await evictUserFromBusinessThreads(req.user._id, req.params.ownerId)
      .catch((err) => console.error('[Team] socket eviction failed:', err.message));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** GET /api/messages/team/:ownerId/conversations */
const getConversations = async (req, res, next) => {
  try {
    const access = await requireTeamAccess({
      ownerId: req.params.ownerId,
      memberId: req.user._id
    });
    const result = await listTeamConversations({
      ownerId: access.owner._id,
      memberId: req.user._id,
      role: access.role,
      folder: req.query.folder || 'inbox',
      unreadOnly: req.query.unread === '1',
      before: req.query.before || null,
      limit: req.query.limit
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** GET /api/messages/team/:ownerId/conversations/:id */
const getThread = async (req, res, next) => {
  try {
    const access = await requireTeamAccess({
      ownerId: req.params.ownerId,
      memberId: req.user._id
    });
    res.status(200).json(await getTeamConversation({
      conversationId: req.params.id,
      ownerId: access.owner._id,
      memberId: req.user._id,
      role: access.role
    }));
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/team/:ownerId/conversations/:id/messages */
const sendMessage = async (req, res, next) => {
  try {
    const access = await requireTeamAccess({
      ownerId: req.params.ownerId,
      memberId: req.user._id,
      write: true
    });
    const result = await postTeamMessage({
      conversationId: req.params.id,
      ownerId: access.owner._id,
      memberId: req.user._id,
      role: access.role,
      sender: req.user,
      text: req.body?.text
    });
    emitToParticipants(req.params.id, 'dm_message', result);
    if (result.autoReply) {
      emitToParticipants(req.params.id, 'dm_message', {
        message: result.autoReply,
        conversation: result.conversation
      });
    }
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/team/:ownerId/conversations/:id/accept */
const accept = async (req, res, next) => {
  try {
    const access = await requireTeamAccess({
      ownerId: req.params.ownerId,
      memberId: req.user._id,
      write: true
    });
    const result = await acceptTeamRequest({
      conversationId: req.params.id,
      ownerId: access.owner._id,
      role: access.role
    });
    emitToParticipants(req.params.id, 'dm_accepted', {
      conversationId: String(req.params.id),
      conversation: result.conversation
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/messages/team/:ownerId/conversations/:id/request */
const decline = async (req, res, next) => {
  try {
    const access = await requireTeamAccess({
      ownerId: req.params.ownerId,
      memberId: req.user._id,
      write: true
    });
    const result = await declineTeamRequest({
      conversationId: req.params.id,
      ownerId: access.owner._id,
      role: access.role
    });
    emitToParticipants(req.params.id, 'dm_declined', { conversationId: String(req.params.id) });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/team/:ownerId/conversations/:id/read */
const read = async (req, res, next) => {
  try {
    const access = await requireTeamAccess({
      ownerId: req.params.ownerId,
      memberId: req.user._id
    });
    const result = await markTeamRead({
      conversationId: req.params.id,
      ownerId: access.owner._id
    });
    emitToParticipants(req.params.id, 'dm_read', {
      conversationId: String(req.params.id),
      userId: String(access.owner._id)
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getBusinessTeam,
  inviteMember,
  changeMemberRole,
  removeMember,
  getWorkspaces,
  respondInvite,
  leaveTeam,
  getConversations,
  getThread,
  sendMessage,
  accept,
  decline,
  read
};
