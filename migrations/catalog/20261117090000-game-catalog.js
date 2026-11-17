/**
 * Catalog domain: the canonical Game collection.
 *
 * Index-only plus collection creation. No provider call and no backfill here:
 * catalog rows are reference data, synced by `npm run games:sync`, never by a
 * migration. That keeps a deploy independent of a third-party API.
 */
const INDEXES = [
  { keys: { slug: 1 }, options: { unique: true, name: 'game_slug_unique' } },
  { keys: { key: 1 }, options: { unique: true, name: 'game_key_unique' } },
  {
    keys: { title: 'text', aliases: 'text', summary: 'text' },
    options: {
      name: 'game_text_search',
      weights: { title: 10, aliases: 6, summary: 1 }
    }
  },
  { keys: { genres: 1, 'stats.favoriteCount': -1 }, options: { name: 'game_genre_popularity' } },
  { keys: { status: 1, 'stats.favoriteCount': -1 }, options: { name: 'game_status_popularity' } },
  { keys: { releaseYear: -1 }, options: { name: 'game_release_year' } },
  { keys: { aliasKeys: 1 }, options: { name: 'game_alias_keys' } }
];

module.exports = {
  async up(db) {
    const existing = await db.listCollections({ name: 'games' }).toArray();
    if (!existing.length) await db.createCollection('games');

    for (const index of INDEXES) {
      await db.collection('games').createIndex(index.keys, { background: true, ...index.options })
        .catch((err) => {
          // Re-running a partially applied migration must be idempotent.
          if (err?.code !== 85 && err?.code !== 86) throw err;
        });
    }
  },

  async down(db) {
    for (const index of INDEXES) {
      await db.collection('games').dropIndex(index.options.name).catch(() => {});
    }
  }
};
