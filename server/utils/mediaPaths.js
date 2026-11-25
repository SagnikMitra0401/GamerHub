/**
 * Media location scheme.
 *
 *   gamerhub/{env}/{surface}/{yyyy}/{mm}/u_{owner}/{id}
 *
 * Environment first so a preview upload can never be mistaken for production
 * media, surface next so a cleanup never crosses domains, then a month bucket
 * (billing and lifecycle rules are per month) and finally the owner. The id is
 * time-sortable, so listing a folder is chronological without extra metadata.
 *
 * Existing assets are deliberately NOT renamed: their public_ids are live in
 * delivered URLs. Only new uploads use this scheme.
 */
const crypto = require('crypto');

const SURFACES = Object.freeze(['post', 'chat', 'avatar', 'game', 'story', 'broadcast', 'other']);

function environmentName() {
  const explicit = String(process.env.MEDIA_ENV || '').trim();
  if (explicit) return explicit.slice(0, 16);
  if (process.env.NODE_ENV === 'production') return 'prod';
  if (process.env.NODE_ENV === 'test') return 'test';
  return 'dev';
}

function ownerSegment(ownerId) {
  if (!ownerId) return 'shared';
  return `u_${
    String(ownerId)
      .replace(/[^a-z0-9]/gi, '')
      .slice(-16) || 'unknown'
  }`;
}

function mediaFolder({ surface = 'other', ownerId = null, now = new Date() } = {}) {
  const safeSurface = SURFACES.includes(surface) ? surface : 'other';
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `gamerhub/${environmentName()}/${safeSurface}/${year}/${month}/${ownerSegment(ownerId)}`;
}

/**
 * A collision-resistant, roughly sortable id. Cloudinary public_ids allow
 * letters, digits, `_`, `-` and `/`, so no other characters are used.
 */
function mediaId(now = Date.now()) {
  const time = Number(now).toString(36);
  const random = crypto.randomBytes(7).toString('hex');
  return `${time}${random}`;
}

function mediaPublicId({ surface = 'other', ownerId = null, now = new Date(), id = null } = {}) {
  return `${mediaFolder({ surface, ownerId, now })}/${id || mediaId(now.getTime())}`;
}

module.exports = {
  SURFACES,
  environmentName,
  mediaFolder,
  mediaPublicId,
};
