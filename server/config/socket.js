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

    // ── send_message ──────────────────────────────────────────────────────
    socket.on('send_message', async ({ channelId, communityId, text }) => {
      try {
        if (!userId) {
          socket.emit('error_msg', { message: 'You must be logged in to send messages.' });
          return;
        }

        const sanitizedText = (text || '').trim().slice(0, 1000);
        if (!sanitizedText) return;

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

    // ── typing_start / typing_stop ────────────────────────────────────────
    socket.on('typing_start', ({ channelId }) => {
      if (!userId || !socket.user) return;
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
      // Rooms auto-cleanup on disconnect
    });
  });

  return io;
}

module.exports = { initSocket };
