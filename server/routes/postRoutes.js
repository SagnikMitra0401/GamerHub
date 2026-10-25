const express = require('express');
const rateLimit = require('express-rate-limit');
const Post = require('../models/Post');
const { protect, optionalProtect } = require('../middleware/auth');
const { checkOwnership } = require('../middleware/ownership');
const upload = require('../middleware/upload');
const {
  createPost, getPosts, getPostById, updatePost, deletePost, toggleLike, previewLink, suggestTags
} = require('../controllers/postController');

const router = express.Router();

// Link previews make the server fetch a remote URL: authenticated + throttled.
const previewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PREVIEW_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many link previews. Please wait a moment.' }
});

router.get('/',        optionalProtect, getPosts);
router.get('/preview', protect, previewLimiter, previewLink); // before /:id
router.get('/tags/suggest', optionalProtect, suggestTags);    // before /:id
router.get('/:id',     optionalProtect, getPostById);
router.post('/', protect, upload.single('media'), createPost);
router.put('/:id', protect, checkOwnership(Post), updatePost);
router.delete('/:id', protect, checkOwnership(Post), deletePost);
router.post('/:id/like', protect, toggleLike);

module.exports = router;
