/**
 * Upload validation for channel attachments.
 *
 * `file.mimetype` is a client claim. We sniff the real image type from the first
 * bytes of the buffer and reject anything whose bytes disagree with the claim —
 * a PHP payload renamed `.png` and uploaded as `image/png` fails here, as does
 * an SVG (scriptable) or a video (out of scope for channel chat).
 */

const ALLOWED_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB, matching the upload route
const MAX_ATTACHMENTS_PER_MESSAGE = 4;

const startsWith = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);

/**
 * Identify an image from its magic bytes.
 * @returns {string|null} the detected mime type, or null when unrecognised
 */
function detectImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // GIF87a / GIF89a
  if (
    buffer.toString('ascii', 0, 6) === 'GIF87a' ||
    buffer.toString('ascii', 0, 6) === 'GIF89a'
  ) {
    return 'image/gif';
  }

  return null;
}

/**
 * Validate a claimed mime type against the real bytes.
 * @returns {{ok: boolean, reason?: string, mimeType?: string}}
 */
function validateImageUpload({ buffer, claimedMime, sizeBytes }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, reason: 'That file is empty.' };
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES || (sizeBytes ?? buffer.length) > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'Images must be 8 MB or smaller.' };
  }

  const detected = detectImageMime(buffer);
  if (!detected) {
    return { ok: false, reason: 'Only JPEG, PNG, WEBP and GIF images are allowed.' };
  }
  if (claimedMime && claimedMime !== detected) {
    return { ok: false, reason: 'The file contents do not match the declared type.' };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(detected)) {
    return { ok: false, reason: 'Only JPEG, PNG, WEBP and GIF images are allowed.' };
  }

  return { ok: true, mimeType: detected };
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  detectImageMime,
  validateImageUpload
};
