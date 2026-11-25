const Party = require('../models/Party');
const Community = require('../models/Community');
const Post = require('../models/Post');
const User = require('../models/User');
const { openSlots } = require('../utils/partyRules');
const { publicPresence } = require('../utils/presence');
const { blockedIdsFor } = require('../utils/visibility');
const relations = require('../utils/relations');
const { escapeRegex } = require('../utils/sanitize');
const {
  MAX_ONBOARDING_GAMES,
  normalizeGames,
  normalizePlatforms,
  gameMatches,
  communityScore,
  publicSuggestionPlayer,
  countMatchingTags,
} = require('../utils/onboarding');
const { recordFirstEvent } = require('../utils/productEvents');
const { resolveGameTitles, applyFavoriteGameChange } = require('../utils/gameRegistry');

const ACTIVE_STATUS = 'active';
const HIDDEN_STATUSES = ['frozen', 'suspended', 'deleted'];
const SQUAD_LIMIT = 9;
const SQUADS_PER_GAME = 3;

const idOf = (value) => String(value?._id || value || '');
const sameId = (a, b) => Boolean(a && b) && String(a) === String(b);

/**
 * GET /api/discover/onboarding?games=Valorant,Apex%20Legends&platforms=PC
 *
 * One authenticated round trip returns open squads, public servers, players and
 * tags. Every section has a popularity fallback so a brand-new account never
 * lands on an empty screen.
 */
