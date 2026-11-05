const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/authorize');
const { getSystemHealth, getMetrics } = require('../controllers/adminController');
const { adminLimiter } = require('../middleware/limiters');

router.use(protect, requirePlatformAdmin, adminLimiter);

router.get('/system-health', getSystemHealth);
router.get('/metrics',       getMetrics);

module.exports = router;
