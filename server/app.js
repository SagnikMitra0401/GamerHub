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
const errorHandler    = require('./middleware/errorHandler');
const { corsOrigin }  = require('./utils/origins');

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
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

app.use('/api/auth',        authRoutes);
app.use('/api/posts',       postRoutes);
app.use('/api/posts/:postId/comments', commentRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/communities', communityRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

app.use(errorHandler);

module.exports = app;
