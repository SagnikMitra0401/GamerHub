/**
 * Denormalise the like count onto each post.
 *
 * The count is recomputed from the likes array here (not just copied), so posts
 * that predate the field and posts whose counter drifted both end up exact.
 * Every later write maintains it atomically — see utils/likeBuffer.likePipeline,
 * which sets `likeCount` to `$size` of the resulting array in the same update.
 *
 * The backfill is an aggregation-pipeline update: one server-side pass, no
 * document round-trips through Node.
 */
module.exports = {
  async up(db) {
    const posts = db.collection('posts');

    await posts.updateMany(
      {},
      [{ $set: { likeCount: { $size: { $ifNull: ['$likes', []] } } } }]
    );

    await posts.createIndex(
      { likeCount: -1, createdAt: -1 },
      { name: 'posts_likeCount_hot' }
    );
  },

  async down(db) {
    const posts = db.collection('posts');
    await posts.updateMany({}, { $unset: { likeCount: '' } });
    try {
      await posts.dropIndex('posts_likeCount_hot');
    } catch (err) {
      if (err.code !== 27 && !/index not found/i.test(err.message)) throw err;
    }
  }
};
