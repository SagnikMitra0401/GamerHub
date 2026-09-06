const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId)
      .select('_id username email following favoriteChannels savedPosts role');

    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Like protect but never blocks — attaches req.user if token is valid, skips silently if not
const optionalProtect = async (req, res, next) => {
  const token = req.cookies.jwt;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId)
      .select('_id username email following favoriteChannels savedPosts role');
    if (user) req.user = user;
  } catch {}
  next();
};

module.exports = { protect, optionalProtect };
