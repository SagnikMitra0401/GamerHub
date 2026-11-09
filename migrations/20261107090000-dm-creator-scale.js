/**
 * Phase B creator-scale messaging.
 *
 * Existing accounts already work through dmPolicy's defaults, but a migration
 * makes the new fields explicit and creates the indexes the Filtered lane,
 * campaign detector and moderation queue rely on.
 */
module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { 'dmSettings.availability': { $exists: false } },
      { $set: { 'dmSettings.availability': 'open', 'dmSettings.awayMessage': '' } }
    );
    await db.collection('users').updateMany(
      { 'dmSettings.quickReplies': { $exists: false } },
      { $set: { 'dmSettings.quickReplies': [] } }
    );

    await db.collection('conversations').createIndex(
      { recipientId: 1, state: 1, filteredAt: 1, createdAt: -1 }
    );
    await db.collection('conversations').createIndex(
      { initiatorId: 1, requestFingerprint: 1, lastRequestAt: -1 }
    );

    await db.collection('dmsenderreputations').createIndex({ userId: 1 }, { unique: true });
    await db.collection('dmsenderreputations').createIndex({ tier: 1, updatedAt: -1 });

    await db.collection('dmmoderationaudits').createIndex({ reportId: 1, createdAt: -1 });
  },

  async down(db) {
    const drops = [
      ['conversations', 'recipientId_1_state_1_filteredAt_1_createdAt_-1'],
      ['conversations', 'initiatorId_1_requestFingerprint_1_lastRequestAt_-1'],
      ['dmsenderreputations', 'userId_1'],
      ['dmsenderreputations', 'tier_1_updatedAt_-1'],
      ['dmmoderationaudits', 'reportId_1_createdAt_-1']
    ];

    for (const [collection, index] of drops) {
      try {
        await db.collection(collection).dropIndex(index);
      } catch (err) {
        if (err.codeName !== 'IndexNotFound') throw err;
      }
    }

    await db.collection('users').updateMany({}, {
      $unset: {
        'dmSettings.availability': '',
        'dmSettings.awayMessage': '',
        'dmSettings.quickReplies': ''
      }
    });
  }
};
