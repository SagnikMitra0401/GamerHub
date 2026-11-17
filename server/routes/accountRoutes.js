const express = require('express');
const { protect } = require('../middleware/auth');
const { createLimiter } = require('../middleware/limiters');
const {
  getAccount,
  updateDmSettings,
  updateNotificationSettings,
  changeUsername,
  resetFeedRecommendations,
  setFreeze,
  getSuccessionPreview,
  deleteAccountNow,
  blockUser,
  unblockUser,
  listBlocked,
  exportData,
  requestDeletion,
  cancelDeletion
} = require('../controllers/accountController');
const {
  saveBusinessProfile,
  downgradeBusiness,
  requestBusinessVerification,
  checkBusinessVerification,
  getBusinessAnalytics
} = require('../controllers/businessController');
const {
  getBusinessTeam,
  inviteMember,
  changeMemberRole,
  removeMember
} = require('../controllers/teamController');

const router = express.Router();

// A full export walks every collection the account touches; it is throttled
// separately from the coarse global limiter.
const exportLimiter = createLimiter({
  name: 'data-export',
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.EXPORT_RATE_LIMIT_MAX) || 5,
  message: 'You can request a data export a few times an hour. Try again later.'
});

// Handles are public identity: a rename loop is both confusing and noisy.
const usernameLimiter = createLimiter({
  name: 'username-change',
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.USERNAME_RATE_LIMIT_MAX) || 5,
  message: 'You can change your username a few times an hour. Try again later.'
});

// Password-confirmed actions: the limit is about bcrypt cost and guessing, not
// about the user's ordinary navigation.
const confirmLimiter = createLimiter({
  name: 'account-confirm',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ACCOUNT_CONFIRM_RATE_LIMIT_MAX) || 12,
  message: 'Too many confirmation attempts. Please wait a few minutes.'
});

const feedResetLimiter = createLimiter({
  name: 'feed-reset',
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.FEED_RESET_RATE_LIMIT_MAX) || 10,
  message: 'Feed reset is limited a few times an hour.'
});

const dmSettingsLimiter = createLimiter({
  name: 'account-settings',
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.DM_SETTINGS_RATE_LIMIT_MAX) || 30,
  message: 'You are changing message settings very often. Try again later.'
});

router.get('/', protect, getAccount);
router.get('/blocked', protect, listBlocked);
router.get('/data-export', protect, exportLimiter, exportData);
router.get('/succession-preview', protect, getSuccessionPreview);

router.patch('/username', protect, usernameLimiter, changeUsername);
router.patch('/dm-settings', protect, dmSettingsLimiter, updateDmSettings);
router.patch('/notification-settings', protect, dmSettingsLimiter, updateNotificationSettings);
router.get('/business/analytics', protect, getBusinessAnalytics);
router.get('/business/team', protect, getBusinessTeam);
router.post('/business/team', protect, dmSettingsLimiter, inviteMember);
router.patch('/business/team/:memberId', protect, dmSettingsLimiter, changeMemberRole);
router.delete('/business/team/:memberId', protect, dmSettingsLimiter, removeMember);
router.post('/business-profile', protect, dmSettingsLimiter, saveBusinessProfile);
router.delete('/business-profile', protect, dmSettingsLimiter, downgradeBusiness);
router.post('/business-verification', protect, dmSettingsLimiter, requestBusinessVerification);
router.post('/business-verification/check', protect, dmSettingsLimiter, checkBusinessVerification);
router.post('/feed-reset', protect, feedResetLimiter, resetFeedRecommendations);
router.post('/freeze', protect, confirmLimiter, setFreeze);

router.post('/block/:userId', protect, blockUser);
router.delete('/block/:userId', protect, unblockUser);

router.post('/deletion-request', protect, requestDeletion);
router.post('/deletion-cancel', protect, cancelDeletion);
router.post('/delete-now', protect, confirmLimiter, deleteAccountNow);

module.exports = router;
