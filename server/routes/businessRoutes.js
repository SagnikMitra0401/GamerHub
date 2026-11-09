const express = require('express');
const { optionalProtect } = require('../middleware/auth');
const { getPublicBusiness } = require('../controllers/businessController');

const router = express.Router();

router.get('/:username', optionalProtect, getPublicBusiness);

module.exports = router;
