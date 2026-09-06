const express = require('express');
const router  = express.Router();
const { protect, optionalProtect } = require('../middleware/auth');
const {
  getProfile,
  getUserPosts,
  toggleFollow,
  toggleSavePost,
  toggleFavouriteChannel,
  getSavedPosts,
  searchAll,
  updateGamerPassport
} = require('../controllers/userController');

// Search & Passport (must be before /:username to avoid route collision)
router.get('/search',      optionalProtect, searchAll);
router.put('/me/passport', protect,         updateGamerPassport);
router.get('/me/saved',    protect,         getSavedPosts);

// Public routes (with optional auth for isFollowing flag)
router.get('/:username',       optionalProtect, getProfile);
router.get('/:username/posts', optionalProtect, getUserPosts);

// Protected routes
router.post('/:username/follow',   protect, toggleFollow);
router.post('/saved/:postId',      protect, toggleSavePost);
router.post('/channels/favourite', protect, toggleFavouriteChannel);

module.exports = router;
