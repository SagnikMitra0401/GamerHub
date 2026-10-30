const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const {
  createInvitation,
  listInbox,
  listSent,
  acceptInvitation,
  declineInvitation,
  revokeInvitation
} = require('../controllers/invitationController');

const router = express.Router();

// Invitations are cheap rows but expensive socially: a low ceiling per hour
// makes invite-spam pointless without getting in the way of normal use.
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.INVITE_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many invitations sent. Try again later.' }
});

router.get('/inbox', protect, listInbox);
router.get('/sent', protect, listSent);

router.post('/', protect, inviteLimiter, createInvitation);
router.post('/:id/accept', protect, acceptInvitation);
router.post('/:id/decline', protect, declineInvitation);
router.post('/:id/revoke', protect, revokeInvitation);

module.exports = router;
