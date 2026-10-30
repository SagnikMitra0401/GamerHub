/**
 * Identity domain: account state, sign-in identities and personal blocks.
 *
 * Backfills the governance fields so the new indexes are dense and the account
 * endpoint never has to treat "missing" as a fifth state.
 */
module.exports = {
  async up(db) {
    const users = db.collection('users');

    await users.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'active', sessionVersion: 0, blockedUsers: [] } }
    );
    await users.updateMany(
      { profileType: { $exists: false } },
      { $set: { profileType: 'personal' } }
    );
    await users.updateMany(
      { privacySettings: { $exists: false } },
      {
        $set: {
          privacySettings: {
            allowSquadInvites: 'anyone',
            allowServerInvites: 'anyone',
            allowDirectMessages: 'mutual_follows',
            discoverableInSearch: true,
            showActivityStatus: true
          }
        }
      }
    );

    await users.createIndex({ status: 1 }, { background: true, name: 'user_status' });
    await users.createIndex(
      { 'authIdentities.provider': 1, 'authIdentities.providerSubject': 1 },
      { background: true, name: 'user_auth_identity' }
    );
    await users.createIndex({ blockedUsers: 1 }, { background: true, name: 'user_blocked' });
  },

  async down(db) {
    const users = db.collection('users');
    for (const name of ['user_status', 'user_auth_identity', 'user_blocked']) {
      await users.dropIndex(name).catch(() => {});
    }
  }
};
