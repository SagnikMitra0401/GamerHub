/**
 * Attachment byte validation.
 *
 * `file.mimetype` is only a client claim, so the validator sniffs the buffer.
 * These tests build the smallest possible headers for each allowed format and
 * the shapes an attacker would actually try: an SVG, a PHP payload behind a PNG
 * header, and an oversized file.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectImageMime,
  validateImageUpload,
  MAX_ATTACHMENT_BYTES
} = require('../utils/fileValidator');

const pad = (header, extra = 8) => Buffer.concat([header, Buffer.alloc(extra, 0)]);

const PNG = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const JPEG = pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
const GIF = pad(Buffer.from('GIF89a', 'ascii'));
const WEBP = (() => {
  const buffer = Buffer.alloc(20);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(12, 4);
  buffer.write('WEBP', 8, 'ascii');
  return buffer;
})();

test('detects each allowed format from its magic bytes', () => {
  assert.equal(detectImageMime(PNG), 'image/png');
  assert.equal(detectImageMime(JPEG), 'image/jpeg');
  assert.equal(detectImageMime(GIF), 'image/gif');
  assert.equal(detectImageMime(WEBP), 'image/webp');
});

test('unknown bytes are not images', () => {
  assert.equal(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(detectImageMime(Buffer.from('<?php system($_GET["c"]); ?>')), null);
  assert.equal(detectImageMime(Buffer.from('RIFF....WAVE')), null);
  assert.equal(detectImageMime(Buffer.alloc(4)), null);
  assert.equal(detectImageMime(null), null);
});

test('a claimed type that disagrees with the bytes is rejected', () => {
  const result = validateImageUpload({ buffer: PNG, claimedMime: 'image/jpeg' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /do not match/i);
});

test('the detected type wins when the client sends no type', () => {
  const result = validateImageUpload({ buffer: WEBP });
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'image/webp');
});

test('svg and polyglot payloads are rejected', () => {
  assert.equal(validateImageUpload({ buffer: Buffer.from('<svg/>'), claimedMime: 'image/svg+xml' }).ok, false);

  // PHP behind a real PNG header: the header passes, but the declared mime was
  // never in the allowlist, so the route's fileFilter would already refuse it.
  const polyglot = Buffer.concat([PNG, Buffer.from('<?php echo 1; ?>')]);
  assert.equal(validateImageUpload({ buffer: polyglot, claimedMime: 'image/jpeg' }).ok, false);
  assert.equal(validateImageUpload({ buffer: polyglot, claimedMime: 'image/png' }).ok, true);
});

test('empty and oversized files are rejected', () => {
  assert.equal(validateImageUpload({ buffer: Buffer.alloc(0), claimedMime: 'image/png' }).ok, false);

  const huge = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
  const result = validateImageUpload({ buffer: huge, claimedMime: 'image/png' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /8 MB/);
});
