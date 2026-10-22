const express = require('express');
const router = express.Router();
const { getGames, getGameById } = require('../controllers/gameController');

router.get('/',    getGames);
router.get('/:id', getGameById);

module.exports = router;
