'use strict';

/**
 * Give pre-feature accounts an explicit notification settings document.
 *
 * The schema and notifyUser already treat a missing field as enabled, so this
 * is not required for correctness. It keeps the account payload and data export
 * explicit and makes future migrations able to read the field directly.
 */
module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { notificationSettings: { $exists: false } },
      {
        $set: {
          notificationSettings: {
            comments: true,
            follows: true,
            likes: true,
            lfg: true,
            bot: true
          }
        }
      }
    );
  },

  async down(db) {
    await db.collection('users').updateMany({}, { $unset: { notificationSettings: '' } });
  }
};
