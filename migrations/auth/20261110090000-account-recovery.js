/**
 * Auth domain: email verification and password reset.
 *
 * Accounts that predate this flow are grandfathered as verified so nobody is
 * locked out of password changes by a feature they never had. New local
 * registrations set `emailVerifiedAt: null` explicitly and must confirm.
 */
module.exports = {
  async up(db) {
    const users = db.collection('users');
    const tokens = db.collection('accounttokens');

    await users.updateMany(
      { emailVerifiedAt: { $exists: false } },
      { $set: { emailVerifiedAt: new Date() } }
    );

    await users.createIndex(
      { emailVerifiedAt: 1 },
      { background: true, name: 'user_email_verified' }
    );

    await tokens.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true, name: 'account_token_ttl' }
    );
    await tokens.createIndex(
      { tokenHash: 1 },
      { unique: true, background: true, name: 'tokenHash_1' }
    );
    await tokens.createIndex(
      { userId: 1, purpose: 1, usedAt: 1 },
      { background: true, name: 'userId_1_purpose_1_usedAt_1' }
    );
  },

  async down(db) {
    // The verification flag is intentionally left in place: rolling back the
    // code should not silently unverify every account.
    const users = db.collection('users');
    const tokens = db.collection('accounttokens');

    for (const name of ['user_email_verified']) {
      await users.dropIndex(name).catch(() => {});
    }
    for (const name of ['account_token_ttl', 'tokenHash_1', 'userId_1_purpose_1_usedAt_1']) {
      await tokens.dropIndex(name).catch(() => {});
    }
  }
};
