const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { notificationEngagementLimiter } = require('../middleware/limiters');
const {
  listNotifications,
  markRead,
  markAllRead,
  opened,
  clicked,
} = require('../controllers/notificationController');

router.get('/', protect, listNotifications);
router.post('/read-all', protect, markAllRead);
router.post('/opened', protect, notificationEngagementLimiter, opened);
router.post('/:id/clicked', protect, notificationEngagementLimiter, clicked);
router.patch('/:id/read', protect, markRead);

module.exports = router;
