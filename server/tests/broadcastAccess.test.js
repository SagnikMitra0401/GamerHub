const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canPublish,
  canReadChannel,
  slugifyBroadcastName,
  uniqueSlug,
} = require('../utils/broadcastAccess');

const owner = { _id: 'o1', role: 'user' };
const reader = { _id: 'r2', role: 'user' };
const admin = { _id: 'x9', role: 'admin' };

const channel = (overrides = {}) => ({
  _id: 'c1',
  ownerId: owner,
  isPublic: true,
  ...overrides,
});

test('only the owner or platform staff can publish', () => {
  assert.equal(canPublish(channel(), owner), true);
  assert.equal(canPublish(channel(), admin), true);
  assert.equal(canPublish(channel(), reader), false);
  assert.equal(canPublish(channel(), null), false);
  assert.equal(canPublish(null, owner), false);
});

test('public channels are readable without a subscription', () => {
  assert.equal(canReadChannel({ channel: channel(), user: null, subscription: null }), true);
  assert.equal(canReadChannel({ channel: channel(), user: reader, subscription: null }), true);
});

test('private channels need a subscription, ownership or staff', () => {
  const privateChannel = channel({ isPublic: false });

  assert.equal(canReadChannel({ channel: privateChannel, user: null, subscription: null }), false);
  assert.equal(
    canReadChannel({ channel: privateChannel, user: reader, subscription: null }),
    false,
  );
  assert.equal(
    canReadChannel({ channel: privateChannel, user: reader, subscription: { muted: false } }),
    true,
  );
  assert.equal(canReadChannel({ channel: privateChannel, user: owner, subscription: null }), true);
  assert.equal(canReadChannel({ channel: privateChannel, user: admin, subscription: null }), true);
});

test('slugs are lowercase, ascii and bounded', () => {
  assert.equal(slugifyBroadcastName('Squad Updates!'), 'squad-updates');
  assert.equal(slugifyBroadcastName('  --Patch Notes--  '), 'patch-notes');
  assert.equal(slugifyBroadcastName('Pokémon GO'), 'pokemon-go');
  assert.equal(slugifyBroadcastName(''), 'channel');
  assert.equal(slugifyBroadcastName('x'.repeat(120)).length <= 60, true);
});

test('uniqueSlug appends a suffix instead of colliding', () => {
  assert.equal(uniqueSlug('updates', []), 'updates');
  assert.equal(uniqueSlug('updates', ['updates']), 'updates-2');
  assert.equal(uniqueSlug('updates', ['updates', 'updates-2']), 'updates-3');
});
