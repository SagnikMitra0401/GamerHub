const test = require('node:test');
const assert = require('node:assert/strict');

const { lintSource, DOMAINS } = require('../../scripts/migration-lint');

const VALID = `
module.exports = {
  async up(db) {
    await db.collection('posts').createIndex({ createdAt: -1 }, { name: 'posts_created' });
  },
  async down(db) {
    await db.collection('posts').dropIndex('posts_created').catch(() => {});
  }
};
`;

test('a well-formed migration passes', () => {
  const result = lintSource(VALID, { file: '20261117090000-add-index.js', domain: 'feed' });
  assert.deepEqual(result.errors, []);
});

test('a missing down() is an error', () => {
  const result = lintSource(
    `module.exports = { async up(db) { await db.collection('posts').updateMany({}, { $set: { x: 1 } }); } };`,
    { file: '20261117090000-add-field.js', domain: 'feed' },
  );
  assert.equal(
    result.errors.some((line) => /down/.test(line)),
    true,
  );
});

test('an unfiltered deleteMany is rejected', () => {
  const result = lintSource(
    `module.exports = { async up(db) { await db.collection('posts').deleteMany({}); }, async down() {} };`,
    { file: '20261117090000-clear.js', domain: 'feed' },
  );
  assert.equal(
    result.errors.some((line) => /deleteMany/.test(line)),
    true,
  );
});

test('filenames must carry a timestamp prefix', () => {
  const result = lintSource(VALID, { file: 'add-index.js', domain: 'feed' });
  assert.equal(
    result.errors.some((line) => /filename/.test(line)),
    true,
  );
});

test('catalog is a known migration domain', () => {
  assert.ok(DOMAINS.includes('catalog'));
});
