const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  register, login, logout, logoutAll, getProviders, googleLogin, linkGoogle, unlinkGoogle,
  getMe, updateProfile
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' }
});

router.get('/providers', getProviders);
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/google', authLimiter, googleLogin);
router.post('/link-google', protect, authLimiter, linkGoogle);
router.delete('/link-google', protect, unlinkGoogle);
router.post('/logout', protect, logout);
router.post('/logout-all', protect, logoutAll);
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);

module.exports = router;
