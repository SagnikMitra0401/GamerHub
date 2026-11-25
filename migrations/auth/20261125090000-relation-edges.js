/**
 * Auth domain: relationship edges.
 *
 * Follows, bookmarks, blocks and mutes have lived in four ObjectId arrays on the
 * user document, which makes every authenticated request load them and caps a
 * heavy account at the 16 MB document limit. They move to one collection per
 * relationship, each identified by a unique pair.
 *
 * This migration is safe to re-run:
 *   - edges are inserted with `ordered: false` and duplicate pairs are ignored
 *   - counters are recomputed from the edge collections, never incremented
 *
 * Backfilled edges carry the account creation date as `createdAt`, because the
 * arrays never stored when a relationship began. That keeps lists in a stable
 * order; it is not a faithful follow timestamp.
 *
 * The arrays stay in place for one release: rollback is `down`, which drops the
 * edges and unsets the counters while the arrays are still authoritative.
 */
const EDGE_COLLECTIONS = ['follows', 'savedposts', 'userblocks', 'usermutes'];

const INDEXES = {
  follows: [
    [{ follower: 1, following: 1 }, { unique: true, name: 'follow_pair' }],
    [{ following: 1, createdAt: -1 }, { name: 'follow_incoming' }],
    [{ follower: 1, createdAt: -1 }, { name: 'follow_outgoing' }],
  ],
  savedposts: [
    [{ user: 1, post: 1 }, { unique: true, name: 'saved_post_pair' }],
    [{ user: 1, createdAt: -1 }, { name: 'saved_post_recent' }],
    [{ post: 1 }, { name: 'saved_post_post' }],
  ],
  userblocks: [
    [{ blocker: 1, blocked: 1 }, { unique: true, name: 'user_block_pair' }],
    [{ blocked: 1, blocker: 1 }, { name: 'user_block_incoming' }],
  ],
  usermutes: [
    [{ muter: 1, muted: 1 }, { unique: true, name: 'user_mute_pair' }],
    [{ muter: 1, createdAt: -1 }, { name: 'user_mute_recent' }],
  ],
};

/** Every user array and the edge collection it becomes. */
const ARRAY_SOURCES = [
  {
    collection: 'follows',
    array: 'following',
    doc: (userId, entry, createdAt) => ({
      follower: userId,
      following: entry,
      createdAt,
    }),
  },
  {
    collection: 'savedposts',
    array: 'savedPosts',
    doc: (userId, entry, createdAt) => ({ user: userId, post: entry, createdAt }),
  },
  {
    collection: 'userblocks',
    array: 'blockedUsers',
    doc: (userId, entry, createdAt) => ({ blocker: userId, blocked: entry, createdAt }),
  },
  {
    collection: 'usermutes',
    array: 'mutedUsers',
    doc: (userId, entry, createdAt) => ({ muter: userId, muted: entry, createdAt }),
  },
];

const BATCH_SIZE = 1000;

/** A duplicate pair is the expected result of re-running the backfill. */
function duplicateOnly(err) {
  if (err?.code === 11000) return true;
  const writeErrors = err?.writeErrors;
  return Array.isArray(writeErrors) && writeErrors.every((entry) => entry?.code === 11000);
}

async function createIndexes(db) {
  for (const collection of EDGE_COLLECTIONS) {
    for (const [keys, options] of INDEXES[collection]) {
      await db.collection(collection).createIndex(keys, { background: true, ...options });
    }
  }
}

/** Turn each user's four arrays into edge rows, in batches shared by collection. */
async function backfillEdges(db) {
  const users = db
    .collection('users')
    .find({}, { projection: { following: 1, savedPosts: 1, blockedUsers: 1, mutedUsers: 1, createdAt: 1 } });

  /** @type {Record<string, object[]>} */
  const pending = Object.fromEntries(EDGE_COLLECTIONS.map((name) => [name, []]));

  const flush = async (collection) => {
    const docs = pending[collection];
    if (!docs.length) return;
    pending[collection] = [];
    try {
      await db.collection(collection).insertMany(docs, { ordered: false });
    } catch (err) {
      if (!duplicateOnly(err)) throw err;
    }
  };

  for await (const user of users) {
    const createdAt = user.createdAt instanceof Date ? user.createdAt : new Date();
    for (const source of ARRAY_SOURCES) {
      for (const entry of user[source.array] || []) {
        if (!entry) continue;
        pending[source.collection].push(source.doc(user._id, entry, createdAt));
      }
      if (pending[source.collection].length >= BATCH_SIZE) {
        await flush(source.collection);
      }
    }
  }
  for (const collection of EDGE_COLLECTIONS) await flush(collection);
}

