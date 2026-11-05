const express = require('express');
const router = express.Router();
const { getGames, getGameById } = require('../controllers/gameController');
const { catalogLimiter } = require('../middleware/limiters');

// The catalog proxies a third-party API; the limiter protects that quota.
router.get('/',    catalogLimiter, getGames);
router.get('/:id', catalogLimiter, getGameById);

module.exports = router;
