const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Community = require('../models/Community');
const BusinessProfile = require('../models/BusinessProfile');
const { awardXp } = require('../utils/gamification');
const { recordFirstEvent } = require('../utils/productEvents');
const { resolveCommunityRole, roleLevel } = require('../utils/permissions');
const { sanitizeLine, escapeRegex } = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');
const { badRequest, notFound, forbidden } = require('../utils/httpError');
const { getIO } = require('../config/socket');
const { publicPresence } = require('../utils/presence');
const { blockedIdsFor, hiddenAccountIds } = require('../utils/visibility');
const relations = require('../utils/relations');
const { describeDmPolicy } = require('../utils/dmPolicy');
const { publicBusinessProfile } = require('../utils/business');
const { notifyFollow } = require('../utils/socialNotifications');
const { resolveGameTitles, applyFavoriteGameChange } = require('../utils/gameRegistry');

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
      // Sign-in identities, session counters and personal block lists are not
      // public profile data.
      .select(
        '-passwordHash -email -authIdentities -sessionVersion -deletionRequestedAt -mutedUsers -recoveryEmail -recoveryEmailVerifiedAt -recoveryEligibleAt -followers -following',
      )
      .lean();
    if (!user) throw notFound('User not found');

    const isSelf = req.user && String(req.user._id) === String(user._id);
    const isStaff = req.user?.role === 'admin';
    const blocked = Boolean(req.user) && (await relations.isBlockedPair(req.user._id, user._id));

    // Frozen, suspended and deleted profiles are not a back door into content
    // the feed and search already hide. A symmetric block is a 404.
    if (
      (['frozen', 'suspended', 'deleted'].includes(user.status) && !isSelf && !isStaff) ||
      blocked
    ) {
      throw notFound('User not found');
    }

    const postCount = await Post.countDocuments({ userId: user._id });

    const [isFollowing, relationship, viewerBlockedIds] = req.user
      ? await Promise.all([
          relations.isFollowing(req.user._id, user._id),
          relations.relationshipBetween(req.user._id, user._id),
          relations.blockedIds(req.user._id),
        ])
      : [false, null, []];
    const viewerHasBlocked = viewerBlockedIds.includes(String(user._id));

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
          role,
        };
      })
      .filter(Boolean)
      .sort((a, b) => roleLevel(b.role) - roleLevel(a.role))
      .slice(0, 20);

    const [recipientBusiness, viewerBusiness] = await Promise.all([
      user.profileType === 'creator_business'
        ? BusinessProfile.findOne({ userId: user._id }).lean()
        : null,
      req.user?.profileType === 'creator_business'
        ? BusinessProfile.findOne({ userId: req.user._id }).select('verificationStatus').lean()
        : null,
    ]);
    const dm = describeDmPolicy({
      recipient: user,
      viewer: req.user,
      viewerIsBusiness: viewerBusiness?.verificationStatus === 'verified',
      relationshipHint: relationship,
    });
    // A counter is undefined until the backfill reaches the account; the
    // fallback reads the mirrored arrays so a profile never reports a false
    // zero during the rollout.
    const counts = await relations.countsFor(user);
    const profile = {
      ...user,
      ...counts,
      viewerHasBlocked,
      // A frozen account reads offline even to itself and staff.
      presence:
        user.status === 'frozen'
          ? { status: 'offline', activeGame: '', lastActive: null }
          : publicPresence(user.presence),
      business: publicBusinessProfile(recipientBusiness),
      postCount,
      isFollowing,
      dm,
      communities,
    };

    // The policy matrix is a private contact surface; the viewer only receives
    // the one row that applies to them in `dm`.
    delete profile.dmSettings;
    delete profile.blockedUsers;
    // The bookmark list is only served by its own endpoint, never as a profile
    // field: a large account must not ship its whole list with every view.
    delete profile.savedPosts;

    // Followed channels and discovery preferences are private.
    if (!isSelf) {
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
    const target = await User.findOne({ username: req.params.username })
      .select('_id status')
      .lean();
    if (!target) throw notFound('User not found');

    const blocked = Boolean(req.user) && (await relations.isBlockedPair(req.user._id, target._id));
    if (
      (['frozen', 'suspended', 'deleted'].includes(target.status) &&
        String(req.user?._id) !== String(target._id) &&
        req.user?.role !== 'admin') ||
      blocked
    ) {
      throw notFound('User not found');
    }

    const { skip, limit } = parsePagination(req.query, { defaultLimit: 15, maxLimit: 50 });

    const posts = await Post.find({ userId: target._id, hiddenAt: null })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'username level role profileType')
      .lean();

    res.status(200).json(posts);
  } catch (err) {
    next(err);
  }
};

