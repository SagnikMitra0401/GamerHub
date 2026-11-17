const crypto = require('crypto');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { sanitizeLine, sanitizeText } = require('../utils/sanitize');
const { normalizeUsername, usernameFilter } = require('../utils/username');
const { disconnectUser } = require('../config/socket');
const {
  PURPOSES,
  issueAccountToken,
  consumeAccountToken
} = require('../utils/accountTokens');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  verificationUrl,
  resetUrl
} = require('../utils/email');
const {
  validatePassword,
  hashPassword,
  verifyPassword
} = require('../utils/passwords');
const { recordEvent } = require('../utils/productEvents');

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];

const GENERIC_RESET_MESSAGE =
  'If an account exists for that email, a reset link has been sent.';
const GENERIC_TOKEN_ERROR = 'This link is invalid or has expired.';

const normalizeEmail = (value) => sanitizeLine(value, 254).toLowerCase();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send the one live verification link for an account.
 * The caller decides whether a delivery failure should be fatal; registration
 * deliberately treats it as non-fatal so an email outage cannot block signup.
 */
async function deliverVerificationEmail(user, req) {
  const token = await issueAccountToken(user._id, PURPOSES.VERIFY_EMAIL);
  await sendVerificationEmail({
    to: user.email,
    username: user.username,
    url: verificationUrl(req, token)
  });
}

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
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ message: passwordCheck.message });
    }

    // Case-insensitive: `Alice` must not be able to register beside `alice`.
    const existing = await User.findOne({ $or: [{ email }, usernameFilter(username)] });
    if (existing) {
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    const preferredPlatforms = Array.isArray(req.body.preferredPlatforms)
      ? [...new Set(req.body.preferredPlatforms.filter((p) => PLATFORMS.includes(p)))]
      : [];

    const passwordHash = await hashPassword(password);
    // `authIdentities` is reserved for federated sign-in. A local account has
    // no external subject, and storing the email there would leak it through
    // the public profile payload.
    const user = await User.create({
      username,
      email,
      passwordHash,
      preferredPlatforms,
      emailVerifiedAt: null
    });

    let verificationSent = false;
    try {
      await deliverVerificationEmail(user, req);
      verificationSent = true;
    } catch (err) {
      // Email delivery is not allowed to turn a successful signup into a 500.
      console.error('[Auth] verification email failed:', err.message);
    }

    recordEvent('signup', user._id, { source: 'local' });
    const token = generateToken(res, user._id, user.sessionVersion);

    res.status(201).json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        emailVerified: false,
        onboardingCompletedAt: user.onboardingCompletedAt || null
      },
      verificationSent,
      token
    });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing credentials' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await verifyPassword(password, user.passwordHash);
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
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        emailVerified: Boolean(user.emailVerifiedAt),
        onboardingCompletedAt: user.onboardingCompletedAt || null
      },
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

    let isNewGoogleAccount = false;
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
        passwordHash: await hashPassword(crypto.randomBytes(32).toString('hex')),
        // No password the owner actually knows — destructive confirmations ask
        // for the username instead.
        hasLocalPassword: false,
        profileType: 'personal',
        status: 'active',
        emailVerifiedAt: new Date(),
        authIdentities: [{ provider: 'google', providerSubject: subject, emailVerified: true }]
      });
      isNewGoogleAccount = true;
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
      // A Google-verified email is proof of ownership even for an account that
      // was created before the local verification flow existed.
      if (!user.emailVerifiedAt) {
        await User.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } });
      }
    }

    if (isNewGoogleAccount) recordEvent('signup', user._id, { source: 'google' });
    const token = generateToken(res, user._id, user.sessionVersion);
    res.status(200).json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        emailVerified: true,
        onboardingCompletedAt: user.onboardingCompletedAt || null
      },
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
    const payload = user.toObject();
    payload.emailVerified = Boolean(payload.emailVerifiedAt);
    const token = req.cookies.jwt;
    res.status(200).json({ user: payload, token });
  } catch (err) {
    next(err);
  }
};

/** POST /api/auth/verify-email  { token } */
const verifyEmail = async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) return res.status(400).json({ message: GENERIC_TOKEN_ERROR });

    const record = await consumeAccountToken(token, PURPOSES.VERIFY_EMAIL);
    if (!record) return res.status(400).json({ message: GENERIC_TOKEN_ERROR });

    const user = await User.findOneAndUpdate(
      { _id: record.userId, status: { $nin: ['suspended', 'deleted'] } },
      { $set: { emailVerifiedAt: new Date() } },
      { new: true, select: '_id email emailVerifiedAt' }
    ).lean();

    if (!user) return res.status(400).json({ message: GENERIC_TOKEN_ERROR });

    recordEvent('email_verified', user._id, { method: 'link' });
    res.status(200).json({ verified: true, emailVerified: true });
  } catch (err) {
    next(err);
  }
};

