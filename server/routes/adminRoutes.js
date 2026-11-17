const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');
const { requirePlatformAdmin, requirePlatformStaff } = require('../middleware/authorize');
const { adminLimiter } = require('../middleware/limiters');

const { getSystemHealth, getMetrics, getFunnel } = require('../controllers/adminController');
const { getDmReports, resolveDmReport } = require('../controllers/dmAdminController');
const {
  getPendingBusinessVerifications,
  resolveBusinessVerification
} = require('../controllers/businessController');
const {
  listUsers,
  getUserDetail,
  updateUserRole,
  updateUserStatus,
  forceLogout,
  resendVerification,
  sendPasswordReset,
  listCases,
  resolveCase,
  listPosts,
  setPostVisibility,
  listComments,
  setCommentVisibility,
  listMessages,
  setMessageVisibility,
  listAudit,
  listGames,
  updateGame,
  mergeGame,
  syncGames,
  getStorage
} = require('../controllers/platformAdminController');

router.use(protect, adminLimiter);

// ── Overview (admin only) ───────────────────────────────────────────────────
router.get('/system-health', requirePlatformAdmin, getSystemHealth);
router.get('/metrics',       requirePlatformAdmin, getMetrics);
router.get('/funnel',        requirePlatformAdmin, getFunnel);

// ── Accounts, roles and account state (admin only) ──────────────────────────
router.get('/users',                 requirePlatformAdmin, listUsers);
router.get('/users/:id',             requirePlatformAdmin, getUserDetail);
router.patch('/users/:id/role',      requirePlatformAdmin, updateUserRole);
router.patch('/users/:id/status',    requirePlatformAdmin, updateUserStatus);
router.post('/users/:id/logout-all', requirePlatformAdmin, forceLogout);
router.post('/users/:id/resend-verification', requirePlatformAdmin, resendVerification);
router.post('/users/:id/send-password-reset', requirePlatformAdmin, sendPasswordReset);

// ── Moderation cases: admins and moderators ─────────────────────────────────
router.get('/cases',                     requirePlatformStaff, listCases);
router.post('/cases/:source/:id/resolve', requirePlatformStaff, resolveCase);

// ── Content browser: admins and moderators ──────────────────────────────────
router.get('/content/posts',                 requirePlatformStaff, listPosts);
router.patch('/content/posts/:id/visibility', requirePlatformStaff, setPostVisibility);
router.get('/content/comments',              requirePlatformStaff, listComments);
router.patch('/content/comments/:id/visibility', requirePlatformStaff, setCommentVisibility);
router.get('/content/messages',              requirePlatformStaff, listMessages);
router.patch('/content/messages/:id/visibility', requirePlatformStaff, setMessageVisibility);
router.get('/audit',                         requirePlatformStaff, listAudit);

// ── Legacy DM report endpoints (kept for the old dashboard) ─────────────────
router.get('/dm-reports',    requirePlatformAdmin, getDmReports);
router.post('/dm-reports/:id/resolve', requirePlatformAdmin, resolveDmReport);

// ── Business verification ───────────────────────────────────────────────────
router.get('/business-verifications', requirePlatformAdmin, getPendingBusinessVerifications);
router.post('/business-verifications/:id/resolve', requirePlatformAdmin, resolveBusinessVerification);

// ── Catalog and storage (admin only) ────────────────────────────────────────
router.get('/games',                 requirePlatformAdmin, listGames);
router.post('/games/sync',           requirePlatformAdmin, syncGames);
router.patch('/games/:id',           requirePlatformAdmin, updateGame);
router.post('/games/:id/merge',      requirePlatformAdmin, mergeGame);
router.get('/storage',               requirePlatformAdmin, getStorage);

module.exports = router;
