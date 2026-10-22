const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { syncYoutube, getBotStatus } = require('../controllers/botController');

router.get('/status',        protect, getBotStatus);
router.post('/sync-youtube', protect, syncYoutube);

module.exports = router;
