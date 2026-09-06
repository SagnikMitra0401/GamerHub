const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const { awardXp } = require('../utils/gamification');

// GET /api/users/:username — public profile
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-passwordHash -email')
      .populate('followers', 'username')
      .populate('following', 'username')
      .lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Count posts
    const postCount = await Post.countDocuments({ userId: user._id });

    // Is the caller following this user?
    const isFollowing = req.user
      ? req.user.following.some(id => id.toString() === user._id.toString())
      : false;

    res.status(200).json({ ...user, postCount, isFollowing });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/:username/posts — posts by a specific user
const getUserPosts = async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username }).select('_id').lean();
    if (!target) return res.status(404).json({ message: 'User not found' });

    const { page = 1, limit = 15 } = req.query;
    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(Math.max(1, Number(limit)), 50);

    const posts = await Post.find({ userId: target._id })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('userId', 'username')
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
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (target._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot follow yourself' });
    }

    const alreadyFollowing = req.user.following.some(
      id => id.toString() === target._id.toString()
    );

    if (alreadyFollowing) {
      // Unfollow
      await User.findByIdAndUpdate(req.user._id,  { $pull: { following: target._id } });
      await User.findByIdAndUpdate(target._id, { $pull: { followers: req.user._id } });
    } else {
      // Follow
      await User.findByIdAndUpdate(req.user._id,  { $addToSet: { following: target._id } });
      await User.findByIdAndUpdate(target._id, { $addToSet: { followers: req.user._id } });

      // Gamification: Community Builder medal when following count hits 5 (non-blocking)
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
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ message: 'Invalid post id' });
    }

    const alreadySaved = req.user.savedPosts.some(
      id => id.toString() === postId
    );

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
    const { channel } = req.body;
    if (!channel || typeof channel !== 'string') {
      return res.status(400).json({ message: 'channel is required' });
    }

    const tag = channel.toLowerCase().trim();
    const alreadyFav = req.user.favoriteChannels.includes(tag);

    const update = alreadyFav
      ? { $pull:     { favoriteChannels: tag } }
      : { $addToSet: { favoriteChannels: tag } };

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

// GET /api/users/me/saved — get saved posts for the logged-in user
const getSavedPosts = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('savedPosts')
      .populate({
        path: 'savedPosts',
        populate: { path: 'userId', select: 'username' }
      })
      .lean();

    res.status(200).json(user.savedPosts.reverse()); // most recently saved first
  } catch (err) {
    next(err);
  }
};

// GET /api/search?q=... — unified full-text search for posts, users, and tags
const searchAll = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }
    const query = q.trim();

    const [posts, users, tags] = await Promise.all([
      // Full-text search on posts using MongoDB text index
      Post.find(
        { $text: { $search: query } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(10)
        .populate('userId', 'username level role')
        .lean(),

      // Regex username search
      User.find({ username: { $regex: query, $options: 'i' } })
        .select('username level role medals')
        .limit(8)
        .lean(),

      // Distinct tag search
      Post.distinct('tags', { tags: { $regex: query, $options: 'i' } })
        .then(t => t.slice(0, 10))
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

    // 1. Custom quote
    if (typeof customQuote === 'string') {
      passportData.customQuote = customQuote.trim().slice(0, 120);
    }

    // 2. Game IDs
    if (gameIds && typeof gameIds === 'object') {
      passportData.gameIds = {
        riotId:     typeof gameIds.riotId === 'string' ? gameIds.riotId.trim().slice(0, 40) : '',
        steamId:    typeof gameIds.steamId === 'string' ? gameIds.steamId.trim().slice(0, 40) : '',
        psnTag:     typeof gameIds.psnTag === 'string' ? gameIds.psnTag.trim().slice(0, 40) : '',
        xboxTag:    typeof gameIds.xboxTag === 'string' ? gameIds.xboxTag.trim().slice(0, 40) : '',
        discordTag: typeof gameIds.discordTag === 'string' ? gameIds.discordTag.trim().slice(0, 40) : ''
      };
    }

    // 3. Active Games (Cap at 10)
    if (Array.isArray(activeGames)) {
      passportData.activeGames = activeGames
        .filter(g => g && typeof g.gameName === 'string' && g.gameName.trim())
        .slice(0, 10)
        .map(g => ({
          gameName:    g.gameName.trim().slice(0, 40),
          platform:    ['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile', 'Other'].includes(g.platform) ? g.platform : 'PC',
          rankOrLevel: typeof g.rankOrLevel === 'string' ? g.rankOrLevel.trim().slice(0, 40) : ''
        }));
    }

    // 4. Multi-Rig Hardware Setups (Cap at 5)
    if (Array.isArray(hardwareRigs)) {
      let foundPrimary = false;
      passportData.hardwareRigs = hardwareRigs
        .filter(r => r && typeof r.rigName === 'string' && r.rigName.trim())
        .slice(0, 5)
        .map(r => {
          // Guarantee only one primary device
          const isPrimary = !foundPrimary && !!r.isPrimary;
          if (isPrimary) foundPrimary = true;

          return {
            rigName:    r.rigName.trim().slice(0, 40),
            deviceType: ['PC', 'Laptop', 'Mobile', 'Console', 'Handheld'].includes(r.deviceType) ? r.deviceType : 'PC',
            isPrimary,
            specs: {
              cpu:         typeof r.specs?.cpu === 'string' ? r.specs.cpu.trim().slice(0, 60) : '',
              gpu:         typeof r.specs?.gpu === 'string' ? r.specs.gpu.trim().slice(0, 60) : '',
              ram:         typeof r.specs?.ram === 'string' ? r.specs.ram.trim().slice(0, 40) : '',
              monitor:     typeof r.specs?.monitor === 'string' ? r.specs.monitor.trim().slice(0, 60) : '',
              peripherals: typeof r.specs?.peripherals === 'string' ? r.specs.peripherals.trim().slice(0, 120) : ''
            }
          };
        });

      // If rigs exist but none marked primary, make first one primary
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

module.exports = {
  getProfile,
  getUserPosts,
  toggleFollow,
  toggleSavePost,
  toggleFavouriteChannel,
  getSavedPosts,
  searchAll,
  updateGamerPassport
};
