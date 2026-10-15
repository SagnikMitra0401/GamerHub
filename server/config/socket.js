const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const Community  = require('../models/Community');
const Channel    = require('../models/Channel');
const Message    = require('../models/Message');

const User       = require('../models/User');

const ROLE_LEVELS = { member: 0, moderator: 1, admin: 2, owner: 3 };

function parseCookie(cookieStr) {
  if (!cookieStr) return {};
  return cookieStr.split(';').reduce((acc, pair) => {
    const [k, v] = pair.trim().split('=');
    if (k && v) acc[decodeURIComponent(k)] = decodeURIComponent(v);
    return acc;
  }, {});
}

function roleAtLeast(userRole, minRole) {
  return (ROLE_LEVELS[userRole] ?? -1) >= (ROLE_LEVELS[minRole] ?? 99);
}

/**
 * Initialise Socket.io on the HTTP server and wire community channel events.
 * @param {import('http').Server} httpServer
 */
function initSocket(httpServer) {
  const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map(u => u.trim().replace(/\/$/, ''))
    : [];

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const clean = origin.replace(/\/$/, '');
        const ok = allowedOrigins.includes(clean) || clean.endsWith('.vercel.app');
        ok ? cb(null, true) : cb(new Error(`Socket.io CORS blocked: ${origin}`));
      },
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // ── Auth Middleware ─────────────────────────────────────────────────────
  // Extract token from httpOnly cookie or auth handshake
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie);
      const token = socket.handshake.auth?.token || cookies.jwt || socket.handshake.query?.token;

      if (!token) {
        socket.user = null;
        return next();
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const targetId = decoded.userId || decoded._id || decoded.id;

      if (targetId) {
        const dbUser = await User.findById(targetId).select('_id username level role medals').lean();
        socket.user = dbUser || null;
      } else {
        socket.user = null;
      }
      next();
    } catch {
      socket.user = null;
      next();
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?._id;

    // ── join_channel ──────────────────────────────────────────────────────
    // Client calls this when they open a channel pane
    socket.on('join_channel', async ({ channelId, communityId }) => {
      try {
        const channel   = await Channel.findById(channelId);
        const community = await Community.findById(communityId);
        if (!channel || !community) return;

        // Permission check: must have read access
        const memberEntry = userId
          ? community.members.find(m => m.userId.toString() === userId.toString())
          : null;
        const callerRole  = memberEntry?.role || null;

        if (!roleAtLeast(callerRole, channel.minRoleToRead)) {
          socket.emit('error_msg', { message: 'You do not have permission to view this channel.' });
          return;
        }

        // Leave any previously joined channel rooms (one channel at a time per socket)
        [...socket.rooms].forEach(room => {
          if (room.startsWith('channel:')) socket.leave(room);
        });

        socket.join(`channel:${channelId}`);
        socket.emit('joined_channel', { channelId });
      } catch (err) {
        console.error('[Socket] join_channel error:', err.message);
      }
    });

    // ── leave_channel ─────────────────────────────────────────────────────
    socket.on('leave_channel', ({ channelId }) => {
      socket.leave(`channel:${channelId}`);
    });

    // In-memory rate-limiter & slowmode tracker: Map<userId:channelId, lastMessageTimestamp>
    const userChannelActivity = new Map();
    // Global socket flood tracker: Array of timestamps
    const messageTimestamps = [];

    // Helper: basic HTML-safe sanitization to prevent stored XSS
    const escapeHtml = (str) => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // ── send_message ──────────────────────────────────────────────────────
    socket.on('send_message', async ({ channelId, communityId, text }) => {
      try {
        if (!userId) {
          socket.emit('error_msg', { message: 'You must be logged in to send messages.' });
          return;
        }

        // 1. Anti-Flood Socket Protection: Max 5 messages in 5 seconds per socket
        const now = Date.now();
        while (messageTimestamps.length > 0 && now - messageTimestamps[0] > 5000) {
          messageTimestamps.shift();
        }
        if (messageTimestamps.length >= 5) {
          socket.emit('error_msg', { message: 'Slow down! Too many messages sent too fast.' });
          return;
        }
        messageTimestamps.push(now);

        const rawText = (text || '').trim();
        if (!rawText || rawText.length > 1000) {
          socket.emit('error_msg', { message: 'Message must be between 1 and 1000 characters.' });
          return;
        }

        const sanitizedText = escapeHtml(rawText);

        const channel   = await Channel.findById(channelId);
        const community = await Community.findById(communityId);
        if (!channel || !community) return;

        const memberEntry = community.members.find(m => m.userId.toString() === userId.toString());
        if (!memberEntry) {
          socket.emit('error_msg', { message: 'You must be a community member to send messages.' });
          return;
        }

        if (!roleAtLeast(memberEntry.role, channel.minRoleToWrite)) {
          socket.emit('error_msg', { message: 'You do not have permission to post in this channel.' });
          return;
        }

        // 2. Slowmode enforcement (Admins & Owners bypass slowmode)
        if (channel.slowModeSeconds > 0 && !['owner', 'admin'].includes(memberEntry.role)) {
          const key = `${userId}:${channelId}`;
          const lastSent = userChannelActivity.get(key) || 0;
          const diff = Math.floor((now - lastSent) / 1000);
          if (diff < channel.slowModeSeconds) {
            const waitTime = channel.slowModeSeconds - diff;
            socket.emit('error_msg', { message: `Slowmode is enabled. Please wait ${waitTime}s before sending another message.` });
            return;
          }
          userChannelActivity.set(key, now);
        }

        // Persist message
        const message = await Message.create({
          channelId:   channel._id,
          communityId: community._id,
          senderId:    userId,
          text:        sanitizedText
        });

        // Populate sender for real-time display
        const populated = await message.populate('senderId', 'username level role medals');

        // Broadcast to everyone in this channel room (including sender)
        io.to(`channel:${channelId}`).emit('new_message', populated);
      } catch (err) {
        console.error('[Socket] send_message error:', err.message);
      }
    });

    // ── delete_message (GDPR Tombstone / Moderator Purge) ─────────────────
    socket.on('delete_message', async ({ messageId, channelId }) => {
      try {
        if (!userId) return;
        const msg = await Message.findById(messageId);
        if (!msg || msg.isDeleted) return;

        const community = await Community.findById(msg.communityId);
        if (!community) return;

        const memberEntry = community.members.find(m => m.userId.toString() === userId.toString());
        const isAuthor = msg.senderId.toString() === userId.toString();
        const canModerate = memberEntry && ['owner', 'admin', 'moderator'].includes(memberEntry.role);

        if (!isAuthor && !canModerate) {
          socket.emit('error_msg', { message: 'You do not have permission to delete this message.' });
          return;
        }

        // Apply tombstone soft-delete
        msg.isDeleted = true;
        msg.deletedAt = new Date();
        msg.deletedBy = userId;
        msg.text = 'This message was deleted';
        await msg.save();

        io.to(`channel:${channelId}`).emit('message_deleted', {
          messageId: msg._id,
          channelId
        });
      } catch (err) {
        console.error('[Socket] delete_message error:', err.message);
      }
    });

    // ── typing_start / typing_stop ────────────────────────────────────────
    let lastTypingEmit = 0;
    socket.on('typing_start', ({ channelId }) => {
      if (!userId || !socket.user) return;
      const now = Date.now();
      if (now - lastTypingEmit < 2000) return; // throttle typing notifications
      lastTypingEmit = now;
      socket.to(`channel:${channelId}`).emit('user_typing', {
        userId,
        username: socket.user.username
      });
    });

    socket.on('typing_stop', ({ channelId }) => {
      if (!userId || !socket.user) return;
      socket.to(`channel:${channelId}`).emit('user_stopped_typing', {
        userId,
        username: socket.user.username
      });
    });

    socket.on('disconnect', () => {
      userChannelActivity.clear();
    });
  });

  return io;
}

module.exports = { initSocket };
