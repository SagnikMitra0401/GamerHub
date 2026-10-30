const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const {
  getSquadChat,
  getSquadMessages,
  sendSquadMessage,
  refreshSquadChat,
  deleteSquadMessage
} = require('../controllers/squadChatController');

const router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.SQUAD_CHAT_RATE_LIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many messages. Please slow down.' }
});

router.get('/:chatId', protect, getSquadChat);
router.get('/:chatId/messages', protect, getSquadMessages);
router.post('/:chatId/messages', protect, chatLimiter, sendSquadMessage);
router.post('/:chatId/refresh', protect, refreshSquadChat);
router.delete('/:chatId/messages/:messageId', protect, deleteSquadMessage);

module.exports = router;
