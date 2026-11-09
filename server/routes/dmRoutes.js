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
  updateLabels,
  report,
  readLimiter,
  writeLimiter,
  requestLimiter
} = require('../controllers/dmController');
const {
  getWorkspaces,
  respondInvite,
  leaveTeam,
  getConversations: getTeamConversations,
  getThread: getTeamThread,
  sendMessage: sendTeamMessage,
  accept: acceptTeamRequest,
  decline: declineTeamRequest,
  read: readTeamThread
} = require('../controllers/teamController');
const { protect, activeOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/summary', readLimiter, getSummary);

// Shared business inboxes. Every route re-checks active membership and the
// owner's business status; a personal thread is never reachable here.
router.get('/team', readLimiter, getWorkspaces);
router.post('/team/:ownerId/respond', activeOnly, writeLimiter, respondInvite);
router.delete('/team/:ownerId/leave', activeOnly, writeLimiter, leaveTeam);
router.get('/team/:ownerId/conversations', readLimiter, getTeamConversations);
router.get('/team/:ownerId/conversations/:id', readLimiter, getTeamThread);
router.post('/team/:ownerId/conversations/:id/messages', activeOnly, writeLimiter, sendTeamMessage);
router.post('/team/:ownerId/conversations/:id/accept', activeOnly, writeLimiter, acceptTeamRequest);
router.delete('/team/:ownerId/conversations/:id/request', activeOnly, writeLimiter, declineTeamRequest);
router.post('/team/:ownerId/conversations/:id/read', writeLimiter, readTeamThread);
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
router.patch('/conversations/:id/labels', activeOnly, writeLimiter, updateLabels);
router.post('/conversations/:id/report', activeOnly, writeLimiter, report);

module.exports = router;
