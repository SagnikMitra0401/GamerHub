/**
 * Phase A direct-message consent core.
 *
 * 1. Give every existing account the new dmSettings matrix.
 * 2. Carry the intent of the old (previously unenforced) allowDirectMessages
 *    switch into the matrix, once.
 * 3. Create the indexes the inbox, request quota and report queue rely on.
 *
 * `mutual_follows` was the old default and was never enforced, so it maps to
 * the new safe default (mutuals inbox, everyone else request) rather than
 * freezing every creator out of requests. `none` and `anyone` are explicit
 * choices and are preserved.
 */
const DEFAULTS = {
  mutual: 'inbox',
  follower: 'request',
  following: 'request',
  community: 'request',
  squad: 'request',
  stranger: 'request'
};

const ALL_REQUEST = {
  mutual: 'request',
  follower: 'request',
  following: 'request',
  community: 'request',
  squad: 'request',
  stranger: 'request'
};

const ALL_NONE = {
  mutual: 'none',
  follower: 'none',
  following: 'none',
  community: 'none',
  squad: 'none',
  stranger: 'none'
};

const settings = (policy) => ({
  policy,
  digest: 'daily',
  readReceipts: false,
  hiddenWords: []
});

module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { dmSettings: { $exists: false } },
      [
        {
          $set: {
            dmSettings: {
              $cond: [
                { $eq: ['$privacySettings.allowDirectMessages', 'none'] },
                settings(ALL_NONE),
                {
                  $cond: [
                    { $eq: ['$privacySettings.allowDirectMessages', 'anyone'] },
                    settings(ALL_REQUEST),
                    settings(DEFAULTS)
                  ]
                }
              ]
            }
          }
        }
      ]
    );

    await db.collection('conversations').createIndex({ pairKey: 1 }, { unique: true });
    await db.collection('conversations').createIndex({ participantIds: 1, state: 1, lastMessageAt: -1 });
    await db.collection('conversations').createIndex({ recipientId: 1, state: 1, createdAt: -1 });
    await db.collection('conversations').createIndex({ state: 1, requestExpiresAt: 1 });
    await db.collection('conversations').createIndex({ initiatorId: 1, state: 1, createdAt: -1 });
    await db.collection('conversations').createIndex({ initiatorId: 1, lastRequestAt: -1 });

    await db.collection('directmessages').createIndex({ conversationId: 1, createdAt: -1 });
    await db.collection('directmessages').createIndex({ authorId: 1, createdAt: -1 });

    await db.collection('dmreports').createIndex(
      { reporterId: 1, conversationId: 1 },
      { unique: true }
    );
    await db.collection('dmreports').createIndex({ status: 1, createdAt: -1 });
  },

  async down(db) {
    const drops = [
      ['conversations', 'pairKey_1'],
      ['conversations', 'participantIds_1_state_1_lastMessageAt_-1'],
      ['conversations', 'recipientId_1_state_1_createdAt_-1'],
      ['conversations', 'state_1_requestExpiresAt_1'],
      ['conversations', 'initiatorId_1_state_1_createdAt_-1'],
      ['conversations', 'initiatorId_1_lastRequestAt_-1'],
      ['directmessages', 'conversationId_1_createdAt_-1'],
      ['directmessages', 'authorId_1_createdAt_-1'],
      ['dmreports', 'reporterId_1_conversationId_1'],
      ['dmreports', 'status_1_createdAt_-1']
    ];

    for (const [collection, index] of drops) {
      try {
        await db.collection(collection).dropIndex(index);
      } catch (err) {
        // An index may not exist if the migration is rolled back on a partial
        // environment; that is not a reason to keep the old data model.
        if (err.codeName !== 'IndexNotFound') throw err;
      }
    }

    await db.collection('users').updateMany({}, { $unset: { dmSettings: '' } });
  }
};