/** POST /api/auth/verify-email/resend — authenticated and rate limited. */
const resendVerification = async (req, res, next) => {
  try {
    if (req.user.emailVerifiedAt) {
      return res.status(200).json({ alreadyVerified: true, emailVerified: true });
    }

    try {
      await deliverVerificationEmail(req.user, req);
    } catch (err) {
      console.error('[Auth] verification resend failed:', err.message);
      return res.status(503).json({
        message: 'We could not send that email right now. Try again later.'
      });
    }

    res.status(200).json({ sent: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/forgot-password  { email }
 *
 * Enumeration-safe: the status, body and elapsed time are the same whether or
 * not the address exists. Delivery is fire-and-forget so provider latency does
 * not become an existence oracle.
 */
const forgotPassword = async (req, res, next) => {
  try {
    const started = Date.now();
    const email = normalizeEmail(req.body?.email);

    try {
      if (email) {
        const user = await User.findOne({ email }).select('_id email username status').lean();
        if (user && !['suspended', 'deleted'].includes(user.status)) {
          recordEvent('password_reset_requested', user._id);
          const token = await issueAccountToken(user._id, PURPOSES.RESET_PASSWORD);
          sendPasswordResetEmail({
            to: user.email,
            username: user.username,
            url: resetUrl(req, token)
          }).catch((err) => console.error('[Auth] reset email failed:', err.message));
        }
      }
    } catch (err) {
      // Keep the response generic even when the lookup or token write fails.
      console.error('[Auth] reset request failed:', err.message);
    }

    await wait(Math.max(0, 250 - (Date.now() - started)));
    res.status(202).json({ message: GENERIC_RESET_MESSAGE });
  } catch (err) {
    next(err);
  }
};

/** POST /api/auth/reset-password  { token, password } */
const resetPassword = async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const check = validatePassword(password);
    if (!check.ok) return res.status(400).json({ message: check.message });
    if (!token) return res.status(400).json({ message: GENERIC_TOKEN_ERROR });

    const record = await consumeAccountToken(token, PURPOSES.RESET_PASSWORD);
    if (!record) return res.status(400).json({ message: GENERIC_TOKEN_ERROR });

    const user = await User.findById(record.userId).select('_id status emailVerifiedAt').lean();
    if (!user || ['suspended', 'deleted'].includes(user.status)) {
      return res.status(400).json({ message: GENERIC_TOKEN_ERROR });
    }

    const passwordHash = await hashPassword(password);
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          // Possession of the link proves control of the address.
          emailVerifiedAt: user.emailVerifiedAt || new Date()
        },
        $inc: { sessionVersion: 1 }
      }
    );

    recordEvent('password_reset_completed', user._id);
    clearAuthCookie(res);
    disconnectUser(user._id);
    res.status(200).json({ reset: true });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/auth/password  { currentPassword?, password }
 *
 * Gated on a verified owner email. Local accounts must prove the current
 * password; Google-only accounts may set one after verification. Every other
 * session is revoked.
 */
const changePassword = async (req, res, next) => {
  try {
    if (!req.user.emailVerifiedAt) {
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email before changing your password.'
      });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const currentPassword = typeof req.body?.currentPassword === 'string'
      ? req.body.currentPassword
      : '';
    const check = validatePassword(password);
    if (!check.ok) return res.status(400).json({ message: check.message });

    const user = await User.findById(req.user._id).select('passwordHash hasLocalPassword').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.hasLocalPassword !== false) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Enter your current password to continue.' });
      }
      const matches = await verifyPassword(currentPassword, user.passwordHash);
      if (!matches) {
        return res.status(403).json({ message: 'That password is not correct.' });
      }
      if (await verifyPassword(password, user.passwordHash)) {
        return res.status(400).json({ message: 'Choose a password you have not used before.' });
      }
    }

    const passwordHash = await hashPassword(password);
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: { passwordHash, hasLocalPassword: true },
        $inc: { sessionVersion: 1 }
      }
    );

    clearAuthCookie(res);
    disconnectUser(req.user._id);
    res.status(200).json({ changed: true, reauthRequired: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/link-google
 *
 * Link a Google identity to the signed-in local account. Deliberately strict:
 * the Google email must match the account email (no silent mixing of two
 * identities), and a subject already linked elsewhere is refused. The settings
 * slide control uses the same OAuth token flow as sign-in, so both credential
 * shapes are verified under the same audience and email checks.
 */
const linkGoogle = async (req, res, next) => {
  try {
    const clientId = googleClientId();
    if (!clientId) {
      return res.status(503).json({ message: 'Google sign-in is not configured on this server.' });
    }

    const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!credential && !accessToken) return res.status(400).json({ message: 'Missing Google credential' });
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
    }

    if (!subject || !email) {
      return res.status(401).json({ message: 'Google credential could not be verified' });
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
      {
        $addToSet: { authIdentities: { provider: 'google', providerSubject: subject, emailVerified: true } },
        $set: { emailVerifiedAt: new Date() }
      }
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
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  updateProfile,
  clearAuthCookie
};
