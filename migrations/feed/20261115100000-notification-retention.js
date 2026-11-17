'use strict';

const {
  NOTIFICATION_TTL_MS,
  isImportantNotification
} = require('../../server/utils/notificationRetention');

const INDEX_NAME = 'notification_retention_ttl';

/**
 * Stamp every pre-policy notification with a retention date, then install the
 * TTL index. Ordinary pings older than 15 days become immediately eligible for
 * deletion; invitations, follow requests, account/security notices and other
 * durable system notices get `null` and are never touched by the index.
 */
module.exports = {
  async up(db) {
    const notifications = db.collection('notifications');
    const cursor = notifications.find(
      { retentionAt: { $exists: false } },
      { projection: { _id: 1, metadata: 1, createdAt: 1 } }
    );

    let operations = [];
    let scanned = 0;

    const flush = async () => {
      if (!operations.length) return;
      await notifications.bulkWrite(operations, { ordered: false });
      operations = [];
    };

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const important = isImportantNotification(doc);
      const createdAt = doc.createdAt instanceof Date && !Number.isNaN(doc.createdAt.getTime())
        ? doc.createdAt
        : new Date();
      const retentionAt = important ? null : new Date(createdAt.getTime() + NOTIFICATION_TTL_MS);

      operations.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { retentionAt } }
        }
      });
      scanned += 1;
      if (operations.length >= 500) await flush();
    }
    await flush();

    await notifications.createIndex(
      { retentionAt: 1 },
      { name: INDEX_NAME, expireAfterSeconds: 0 }
    );

    return { scanned };
  },

  async down(db) {
    const notifications = db.collection('notifications');
    try {
      await notifications.dropIndex(INDEX_NAME);
    } catch (err) {
      if (err.code !== 27 && err.codeName !== 'IndexNotFound') throw err;
    }
    await notifications.updateMany({}, { $unset: { retentionAt: '' } });
  }
};
