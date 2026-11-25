const { notifyUser } = require('./notify');
const { idOf } = require('./privacy');

const LIKE_MILESTONES = Object.freeze([1, 5, 10, 25, 50, 100]);
const COMMENT_SNIPPET = 140;

function displayActor(actor) {
  return actor?.username ? `@${actor.username}` : 'A player';
}

function likeMilestoneFor(likeCount) {
  const count = Number(likeCount);
  return LIKE_MILESTONES.includes(count) ? count : null;
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

/** Ping the post author when somebody comments. Never ping the author's own comment. */
async function notifyPostComment({ post, comment, actor }) {
  if (!post || !comment) return null;
  const authorId = idOf(post.userId);
  const actorId = idOf(actor);
  if (!authorId || !actorId || authorId === actorId) return null;

  const snippet = String(comment.text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, COMMENT_SNIPPET);

  return notifyUser({
    userId: authorId,
    actorId,
    type: 'social',
    title: `${displayActor(actor)} commented on your post`,
    message: snippet,
    actionUrl: `/posts/${post._id}`,
    metadata: {
      kind: 'comment',
      postId: String(post._id),
      commentId: String(comment._id),
    },
    dedupeKey: `comment:${comment._id}`,
  });
}

/** Ping a player when somebody starts following them. */
async function notifyFollow({ target, actor }) {
  const targetId = idOf(target);
  const actorId = idOf(actor);
  if (!targetId || !actorId || targetId === actorId) return null;

  return notifyUser({
    userId: targetId,
    actorId,
    type: 'social',
    title: `${displayActor(actor)} followed you`,
    message: 'Open their profile to see what they play.',
    actionUrl: actor?.username ? `/u/${actor.username}` : '/discover',
    metadata: {
      kind: 'follow',
      followerId: actorId,
    },
    dedupeKey: `follow:${targetId}:${actorId}`,
  });
}

/**
 * Ping the author when a post crosses a like milestone. The dedupe key makes
 * re-liking, retries and buffered flushes idempotent; unlike/re-like can never
 * produce a second ping for the same milestone.
 */
async function notifyLikeMilestone({ post, actor = null, likeCount }) {
  if (!post) return null;
  const authorId = idOf(post.userId);
  const milestone = likeMilestoneFor(likeCount);
  const actorId = idOf(actor);
  if (!authorId || !milestone || (actorId && authorId === actorId)) return null;

  return notifyUser({
    userId: authorId,
    actorId: actorId || null,
    type: 'social',
    title: `Your post reached ${plural(milestone, 'like')}`,
    message:
      milestone === 1
        ? 'Your first like is in. Keep the conversation going.'
        : 'People are engaging with what you shared.',
    actionUrl: `/posts/${post._id}`,
    metadata: {
      kind: 'like_milestone',
      postId: String(post._id),
      milestone,
    },
    dedupeKey: `like:${post._id}:${milestone}`,
  });
}

module.exports = {
  LIKE_MILESTONES,
  likeMilestoneFor,
  notifyPostComment,
  notifyFollow,
  notifyLikeMilestone,
};