/** Count edges per account, for the two sides of each relationship. */
async function edgeCounts(db, collection, field) {
  const rows = await db
    .collection(collection)
    .aggregate([{ $group: { _id: `$${field}`, count: { $sum: 1 } } }])
    .toArray();
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function writeCounters(db) {
  const following = await edgeCounts(db, 'follows', 'follower');
  const followers = await edgeCounts(db, 'follows', 'following');
  const saved = await edgeCounts(db, 'savedposts', 'user');

  const ids = await db.collection('users').distinct('_id');
  const operations = ids.map((id) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $set: {
          followerCount: followers.get(String(id)) || 0,
          followingCount: following.get(String(id)) || 0,
          savedCount: saved.get(String(id)) || 0,
        },
      },
    },
  }));

  for (let index = 0; index < operations.length; index += BATCH_SIZE) {
    await db.collection('users').bulkWrite(operations.slice(index, index + BATCH_SIZE), {
      ordered: false,
    });
  }
}

/** Sum of an array field across every user. */
async function arrayTotal(db, field) {
  const rows = await db
    .collection('users')
    .aggregate([
      { $project: { size: { $size: { $ifNull: [`$${field}`, []] } } } },
      { $group: { _id: null, total: { $sum: '$size' } } },
    ])
    .toArray();
  return rows[0]?.total || 0;
}

/**
 * Fail the migration when a relationship did not land.
 *
 * Two checks: every array entry has a row (global totals), and every counter
 * equals the number of rows for that account. A partial backfill fails here
 * instead of surfacing as a wrong follower count in production.
 */
async function verify(db) {
  const report = [];
  for (const source of ARRAY_SOURCES) {
    const [arrays, edges] = await Promise.all([
      arrayTotal(db, source.array),
      db.collection(source.collection).countDocuments(),
    ]);
    report.push(`${source.array}=${arrays} ${source.collection}=${edges}`);
    if (arrays !== edges) {
      throw new Error(`Relation edge backfill mismatch: ${source.array} has ${arrays} entries but ${source.collection} has ${edges} rows`);
    }
  }

  const following = await edgeCounts(db, 'follows', 'follower');
  const followers = await edgeCounts(db, 'follows', 'following');
  const saved = await edgeCounts(db, 'savedposts', 'user');

  let counterMismatches = 0;
  const users = db
    .collection('users')
    .find({}, { projection: { followerCount: 1, followingCount: 1, savedCount: 1 } });
  for await (const user of users) {
    const id = String(user._id);
    if (
      user.followerCount !== (followers.get(id) || 0) ||
      user.followingCount !== (following.get(id) || 0) ||
      user.savedCount !== (saved.get(id) || 0)
    ) {
      counterMismatches += 1;
      if (counterMismatches <= 5) {
        console.error(
          `Counter mismatch for ${id}: ${JSON.stringify({
            followerCount: user.followerCount,
            followingCount: user.followingCount,
            savedCount: user.savedCount,
          })}`,
        );
      }
    }
  }
  if (counterMismatches) {
    throw new Error(`${counterMismatches} user(s) have counters that disagree with the edge collections`);
  }

  console.log(`Relation edges verified: ${report.join(', ')}, counters agree`);
}

module.exports = {
  async up(db) {
    await createIndexes(db);
    await backfillEdges(db);
    await writeCounters(db);
    await verify(db);
  },

  async down(db) {
    await db.collection('users').updateMany(
      {},
      { $unset: { followerCount: '', followingCount: '', savedCount: '' } }
    );
    for (const collection of EDGE_COLLECTIONS) {
      await db.dropCollection(collection).catch(() => {});
    }
  },
};
