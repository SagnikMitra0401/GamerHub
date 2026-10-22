const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/authorize');
const { getSystemHealth, getMetrics } = require('../controllers/adminController');

router.use(protect, requirePlatformAdmin);

router.get('/system-health', getSystemHealth);
router.get('/metrics',       getMetrics);

module.exports = router;
