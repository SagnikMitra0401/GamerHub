const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Community = require('../models/Community');
const { awardXp } = require('../utils/gamification');
const { resolveCommunityRole, roleLevel } = require('../utils/permissions');
const { sanitizeLine, escapeRegex } = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { badRequest, notFound } = require('../utils/httpError');
const { getIO } = require('../config/socket');
const { publicPresence } = require('../utils/presence');

const USER_PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];
const PRESENCE_STATUSES = ['online', 'in_game', 'offline', 'invisible'];
const MAX_FAVORITES = 20;

/** Trim, cap and de-duplicate a user-supplied string list (null when not an array). */
function cleanStringList(input, { maxLength = 40, limit = MAX_FAVORITES } = {}) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of input.slice(0, 100)) {
    const value = sanitizeLine(String(raw ?? ''), maxLength);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}



// GET /api/users/:username — public profile
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-passwordHash -email')
      .populate('followers', 'username')
      .populate('following', 'username')
      .lean();
    if (!user) throw notFound('User not found');

    const postCount = await Post.countDocuments({ userId: user._id });

    const isFollowing = req.user
      ? req.user.following.some((id) => id.toString() === user._id.toString())
      : false;

    const isSelf = req.user && String(req.user._id) === String(user._id);

    // Server memberships + the role held in each (role badge integration).
    const rows = await Community.find({ 'members.userId': user._id })
      .select('name slug icon isPrivate members')
      .limit(30)
      .lean();

    const communities = rows
      .map((c) => {
        const role = resolveCommunityRole(c, user._id);
        if (!role) return null;
        // Both the server's existence and this user's membership are private
        // data: only the user themselves, or a fellow member, may see them.
        if (c.isPrivate && !isSelf && !resolveCommunityRole(c, req.user?._id)) return null;
        return {
          _id: c._id,
          name: c.name,
          slug: c.slug,
          icon: c.icon,
          isPrivate: c.isPrivate,
          role
        };
      })
      .filter(Boolean)
      .sort((a, b) => roleLevel(b.role) - roleLevel(a.role))
      .slice(0, 20);

    const profile = {
      ...user,
      presence: publicPresence(user.presence),
      postCount,
      isFollowing,
      communities
    };

    // Bookmarks, followed channels and discovery preferences are private.
    if (!isSelf) {
      delete profile.savedPosts;
      delete profile.favoriteChannels;
      delete profile.preferences;
    }

    res.status(200).json(profile);
  } catch (err) {
    next(err);
  }
};

// GET /api/users/:username/posts
const getUserPosts = async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username }).select('_id').lean();
    if (!target) throw notFound('User not found');

    const { skip, limit } = parsePagination(req.query, { defaultLimit: 15, maxLimit: 50 });

    const posts = await Post.find({ userId: target._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'username level role')
      .lean();

    res.status(200).json(posts);
  } catch (err) {
    next(err);
  }
};

// POST /api/users/:username/follow — toggle follow/unfollow
const toggleFollow = async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username }).select('_id username');
    if (!target) throw notFound('User not found');

    if (target._id.toString() === req.user._id.toString()) {
      throw badRequest('You cannot follow yourself');
    }

    const alreadyFollowing = req.user.following.some(
      (id) => id.toString() === target._id.toString()
    );

    if (alreadyFollowing) {
      await User.findByIdAndUpdate(req.user._id,  { $pull: { following: target._id } });
      await User.findByIdAndUpdate(target._id, { $pull: { followers: req.user._id } });
    } else {
      await User.findByIdAndUpdate(req.user._id,  { $addToSet: { following: target._id } });
      await User.findByIdAndUpdate(target._id, { $addToSet: { followers: req.user._id } });

      const updatedCaller = await User.findById(req.user._id).select('following').lean();
      if (updatedCaller?.following?.length === 5) {
        awardXp(req.user._id, 20, 'community_builder');
      }
    }

    const updated = await User.findById(target._id)
      .select('followers')
      .populate('followers', 'username')
      .lean();

    res.status(200).json({
      following: !alreadyFollowing,
      followers: updated.followers
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/users/saved/:postId — toggle bookmark
const toggleSavePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) throw badRequest('Invalid post id');

    const alreadySaved = req.user.savedPosts.some((id) => id.toString() === postId);

    const update = alreadySaved
      ? { $pull:     { savedPosts: postId } }
      : { $addToSet: { savedPosts: postId } };

    await User.findByIdAndUpdate(req.user._id, update);
    res.status(200).json({ saved: !alreadySaved, postId });
  } catch (err) {
    next(err);
  }
};

