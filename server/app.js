const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const authRoutes      = require('./routes/authRoutes');
const postRoutes      = require('./routes/postRoutes');
const commentRoutes   = require('./routes/commentRoutes');
const userRoutes      = require('./routes/userRoutes');
const communityRoutes = require('./routes/communityRoutes');
const errorHandler    = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(url => url.trim().replace(/\/$/, ''))
  : [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin) return callback(null, true);
    
    // Check if origin matches allowed origins (stripping trailing slash) or is a Vercel deployment URL
    const cleanOrigin = origin.replace(/\/$/, '');
    const isAllowed = allowedOrigins.includes(cleanOrigin) || cleanOrigin.endsWith('.vercel.app');
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(mongoSanitize());

app.use('/api/auth',        authRoutes);
app.use('/api/posts',       postRoutes);
app.use('/api/posts/:postId/comments', commentRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/communities', communityRoutes);

app.use(errorHandler);

module.exports = app;
