const express = require('express');
const Comment = require('../models/Comment');
const { protect, activeOnly } = require('../middleware/auth');
const { checkOwnership } = require('../middleware/ownership');
const {
  createComment, getCommentsForPost, updateComment, deleteComment
} = require('../controllers/commentController');

const router = express.Router({ mergeParams: true }); // mounted at /api/posts/:postId/comments

router.get('/', getCommentsForPost);
router.post('/', protect, activeOnly, createComment);
router.put('/:id', protect, checkOwnership(Comment), updateComment);
router.delete('/:id', protect, checkOwnership(Comment), deleteComment);

module.exports = router;