// POST /api/users/channels/favourite — toggle favourite channel (tag)
const toggleFavouriteChannel = async (req, res, next) => {
  try {
    const channel = sanitizeLine(req.body.channel, 24).toLowerCase();
    if (!channel) throw badRequest('channel is required');

    const alreadyFav = req.user.favoriteChannels.includes(channel);

    const update = alreadyFav
      ? { $pull:     { favoriteChannels: channel } }
      : { $addToSet: { favoriteChannels: channel } };

    const updated = await User.findByIdAndUpdate(req.user._id, update, { new: true })
      .select('favoriteChannels');

    res.status(200).json({
      favourited: !alreadyFav,
      favoriteChannels: updated.favoriteChannels
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/me/saved — saved posts for the logged-in user
const getSavedPosts = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('savedPosts')
      .populate({
        path: 'savedPosts',
        populate: { path: 'userId', select: 'username level role' }
      })
      .lean();

    // Deleted posts must not appear as nulls.
    const posts = (user?.savedPosts || []).filter(Boolean).reverse();
    res.status(200).json(posts);
  } catch (err) {
    next(err);
  }
};

// GET /api/users/search — unified search for posts, users, and tags
const searchAll = async (req, res, next) => {
  try {
    const q = sanitizeLine(req.query.q, 50);
    if (q.length < 2) throw badRequest('Query must be at least 2 characters');

    const safe = escapeRegex(q);

    const [posts, users, tags] = await Promise.all([
      // Weights come from the schema/migration text index: title 10, tags 5,
      // body 1. Sorting by textScore puts the best match first; createdAt breaks
      // ties so equally relevant posts stay in publish order.
      Post.find(
        { $text: { $search: q } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .limit(10)
        .populate('userId', 'username level role')
        .lean(),

      // Anchored prefix, not an unanchored scan: the unique username index can
      // serve `^handle` directly.
      User.find({ username: { $regex: `^${safe}`, $options: 'i' } })
        .select('username level role medals')
        .limit(8)
        .lean(),

      Post.distinct('tags', { tags: { $regex: safe, $options: 'i' } })
        .then((t) => t.slice(0, 10))
    ]);

    res.status(200).json({ posts, users, tags });
  } catch (err) {
    next(err);
  }
};

// PUT /api/users/me/passport — update authenticated user's gamer passport
const updateGamerPassport = async (req, res, next) => {
  try {
    const { customQuote, gameIds, activeGames, hardwareRigs } = req.body;
    const passportData = {};

    if (typeof customQuote === 'string') {
      passportData.customQuote = sanitizeLine(customQuote, 120);
    }

    if (gameIds && typeof gameIds === 'object') {
      passportData.gameIds = {
        riotId:     sanitizeLine(gameIds.riotId, 40),
        steamId:    sanitizeLine(gameIds.steamId, 40),
        psnTag:     sanitizeLine(gameIds.psnTag, 40),
        xboxTag:    sanitizeLine(gameIds.xboxTag, 40),
        discordTag: sanitizeLine(gameIds.discordTag, 40)
      };
    }

    if (Array.isArray(activeGames)) {
      passportData.activeGames = activeGames
        .filter((g) => g && typeof g.gameName === 'string' && g.gameName.trim())
        .slice(0, 10)
        .map((g) => ({
          gameName:    sanitizeLine(g.gameName, 40),
          platform:    ['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile', 'Other'].includes(g.platform) ? g.platform : 'PC',
          rankOrLevel: sanitizeLine(g.rankOrLevel, 40)
        }));
    }

    if (Array.isArray(hardwareRigs)) {
      let foundPrimary = false;
      passportData.hardwareRigs = hardwareRigs
        .filter((r) => r && typeof r.rigName === 'string' && r.rigName.trim())
        .slice(0, 5)
        .map((r) => {
          const isPrimary = !foundPrimary && !!r.isPrimary;
          if (isPrimary) foundPrimary = true;

          return {
            rigName:    sanitizeLine(r.rigName, 40),
            deviceType: ['PC', 'Laptop', 'Mobile', 'Console', 'Handheld'].includes(r.deviceType) ? r.deviceType : 'PC',
            isPrimary,
            specs: {
              cpu:         sanitizeLine(r.specs?.cpu, 60),
              gpu:         sanitizeLine(r.specs?.gpu, 60),
              ram:         sanitizeLine(r.specs?.ram, 40),
              monitor:     sanitizeLine(r.specs?.monitor, 60),
              peripherals: sanitizeLine(r.specs?.peripherals, 120)
            }
          };
        });

      if (passportData.hardwareRigs.length > 0 && !foundPrimary) {
        passportData.hardwareRigs[0].isPrimary = true;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { gamerPassport: passportData } },
      { new: true }
    ).select('gamerPassport');

    res.status(200).json(updatedUser.gamerPassport);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/users/me/preferences — favourite games/genres/platforms
const updatePreferences = async (req, res, next) => {
  try {
    const { favoriteGames, favoriteGenres, platforms } = req.body || {};
    if (!req.body || typeof req.body !== 'object') throw badRequest('Invalid payload');

    const updates = {};

    if (favoriteGames !== undefined) {
      const games = cleanStringList(favoriteGames, { maxLength: 60 });
      if (!games) throw badRequest('favoriteGames must be an array of game titles.');
      updates['preferences.favoriteGames'] = games;
    }

    if (favoriteGenres !== undefined) {
      const genres = cleanStringList(favoriteGenres, { maxLength: 40 });
      if (!genres) throw badRequest('favoriteGenres must be an array of genres.');
      updates['preferences.favoriteGenres'] = genres;
    }

    if (platforms !== undefined) {
      if (!Array.isArray(platforms)) throw badRequest('platforms must be an array.');
      const invalid = platforms.filter((p) => !USER_PLATFORMS.includes(p));
      if (invalid.length) {
        throw badRequest(`Invalid platform(s): ${invalid.join(', ')}. Allowed: ${USER_PLATFORMS.join(', ')}`);
      }
      updates['preferences.platforms'] = [...new Set(platforms)];
    }

    if (!Object.keys(updates).length) throw badRequest('No preferences provided.');

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('preferences');

    res.status(200).json({ preferences: updated.preferences });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/users/presence — set online / in_game / offline / invisible
const updatePresence = async (req, res, next) => {
  try {
    const status = String(req.body?.status || '');
    if (!PRESENCE_STATUSES.includes(status)) {
      throw badRequest('status must be one of: online, in_game, offline, invisible.');
    }

    const activeGame = status === 'in_game'
      ? sanitizeLine(req.body?.activeGame, 60)
      : '';
    if (status === 'in_game' && !activeGame) {
      throw badRequest('Pick a game to show as your active game.');
    }

    const presence = { status, activeGame, lastActive: new Date() };
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { presence } },
      { new: true, runValidators: true }
    ).select('presence');

    // Everyone else sees the public projection (invisible -> offline).
    getIO()?.emit('presence_change', {
      userId: String(req.user._id),
      username: req.user.username,
      ...publicPresence(updated.presence)
    });

    res.status(200).json({ presence: updated.presence });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfile,
  getUserPosts,
  toggleFollow,
  toggleSavePost,
  toggleFavouriteChannel,
  getSavedPosts,
  searchAll,
  updateGamerPassport,
  updatePreferences,
  updatePresence,
  publicPresence,
  cleanStringList
};
