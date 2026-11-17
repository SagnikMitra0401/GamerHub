/**
 * Auth domain: game-first onboarding.
 *
 * Existing accounts are grandfathered as completed at their creation time, so
 * only accounts created after this migration are sent to /welcome. New users
 * receive the schema default (`null`) and must finish or skip the flow.
 */
module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { onboardingCompletedAt: { $exists: false } },
      [{ $set: { onboardingCompletedAt: '$createdAt' } }]
    );

    await db.collection('users').createIndex(
      { 'preferences.favoriteGames': 1 },
      { background: true, name: 'user_favorite_games' }
    );
    await db.collection('users').createIndex(
      { 'gamerPassport.activeGames.gameName': 1 },
      { background: true, name: 'user_passport_games' }
    );
  },

  async down(db) {
    await db.collection('users').dropIndex('user_favorite_games').catch(() => {});
    await db.collection('users').dropIndex('user_passport_games').catch(() => {});
    await db.collection('users').updateMany({}, { $unset: { onboardingCompletedAt: '' } });
  }
};
