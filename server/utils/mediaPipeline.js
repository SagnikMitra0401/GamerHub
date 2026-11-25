/**
 * One upload pipeline for every surface.
 *
 * Bytes are validated first (magic bytes, size), then normalised locally with
 * sharp (EXIF/GPS stripped, dimensions capped), then uploaded with a
 * deterministic public_id. The ledger row is created only after Cloudinary has
 * accepted the file, so a failed upload never leaves a "ready" asset behind.
 */
const MediaAsset = require('../models/MediaAsset');
const { cloudinary } = require('../config/cloudinary');
const { validateImageUpload, MAX_ATTACHMENT_BYTES } = require('./fileValidator');
const { mediaPublicId } = require('./mediaPaths');
const { deliverySet, extensionFor } = require('./mediaDelivery');
const { badRequest } = require('./httpError');

const MAX_IMAGE_DIMENSION = 2400;

function loadSharp() {
  try {
    // eslint-disable-next-line global-require
    return /** @type {any} */ (require('sharp'));
  } catch {
    return null;
  }
}

/** Strip EXIF and cap dimensions. GIFs pass through so animation survives. */
async function normaliseImage(buffer, mimeType) {
  if (mimeType === 'image/gif') return { buffer, width: null, height: null };

  const sharp = loadSharp();
  if (!sharp) return { buffer, width: null, height: null };

  try {
    const pipeline = sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    throw badRequest('That image could not be processed.');
  }
}

/**
 * @param {Buffer} buffer
 * @param {{publicId: string, resourceType?: 'image'|'video'|'raw'|'auto'}} options
 */
function uploadBuffer(buffer, { publicId, resourceType = 'image' }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: resourceType,
        image_metadata: false,
        overwrite: false
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

/**
 * Validate → normalise → upload → ledger row.
 * Returns the MediaAsset document and the delivery set used by callers.
 */
async function storeImageBuffer({
  buffer,
  mimeType,
  sizeBytes,
  surface = 'other',
  ownerId = null,
  refType = null,
  refId = null
}) {
  if (!buffer?.length) throw badRequest('Choose an image to upload.');
  if (Number(sizeBytes || buffer.length) > MAX_ATTACHMENT_BYTES) {
    throw badRequest('Images must be 8 MB or smaller.');
  }

  const validated = validateImageUpload({ buffer, claimedMime: mimeType, sizeBytes: sizeBytes || buffer.length });
  if (!validated.ok) throw badRequest(validated.reason);

  const normalised = await normaliseImage(buffer, validated.mimeType);
  const publicId = mediaPublicId({ surface, ownerId });

  const result = await uploadBuffer(normalised.buffer, { publicId, resourceType: 'image' });

  const asset = await MediaAsset.create({
    surface,
    ownerId: ownerId || null,
    publicId: result.public_id,
    resourceType: 'image',
    format: result.format || extensionFor(validated.mimeType),
    mimeType: validated.mimeType,
    bytes: result.bytes || normalised.buffer.length,
    width: normalised.width || result.width || null,
    height: normalised.height || result.height || null,
    url: result.secure_url,
    derivatives: deliverySet(result.public_id, { resourceType: 'image' }),
    status: 'ready',
    refType,
    refId
  });

  return { asset, result, delivery: asset.derivatives };
}

/** Record a video that was uploaded through the existing Cloudinary helper. */
async function linkMediaAsset(assetId, { refType, refId }) {
  if (!assetId || !refType || !refId) return null;
  return MediaAsset.findOneAndUpdate(
    { _id: assetId },
    { $set: { refType, refId } },
    { new: true }
  );
}

async function registerVideoAsset({ result, ownerId, surface = 'post', refType = null, refId = null }) {
  const asset = await MediaAsset.create({
    surface,
    ownerId: ownerId || null,
    publicId: result.public_id,
    resourceType: 'video',
    format: result.format || null,
    mimeType: result.resource_type === 'video' ? 'video/mp4' : null,
    bytes: result.bytes || 0,
    width: result.width || null,
    height: result.height || null,
    url: result.secure_url,
    derivatives: deliverySet(result.public_id, { resourceType: 'video', format: result.format || 'mp4' }),
    status: 'ready',
    refType,
    refId
  });
  return asset;
}

module.exports = {
  MAX_IMAGE_DIMENSION,
  normaliseImage,
  storeImageBuffer,
  linkMediaAsset,
  registerVideoAsset
};
