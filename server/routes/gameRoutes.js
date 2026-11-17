const express = require('express');
const router = express.Router();
const { getGames, getGameRails, getGame, followGame } = require('../controllers/gameController');
const { protect, optionalProtect, activeOnly } = require('../middleware/auth');
const { catalogLimiter } = require('../middleware/limiters');

// The catalog reads a provider-backed collection; the limiter protects the
// shared work, not a per-user quota.
router.get('/', catalogLimiter, getGames);
router.get('/rails', catalogLimiter, optionalProtect, getGameRails);
router.get('/:slug', catalogLimiter, optionalProtect, getGame);
router.post('/:slug/follow', protect, activeOnly, catalogLimiter, followGame);

module.exports = router;
