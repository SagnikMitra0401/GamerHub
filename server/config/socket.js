const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Community = require('../models/Community');
const Channel   = require('../models/Channel');
const Message   = require('../models/Message');
const User      = require('../models/User');
const Attachment = require('../models/Attachment');
const Conversation = require('../models/Conversation');
const BusinessTeamMember = require('../models/BusinessTeamMember');

const { CHAT_POLICY } = require('./chatPolicy');
const {
  CAP, communityPermissions, roleAtLeast, isAppStaff, findMember
} = require('../utils/permissions');
const { normalizeMessageText, escapeRegex } = require('../utils/sanitize');
const {
  extractMentionNames, mentionsEveryone, replyPreview, MAX_MENTIONS_PER_MESSAGE
} = require('../utils/mentions');
const { resolveAttachments } = require('../utils/attachmentRefs');
const {
  toChatView, toMessageView, loadChatForUser, postSquadMessage
} = require('../utils/squadChatService');
const { createSlidingWindowLimiter, createRecentEventTracker } = require('../utils/rateLimiter');
const { recordAudit } = require('../utils/audit');
const { canParticipate } = require('../utils/privacy');
const { corsOrigin } = require('../utils/origins');

/** Live Socket.io instance (controllers broadcast channel/member changes). */
let ioInstance = null;
const getIO = () => ioInstance;

const emitToChannel = (channelId, event, payload) =>
  ioInstance?.to(`channel:${channelId}`).emit(event, payload);

const emitToCommunity = (communityId, event, payload) =>
  ioInstance?.to(`community:${communityId}`).emit(event, payload);

/**
 * Force a user's live sockets out of ONE server's rooms.
 * Without this, a kicked (or departed) member keeps receiving new messages in
 * their open tab until they reload. Channel rooms are scoped by the map built
 * in `join_channel`, so being removed from server A never drops the user out of
 * server B's live chat.
 */
function evictUserFromCommunity(userId, communityId) {
  if (!ioInstance) return;
  const target = String(communityId);

  for (const socket of ioInstance.sockets.sockets.values()) {
    if (!socket.user || String(socket.user._id) !== String(userId)) continue;

    const joined = socket.data?.joinedChannels; // channelId -> communityId

    for (const room of [...socket.rooms]) {
      if (!room.startsWith('channel:')) continue;
      const channelId = room.slice('channel:'.length);
      const owner = joined?.get?.(channelId);
      if (owner && owner !== target) continue; // belongs to another server
      socket.leave(room);
      joined?.delete?.(channelId);
    }

    socket.leave(`community:${target}`);
    socket.emit('membership_revoked', { communityId: target });
  }
}

/**
 * Remove a user's live sockets from a business owner's shared threads.
 * REST and the join check enforce revocation; this stops an already-open tab
 * from receiving more messages before its next request.
 */
async function evictUserFromBusinessThreads(userId, businessOwnerId) {
  if (!ioInstance) return;

  const conversations = await Conversation.find({
    businessThread: true,
    participantIds: businessOwnerId
  }).select('_id').lean();
  if (!conversations.length) return;

  for (const socket of ioInstance.sockets.sockets.values()) {
    if (!socket.user || String(socket.user._id) !== String(userId)) continue;
    for (const conversation of conversations) {
      socket.leave(`dm:${conversation._id}`);
    }
    socket.emit('team_access_revoked', { ownerId: String(businessOwnerId) });
  }
}

/**
 * Remove a user's live sockets from ONE squad chat room.
 * Used when they leave the squad, are removed, or the squad is closed — the
 * authoritative check also blocks them, but this stops delivery immediately.
 */
function evictUserFromSquadChat(userId, chatId) {
  if (!ioInstance) return;
  const room = `squad:${String(chatId)}`;

  for (const socket of ioInstance.sockets.sockets.values()) {
    if (!socket.user || String(socket.user._id) !== String(userId)) continue;
    socket.leave(room);
    if (socket.data?.squadChat === String(chatId)) socket.data.squadChat = null;
    socket.emit('squad_chat_evicted', { chatId: String(chatId) });
  }
}

