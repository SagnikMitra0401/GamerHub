/**
 * Indexes for the queries the app actually runs.
 *
 * Deliberately NOT created here, because Mongoose already declares them and a
 * second copy would only cost write throughput:
 *   - users.username / communities.slug  (unique, from the schemas)
 *   - communities.members.userId
 *   - notifications { userId, createdAt }   (kept for the general list)
 *   - auditlogs { communityId, createdAt }  (declared in the model)
 *   - parties { status, createdAt }         (declared in the model)
 * The original plan also asked for `parties { status, game, createdAt }`, but
 * the field is `gameTitle` and no query filters on it.
 */

const TEXT_INDEX_NAME = 'posts_text_weighted';
const TEXT_KEYS = { title: 'text', content: 'text', tags: 'text' };
const TEXT_WEIGHTS = { title: 10, tags: 5, content: 1 };

async function dropIndexIfPresent(collection, name) {
  try {
    await collection.dropIndex(name);
  } catch (err) {
    // 27 = IndexNotFound. Anything else is a real failure.
    if (err.code !== 27 && !/index not found/i.test(err.message)) throw err;
  }
}

module.exports = {
  async up(db) {
    const posts = db.collection('posts');

    // Profile feed: find({ userId }).sort({ createdAt: -1 })
    await posts.createIndex({ userId: 1, createdAt: -1 }, { name: 'posts_userId_createdAt' });

    // Replace the unweighted text index with the weighted one, so title/tag
    // matches outrank body matches. Mongo allows only one text index per
    // collection, hence the drop first.
    const indexes = await posts.indexes();
    const existingText = indexes.find((index) => index.key && index.key._fts === 'text');
    if (existingText && existingText.name !== TEXT_INDEX_NAME) {
      await dropIndexIfPresent(posts, existingText.name);
    }
    await posts.createIndex(TEXT_KEYS, { name: TEXT_INDEX_NAME, weights: TEXT_WEIGHTS });

    // Unread notification list + badge count for one user.
    await db.collection('notifications').createIndex(
      { userId: 1, read: 1, createdAt: -1 },
      { name: 'notif_userId_read_createdAt' }
    );
  },

  async down(db) {
    const posts = db.collection('posts');

    await dropIndexIfPresent(posts, 'posts_userId_createdAt');
    await dropIndexIfPresent(db.collection('notifications'), 'notif_userId_read_createdAt');

    await dropIndexIfPresent(posts, TEXT_INDEX_NAME);
    await posts.createIndex(TEXT_KEYS, { name: 'title_text_content_text_tags_text' });
  }
};
