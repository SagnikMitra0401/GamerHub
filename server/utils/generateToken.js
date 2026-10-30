const jwt = require('jsonwebtoken');

/**
 * Mint the session cookie.
 *
 * `sv` is the account's session version at the moment of signing. Bumping
 * `sessionVersion` on the user document ("sign out everywhere", deletion
 * request) invalidates every cookie already in the wild without a session
 * table. Tokens minted before this field existed decode with `sv: undefined`
 * and are treated as version 0, so existing sessions keep working.
 */
const generateToken = (res, userId, sessionVersion = 0) => {
  const token = jwt.sign(
    { userId, sv: Number(sessionVersion) || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });

  return token;
};

module.exports = generateToken;
