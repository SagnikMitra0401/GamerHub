const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/authorize');
const { getSystemHealth, getMetrics } = require('../controllers/adminController');
const { getDmReports, resolveDmReport } = require('../controllers/dmAdminController');
const {
  getPendingBusinessVerifications,
  resolveBusinessVerification
} = require('../controllers/businessController');
const { adminLimiter } = require('../middleware/limiters');

router.use(protect, requirePlatformAdmin, adminLimiter);

router.get('/system-health', getSystemHealth);
router.get('/metrics',       getMetrics);
router.get('/dm-reports',    getDmReports);
router.post('/dm-reports/:id/resolve', resolveDmReport);
router.get('/business-verifications', getPendingBusinessVerifications);
router.post('/business-verifications/:id/resolve', resolveBusinessVerification);

module.exports = router;
