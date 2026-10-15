const express = require('express');
const Post = require('../models/Post');
const { protect, optionalProtect } = require('../middleware/auth');
const { checkOwnership } = require('../middleware/ownership');
const upload = require('../middleware/upload');
const {
  createPost, getPosts, getPostById, updatePost, deletePost, toggleLike, previewLink
} = require('../controllers/postController');

const router = express.Router();

router.get('/',        optionalProtect, getPosts);
router.get('/preview', previewLink);           // GET /api/posts/preview?url=...
router.get('/:id',     optionalProtect, getPostById);
router.post('/', protect, upload.single('media'), createPost);
router.put('/:id', protect, checkOwnership(Post), updatePost);
router.delete('/:id', protect, checkOwnership(Post), deletePost);
router.post('/:id/like', protect, toggleLike);

module.exports = router;
