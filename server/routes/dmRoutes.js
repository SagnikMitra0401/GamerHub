const express = require('express');
const {
  getSummary,
  getConversations,
  getThread,
  startRequest,
  accept,
  decline,
  sendMessage,
  read,
  archive,
  mute,
  report,
  readLimiter,
  writeLimiter,
  requestLimiter
} = require('../controllers/dmController');
const { protect, activeOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/summary', readLimiter, getSummary);
router.get('/conversations', readLimiter, getConversations);
router.get('/conversations/:id', readLimiter, getThread);

// Writes require an account that may participate (not frozen/suspended).
router.post('/requests', activeOnly, requestLimiter, startRequest);
router.post('/conversations/:id/accept', activeOnly, writeLimiter, accept);
router.delete('/conversations/:id/request', activeOnly, writeLimiter, decline);
router.post('/conversations/:id/messages', activeOnly, writeLimiter, sendMessage);
router.post('/conversations/:id/read', writeLimiter, read);
router.post('/conversations/:id/archive', writeLimiter, archive);
router.patch('/conversations/:id/mute', writeLimiter, mute);
router.post('/conversations/:id/report', activeOnly, writeLimiter, report);

module.exports = router;
