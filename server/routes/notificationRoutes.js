const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { listNotifications, markRead, markAllRead } = require('../controllers/notificationController');

router.get('/',             protect, listNotifications);
router.post('/read-all',    protect, markAllRead);
router.patch('/:id/read',   protect, markRead);

module.exports = router;
