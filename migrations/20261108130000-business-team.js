'use strict';

/**
 * Phase C shared inbox: one membership row per owner/member pair. The unique
 * index is the race arbiter for duplicate invitations; the member/status index
 * powers the invitee's workspace list.
 */
module.exports = {
  async up(db) {
    await db.collection('businessteammembers').createIndex(
      { businessOwnerId: 1, memberId: 1 },
      { unique: true }
    );
    await db.collection('businessteammembers').createIndex(
      { memberId: 1, status: 1, updatedAt: -1 }
    );
  },

  async down(db) {
    await db.collection('businessteammembers').dropIndex({ businessOwnerId: 1, memberId: 1 });
    await db.collection('businessteammembers').dropIndex({ memberId: 1, status: 1, updatedAt: -1 });
  }
};
