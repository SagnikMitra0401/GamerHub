/**
 * Reaction allowlist + serialisation.
 *
 * These are pure functions, so no database is needed. What matters is that a
 * client cannot invent a reaction (the allowlist is the only source) and that a
 * serialised message never leaks reactor user ids.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  REACTION_CODES,
  MAX_REACTIONS_PER_MESSAGE,
  normalizeReaction,
  serializeReactions
} = require('../utils/reactions');

test('the catalogue is a frozen short allowlist', () => {
  assert.ok(REACTION_CODES.length >= 5 && REACTION_CODES.length <= 12);
  assert.ok(Object.isFrozen(REACTION_CODES));
  assert.ok(REACTION_CODES.every((code) => /^[a-z]+$/.test(code)));
  assert.equal(MAX_REACTIONS_PER_MESSAGE, REACTION_CODES.length);
});

test('known codes normalise, unknown values are rejected', () => {
  assert.equal(normalizeReaction('fire'), 'fire');
  assert.equal(normalizeReaction('  FIRE '), 'fire');
  assert.equal(normalizeReaction('💩'), null);
  assert.equal(normalizeReaction('<script>'), null);
  assert.equal(normalizeReaction(''), null);
  assert.equal(normalizeReaction(null), null);
  assert.equal(normalizeReaction(42), null);

  // No accidental prefix matching.
  assert.equal(normalizeReaction('fire123'), null);
});

test('serialisation exposes counts, never user ids', () => {
  const reactions = [
    { emoji: 'fire', users: ['a', 'b'] },
    { emoji: 'gg', users: ['c'] }
  ];

  const summary = serializeReactions(reactions, 'b');
  assert.deepEqual(summary, [
    { emoji: 'fire', count: 2, mine: true },
    { emoji: 'gg', count: 1, mine: false }
  ]);

  // The serialised form carries no ids at all.
  assert.equal(JSON.stringify(summary).includes('"a"'), false);
});

test('empty slots are dropped and missing input is safe', () => {
  const summary = serializeReactions([
    { emoji: 'fire', users: [] },
    { emoji: 'gg', users: ['a'] }
  ]);
  assert.deepEqual(summary, [{ emoji: 'gg', count: 1, mine: false }]);

  assert.deepEqual(serializeReactions(), []);
  assert.deepEqual(serializeReactions(null, 'a'), []);
});

test('populated user documents are still matched by id', () => {
  const summary = serializeReactions(
    [{ emoji: 'heart', users: [{ _id: 'u1', username: 'alice' }] }],
    'u1'
  );
  assert.equal(summary[0].mine, true);
  assert.equal(summary[0].count, 1);
});
