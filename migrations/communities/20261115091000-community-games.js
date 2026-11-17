/**
 * Communities domain: optional game tags for discovery.
 *
 * Existing communities start with an empty list; Discover falls back to their
 * name and description until an owner adds tags in Server Settings.
 */
module.exports = {
  async up(db) {
    await db.collection('communities').updateMany(
      { games: { $exists: false } },
      { $set: { games: [] } }
    );
    await db.collection('communities').createIndex(
      { games: 1 },
      { background: true, name: 'community_games' }
    );
  },

  async down(db) {
    await db.collection('communities').dropIndex('community_games').catch(() => {});
    await db.collection('communities').updateMany({}, { $unset: { games: '' } });
  }
};
