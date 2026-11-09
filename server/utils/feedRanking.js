/**
 * Personalized feed ranking ("For You").
 *
 * A transparent, deterministic score — no ML, no hidden signals:
 *   +50 per matched favourite game / genre tag
 *   +30 per matched favourite channel tag
 *   +15 when the post's author is someone you follow
 *   + 2 per like, +3 per comment (capped, so a viral old post cannot dominate)
 *   − 0.5 per hour of age
 * Ties break on newest first so the order is stable across requests.
 *
 * Tags are compared on their letters and digits only, so a favourite game
 * "Elden Ring" matches #eldenring, #elden-ring and "Elden Ring" alike.
 */

const GAME_TAG_WEIGHT = 50;
const CHANNEL_TAG_WEIGHT = 30;
const FOLLOWED_AUTHOR_BOOST = 15;
const MAX_ENGAGEMENT_BONUS = 60;
const AGE_PENALTY_PER_HOUR = 0.5;

const norm = (value) => String(value ?? '').trim().toLowerCase();

/** Letters and digits only: "#Elden-Ring" and "elden ring" both become "eldenring". */
const tagKey = (value) =>
  norm(value).replace(/^#+/, '').replace(/[^\p{L}\p{N}]+/gu, '');

const keySet = (list) =>
  new Set((Array.isArray(list) ? list : []).map(tagKey).filter(Boolean));

const authorId = (post) => String(post?.userId?._id ?? post?.userId ?? '');

/** Ids only, so ranking never depends on populated user documents. */
const followSet = (list) =>
  new Set((Array.isArray(list) ? list : []).map((entry) => String(entry?._id ?? entry)).filter(Boolean));

/**
 * @param {object[]} posts     post documents (lean) with tags/likes/commentCount/createdAt
 * @param {object}   prefs     { favoriteGames, favoriteGenres, favoriteChannels, following }
 * @param {object}   options   { now }
 * @returns {object[]} posts with `rankScore` and `matchedTags`, best first
 */
function rankPostsForUser(posts, prefs = {}, { now = Date.now() } = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return [];

  const games = keySet(prefs.favoriteGames);
  const genres = keySet(prefs.favoriteGenres);
  const channels = keySet(prefs.favoriteChannels);
  const following = followSet(prefs.following);

  return posts
    .map((post) => {
      const tags = (post.tags || []).map(norm);
      let score = 0;
      const matched = new Set();

      for (const tag of tags) {
        const key = tagKey(tag);
        if (!key) continue;
        if (games.has(key) || genres.has(key)) {
          score += GAME_TAG_WEIGHT;
          matched.add(tag);
        }
        if (channels.has(key)) {
          score += CHANNEL_TAG_WEIGHT;
          matched.add(tag);
        }
      }

      if (following.has(authorId(post))) score += FOLLOWED_AUTHOR_BOOST;

      const likes = Array.isArray(post.likes) ? post.likes.length : Number(post.likeCount) || 0;
      const comments = Number(post.commentCount) || 0;
      score += Math.min(MAX_ENGAGEMENT_BONUS, likes * 2 + comments * 3);

      const created = post.createdAt ? new Date(post.createdAt).getTime() : now;
      const ageHours = Number.isFinite(created) ? Math.max(0, (now - created) / 3_600_000) : 0;
      score -= ageHours * AGE_PENALTY_PER_HOUR;

      return {
        ...post,
        rankScore: Math.round(score * 100) / 100,
        matchedTags: [...matched]
      };
    })
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });
}

module.exports = {
  rankPostsForUser,
  MAX_ENGAGEMENT_BONUS,
  GAME_TAG_WEIGHT,
  CHANNEL_TAG_WEIGHT,
  FOLLOWED_AUTHOR_BOOST,
  tagKey
};
