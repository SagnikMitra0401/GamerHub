const express = require('express');
const {
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
  verifyEmail,
  verifyEmailWithCode,
  resendVerification,
  setRecoveryEmail,
  verifyRecoveryEmail,
  removeRecoveryEmail,
  startRecovery,
  verifyRecovery,
  forgotPassword,
  resetPassword,
  changePassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { createLimiter } = require('../middleware/limiters');

const router = express.Router();

const authLimiter = createLimiter({
  name: 'auth',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  message: 'Too many attempts. Please try again later.',
});

// Account mail is deliberately tight: a person needs a handful of links, a
// script must not be able to use this as an email cannon.
const emailLimiter = createLimiter({
  name: 'account-email',
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ACCOUNT_EMAIL_RATE_LIMIT_MAX) || 3,
  message: 'Too many email requests. Try again in an hour.',
});

const passwordLimiter = createLimiter({
  name: 'account-password',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ACCOUNT_PASSWORD_RATE_LIMIT_MAX) || 10,
  message: 'Too many password attempts. Try again in a few minutes.',
});

router.get('/providers', getProviders);
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
// Legacy link endpoint, kept for the deprecation window. New registrations
// receive an 8-digit code and never a link.
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/verify-email/code', protect, authLimiter, verifyEmailWithCode);
router.post('/verify-email/resend', protect, emailLimiter, resendVerification);

// Recovery email: the address proves itself before it is stored.
router.post('/recovery-email', protect, emailLimiter, setRecoveryEmail);
router.post('/recovery-email/verify', protect, authLimiter, verifyRecoveryEmail);
router.delete('/recovery-email', protect, removeRecoveryEmail);

// Account recovery stays unauthenticated by design: the point is a lost session.
router.post('/recovery/start', emailLimiter, startRecovery);
router.post('/recovery/verify', authLimiter, verifyRecovery);
router.post('/forgot-password', emailLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.patch('/password', protect, passwordLimiter, changePassword);
router.post('/google', authLimiter, googleLogin);
router.post('/link-google', protect, authLimiter, linkGoogle);
router.delete('/link-google', protect, unlinkGoogle);
router.post('/logout', protect, logout);
router.post('/logout-all', protect, logoutAll);
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);

module.exports = router;
