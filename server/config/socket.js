const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Community = require('../models/Community');
const Channel   = require('../models/Channel');
const Message   = require('../models/Message');
const User      = require('../models/User');

const { CHAT_POLICY } = require('./chatPolicy');
const { CAP, communityPermissions, roleAtLeast, isAppStaff } = require('../utils/permissions');
const { normalizeMessageText } = require('../utils/sanitize');
const { createSlidingWindowLimiter, createRecentEventTracker } = require('../utils/rateLimiter');
const { recordAudit } = require('../utils/audit');
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

/** Reset all in-memory trackers (used by tests). */
function resetChatTrackers() {
  floodLimiter.reset();
  slowmodeTracker.reset();
  typingTracker.reset();
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
        .select('_id username level role medals')
        .lean();
      socket.user = user || null;
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

        // 1. Per-user flood control (across every socket this user has open)
        const flood = floodLimiter.consume(userId);
        if (!flood.allowed) {
          const seconds = Math.max(1, Math.ceil(flood.retryAfterMs / 1000));
          return fail(socket, `Slow down! Try again in ${seconds}s.`, 'FLOOD');
        }

        // 2. Normalise text (control chars, bidi overrides, zero-width, length)
        const normalized = normalizeMessageText(payload.text, CHAT_POLICY);
        if (!normalized.ok) return fail(socket, normalized.reason, 'INVALID_MESSAGE');

        // 3. Resolve channel + community from the server side only
        const ctx = await loadChannelContext(payload.channelId);
        if (!ctx) return fail(socket, 'Channel not found.', 'NOT_FOUND');

        const { channel, community } = ctx;
        const { role, permissions } = communityPermissions(community, userId);

        if (!permissions.includes(CAP.SEND_MESSAGES) || !roleAtLeast(role, channel.minRoleToWrite)) {
          return fail(socket, 'You do not have permission to post in this channel.', 'FORBIDDEN');
        }

        // Announcement channels are staff-only by design.
        if (channel.type === 'announcement' && !roleAtLeast(role, 'moderator')) {
          return fail(socket, 'Only moderators can post in announcement channels.', 'FORBIDDEN');
        }

        // 4. Slowmode (moderators+ bypass it)
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

        // 5. Persist raw text (React escapes on render — no double encoding)
        const message = await Message.create({
          channelId: channel._id,
          communityId: community._id, // derived, never client-supplied
          senderId: userId,
          text: normalized.text
        });

        const populated = await message.populate('senderId', 'username level role medals');
        // `communityRole` is the *server* role — distinct from the platform role
        // inside senderId.role — so clients can render the right badge.
        emitToChannel(channel._id, 'new_message', {
          ...populated.toObject(),
          communityRole: role
        });
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
  resetChatTrackers
};
