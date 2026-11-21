/**
 * Story visibility and grouping.
 *
 * Pure functions so the rules that decide who sees a status can be tested
 * without a database: followers-only stories need a follow relationship,
 * public stories need only a signed-in-or-anonymous reader, and a block in
 * either direction wins over both.
 */

const idOf = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

const toIdSet = (values) => new Set((Array.isArray(values) ? values : []).map(idOf).filter(Boolean));

function canViewStory({ story, viewerId, followingIds = [], blockedIds = [] }) {
  if (!story) return false;

  const authorId = idOf(story.authorId);
  const viewer = idOf(viewerId);
  const blocked = toIdSet(blockedIds);

  if (viewer && blocked.has(authorId)) return false;
  if (viewer && authorId === viewer) return true;
  if (story.visibility === 'public') return true;
  if (!viewer) return false;

  return toIdSet(followingIds).has(authorId);
}

/**
 * Group visible stories by author.
 *
 * Ordering mirrors the rail: your own stories first, then authors with
 * something unseen, then most recent activity.
 *
 * @returns {Array<{author: object, stories: object[], seen: boolean, latestAt: Date}>}
 */
function groupStories({ stories = [], seenIds = [], viewerId = null }) {
  const seen = toIdSet(seenIds);
  const viewer = idOf(viewerId);
  const groups = new Map();

  for (const story of stories) {
    const author = story.authorId;
    const authorId = idOf(author);
    if (!authorId) continue;

    if (!groups.has(authorId)) {
      groups.set(authorId, {
        author: {
          _id: authorId,
          username: author?.username || 'unknown',
          level: author?.level || 1,
          role: author?.role || 'user',
          avatarUrl: author?.avatarUrl || null
        },
        stories: [],
        seen: true,
        latestAt: story.createdAt || new Date(0)
      });
    }

    const group = groups.get(authorId);
    const hasSeen = seen.has(String(story._id));
    group.stories.push({
      _id: String(story._id),
      kind: story.kind,
      text: story.text || '',
      background: story.background || 'aurora',
      mediaUrl: story.mediaUrl || null,
      mediaCardUrl: story.mediaCardUrl || null,
      caption: story.caption || '',
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
      viewCount: story.viewCount || 0,
      seen: hasSeen
    });
    if (!hasSeen) group.seen = false;
    if (story.createdAt > group.latestAt) group.latestAt = story.createdAt;
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      stories: group.stories.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      isOwn: idOf(group.author._id) === viewer
    }))
    .sort((a, b) => {
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      if (a.seen !== b.seen) return a.seen ? 1 : -1;
      return new Date(b.latestAt) - new Date(a.latestAt);
    });
}

module.exports = { canViewStory, groupStories, idOf };
