const { isPlatformAdmin } = require('../utils/permissions');

/**
 * Platform-level gates. These use the APPLICATION role (user/moderator/admin),
 * never a server/community role — being the owner of a Discord-style server
 * must not unlock platform administration.
 *
 * Must run after `protect`.
 */
const requirePlatformAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  if (!isPlatformAdmin(req.user)) {
    return res.status(403).json({ message: 'Administrator access required.' });
  }
  return next();
};

/**
 * Platform staff covers the moderation surfaces: an admin or a moderator may
 * review cases and hide content, but only an admin may change roles, suspend
 * accounts or edit the catalog. `requirePlatformAdmin` still guards those.
 */
const requirePlatformStaff = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  if (!['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Moderator access required.' });
  }
  return next();
};

module.exports = { requirePlatformAdmin, requirePlatformStaff };
