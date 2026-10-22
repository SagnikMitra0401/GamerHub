const express = require('express');
const router = express.Router();
const { protect, optionalProtect } = require('../middleware/auth');
const {
  listParties,
  listMyParties,
  createParty,
  getParty,
  requestJoin,
  respondToRequest,
  closeParty
} = require('../controllers/lfgController');

// `/mine` must be declared before `/:id` or it would be parsed as an id.
router.get('/mine',  protect, listMyParties);
router.get('/',      optionalProtect, listParties);
router.post('/',     protect, createParty);

router.get('/:id',             optionalProtect, getParty);
router.post('/:id/request',    protect, requestJoin);
router.patch('/:id/respond',   protect, respondToRequest);
router.delete('/:id',          protect, closeParty);

module.exports = router;
