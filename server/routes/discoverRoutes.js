const express = require('express');
const router = express.Router();
const { protect, activeOnly } = require('../middleware/auth');
const { browseLimiter } = require('../middleware/limiters');
const {
  getOnboardingSuggestions,
  startOnboarding,
  completeOnboarding,
} = require('../controllers/discoverController');

router.get('/onboarding', protect, browseLimiter, getOnboardingSuggestions);
router.post('/onboarding/start', protect, activeOnly, startOnboarding);
router.post('/onboarding/complete', protect, activeOnly, completeOnboarding);

module.exports = router;
