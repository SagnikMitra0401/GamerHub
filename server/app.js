const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const authRoutes      = require('./routes/authRoutes');
const postRoutes      = require('./routes/postRoutes');
const commentRoutes   = require('./routes/commentRoutes');
const userRoutes      = require('./routes/userRoutes');
const communityRoutes = require('./routes/communityRoutes');
const lfgRoutes       = require('./routes/lfgRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const accountRoutes   = require('./routes/accountRoutes');
const invitationRoutes = require('./routes/invitationRoutes');
const squadChatRoutes = require('./routes/squadChatRoutes');
const gameRoutes      = require('./routes/gameRoutes');
const adminRoutes     = require('./routes/adminRoutes');
const botRoutes       = require('./routes/botRoutes');
const dmRoutes        = require('./routes/dmRoutes');
const errorHandler    = require('./middleware/errorHandler');
const { corsOrigin }  = require('./utils/origins');
const { metricsMiddleware } = require('./utils/metrics');
const { domainStatus } = require('./config/connections');

const app = express();

// Behind Render / Vercel there is exactly one reverse proxy. Without this,
// express-rate-limit keys every request on the proxy IP and logs
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.disable('x-powered-by');

app.use(helmet());

app.use(cors({
  origin: corsOrigin, // exact allow-list, see utils/origins.js
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 600
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(mongoSanitize());

// Traffic/latency counters for the admin dashboard (no request bodies, no PII).
app.use(metricsMiddleware);

// Coarse global limiter. Route-specific limits (auth, previews) are stricter.
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' }
});
app.use('/api', globalLimiter);

app.get('/api/health', (req, res) => {
  const domains = domainStatus();
  const healthy = domains.auth === 'connected' && domains.squads === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime()),
    domains
  });
});

app.use('/api/auth',        authRoutes);
app.use('/api/posts',       postRoutes);
app.use('/api/posts/:postId/comments', commentRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/lfg',         lfgRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/account',     accountRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/squad-chats', squadChatRoutes);
app.use('/api/games',       gameRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/bot',         botRoutes);
app.use('/api/messages',    dmRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

app.use(errorHandler);

module.exports = app;