// POST /api/users/:username/follow — toggle follow/unfollow
const toggleFollow = async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username }).select(
      '_id username status',
    );
    if (!target) throw notFound('User not found');

    if (target.status === 'frozen') {
      throw forbidden('That player is not accepting new followers right now.');
    }

    if (target._id.toString() === req.user._id.toString()) {
      throw badRequest('You cannot follow yourself');
    }

    const alreadyFollowing = await relations.isFollowing(req.user._id, target._id);

    if (alreadyFollowing) {
      await relations.unfollow({ followerId: req.user._id, followingId: target._id });
    } else {
      const result = await relations.follow({
        followerId: req.user._id,
        followingId: target._id,
      });
      if (result.created) {
        recordFirstEvent('first_follow', req.user._id, { surface: 'profile' });

        const updatedCaller = await User.findById(req.user._id).select('followingCount').lean();
        if (updatedCaller?.followingCount === 5) {
          awardXp(req.user._id, 20, 'community_builder');
        }

        // Only a new follow creates a ping; unfollowing is silent. The dedupe
        // key prevents follow/unfollow/re-follow churn from spamming the target.
        await notifyFollow({ target, actor: req.user });
      }
    }

    const updated = await User.findById(target._id).select('followerCount followers').lean();
    const { followerCount } = await relations.countsFor(updated);

    res.status(200).json({ following: !alreadyFollowing, followerCount });
  } catch (err) {
    next(err);
  }
};

