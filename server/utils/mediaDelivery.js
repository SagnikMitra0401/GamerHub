/**
 * Delivery URLs for stored media.
 *
 * One high-quality original is uploaded; every surface asks for a variant.
 * The transformations below are the single definition of those variants, so a
 * card, a feed image and a full-size view stay consistent. They map 1:1 to
 * Cloudinary named transformations (`gamerhub_card`, …) if an operator creates
 * them; using the explicit string keeps delivery working before that step.
 */
const { cloudinary } = require('../config/cloudinary');

const TRANSFORMS = Object.freeze({
  thumb: { width: 160, height: 160, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
  card: { width: 640, height: 360, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
  feed: { width: 1200, crop: 'limit', fetch_format: 'auto', quality: 'auto' },
  full: { width: 2000, crop: 'limit', fetch_format: 'auto', quality: 'auto' }
});

function deliveryUrl(publicId, variant = 'card', { resourceType = 'image' } = {}) {
  if (!publicId) return null;
  const transformation = TRANSFORMS[variant] || TRANSFORMS.card;
  return cloudinary.url(publicId, {
    secure: true,
    resource_type: resourceType,
    transformation
  });
}

function deliverySet(publicId, { resourceType = 'image' } = {}) {
  if (!publicId) return { thumb: null, card: null, feed: null, full: null };
  return {
    thumb: deliveryUrl(publicId, 'thumb', { resourceType }),
    card: deliveryUrl(publicId, 'card', { resourceType }),
    feed: deliveryUrl(publicId, 'feed', { resourceType }),
    full: deliveryUrl(publicId, 'full', { resourceType })
  };
}

/** MIME-safe extension for the stored format; public_id must not carry one. */
function extensionFor(mimeType = '', format = '') {
  if (format) return String(format).toLowerCase();
  const mime = String(mimeType).toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return 'jpg';
}

module.exports = { TRANSFORMS, deliveryUrl, deliverySet, extensionFor };
