const { createLimiter } = require('../middleware/limiters');
const {
  listConversations,
  getConversation,
  createRequest,
  acceptRequest,
  declineRequest,
  archiveConversation,
  setMuted,
  setLabels,
  postMessage,
  markRead,
  reportConversation,
  summary
} = require('../utils/dmService');
const { getIO } = require('../config/socket');

const readLimiter = createLimiter({
  name: 'dm-read',
  windowMs: 60 * 1000,
  max: Number(process.env.DM_READ_RATE_LIMIT_MAX) || 180,
  message: 'You are refreshing your inbox very quickly. Give it a minute.'
});

const writeLimiter = createLimiter({
  name: 'dm-write',
  windowMs: 60 * 1000,
  max: Number(process.env.DM_WRITE_RATE_LIMIT_MAX) || 60,
  message: 'You are sending messages very quickly. Slow down for a moment.'
});

// The daily and weekly product quotas live in dmPolicy; this is only a coarse
// anti-script limit so one account cannot enumerate every profile.
const requestLimiter = createLimiter({
  name: 'dm-request',
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.DM_REQUEST_RATE_LIMIT_MAX) || 15,
  message: 'Too many message requests. Try again later.'
});

const emitToParticipants = (conversationId, event, payload) => {
  getIO()?.to(`dm:${String(conversationId)}`).emit(event, payload);
};

/** GET /api/messages/summary */
const getSummary = async (req, res, next) => {
  try {
    res.status(200).json(await summary({ userId: req.user._id }));
  } catch (err) {
    next(err);
  }
};

/** GET /api/messages/conversations?folder=inbox|requests|sent|archived */
const getConversations = async (req, res, next) => {
  try {
    const result = await listConversations({
      userId: req.user._id,
      folder: req.query.folder || 'inbox',
      scope: req.query.scope || 'all',
      unreadOnly: req.query.unread === '1',
      before: req.query.before || null,
      limit: req.query.limit
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** GET /api/messages/conversations/:id */
const getThread = async (req, res, next) => {
  try {
    const result = await getConversation({ conversationId: req.params.id, userId: req.user._id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/requests */
const startRequest = async (req, res, next) => {
  try {
    const result = await createRequest({
      sender: req.user,
      recipientId: req.body?.recipientId,
      text: req.body?.text,
      context: req.body?.context,
      intent: req.body?.intent,
      company: req.body?.company,
      website: req.body?.website,
      budgetBand: req.body?.budgetBand,
      timeline: req.body?.timeline
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/conversations/:id/accept */
const accept = async (req, res, next) => {
  try {
    const result = await acceptRequest({ conversationId: req.params.id, userId: req.user._id });
    emitToParticipants(req.params.id, 'dm_accepted', {
      conversationId: String(req.params.id),
      conversation: result.conversation
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/messages/conversations/:id/request — decline, never notify */
const decline = async (req, res, next) => {
  try {
    const result = await declineRequest({ conversationId: req.params.id, userId: req.user._id });
    emitToParticipants(req.params.id, 'dm_declined', { conversationId: String(req.params.id) });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/conversations/:id/messages */
const sendMessage = async (req, res, next) => {
  try {
    const result = await postMessage({
      conversationId: req.params.id,
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

/** POST /api/messages/conversations/:id/read */
const read = async (req, res, next) => {
  try {
    const result = await markRead({ conversationId: req.params.id, userId: req.user._id });
    emitToParticipants(req.params.id, 'dm_read', {
      conversationId: String(req.params.id),
      userId: String(req.user._id)
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/conversations/:id/archive */
const archive = async (req, res, next) => {
  try {
    const result = await archiveConversation({ conversationId: req.params.id, userId: req.user._id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/messages/conversations/:id/mute */
const mute = async (req, res, next) => {
  try {
    const result = await setMuted({
      conversationId: req.params.id,
      userId: req.user._id,
      muted: req.body?.muted !== false
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/messages/conversations/:id/labels */
const updateLabels = async (req, res, next) => {
  try {
    const result = await setLabels({
      conversationId: req.params.id,
      userId: req.user._id,
      labels: req.body?.labels
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/conversations/:id/report */
const report = async (req, res, next) => {
  try {
    const result = await reportConversation({
      conversationId: req.params.id,
      reporterId: req.user._id,
      reason: req.body?.reason,
      note: req.body?.note,
      messageIds: req.body?.messageIds,
      block: req.body?.block === true
    });
    res.status(201).json({
      reported: true,
      blocked: result.blocked
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSummary,
  getConversations,
  getThread,
  startRequest,
  accept,
  decline,
  sendMessage,
  read,
  archive,
  mute,
  updateLabels,
  report,
  readLimiter,
  writeLimiter,
  requestLimiter
};
