/**
 * Auth domain: one live verification/reset token per purpose.
 *
 * The index is partial so consumed tokens remain in the collection until the
 * TTL removes them without blocking the next token.
 */
module.exports = {
  async up(db) {
    await db.collection('accounttokens').createIndex(
      { userId: 1, purpose: 1 },
      {
        unique: true,
        partialFilterExpression: { usedAt: null },
        background: true,
        name: 'account_token_live'
      }
    );
  },

  async down(db) {
    await db.collection('accounttokens').dropIndex('account_token_live').catch(() => {});
  }
};
