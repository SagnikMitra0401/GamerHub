const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, optionalProtect, activeOnly } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  createChannel, listChannels, getChannel, subscribe, unsubscribe, setMuted,
  markRead, getMessages, publishMessage, deleteChannel, deleteMessage
} = require('../controllers/broadcastController');

const router = express.Router();

const publishLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.BROADCAST_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'You are publishing too quickly. Try again shortly.' }
});

router.get('/', optionalProtect, listChannels);
router.post('/', protect, activeOnly, createChannel);

router.get('/:slug', optionalProtect, getChannel);
router.get('/:slug/messages', optionalProtect, getMessages);
router.delete('/:slug', protect, activeOnly, deleteChannel);

router.post('/:slug/subscribe', protect, activeOnly, subscribe);
router.delete('/:slug/subscribe', protect, activeOnly, unsubscribe);
router.patch('/:slug/subscription', protect, activeOnly, setMuted);
router.post('/:slug/read', protect, activeOnly, markRead);

router.post('/:slug/messages', protect, activeOnly, publishLimiter, upload.single('media'), publishMessage);
router.delete('/:slug/messages/:messageId', protect, activeOnly, deleteMessage);

module.exports = router;
