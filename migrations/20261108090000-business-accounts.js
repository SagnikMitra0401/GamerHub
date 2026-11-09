'use strict';

/**
 * Phase C: disclose business accounts without changing the Phase A defaults.
 * The business policy row starts at `request`; an account can then narrow it.
 */
module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { 'dmSettings.policy.business': { $exists: false } },
      { $set: { 'dmSettings.policy.business': 'request' } }
    );

    await db.collection('conversations').updateMany(
      { businessThread: { $exists: false } },
      {
        $set: {
          businessThread: false,
          requestIntent: null,
          requestCompany: '',
          requestWebsite: '',
          requestBudgetBand: null,
          requestTimeline: ''
        }
      }
    );

    await db.collection('businessprofiles').createIndex({ userId: 1 }, { unique: true });
    await db.collection('businessprofiles').createIndex({ verificationStatus: 1, createdAt: -1 });
    await db.collection('businessverificationaudits').createIndex(
      { businessProfileId: 1, createdAt: -1 }
    );
  },

  async down(db) {
    await db.collection('users').updateMany(
      {},
      { $unset: { 'dmSettings.policy.business': '' } }
    );
    await db.collection('conversations').updateMany(
      {},
      {
        $unset: {
          businessThread: '',
          requestIntent: '',
          requestCompany: '',
          requestWebsite: '',
          requestBudgetBand: '',
          requestTimeline: ''
        }
      }
    );
    await db.collection('businessprofiles').dropIndex({ userId: 1 });
    await db.collection('businessprofiles').dropIndex({ verificationStatus: 1, createdAt: -1 });
    await db.collection('businessverificationaudits').dropIndex({
      businessProfileId: 1,
      createdAt: -1
    });
  }
};