/**
 * Update the cached status on a user's live sockets.
 *
 * The handshake snapshot is what the participation guard reads, so a freeze
 * must also flip open connections — otherwise an already-connected tab keeps
 * its pre-freeze `active` status until it reconnects.
 */
function setUserFrozenState(userId, frozen) {
  if (!ioInstance || !userId) return 0;
  let updated = 0;
  for (const socket of ioInstance.sockets.sockets.values()) {
    if (!socket.user || String(socket.user._id) !== String(userId)) continue;
    socket.user.status = frozen ? 'frozen' : 'active';
    updated += 1;
  }
  return updated;
}

/** Drop every live socket for a user (account deletion / "sign out everywhere"). */
function disconnectUser(userId) {
  if (!ioInstance || !userId) return 0;
  let closed = 0;
  for (const socket of ioInstance.sockets.sockets.values()) {
    if (!socket.user || String(socket.user._id) !== String(userId)) continue;
    socket.disconnect(true);
    closed += 1;
  }
  return closed;
}

/**
 * Rebuild the mention list from the message text.
 *
 * Nothing the client sends about identity is trusted: names are matched against
 * real users, then filtered down to members of this community, and only
 * `@everyone` requires the MENTION_EVERYONE capability.
 */
async function resolveMentions({ text, community, permissions }) {
  const everyoneRequested = mentionsEveryone(text);
  const everyoneAllowed = everyoneRequested && permissions.includes(CAP.MENTION_EVERYONE);

  const names = extractMentionNames(text).slice(0, 20);
  if (!names.length) return { mentions: [], everyoneRequested, everyoneAllowed };

  // Case-insensitive exact match, anchored so `@ali` never resolves to `@alice`.
  const pattern = new RegExp(`^(${names.map(escapeRegex).join('|')})$`, 'i');
  const users = await User.find({ username: pattern }).select('_id username').lean();

  const memberIds = new Set(
    (community.members || []).map((member) => String(member.userId?._id ?? member.userId))
  );

  const mentions = [];
  for (const user of users) {
    if (!memberIds.has(String(user._id))) continue;
    mentions.push({ userId: user._id, username: user.username });
    if (mentions.length >= MAX_MENTIONS_PER_MESSAGE) break;
  }

  return { mentions, everyoneRequested, everyoneAllowed };
}

// ── Abuse control (per-user, shared across tabs/sockets) ────────────────────
const floodLimiter = createSlidingWindowLimiter({
  windowMs: CHAT_POLICY.flood.windowMs,
  max: CHAT_POLICY.flood.maxMessages
});
const slowmodeTracker = createRecentEventTracker({
  maxAgeMs: CHAT_POLICY.slowmode.maxSeconds * 1000
});
const typingTracker = createRecentEventTracker({
  maxAgeMs: CHAT_POLICY.typing.indicatorTtlMs
});
// Separate budget for temporary squad chat: a rapid squad exchange must not
// consume the community-chat allowance (or vice versa).
const squadFloodLimiter = createSlidingWindowLimiter({
  windowMs: CHAT_POLICY.flood.windowMs,
  max: CHAT_POLICY.flood.maxMessages
});
// Room joins run two database reads each. A tab joins a handful of times per
// session; a script can join thousands of times a minute, so the budget is
// generous for people and prohibitive for a loop.
const joinLimiter = createSlidingWindowLimiter({
  windowMs: 60_000,
  max: Number(process.env.SOCKET_JOIN_RATE_MAX) || 60
});
const MAX_SOCKETS_PER_USER = Number(process.env.SOCKET_MAX_PER_USER) || 8;

/** Reset all in-memory trackers (used by tests). */
function resetChatTrackers() {
  floodLimiter.reset();
  slowmodeTracker.reset();
  typingTracker.reset();
  squadFloodLimiter.reset();
  joinLimiter.reset();
}

function parseCookie(cookieStr) {
  if (!cookieStr) return {};
  return cookieStr.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return acc;
    const key = decodeURIComponent(pair.slice(0, idx).trim());
    const value = decodeURIComponent(pair.slice(idx + 1).trim());
    if (key && value) acc[key] = value;
    return acc;
  }, {});
}

