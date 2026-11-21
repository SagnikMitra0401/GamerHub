const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, optionalProtect, activeOnly } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  createStory, getStories, viewStory, getStoryViewers, deleteStory
} = require('../controllers/storyController');

const router = express.Router();

// A story upload is the most expensive write in the app; keep it rare.
const storyWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.STORY_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'You are posting stories too quickly. Try again shortly.' }
});

router.get('/', optionalProtect, getStories);
router.get('/:id/viewers', protect, getStoryViewers);
router.post('/', protect, activeOnly, storyWriteLimiter, upload.single('media'), createStory);
router.post('/:id/view', protect, activeOnly, viewStory);
router.delete('/:id', protect, activeOnly, deleteStory);

module.exports = router;
