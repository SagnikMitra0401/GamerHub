const mongoose = require('mongoose');

const SquadChatMessage = require('../models/SquadChatMessage');
const { getIO } = require('../config/socket');
const {
  toChatView,
  toMessageView,
  loadChatForUser,
  postSquadMessage,
  refreshSquadChat,
  listSquadMessages
} = require('../utils/squadChatService');
const { badRequest, forbidden, notFound } = require('../utils/httpError');

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const squadRoom = (chatId) => `squad:${String(chatId)}`;

/** GET /api/squad-chats/:chatId */
const getSquadChat = async (req, res, next) => {
  try {
    const chat = await loadChatForUser(req.params.chatId, req.user._id);
    res.status(200).json({ chat: toChatView(chat, req.user._id) });
  } catch (err) {
    next(err);
  }
};

/** GET /api/squad-chats/:chatId/messages?before=&limit= */
const getSquadMessages = async (req, res, next) => {
  try {
    const chat = await loadChatForUser(req.params.chatId, req.user._id);
    const page = await listSquadMessages(chat._id, {
      before: req.query.before,
      limit: req.query.limit
    });

    res.status(200).json({
      chat: toChatView(chat, req.user._id),
      items: page.items,
      nextCursor: page.nextCursor
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/squad-chats/:chatId/messages
 * The REST path mirrors the socket path; both go through the same service so
 * the expiry rule cannot drift between transports.
 */
const sendSquadMessage = async (req, res, next) => {
  try {
    const chat = await loadChatForUser(req.params.chatId, req.user._id);
    const message = await postSquadMessage({ chat, user: req.user, text: req.body?.text });
    const view = toMessageView(message);

    getIO()?.to(squadRoom(chat._id)).emit('squad_message', view);

    res.status(201).json({ message: view, chat: toChatView(chat, req.user._id) });
  } catch (err) {
    next(err);
  }
};

/** POST /api/squad-chats/:chatId/refresh — owner only, rolling 15 days. */
const refreshSquadChatHandler = async (req, res, next) => {
  try {
    const chat = await refreshSquadChat(req.params.chatId, req.user._id);
    const view = toChatView(chat, req.user._id);

    getIO()?.to(squadRoom(chat._id)).emit('squad_chat_refreshed', {
      chatId: String(chat._id),
      expiresAt: chat.expiresAt,
      refreshCount: chat.refreshCount
    });

    res.status(200).json({ chat: view });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/squad-chats/:chatId/messages/:messageId — author or squad leader. */
const deleteSquadMessage = async (req, res, next) => {
  try {
    if (!isId(req.params.messageId)) throw badRequest('Invalid message id');

    const chat = await loadChatForUser(req.params.chatId, req.user._id);
    const message = await SquadChatMessage.findOne({
      _id: req.params.messageId,
      chatId: chat._id
    });
    if (!message || message.isDeleted) throw notFound('Message not found');

    const isAuthor = String(message.authorUserId) === String(req.user._id);
    const isLeader = String(chat.ownerUserId) === String(req.user._id);
    if (!isAuthor && !isLeader) {
      throw forbidden('You cannot delete that message.');
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    message.text = '';
    await message.save();

    getIO()?.to(squadRoom(chat._id)).emit('squad_message_deleted', {
      chatId: String(chat._id),
      messageId: String(message._id)
    });

    res.status(200).json({ deleted: true, messageId: String(message._id) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSquadChat,
  getSquadMessages,
  sendSquadMessage,
  refreshSquadChat: refreshSquadChatHandler,
  deleteSquadMessage,
  squadRoom
};
