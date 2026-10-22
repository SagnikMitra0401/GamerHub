const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_POLICY } = require('../config/chatPolicy');
const {
  normalizeMessageText,
  sanitizeLine,
  sanitizeText,
  sanitizeLinkPreview,
  normalizeTags,
  escapeRegex,
  isHttpUrl,
  decodeHtmlEntities
} = require('../utils/sanitize');
const { parsePagination } = require('../utils/pagination');

test('message normalisation strips hostile characters', () => {
  assert.deepEqual(normalizeMessageText('  hello\u0000 world  ', CHAT_POLICY), {
    ok: true,
    text: 'hello world'
  });

  // Bidi override + zero width hidden text
  const spoof = normalizeMessageText('safe\u202Eevil\u200B', CHAT_POLICY);
  assert.equal(spoof.text, 'safeevil');

  // Blank-line floods collapse
  assert.equal(normalizeMessageText('a\n\n\n\n\nb', CHAT_POLICY).text, 'a\n\nb');

  // Newlines are preserved (chat formatting)
  assert.equal(normalizeMessageText('line1\nline2', CHAT_POLICY).text, 'line1\nline2');
});

test('message limits are enforced', () => {
  assert.equal(normalizeMessageText('', CHAT_POLICY).ok, false);
  assert.equal(normalizeMessageText('   ', CHAT_POLICY).ok, false);
  assert.equal(normalizeMessageText(null, CHAT_POLICY).ok, false);
  assert.equal(normalizeMessageText('x'.repeat(1001), CHAT_POLICY).ok, false);
  assert.equal(normalizeMessageText('x'.repeat(1000), CHAT_POLICY).ok, true);

  const manyLines = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
  assert.equal(normalizeMessageText(manyLines, CHAT_POLICY).ok, false);
});

test('line/text sanitizers remove control characters', () => {
  assert.equal(sanitizeLine('  a\u0007b  ', 20), 'ab');
  assert.equal(sanitizeLine('a\nb', 20), 'a b');
  assert.equal(sanitizeLine(123, 20), '');
  assert.equal(sanitizeText('a\u0000b\n\n\n\nc', 50), 'ab\n\nc');
});

test('link previews only accept http(s) URLs', () => {
  assert.equal(sanitizeLinkPreview({ url: 'javascript:alert(1)' }), null);
  assert.equal(sanitizeLinkPreview({ url: 'data:text/html,<script>' }), null);
  assert.equal(sanitizeLinkPreview({ url: 'ftp://example.com/x' }), null);
  assert.equal(sanitizeLinkPreview({ url: '' }), null);
  assert.equal(sanitizeLinkPreview(null), null);

  const clean = sanitizeLinkPreview({
    url: 'https://example.com/page',
    title: '  Hello\u0007  ',
    description: 'desc',
    image: 'javascript:alert(1)',
    siteName: 'Example',
    injected: 'nope'
  });

  assert.equal(clean.url, 'https://example.com/page');
  assert.equal(clean.title, 'Hello');
  assert.equal(clean.image, null); // unsafe image dropped
  assert.equal(clean.siteName, 'Example');
  assert.equal('injected' in clean, false);
});

test('third-party HTML entities are decoded once', () => {
  assert.equal(decodeHtmlEntities('It&#39;s &quot;great&quot; &amp; fun'), 'It\'s "great" & fun');
  assert.equal(decodeHtmlEntities('&#x1F3AE; game'), '🎮 game');
  assert.equal(decodeHtmlEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assert.equal(decodeHtmlEntities('100% &unknown; raw'), '100% &unknown; raw');
  assert.equal(decodeHtmlEntities(null), '');
});

test('isHttpUrl', () => {
  assert.equal(isHttpUrl('https://a.b'), true);
  assert.equal(isHttpUrl('http://a.b'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('not a url'), false);
});

test('tags are normalised, deduped and capped', () => {
  const tags = normalizeTags(['#FPS', ' fps ', 'RPG', '', null, 'x'.repeat(30)]);
  assert.equal(tags[0], 'fps');
  assert.equal(tags[1], 'rpg');
  assert.equal(tags.length, 3);
  assert.equal(tags[2].length, 24);

  const many = normalizeTags(Array.from({ length: 25 }, (_, i) => `tag${i}`));
  assert.equal(many.length, 10);

  assert.deepEqual(normalizeTags('A, b ,, c'), ['a', 'b', 'c']);
});

test('escapeRegex neutralises user input', () => {
  const pattern = new RegExp(escapeRegex('a.b*c'), 'i');
  assert.equal(pattern.test('a.b*c'), true);
  assert.equal(pattern.test('axbx c'), false);
});

test('pagination is NaN-proof', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 15, skip: 0 });
  assert.deepEqual(parsePagination({ page: 'abc', limit: 'abc' }), { page: 1, limit: 15, skip: 0 });
  assert.deepEqual(parsePagination({ page: '-4', limit: '-1' }), { page: 1, limit: 1, skip: 0 });
  assert.deepEqual(parsePagination({ page: '999999', limit: '9999' }), {
    page: 10_000,
    limit: 50,
    skip: 9_999 * 50
  });
});