// POST /api/users/saved/:postId — toggle bookmark
const toggleSavePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) throw badRequest('Invalid post id');

    const alreadySaved = await relations.isSaved({ userId: req.user._id, postId });

    if (alreadySaved) {
      await relations.unsavePost({ userId: req.user._id, postId });
    } else {
      await relations.savePost({ userId: req.user._id, postId });
    }

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
      ? { $pull: { favoriteChannels: channel } }
      : { $addToSet: { favoriteChannels: channel } };

    const updated = await User.findByIdAndUpdate(req.user._id, update, { new: true }).select(
      'favoriteChannels',
    );

    res.status(200).json({
      favourited: !alreadyFav,
      favoriteChannels: updated.favoriteChannels,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/me/saved — saved posts for the logged-in user
const getSavedPosts = async (req, res, next) => {
  try {
    // Bookmark order comes from the edges, so a heavy account never loads its
    // whole saved list through the user document.
    const ids = await relations.savedPostIds(req.user._id);
    if (!ids.length) return res.status(200).json([]);

    const posts = await Post.find({ _id: { $in: ids } })
      .populate('userId', 'username level role')
      .lean();
    const byId = new Map(posts.map((post) => [String(post._id), post]));

    // Deleted posts must not appear as nulls.
    res.status(200).json(ids.map((id) => byId.get(id)).filter(Boolean));
  } catch (err) {
    next(err);
  }
};

// GET /api/users/me/saved-ids — bookmark ids for the session user
const getSavedPostIds = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({ savedPostIds: await relations.savedPostIds(req.user._id) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/users/:username/followers and /following
 *
 * A page of ids from the edge collection, then one projection for the accounts
 * on it. Capped at 50 rows like every other list this API serves.
 */
const followList = async (req, res, next, kind) => {
  try {
    const target = await User.findOne({ username: req.params.username })
      .select('_id status')
      .lean();
    if (!target) throw notFound('User not found');

    const isSelf = String(req.user?._id || '') === String(target._id);
    if (
      ['frozen', 'suspended', 'deleted'].includes(target.status) &&
      !isSelf &&
      req.user?.role !== 'admin'
    ) {
      throw notFound('User not found');
    }
    if (req.user && (await relations.isBlockedPair(req.user._id, target._id))) {
      throw notFound('User not found');
    }

    const { skip, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const page =
      kind === 'followers'
        ? await relations.followersPage(target._id, { skip, limit, cursor })
        : await relations.followingPage(target._id, { skip, limit, cursor });

    const rows = page.userIds.length
      ? await User.find({ _id: { $in: page.userIds } })
          .select('username level profileType status presence')
          .lean()
      : [];
    const byId = new Map(rows.map((row) => [String(row._id), row]));

    const items = page.userIds
      .map((id) => byId.get(id))
      .filter(
        (row) =>
          row &&
          (!['frozen', 'suspended', 'deleted', 'deletion_pending'].includes(row.status) ||
            String(row._id) === String(req.user?._id)),
      )
      .map((row) => ({
        _id: String(row._id),
        username: row.username,
        level: row.level,
        profileType: row.profileType,
        presence: publicPresence(row.presence),
      }));

    res.set('Cache-Control', 'private, max-age=15');
    res.status(200).json({
      items,
      total: page.total,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    next(err);
  }
};

const getFollowers = (req, res, next) => followList(req, res, next, 'followers');
const getFollowing = (req, res, next) => followList(req, res, next, 'following');

// GET /api/users/search — unified search for posts, users, and tags
const searchAll = async (req, res, next) => {
  try {
    const q = sanitizeLine(req.query.q, 50);
    if (q.length < 2) throw badRequest('Query must be at least 2 characters');

    const safe = escapeRegex(q);

    // Blocking is symmetric: hide accounts the caller blocked *and* accounts
    // that blocked the caller, in both people and post results. Frozen and
    // suspended accounts are hidden everywhere for the same reason.
    //
    // The "who blocked me" and "who is frozen" lookups are cached for a few
    // seconds (and invalidated by freeze/block), so a signed-in search does not
    // scan the user collection on every keystroke.
    const [blockedIds, hiddenAccounts] = await Promise.all([
      blockedIdsFor(req.user?._id),
      hiddenAccountIds(),
    ]);

    // Post authors are filtered after the populate, which is cheaper than
    // loading every frozen account into a `$nin` before the text query.
    const hiddenIds = [...new Set([...blockedIds, ...hiddenAccounts])];

    const userFilter = {
      username: { $regex: `^${safe}`, $options: 'i' },
      'privacySettings.discoverableInSearch': { $ne: false },
      status: { $nin: ['frozen', 'suspended', 'deleted'] },
    };
    if (hiddenIds.length) userFilter._id = { $nin: hiddenIds };

    // Only blocks are pushed into the text query; frozen authors are dropped
    // from the populated page instead of turning into a large `$nin` list.
    const postFilter = { $text: { $search: q } };
    if (blockedIds.length) postFilter.userId = { $nin: blockedIds };

    const [posts, users, tags] = await Promise.all([
      // Weights come from the schema/migration text index: title 10, tags 5,
      // body 1. Sorting by textScore puts the best match first; createdAt breaks
      // ties so equally relevant posts stay in publish order. A few extra rows
      // are fetched so hiding a frozen author cannot empty the result page.
      Post.find(postFilter, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .limit(15)
        .populate('userId', 'username level role profileType status')
        .lean(),

      // Anchored prefix, not an unanchored scan: the unique username index can
      // serve `^handle` directly.
      User.find(userFilter).select('username level role medals').limit(8).lean(),

      // Anchored prefix: `^gam` can walk the multikey tags index, while a bare
      // regex would scan every post document on each search.
      Post.distinct('tags', { tags: { $regex: `^${safe}`, $options: 'i' } }).then((t) =>
        t.slice(0, 10),
      ),
    ]);

    const visiblePosts = posts
      .filter(
        (post) =>
          post.userId && post.userId.status !== 'frozen' && post.userId.status !== 'suspended',
      )
      .slice(0, 10);

    res.status(200).json({ posts: visiblePosts, users, tags });
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
        riotId: sanitizeLine(gameIds.riotId, 40),
        steamId: sanitizeLine(gameIds.steamId, 40),
        psnTag: sanitizeLine(gameIds.psnTag, 40),
        xboxTag: sanitizeLine(gameIds.xboxTag, 40),
        discordTag: sanitizeLine(gameIds.discordTag, 40),
      };
    }

    if (Array.isArray(activeGames)) {
      passportData.activeGames = activeGames
        .filter((g) => g && typeof g.gameName === 'string' && g.gameName.trim())
        .slice(0, 10)
        .map((g) => ({
          gameName: sanitizeLine(g.gameName, 40),
          platform: ['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile', 'Other'].includes(g.platform)
            ? g.platform
            : 'PC',
          rankOrLevel: sanitizeLine(g.rankOrLevel, 40),
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
            rigName: sanitizeLine(r.rigName, 40),
            deviceType: ['PC', 'Laptop', 'Mobile', 'Console', 'Handheld'].includes(r.deviceType)
              ? r.deviceType
              : 'PC',
            isPrimary,
            specs: {
              cpu: sanitizeLine(r.specs?.cpu, 60),
              gpu: sanitizeLine(r.specs?.gpu, 60),
              ram: sanitizeLine(r.specs?.ram, 40),
              monitor: sanitizeLine(r.specs?.monitor, 60),
              peripherals: sanitizeLine(r.specs?.peripherals, 120),
            },
          };
        });

      if (passportData.hardwareRigs.length > 0 && !foundPrimary) {
        passportData.hardwareRigs[0].isPrimary = true;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { gamerPassport: passportData } },
      { new: true },
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
        throw badRequest(
          `Invalid platform(s): ${invalid.join(', ')}. Allowed: ${USER_PLATFORMS.join(', ')}`,
        );
      }
      updates['preferences.platforms'] = [...new Set(platforms)];
    }

    if (!Object.keys(updates).length) throw badRequest('No preferences provided.');

    const previous = await User.findById(req.user._id).select('preferences.favoriteGames').lean();

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true },
    ).select('preferences');

    // Keep the canonical catalog in step with the free-text titles saved here.
    if (updates['preferences.favoriteGames']) {
      await resolveGameTitles(updated.preferences?.favoriteGames || []);
      await applyFavoriteGameChange(
        previous?.preferences?.favoriteGames || [],
        updated.preferences?.favoriteGames || [],
      );
    }

    res.status(200).json({ preferences: updated.preferences });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/users/presence — set online / in_game / offline / invisible
const updatePresence = async (req, res, next) => {
  try {
    if (req.user.status === 'frozen') {
      throw forbidden('Your account is frozen. Unfreeze it in Settings to show a presence.');
    }

    const status = String(req.body?.status || '');
    if (!PRESENCE_STATUSES.includes(status)) {
      throw badRequest('status must be one of: online, in_game, offline, invisible.');
    }

    const activeGame = status === 'in_game' ? sanitizeLine(req.body?.activeGame, 60) : '';
    if (status === 'in_game' && !activeGame) {
      throw badRequest('Pick a game to show as your active game.');
    }

    const presence = { status, activeGame, lastActive: new Date() };
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { presence } },
      { new: true, runValidators: true },
    ).select('presence');

    // Everyone else sees the public projection (invisible -> offline).
    getIO()?.emit('presence_change', {
      userId: String(req.user._id),
      username: req.user.username,
      ...publicPresence(updated.presence),
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
  getSavedPostIds,
  getFollowers,
  getFollowing,
  searchAll,
  updateGamerPassport,
  updatePreferences,
  updatePresence,
  publicPresence,
  cleanStringList,
};
