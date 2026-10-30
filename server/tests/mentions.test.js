/**
 * Mention parsing.
 *
 * The parser decides which usernames are even considered; the socket then keeps
 * only real members. These tests pin the two properties that matter: tokens are
 * de-duplicated case-insensitively, and an email address never looks like a
 * mention.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MENTIONS_PER_MESSAGE,
  extractMentionNames,
  replyPreview,
  mentionsEveryone
} = require('../utils/mentions');

test('extracts de-duplicated names, preserving first casing', () => {
  assert.deepEqual(
    extractMentionNames('gg @alice and @Bob — @alice again'),
    ['alice', 'Bob']
  );
});

test('ignores email addresses and bare @', () => {
  assert.deepEqual(extractMentionNames('mail john@example.com please'), []);
  assert.deepEqual(extractMentionNames('mail @ '), []);
  assert.deepEqual(extractMentionNames('@@@'), []);
  assert.deepEqual(extractMentionNames('hey@alice'), []);
});

test('requires 3-20 word characters', () => {
  assert.deepEqual(extractMentionNames('@ab'), []);
  assert.deepEqual(extractMentionNames(`@${'a'.repeat(20)}`), ['a'.repeat(20)]);
  assert.deepEqual(extractMentionNames(`@${'a'.repeat(21)}`), []);
  assert.deepEqual(extractMentionNames('@has-dash'), ['has']);
});

test('non-strings are safe', () => {
  assert.deepEqual(extractMentionNames(undefined), []);
  assert.deepEqual(extractMentionNames(null), []);
  assert.deepEqual(extractMentionNames(123), []);
});

test('@everyone is detected anywhere as a word', () => {
  assert.equal(mentionsEveryone('@everyone raid time'), true);
  assert.equal(mentionsEveryone('hey @everyone!'), true);
  assert.equal(mentionsEveryone('@everyoneS'), false);
  assert.equal(mentionsEveryone('no ping here'), false);
  assert.equal(mentionsEveryone(undefined), false);
});

test('reply preview is a single sanitised line', () => {
  assert.equal(replyPreview('hello\n\nworld'), 'hello world');
  assert.equal(replyPreview('  spaced  '), 'spaced');
  assert.equal(replyPreview(''), null);
  assert.equal(replyPreview(null), null);
  assert.equal(replyPreview('x'.repeat(300)).length, 120);
});

test('the mention cap is small enough to prevent mention spam', () => {
  assert.ok(MAX_MENTIONS_PER_MESSAGE > 0 && MAX_MENTIONS_PER_MESSAGE <= 5);
});