const fail = (socket, message, code) => socket.emit('error_msg', { message, ...(code ? { code } : {}) });

// ── Presence ────────────────────────────────────────────────────────────────
// Counted per user, not per socket: closing one of three tabs must not make a
// player look offline. An 'invisible' player is never flipped to online.
const presenceSockets = new Map();

async function markPresenceOnConnect(socket, userId) {
  if (!userId) return;
  const next = (presenceSockets.get(userId) || 0) + 1;
  presenceSockets.set(userId, next);
  if (next > 1) return;

  try {
    const user = await User.findById(userId).select('presence username status').lean();
    // A frozen account never broadcasts presence, not even to its own tabs.
    if (user?.status === 'frozen') return;
    const status = user?.presence?.status || 'offline';
    if (status !== 'offline') return; // in_game / invisible are explicit choices

    await User.updateOne(
      { _id: userId },
      { $set: { 'presence.status': 'online', 'presence.lastActive': new Date() } }
    );
    ioInstance?.emit('presence_change', {
      userId,
      username: user?.username || socket.user?.username || null,
      status: 'online',
      activeGame: user?.presence?.activeGame || ''
    });
  } catch (err) {
    console.error('[Socket] presence connect error:', err.message);
  }
}

async function markPresenceOnDisconnect(io, userId) {
  if (!userId) return;
  const remaining = (presenceSockets.get(userId) || 1) - 1;
  if (remaining > 0) {
    presenceSockets.set(userId, remaining);
    return;
  }
  presenceSockets.delete(userId);

  // Shutting down: skip the write instead of logging a closed-connection error.
  if (mongoose.connection.readyState !== 1) return;

  try {
    const user = await User.findById(userId).select('presence username').lean();
    if (!user || user.presence?.status === 'invisible') return;

    await User.updateOne(
      { _id: userId },
      { $set: { 'presence.status': 'offline', 'presence.activeGame': '', 'presence.lastActive': new Date() } }
    );
    io.emit('presence_change', {
      userId,
      username: user.username,
      status: 'offline',
      activeGame: ''
    });
  } catch (err) {
    console.error('[Socket] presence disconnect error:', err.message);
  }
}

/**
 * Resolve the channel + its community. The community is ALWAYS derived from
 * channel.communityId — never from the client payload — which closes the
 * cross-community injection hole.
 */
async function loadChannelContext(channelId) {
  if (!channelId || !mongoose.Types.ObjectId.isValid(String(channelId))) return null;
  const channel = await Channel.findById(channelId).lean();
  if (!channel) return null;
  const community = await Community.findById(channel.communityId).lean();
  if (!community) return null;
  return { channel, community };
}

