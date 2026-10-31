const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { sanitizeLine, sanitizeText } = require('../utils/sanitize');
const { normalizeUsername, usernameFilter } = require('../utils/username');

const SALT_ROUNDS = 10;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128; // bcrypt silently truncates past 72 bytes
const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];

// Public OIDC client id. It is not a secret; the server still verifies every
// ID token's signature and audience before trusting a single claim.
const googleClientId = () => String(process.env.GOOGLE_CLIENT_ID || '').trim();

/** Build a unique, valid GamerHub username from a Google profile. */
async function usernameFromGoogle({ email, name }) {
  const base = String(name || email || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16) || 'player';

  const seed = base.length >= 3 ? base : `player_${base}`.slice(0, 16);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? seed : `${seed.slice(0, 12)}_${attempt}`;
    // Reserved and malformed candidates are skipped, not handed out.
    if (!normalizeUsername(candidate).ok) continue;
    const taken = await User.exists(usernameFilter(candidate));
    if (!taken) return candidate;
  }
  return `player_${crypto.randomBytes(4).toString('hex')}`.slice(0, 20);
}

const register = async (req, res, next) => {
  try {
    const parsedUsername = normalizeUsername(req.body.username);
    if (!parsedUsername.ok) {
      return res.status(400).json({ message: parsedUsername.reason });
    }
    const username = parsedUsername.value;
    const email = sanitizeLine(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return res.status(400).json({
        message: `Password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters`
      });
    }

    // Case-insensitive: `Alice` must not be able to register beside `alice`.
    const existing = await User.findOne({ $or: [{ email }, usernameFilter(username)] });
    if (existing) {
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    const preferredPlatforms = Array.isArray(req.body.preferredPlatforms)
      ? [...new Set(req.body.preferredPlatforms.filter((p) => PLATFORMS.includes(p)))]
      : [];

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // `authIdentities` is reserved for federated sign-in. A local account has
    // no external subject, and storing the email there would leak it through
    // the public profile payload.
    const user = await User.create({ username, email, passwordHash, preferredPlatforms });

    const token = generateToken(res, user._id, user.sessionVersion);

    res.status(201).json({
      user: { id: user._id, username: user.username, email: user.email },
      token
    });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const email = sanitizeLine(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing credentials' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash).catch(() => false);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'This account is suspended' });
    }
    if (user.status === 'deleted') {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(res, user._id, user.sessionVersion);

    res.status(200).json({
      user: { id: user._id, username: user.username, email: user.email },
      token
    });
  } catch (err) {
    next(err);
  }
};

const clearAuthCookie = (res) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    expires: new Date(0),
    path: '/'
  });
};

const logout = (req, res) => {
  clearAuthCookie(res);
  res.status(200).json({ message: 'Logged out' });
};

/**
 * Revoke every session, on every device.
 * The cookie in *this* browser is cleared too, so the caller has to sign in
 * again — that is the point of the button.
 */
const logoutAll = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { sessionVersion: 1 } },
      { new: true, select: 'sessionVersion' }
    );
    clearAuthCookie(res);
    res.status(200).json({ message: 'Signed out everywhere', sessionVersion: user.sessionVersion });
  } catch (err) {
    next(err);
  }
};

/** Public sign-in configuration. The client id is public by design. */
const getProviders = (req, res) => {
  res.status(200).json({
    google: { enabled: Boolean(googleClientId()), clientId: googleClientId() || null }
  });
};

/**
 * Google Sign-In (OpenID Connect).
 *
 * The browser posts the ID token from Google Identity Services; the signature,
 * issuer and audience are verified server-side before any claim is read. An
 * existing local account with the same email is never merged automatically —
 * linking on an unverified match is the classic account-takeover path.
 */
const googleLogin = async (req, res, next) => {
  try {
    const clientId = googleClientId();
    if (!clientId) {
      return res.status(503).json({ message: 'Google sign-in is not configured on this server.' });
    }

    const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';

    if (!credential && !accessToken) {
      return res.status(400).json({ message: 'Missing Google credential' });
    }
    if (credential.length > 8000 || accessToken.length > 2000) {
      return res.status(400).json({ message: 'Invalid Google credential' });
    }

    let OAuth2Client;
    try {
      ({ OAuth2Client } = require('google-auth-library'));
    } catch {
      return res.status(503).json({ message: 'Google sign-in is unavailable on this server.' });
    }

    const client = new OAuth2Client(clientId);
    let subject;
    let email;
    let name = '';

    if (credential) {
      let payload;
      try {
        const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
        payload = ticket.getPayload();
      } catch {
        return res.status(401).json({ message: 'Google credential could not be verified' });
      }

      subject = payload?.sub;
      email = sanitizeLine(payload?.email, 254).toLowerCase();
      name = payload?.name || '';
      if (payload?.email_verified === false) {
        return res.status(403).json({ message: 'That Google account has no verified email.' });
      }
    } else {
      let tokenInfo;
      try {
        tokenInfo = await client.getTokenInfo(accessToken);
      } catch {
        return res.status(401).json({ message: 'Google credential could not be verified' });
      }

      if (tokenInfo.aud && tokenInfo.aud !== clientId && tokenInfo.issued_to !== clientId) {
        return res.status(401).json({ message: 'Google token audience mismatch' });
      }

      subject = tokenInfo.sub || tokenInfo.user_id;
      email = sanitizeLine(tokenInfo.email, 254).toLowerCase();
      if (tokenInfo.email_verified === false || tokenInfo.verified_email === false) {
        return res.status(403).json({ message: 'That Google account has no verified email.' });
      }

      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (userRes.ok) {
          const userObj = await userRes.json();
          name = userObj.name || '';
        }
      } catch {
        // Fallback to email for username generation
      }
    }

    if (!subject || !email) {
      return res.status(401).json({ message: 'Google credential could not be verified' });
    }

    let user = await User.findOne({
      authIdentities: { $elemMatch: { provider: 'google', providerSubject: subject } }
    });

    if (!user) {
      const emailOwner = await User.findOne({ email }).select('_id').lean();
      if (emailOwner) {
        return res.status(409).json({
          message: 'An account already uses this email. Sign in with your password, then link Google from settings.'
        });
      }

      const username = await usernameFromGoogle({ email, name });
      user = await User.create({
        username,
        email,
        // A random secret: password login is impossible until the owner sets one.
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS),
        // No password the owner actually knows — destructive confirmations ask
        // for the username instead.
        hasLocalPassword: false,
        profileType: 'personal',
        status: 'active',
        authIdentities: [{ provider: 'google', providerSubject: subject, emailVerified: true }]
      });
    } else {
      if (user.status === 'suspended') {
        return res.status(403).json({ message: 'This account is suspended' });
      }
      if (user.status === 'deleted' || user.status === 'deletion_pending') {
        return res.status(403).json({ message: 'This account is being deleted' });
      }
      await User.updateOne(
        { _id: user._id, 'authIdentities.providerSubject': subject },
        { $set: { 'authIdentities.$.emailVerified': true } }
      );
    }

    const token = generateToken(res, user._id, user.sessionVersion);
    res.status(200).json({
      user: { id: user._id, username: user.username, email: user.email },
      token
    });
  } catch (err) {
    next(err);
  }
};

