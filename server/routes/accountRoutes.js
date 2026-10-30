const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const {
  getAccount,
  blockUser,
  unblockUser,
  listBlocked,
  exportData,
  requestDeletion,
  cancelDeletion
} = require('../controllers/accountController');

const router = express.Router();

// A full export walks every collection the account touches; it is throttled
// separately from the coarse global limiter.
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.EXPORT_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'You can request a data export a few times an hour. Try again later.' }
});

router.get('/', protect, getAccount);
router.get('/blocked', protect, listBlocked);
router.get('/data-export', protect, exportLimiter, exportData);

router.post('/block/:userId', protect, blockUser);
router.delete('/block/:userId', protect, unblockUser);

router.post('/deletion-request', protect, requestDeletion);
router.post('/deletion-cancel', protect, cancelDeletion);

module.exports = router;