/**
 * @param {import('http').Server} httpServer
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e5, // 100 kB — a message is at most 1000 chars
    pingTimeout: 20000,
    pingInterval: 25000
  });
  ioInstance = io;

  // ── Auth handshake ────────────────────────────────────────────────────────
  // httpOnly cookie first; bearer token only from the auth payload (never the
  // query string, which ends up in access logs and proxies).
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie);
      const token = socket.handshake.auth?.token || cookies.jwt;
      if (!token) {
        socket.user = null;
        return next();
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const targetId = decoded.userId || decoded._id || decoded.id;
      if (!targetId) {
        socket.user = null;
        return next();
      }

      const user = await User.findById(targetId)
        .select('_id username level role medals status')
        .lean();
      socket.user = user || null;

      // Bound the number of live sockets per account. Every socket holds rooms,
      // presence bookkeeping and listeners; without a cap one account can grow
      // the process until the container is killed.
      if (user) {
        const target = String(user._id);
        let live = 0;
        for (const existing of io.sockets.sockets.values()) {
          if (existing.user && String(existing.user._id) === target) live += 1;
        }
        if (live >= MAX_SOCKETS_PER_USER) {
          return next(new Error('TOO_MANY_CONNECTIONS'));
        }
      }

      return next();
    } catch {
      socket.user = null;
      return next();
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?._id ? String(socket.user._id) : null;

    // channelId -> communityId, so eviction can be scoped to one server.
    socket.data.joinedChannels = new Map();

    // Private room for per-user pushes (notifications, LFG requests).
    if (userId) socket.join(`user:${userId}`);

    // Fire-and-forget: awaiting here would delay listener registration and a
    // `join_channel` sent right after connect could be missed. The function
    // handles its own errors.
    markPresenceOnConnect(socket, userId);

    const leaveChannelRooms = () => {
      for (const room of [...socket.rooms]) {
        if (!room.startsWith('channel:')) continue;
        socket.leave(room);
        socket.data.joinedChannels.delete(room.slice('channel:'.length));
      }
    };

    // ── join_channel ────────────────────────────────────────────────────────
    socket.on('join_channel', async (payload = {}) => {
      try {
        if (!userId) return fail(socket, 'You must be logged in to read this channel.', 'UNAUTHENTICATED');

        const joins = joinLimiter.consume(userId);
        if (!joins.allowed) {
          return fail(socket, 'You are joining channels too quickly. Slow down.', 'RATE_LIMITED');
        }

        const ctx = await loadChannelContext(payload.channelId);
        if (!ctx) return fail(socket, 'Channel not found.', 'NOT_FOUND');

        const { channel, community } = ctx;
        const { role, permissions } = communityPermissions(community, userId);

        if (!permissions.includes(CAP.VIEW_CHANNEL) || !roleAtLeast(role, channel.minRoleToRead)) {
          return fail(socket, 'You do not have permission to view this channel.', 'FORBIDDEN');
        }

        leaveChannelRooms();
        for (const room of [...socket.rooms]) {
          if (room.startsWith('community:')) socket.leave(room);
        }

        socket.join(`channel:${channel._id}`);
        socket.join(`community:${community._id}`);
        socket.data.joinedChannels.set(String(channel._id), String(community._id));

        socket.emit('joined_channel', {
          channelId: String(channel._id),
          communityId: String(community._id),
          role,
          permissions
        });
      } catch (err) {
        console.error('[Socket] join_channel error:', err.message);
        fail(socket, 'Could not join this channel.', 'INTERNAL');
      }
    });

    socket.on('leave_channel', (payload = {}) => {
      if (!payload.channelId) return;
      const channelId = String(payload.channelId);
      socket.leave(`channel:${channelId}`);
      socket.data.joinedChannels.delete(channelId);
      typingTracker.set(`${userId}:${channelId}`);
    });

    // ── send_message ────────────────────────────────────────────────────────
    socket.on('send_message', async (payload = {}) => {
      try {
        if (!userId) return fail(socket, 'You must be logged in to send messages.', 'UNAUTHENTICATED');

        // A frozen account may read, but not take part. Mirrors the REST guard.
        const gate = canParticipate(socket.user);
        if (!gate.ok) return fail(socket, gate.reason, gate.code);

        // 1. Per-user flood control (across every socket this user has open)
        const flood = floodLimiter.consume(userId);
        if (!flood.allowed) {
          const seconds = Math.max(1, Math.ceil(flood.retryAfterMs / 1000));
          return fail(socket, `Slow down! Try again in ${seconds}s.`, 'FLOOD');
        }

        // 2. Resolve channel + community from the server side only
        const ctx = await loadChannelContext(payload.channelId);
        if (!ctx) return fail(socket, 'Channel not found.', 'NOT_FOUND');

        const { channel, community } = ctx;
        const { role, permissions } = communityPermissions(community, userId);

        if (!permissions.includes(CAP.SEND_MESSAGES) || !roleAtLeast(role, channel.minRoleToWrite)) {
          return fail(socket, 'You do not have permission to post in this channel.', 'FORBIDDEN');
        }

        // Forum channels use threads; there is no live stream to post into.
        if (channel.type === 'forum') {
          return fail(socket, 'This is a forum channel. Start a thread instead.', 'FORUM_CHANNEL');
        }

        // Announcement channels are staff-only by design.
        if (channel.type === 'announcement' && !roleAtLeast(role, 'moderator')) {
          return fail(socket, 'Only moderators can post in announcement channels.', 'FORBIDDEN');
        }

        // 3. Timed suspension (server-owned clock, never the client's).
        const member = findMember(community, userId);
        if (member?.timeoutUntil && new Date(member.timeoutUntil).getTime() > Date.now()) {
          return fail(
            socket,
            `You are timed out until ${new Date(member.timeoutUntil).toLocaleString()}.`,
            'TIMEOUT'
          );
        }

        // 4. Attachments must already be uploaded by THIS user into THIS channel.
        const attachmentIds = await resolveAttachments({
          attachmentIds: payload.attachmentIds,
          channelId: channel._id,
          communityId: community._id,
          uploaderId: userId
        });

        // Uploads disabled after the fact must not be attachable either.
        if (attachmentIds.length && channel.attachmentsEnabled === false) {
          return fail(socket, 'Attachments are disabled in this channel.', 'FORBIDDEN');
        }

        // 5. Normalise text (control chars, bidi overrides, zero-width, length).
        //    An image-only message is allowed when the upload succeeded.
        const normalized = normalizeMessageText(payload.text ?? '', CHAT_POLICY);
        if (!normalized.ok && !attachmentIds.length) {
          return fail(socket, normalized.reason, 'INVALID_MESSAGE');
        }
        const text = normalized.ok ? normalized.text : '';

        // 6. Slowmode (moderators+ bypass it)
        if (channel.slowModeSeconds > 0 && !permissions.includes(CAP.BYPASS_SLOWMODE)) {
          const key = `${userId}:${channel._id}`;
          const lastSent = slowmodeTracker.get(key);
          const elapsed = Date.now() - lastSent;
          if (lastSent && elapsed < channel.slowModeSeconds * 1000) {
            const waitSeconds = Math.ceil((channel.slowModeSeconds * 1000 - elapsed) / 1000);
            return fail(socket, `Slowmode is enabled. Wait ${waitSeconds}s.`, 'SLOWMODE');
          }
          slowmodeTracker.set(key);
        }

        // 7. Reply context: only a message in the SAME channel may be quoted.
        let replyTo = null;
        if (payload.replyTo?.messageId && mongoose.Types.ObjectId.isValid(String(payload.replyTo.messageId))) {
          const target = await Message.findOne({
            _id: payload.replyTo.messageId,
            channelId: channel._id
          }).select('senderId text isDeleted').populate('senderId', 'username').lean();

          if (target) {
            replyTo = {
              messageId: target._id,
              senderName: target.senderId?.username || null,
              preview: target.isDeleted ? '[deleted]' : replyPreview(target.text)
            };
          }
        }

        // 8. Mentions: rebuild from text, restricted to real members.
        const { mentions, everyoneRequested, everyoneAllowed } = await resolveMentions({
          text,
          community,
          permissions
        });

        // 9. Persist raw text (React escapes on render — no double encoding)
        const message = await Message.create({
          channelId: channel._id,
          communityId: community._id, // derived, never client-supplied
          senderId: userId,
          text,
          replyTo,
          mentions,
          attachments: attachmentIds
        });

        if (attachmentIds.length) {
          await Attachment.updateMany(
            { _id: { $in: attachmentIds } },
            { $set: { messageId: message._id } }
          );
        }

        const populated = await message.populate([
          { path: 'senderId', select: 'username level role medals' },
          { path: 'attachments', select: 'mimeType sizeBytes width height' }
        ]);

        const payloadOut = {
          ...populated.toObject(),
          // `communityRole` is the *server* role — distinct from the platform role
          // inside senderId.role — so clients can render the right badge.
          communityRole: role,
          mentionsEveryone: everyoneRequested && everyoneAllowed
        };

        emitToChannel(channel._id, 'new_message', payloadOut);

        // 10. Mention pings are best-effort and never delay the broadcast.
        //     Required lazily: notify.js calls this module's getIO(), so a
        //     top-level import would capture an empty exports object mid-load.
        const { notifyUser } = require('../utils/notify');
        for (const mention of mentions) {
          notifyUser({
            userId: mention.userId,
            type: 'social',
            title: `${socket.user.username} mentioned you`,
            message: text.slice(0, 140),
            actionUrl: `/communities/${community.slug}`,
            metadata: {
              kind: 'mention',
              communityId: String(community._id),
              channelId: String(channel._id),
              messageId: String(message._id)
            }
          });
        }
      } catch (err) {
        console.error('[Socket] send_message error:', err.message);
        fail(socket, 'Could not send that message.', 'INTERNAL');
      }
    });

    // ── delete_message (author, server moderators, platform staff) ──────────
    socket.on('delete_message', async (payload = {}) => {
      try {
        if (!userId) return fail(socket, 'You must be logged in.', 'UNAUTHENTICATED');
        if (!payload.messageId || !mongoose.Types.ObjectId.isValid(String(payload.messageId))) {
          return fail(socket, 'Message not found.', 'NOT_FOUND');
        }

        const message = await Message.findById(payload.messageId);
        if (!message || message.isDeleted) return fail(socket, 'Message not found.', 'NOT_FOUND');

        const community = await Community.findById(message.communityId).lean();
        if (!community) return fail(socket, 'Community not found.', 'NOT_FOUND');

        const { role, permissions } = communityPermissions(community, userId);
        const isAuthor = String(message.senderId) === userId;
        const canModerate = permissions.includes(CAP.MANAGE_MESSAGES) || isAppStaff(socket.user);

        if (!isAuthor && !canModerate) {
          return fail(socket, 'You do not have permission to delete this message.', 'FORBIDDEN');
        }

        message.isDeleted = true;
        message.deletedAt = new Date();
        message.deletedBy = userId;
        message.text = 'This message was deleted';
        await message.save();

        if (!isAuthor) {
          recordAudit({
            communityId: community._id,
            actorId: userId,
            actionType: 'MESSAGE_PURGE',
            targetId: message._id,
            targetModel: 'Message',
            metadata: {
              channelId: String(message.channelId),
              authorId: String(message.senderId),
              role
            }
          });
        }

        // Broadcast to the message's real channel, not a client-supplied one.
        emitToChannel(message.channelId, 'message_deleted', {
          messageId: String(message._id),
          channelId: String(message.channelId)
        });
      } catch (err) {
        console.error('[Socket] delete_message error:', err.message);
        fail(socket, 'Could not delete that message.', 'INTERNAL');
      }
    });

    // ── direct-message rooms ────────────────────────────────────────────────
    // The room is only a delivery channel. It never grants read access: REST
    // checks membership on every call, and this join checks it again so a
    // guessed id cannot subscribe to live messages.
    socket.on('join_conversation', async (payload = {}) => {
      try {
        if (!userId) return fail(socket, 'Sign in to open this conversation.', 'UNAUTHENTICATED');

        const joins = joinLimiter.consume(userId);
        if (!joins.allowed) {
          return fail(socket, 'You are opening conversations too quickly. Slow down.', 'RATE_LIMITED');
        }

        const conversationId = String(payload.conversationId || '');
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
          return fail(socket, 'Conversation not found.', 'NOT_FOUND');
        }

        const conversation = await Conversation.findById(conversationId)
          .select('participantIds state businessThread')
          .lean();
        const isParticipant = conversation?.participantIds?.some((id) => String(id) === userId);
        // An active shared-inbox teammate may open the business thread even
        // though the owner, not the teammate, is the conversation participant.
        const isTeamMember = !isParticipant && conversation?.businessThread
          ? Boolean(await BusinessTeamMember.exists({
              memberId: userId,
              businessOwnerId: { $in: conversation.participantIds },
              status: 'active'
            }))
          : false;
        if (!conversation || (!isParticipant && !isTeamMember)) {
          return fail(socket, 'Conversation not found.', 'NOT_FOUND');
        }
        if (conversation.state !== 'active') {
          return fail(socket, 'Accept this request before opening the conversation.', 'FORBIDDEN');
        }

        socket.join(`dm:${conversation._id}`);
        socket.emit('joined_conversation', { conversationId: String(conversation._id) });
      } catch (err) {
        console.error('[Socket] join_conversation error:', err.message);
        fail(socket, 'Could not open that conversation.', 'INTERNAL');
      }
    });

    socket.on('leave_conversation', (payload = {}) => {
      if (payload.conversationId) socket.leave(`dm:${String(payload.conversationId)}`);
    });

    // ── squad chat (temporary, 15 days) ─────────────────────────────────────
    // Membership and expiry are resolved by the service on every join and send:
    // the room name alone is never treated as authorisation.
    socket.on('join_squad_chat', async (payload = {}) => {
      try {
        if (!userId) return fail(socket, 'Sign in to open this squad chat.', 'UNAUTHENTICATED');

        const joins = joinLimiter.consume(userId);
        if (!joins.allowed) {
          return fail(socket, 'You are joining chats too quickly. Slow down.', 'RATE_LIMITED');
        }

        const chat = await loadChatForUser(payload.chatId, userId);
        socket.join(`squad:${chat._id}`);
        socket.data.squadChat = String(chat._id);

        socket.emit('joined_squad_chat', { chat: toChatView(chat, userId) });
      } catch (err) {
        const code = err.statusCode === 404 ? 'NOT_FOUND' : err.statusCode === 403 ? 'FORBIDDEN' : 'INTERNAL';
        fail(socket, err.message || 'Could not open that squad chat.', code);
      }
    });

    socket.on('send_squad_message', async (payload = {}) => {
      try {
        if (!userId) return fail(socket, 'Sign in to send messages.', 'UNAUTHENTICATED');

        const gate = canParticipate(socket.user);
        if (!gate.ok) return fail(socket, gate.reason, gate.code);

        const flood = squadFloodLimiter.consume(userId);
        if (!flood.allowed) {
          const seconds = Math.max(1, Math.ceil(flood.retryAfterMs / 1000));
          return fail(socket, `Slow down! Try again in ${seconds}s.`, 'FLOOD');
        }

        const chat = await loadChatForUser(payload.chatId, userId);
        const message = await postSquadMessage({ chat, user: socket.user, text: payload.text });

        ioInstance.to(`squad:${chat._id}`).emit('squad_message', toMessageView(message));
      } catch (err) {
        const code = err.statusCode === 404 ? 'NOT_FOUND'
          : err.statusCode === 403 ? 'FORBIDDEN'
            : err.statusCode === 400 ? 'INVALID_MESSAGE'
              : 'INTERNAL';
        fail(socket, err.message || 'Could not send that message.', code);
      }
    });

    socket.on('leave_squad_chat', (payload = {}) => {
      if (!payload.chatId) return;
      socket.leave(`squad:${String(payload.chatId)}`);
      if (socket.data?.squadChat === String(payload.chatId)) socket.data.squadChat = null;
    });

    // ── typing indicators ───────────────────────────────────────────────────
    const handleTyping = async (payload = {}, typing) => {
      if (!userId || !payload.channelId) return;
      const cid = String(payload.channelId);

      if (typing) {
        if (!typingTracker.touch(`${userId}:${cid}`, CHAT_POLICY.typing.throttleMs)) return;
      } else {
        typingTracker.set(`${userId}:${cid}`);
      }

      const ctx = await loadChannelContext(cid);
      if (!ctx) return;
      const { role, permissions } = communityPermissions(ctx.community, userId);
      if (!permissions.includes(CAP.VIEW_CHANNEL) || !roleAtLeast(role, ctx.channel.minRoleToRead)) return;

      socket.to(`channel:${cid}`).emit(typing ? 'user_typing' : 'user_stopped_typing', {
        userId,
        username: socket.user.username
      });
    };

    socket.on('typing_start', (payload) => handleTyping(payload, true));
    socket.on('typing_stop', (payload) => handleTyping(payload, false));

    socket.on('disconnect', () => {
      for (const room of [...socket.rooms]) {
        if (room.startsWith('channel:')) {
          socket.to(room).emit('user_stopped_typing', {
            userId,
            username: socket.user?.username
          });
        }
      }
      markPresenceOnDisconnect(io, userId);
    });
  });

  return io;
}

module.exports = {
  initSocket,
  getIO,
  emitToChannel,
  emitToCommunity,
  evictUserFromCommunity,
  evictUserFromBusinessThreads,
  evictUserFromSquadChat,
  disconnectUser,
  setUserFrozenState,
  resetChatTrackers
};
