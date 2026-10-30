const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { accountGate } = require('../utils/privacy');

const SESSION_FIELDS =
  '_id username email following favoriteChannels savedPosts role ' +
  'sessionVersion status profileType privacySettings blockedUsers mutedUsers';

/** 401 when the account is deleted, 403 when it is suspended. */
const denyAccount = (res, user) => {
  const gate = accountGate(user);
  if (gate.ok) return false;
  res.status(gate.status).json({ message: gate.message });
  return true;
};

/**
 * A token is only valid for the session version it was minted with, so
 * "sign out everywhere" and account deletion revoke outstanding cookies
 * immediately. Missing `sv` (tokens from before the field existed) is 0.
 */
const staleSession = (decoded, user) =>
  (Number(decoded.sv) || 0) !== (Number(user.sessionVersion) || 0);

const protect = async (req, res, next) => {
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select(SESSION_FIELDS);

    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }
    if (staleSession(decoded, user)) {
      return res.status(401).json({ message: 'Session expired. Please sign in again.' });
    }
    if (denyAccount(res, user)) return;

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
    const user = await User.findById(decoded.userId).select(SESSION_FIELDS);
    if (user && !staleSession(decoded, user) && accountGate(user).ok) req.user = user;
  } catch {}
  next();
};

module.exports = { protect, optionalProtect, SESSION_FIELDS };
