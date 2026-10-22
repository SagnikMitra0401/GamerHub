const User = require('../models/User');
const youtubeBot = require('../utils/youtubeBot');
const { createRecentEventTracker } = require('../utils/rateLimiter');

/**
 * Each sync costs up to MAX_GAMES_PER_SYNC YouTube search requests, so a user
 * may trigger it once a minute at most. Repeated syncs hit the server-side
 * cache and create no duplicates.
 */
const syncThrottle = createRecentEventTracker({ maxAgeMs: 5 * 60 * 1000 });
const SYNC_INTERVAL_MS = 60 * 1000;

// POST /api/bot/sync-youtube
const syncYoutube = async (req, res, next) => {
  try {
    if (!youtubeBot.isConfigured()) {
      return res.status(503).json({
        message: 'The gaming bot needs YOUTUBE_API_KEY in the server environment before it can fetch videos.',
        code: 'BOT_NOT_CONFIGURED'
      });
    }

    if (!syncThrottle.touch(String(req.user._id), SYNC_INTERVAL_MS)) {
      return res.status(429).json({ message: 'You just synced. Try again in a minute.' });
    }

    const user = await User.findById(req.user._id).select('preferences').lean();
    const result = await youtubeBot.syncUserNotifications(user);

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
};

// GET /api/bot/status — configuration only, never the key
const getBotStatus = async (req, res, next) => {
  try {
    const status = youtubeBot.getStatus();
    res.status(200).json({
      configured: status.configured,
      lastSync: status.lastSync,
      cacheTtlMinutes: status.cacheTtlMinutes,
      lookbackDays: status.lookbackDays,
      maxGamesPerSync: status.maxGamesPerSync
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { syncYoutube, getBotStatus, syncThrottle };
