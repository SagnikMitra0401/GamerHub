/**
 * Indexes for the load-sensitive lookups added in the hardening pass.
 *
 * `blockedUsers` is queried in the opposite direction ("who blocked me") on
 * every search and profile view. Without a multikey index that is a collection
 * scan of the whole user base, which is exactly the query that would collapse
 * under load. The array is small per user, so the index is cheap to maintain.
 *
 * The `status` index already exists from the identity-governance migration
 * (Mongoose declares it); no duplicate is created here.
 */

const BLOCKED_INDEX = 'users_blockedUsers';
const STATUS_INDEX = 'users_status_createdAt';

async function dropIndexIfPresent(collection, name) {
  try {
    await collection.dropIndex(name);
  } catch (err) {
    if (err.code !== 27 && !/index not found/i.test(err.message)) throw err;
  }
}

module.exports = {
  async up(db) {
    const users = db.collection('users');
    await users.createIndex({ blockedUsers: 1 }, { name: BLOCKED_INDEX, sparse: true });
    await users.createIndex({ status: 1, createdAt: -1 }, { name: STATUS_INDEX });
  },

  async down(db) {
    const users = db.collection('users');
    await dropIndexIfPresent(users, BLOCKED_INDEX);
    await dropIndexIfPresent(users, STATUS_INDEX);
  }
};
