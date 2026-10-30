const mongoose = require('mongoose');

const SquadChat = require('../models/SquadChat');
const SquadChatMessage = require('../models/SquadChatMessage');
const { CHAT_POLICY } = require('../config/chatPolicy');
const { normalizeMessageText } = require('./sanitize');
const {
  expiryFrom, isExpired, isOpen, isChatMember, canRefresh, msRemaining, formatRemaining
} = require('./squadLifecycle');
const { badRequest, forbidden, notFound, conflict } = require('./httpError');

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const toChatView = (chat, userId, now = new Date()) => ({
  _id: String(chat._id),
  squadId: String(chat.squadId),
  state: chat.state,
  expiresAt: chat.expiresAt,
  msRemaining: msRemaining(chat, now),
  remainingLabel: formatRemaining(chat, now),
  refreshCount: chat.refreshCount || 0,
  isOwner: String(chat.ownerUserId) === String(userId),
  canRefresh: canRefresh(chat, userId, now).ok,
  participantCount: (chat.memberIds || []).length,
  lastRefreshedAt: chat.lastRefreshedAt
});

const toMessageView = (message) => ({
  _id: String(message._id),
  chatId: String(message.chatId),
  squadId: String(message.squadId),
  author: {
    id: String(message.authorUserId),
    username: message.authorUsername || 'player',
    level: message.authorLevel || 1
  },
  text: message.text,
  isDeleted: Boolean(message.isDeleted),
  createdAt: message.createdAt
});

/**
 * Create the single chat for a squad, or return the existing one.
 * Two concurrent "lock" calls race safely: the unique index rejects the second
 * write and the loser re-reads the winner's document.
 */
async function ensureSquadChat({ party, ownerUsername = '' }) {
  if (!party?._id) throw badRequest('Squad not found');

  const existing = await SquadChat.findOne({ squadId: party._id });
  if (existing) return existing;

  const memberIds = [...new Set((party.members || []).map((m) => String(m.userId?._id ?? m.userId)))]
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!memberIds.some((id) => String(id) === String(party.leaderId?._id ?? party.leaderId))) {
    memberIds.push(new mongoose.Types.ObjectId(String(party.leaderId?._id ?? party.leaderId)));
  }

  try {
    return await SquadChat.create({
      squadId: party._id,
      ownerUserId: party.leaderId?._id ?? party.leaderId,
      ownerUsername,
      memberIds,
      state: 'active',
      expiresAt: expiryFrom()
    });
  } catch (err) {
    if (err.code === 11000) return SquadChat.findOne({ squadId: party._id });
    throw err;
  }
}

/** Mark a chat expired in the database the first time somebody notices. */
async function markExpired(chat) {
  if (!chat || chat.state !== 'active') return chat;
  await SquadChat.updateOne(
    { _id: chat._id, state: 'active' },
    { $set: { state: 'expired' } }
  ).catch(() => {});
  chat.state = 'expired';
  return chat;
}

/**
 * Load a chat for a user, enforcing membership and request-time expiry.
 * The sweep is not trusted: even with the cron stopped, an expired chat is
 * refused here.
 */
async function loadChatForUser(chatId, userId) {
  if (!isId(chatId)) throw badRequest('Invalid squad chat id');

  const chat = await SquadChat.findById(chatId);
  if (!chat) throw notFound('Squad chat not found');
  if (!isChatMember(chat, userId)) throw forbidden('You are not part of this squad chat.');

  if (chat.state === 'closed') throw forbidden('This squad chat is closed.');
  if (isExpired(chat)) {
    await markExpired(chat);
    throw forbidden('This squad chat has expired.');
  }
  return chat;
}

/** Append a message. Text is normalised with the same policy as server chat. */
async function postSquadMessage({ chat, user, text }) {
  if (!chat || !user) throw badRequest('Message could not be sent');
  if (!isOpen(chat)) {
    await markExpired(chat);
    throw forbidden('This squad chat is not open.');
  }

  const normalized = normalizeMessageText(text ?? '', CHAT_POLICY);
  if (!normalized.ok) throw badRequest(normalized.reason);

  const message = await SquadChatMessage.create({
    chatId: chat._id,
    squadId: chat.squadId,
    authorUserId: user._id,
    authorUsername: user.username,
    authorLevel: user.level || 1,
    text: normalized.text
  });

  // Keep `lastRefreshedAt` distinct from activity: refresh is consent to keep
  // the thread alive, not a by-product of chatting.
  return message;
}

/** Owner-only rolling refresh. */
async function refreshSquadChat(chatId, userId) {
  const chat = await SquadChat.findById(chatId);
  if (!chat) throw notFound('Squad chat not found');

  const check = canRefresh(chat, userId);
  if (!check.ok) {
    if (check.code === 'NOT_FOUND') throw notFound(check.reason);
    if (check.code === 'FORBIDDEN') throw forbidden(check.reason);
    if (check.code === 'EXPIRED') {
      await markExpired(chat);
      throw forbidden(check.reason);
    }
    throw conflict(check.reason);
  }

  chat.expiresAt = expiryFrom();
  chat.lastRefreshedAt = new Date();
  chat.refreshCount = (chat.refreshCount || 0) + 1;
  chat.lifecycleVersion = (chat.lifecycleVersion || 1) + 1;
  await chat.save();
  return chat;
}

/** Cursor-paginated history, newest page first but returned oldest-first. */
async function listSquadMessages(chatId, { before, limit = 50 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), CHAT_POLICY.history.maxLimit);
  const query = { chatId, isDeleted: false };

  if (before) {
    const parsed = new Date(before);
    if (!Number.isNaN(parsed.getTime())) query.createdAt = { $lt: parsed };
  }

  const rows = await SquadChatMessage.find(query).sort({ createdAt: -1 }).limit(cap).lean();
  return {
    items: rows.reverse().map(toMessageView),
    nextCursor: rows.length === cap ? rows[0].createdAt : null
  };
}

/** Add a member to an existing chat, if there is one. */
async function addMemberToChat(squadId, userId) {
  if (!isId(squadId) || !isId(userId)) return null;
  return SquadChat.findOneAndUpdate(
    { squadId },
    { $addToSet: { memberIds: new mongoose.Types.ObjectId(String(userId)) } },
    { new: true }
  );
}

/** Evict a member (squad leave / kick). Returns the chat so the socket can notify. */
async function removeMemberFromChat(squadId, userId) {
  if (!isId(squadId) || !isId(userId)) return null;
  return SquadChat.findOneAndUpdate(
    { squadId },
    { $pull: { memberIds: new mongoose.Types.ObjectId(String(userId)) } },
    { new: true }
  );
}

/** Close (not expire) the chat — used when the squad is closed/cancelled. */
async function closeChatForSquad(squadId) {
  if (!isId(squadId)) return null;
  return SquadChat.findOneAndUpdate(
    { squadId, state: { $ne: 'closed' } },
    { $set: { state: 'closed' } },
    { new: true }
  );
}

module.exports = {
  toChatView,
  toMessageView,
  ensureSquadChat,
  markExpired,
  loadChatForUser,
  postSquadMessage,
  refreshSquadChat,
  listSquadMessages,
  addMemberToChat,
  removeMemberFromChat,
  closeChatForSquad
};