const getOnboardingSuggestions = async (req, res, next) => {
  try {
    const viewerId = req.user._id;
    const viewer = String(viewerId);
    const games = normalizeGames(req.query.games, { limit: MAX_ONBOARDING_GAMES });
    const platforms = normalizePlatforms(req.query.platforms);

    // blockedIdsFor already returns both directions of a block.
    const blockedIds = await blockedIdsFor(viewerId);
    const gameRegexes = games.map((game) => new RegExp(`^${escapeRegex(game)}`, 'i'));

    // ── Squads ──────────────────────────────────────────────────────────────
    const squadRows = await Party.find({
      status: 'open',
      expiresAt: { $gt: new Date() },
      'members.userId': { $ne: viewerId },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate({ path: 'leaderId', select: 'username level role presence status' })
      .lean();

    const rankedSquads = squadRows
      .filter((party) => party.leaderId && party.leaderId.status === ACTIVE_STATUS)
      .filter((party) => !blockedIds.includes(idOf(party.leaderId)))
      .filter((party) => openSlots(party) > 0)
      .map((party) => {
        const matchedGame = games.find((game) => gameMatches(game, party.gameTitle)) || null;
        return { party, matchedGame };
      })
      .sort((a, b) => {
        if (Boolean(a.matchedGame) !== Boolean(b.matchedGame)) return a.matchedGame ? -1 : 1;
        return new Date(b.party.createdAt).getTime() - new Date(a.party.createdAt).getTime();
      });

    const seenSquads = new Set();
    const perGame = new Map();
    const squads = [];
    for (const entry of rankedSquads) {
      if (squads.length >= SQUAD_LIMIT) break;
      const party = entry.party;
      if (seenSquads.has(String(party._id))) continue;
      if (entry.matchedGame) {
        const count = perGame.get(entry.matchedGame) || 0;
        if (count >= SQUADS_PER_GAME) continue;
        perGame.set(entry.matchedGame, count + 1);
      }
      seenSquads.add(String(party._id));
      squads.push({
        id: String(party._id),
        gameTitle: party.gameTitle,
        gameThumbnail: party.gameThumbnail || null,
        activity: party.activity || '',
        openSlots: openSlots(party),
        maxSlots: party.maxSlots,
        micRequired: !!party.requirements?.micRequired,
        leader: party.leaderId
          ? {
              id: idOf(party.leaderId),
              username: party.leaderId.username,
              level: party.leaderId.level || 1,
              presence: publicPresence(party.leaderId.presence),
            }
          : null,
        popular: !entry.matchedGame,
      });
    }

    // ── Communities ─────────────────────────────────────────────────────────
    const communityRows = await Community.find({ isPrivate: false })
      .select('name slug description icon games members bannedUsers createdAt')
      .sort({ createdAt: -1 })
      .limit(80)
      .lean();

    const scoredCommunities = communityRows
      .filter(
        (community) => !(community.members || []).some((member) => sameId(member.userId, viewerId)),
      )
      .filter(
        (community) => !(community.bannedUsers || []).some((ban) => sameId(ban.userId, viewerId)),
      )
      .map((community) => ({
        community,
        score: communityScore(community, games),
        memberCount: (community.members || []).length,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.memberCount - a.memberCount ||
          new Date(b.community.createdAt).getTime() - new Date(a.community.createdAt).getTime(),
      )
      .slice(0, 5);

    const communities = scoredCommunities.map(({ community, score, memberCount }) => ({
      id: String(community._id),
      name: community.name,
      slug: community.slug,
      description: community.description || '',
      icon: community.icon || '🎮',
      memberCount,
      games: Array.isArray(community.games) ? community.games : [],
      popular: !score,
    }));

    // ── Players ─────────────────────────────────────────────────────────────
    let players = [];
    if (games.length) {
      const playerFilter = {
        _id: { $ne: viewerId },
        status: ACTIVE_STATUS,
        'privacySettings.discoverableInSearch': { $ne: false },
        $or: [
          { 'preferences.favoriteGames': { $in: gameRegexes } },
          { 'gamerPassport.activeGames.gameName': { $in: gameRegexes } },
        ],
      };
      if (blockedIds.length) playerFilter._id.$nin = blockedIds;

      const playerRows = await User.find(playerFilter)
        .select('username level presence preferences.favoriteGames gamerPassport.activeGames')
        .limit(30)
        .lean();

      const followed = new Set(
        await relations.followedAmong(
          req.user._id,
          playerRows.map((player) => player._id),
        ),
      );

      players = playerRows
        .map((player) => ({
          ...publicSuggestionPlayer(
            { ...player, presence: publicPresence(player.presence) },
            games,
          ),
          following: followed.has(String(player._id)),
        }))
        .filter((player) => player.sharedGames.length > 0)
        .slice(0, 5);
    }

    // ── Tags ────────────────────────────────────────────────────────────────
    const recentPosts = await Post.find({ hiddenAt: null })
      .sort({ createdAt: -1 })
      .limit(200)
      .select('tags')
      .lean();
    const tags = countMatchingTags(recentPosts, games);

    const squadsHaveMatch = squads.some((squad) => !squad.popular);
    const communitiesHaveMatch = communities.some((community) => !community.popular);

    res.status(200).json({
      games,
      platforms,
      squads,
      communities,
      players,
      tags,
      // Per-section labels: a section may be relevant while another section is
      // showing its popularity fallback.
      fallback: {
        squads: games.length > 0 && !squadsHaveMatch,
        communities: games.length > 0 && !communitiesHaveMatch,
      },
    });
  } catch (err) {
    next(err);
  }
};

/** POST /api/discover/onboarding/start — records the entry point once. */
const startOnboarding = async (req, res, next) => {
  try {
    recordFirstEvent('onboarding_started', req.user._id);
    res.status(200).json({ started: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/discover/onboarding/complete
 *
 * Saves the chosen games/platforms and stamps completion. Re-running the flow
 * from Settings is harmless: it updates the timestamp and preferences again.
 */
const completeOnboarding = async (req, res, next) => {
  try {
    const updates = { onboardingCompletedAt: new Date() };

    if (req.body?.games !== undefined) {
      const games = normalizeGames(req.body.games, { limit: MAX_ONBOARDING_GAMES });
      updates['preferences.favoriteGames'] = games;
    }
    if (req.body?.platforms !== undefined) {
      updates['preferences.platforms'] = normalizePlatforms(req.body.platforms);
    }

    const previous = await User.findById(req.user._id).select('preferences.favoriteGames').lean();

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true, select: 'onboardingCompletedAt preferences' },
    ).lean();

    // Every chosen game becomes a canonical catalog row (provisional if no
    // provider knows it), so the profile, LFG board and catalog agree on names.
    if (updates['preferences.favoriteGames']) {
      const nextGames = updated.preferences?.favoriteGames || [];
      await resolveGameTitles(nextGames);
      await applyFavoriteGameChange(previous?.preferences?.favoriteGames || [], nextGames);
    }

    const skipped = req.body?.skipped === true;
    recordFirstEvent(skipped ? 'onboarding_skipped' : 'onboarding_completed', req.user._id, {
      games: updated.preferences?.favoriteGames?.length || 0,
      platforms: updated.preferences?.platforms?.length || 0,
    });

    res.status(200).json({
      onboardingCompletedAt: updated.onboardingCompletedAt,
      preferences: updated.preferences,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getOnboardingSuggestions,
  startOnboarding,
  completeOnboarding,
};