// Returns full profile — refetch so bio/preferredPlatforms/createdAt are included
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found' });
    const token = req.cookies.jwt;
    res.status(200).json({ user, token });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/link-google
 *
 * Link a Google identity to the signed-in local account. Deliberately strict:
 * the Google email must match the account email (no silent mixing of two
 * identities), and a subject already linked elsewhere is refused.
 */
const linkGoogle = async (req, res, next) => {
  try {
    const clientId = googleClientId();
    if (!clientId) {
      return res.status(503).json({ message: 'Google sign-in is not configured on this server.' });
    }

    const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
    if (!credential) return res.status(400).json({ message: 'Missing Google credential' });
    if (credential.length > 8000) return res.status(400).json({ message: 'Invalid Google credential' });

    let OAuth2Client;
    try {
      ({ OAuth2Client } = require('google-auth-library'));
    } catch {
      return res.status(503).json({ message: 'Google sign-in is unavailable on this server.' });
    }

    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ message: 'Google credential could not be verified' });
    }

    const subject = payload?.sub;
    const email = sanitizeLine(payload?.email, 254).toLowerCase();
    if (!subject || !email) {
      return res.status(401).json({ message: 'Google credential could not be verified' });
    }
    if (payload?.email_verified === false) {
      return res.status(403).json({ message: 'That Google account has no verified email.' });
    }
    if (email !== String(req.user.email).toLowerCase()) {
      return res.status(409).json({
        message: 'That Google account uses a different email from your GamerHub account.'
      });
    }

    const linkedElsewhere = await User.findOne({
      _id: { $ne: req.user._id },
      authIdentities: { $elemMatch: { provider: 'google', providerSubject: subject } }
    }).select('_id').lean();
    if (linkedElsewhere) {
      return res.status(409).json({ message: 'That Google account is already linked to another player.' });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { authIdentities: { provider: 'google', providerSubject: subject, emailVerified: true } } }
    );

    const fresh = await User.findById(req.user._id).select('authIdentities').lean();
    res.status(200).json({
      providers: [...new Set((fresh.authIdentities || []).map((identity) => identity.provider))]
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/auth/link-google
 * Refused for accounts with no local password: unlinking would lock them out.
 */
const unlinkGoogle = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('authIdentities hasLocalPassword')
      .lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const linked = (user.authIdentities || []).some((identity) => identity.provider === 'google');
    if (!linked) return res.status(200).json({ providers: [...new Set((user.authIdentities || []).map((i) => i.provider))] });

    if (user.hasLocalPassword === false) {
      return res.status(409).json({
        message: 'This account signs in with Google only. Set a password before unlinking it.'
      });
    }

    await User.updateOne({ _id: req.user._id }, { $pull: { authIdentities: { provider: 'google' } } });
    res.status(200).json({ providers: ['local'] });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/auth/profile  — update bio and/or preferredPlatforms
const updateProfile = async (req, res, next) => {
  try {
    const ALLOWED_PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];
    const { bio, preferredPlatforms } = req.body;

    const updates = {};

    if (bio !== undefined) {
      if (typeof bio !== 'string') {
        return res.status(400).json({ message: 'Bio must be a string' });
      }
      updates.bio = sanitizeText(bio, 300);
    }

    if (preferredPlatforms !== undefined) {
      if (!Array.isArray(preferredPlatforms)) {
        return res.status(400).json({ message: 'preferredPlatforms must be an array' });
      }
      const invalid = preferredPlatforms.filter(p => !ALLOWED_PLATFORMS.includes(p));
      if (invalid.length) {
        return res.status(400).json({
          message: `Invalid platform(s): ${invalid.join(', ')}. Allowed: ${ALLOWED_PLATFORMS.join(', ')}`
        });
      }
      updates.preferredPlatforms = [...new Set(preferredPlatforms)]; // deduplicate
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: 'No updatable fields provided' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-passwordHash');

    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  logout,
  logoutAll,
  getProviders,
  googleLogin,
  linkGoogle,
  unlinkGoogle,
  getMe,
  updateProfile,
  clearAuthCookie
};
