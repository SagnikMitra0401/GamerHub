const User = require('../models/User');

// Medal definitions — single source of truth
const MEDALS = {
  highlight_poster: {
    id: 'highlight_poster',
    name: 'Highlight Poster',
    icon: '🎬',
    description: 'Uploaded your first gaming clip or screenshot'
  },
  gamer_critic: {
    id: 'gamer_critic',
    name: 'Gamer Critic',
    icon: '💬',
    description: 'Posted your first community comment'
  },
  viral_gamer: {
    id: 'viral_gamer',
    name: 'Viral Gamer',
    icon: '🔥',
    description: 'One of your posts reached 10 likes'
  },
  community_builder: {
    id: 'community_builder',
    name: 'Community Builder',
    icon: '🌐',
    description: 'Following 5 or more gamers'
  }
};

// Level formula: Level = floor(XP / 25) + 1
const calcLevel = (xp) => Math.floor(Math.max(0, xp) / 25) + 1;

/**
 * Award XP to a user and optionally unlock a medal.
 * Silently fails so gamification never blocks critical request paths.
 *
 * @param {ObjectId|string} userId
 * @param {number}          xpGained
 * @param {string|null}     medalId  — key in MEDALS dict, or null
 */
const awardXp = async (userId, xpGained, medalId = null) => {
  try {
    const user = await User.findById(userId).select('xp level medals');
    if (!user) return;

    const newXp    = (user.xp || 0) + xpGained;
    const newLevel = calcLevel(newXp);
    const setData  = { xp: newXp, level: newLevel };

    if (medalId && MEDALS[medalId]) {
      const alreadyEarned = (user.medals || []).some(m => m.id === medalId);
      if (!alreadyEarned) {
        await User.findByIdAndUpdate(userId, {
          $set:  setData,
          $push: { medals: { ...MEDALS[medalId], earnedAt: new Date() } }
        });
        return;
      }
    }

    await User.findByIdAndUpdate(userId, { $set: setData });
  } catch (err) {
    // Non-fatal — log but do not propagate
    console.error('[Gamification] awardXp error:', err.message);
  }
};

module.exports = { awardXp, calcLevel, MEDALS };
