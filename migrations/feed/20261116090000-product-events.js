'use strict';

const ProductEvent = require('../../server/models/ProductEvent');

const {
  FIRST_EVENT_NAMES,
  PRODUCT_EVENT_TTL_SECONDS
} = ProductEvent;

const INDEXES = {
  nameCreated: 'product_events_name_created',
  userCreated: 'product_events_user_created',
  firstUnique: 'product_events_first_unique',
  ttl: 'product_events_ttl'
};

/**
 * Product events are a first-party, bounded analytics collection. The indexes
 * make the admin funnel cheap, guarantee one "first_*" milestone per account
 * even under a race, and expire raw events after 180 days.
 */
module.exports = {
  async up(db) {
    const events = db.collection('productevents');
    await Promise.all([
      events.createIndex({ name: 1, createdAt: -1 }, { name: INDEXES.nameCreated }),
      events.createIndex({ userId: 1, createdAt: -1 }, { name: INDEXES.userCreated }),
      events.createIndex(
        { userId: 1, name: 1 },
        {
          name: INDEXES.firstUnique,
          unique: true,
          partialFilterExpression: { name: { $in: FIRST_EVENT_NAMES } }
        }
      ),
      events.createIndex(
        { createdAt: 1 },
        { name: INDEXES.ttl, expireAfterSeconds: PRODUCT_EVENT_TTL_SECONDS }
      )
    ]);

    return { indexes: Object.values(INDEXES) };
  },

  async down(db) {
    const events = db.collection('productevents');
    for (const name of Object.values(INDEXES)) {
      try {
        await events.dropIndex(name);
      } catch (err) {
        if (err.code !== 27 && err.codeName !== 'IndexNotFound') throw err;
      }
    }
  }
};
