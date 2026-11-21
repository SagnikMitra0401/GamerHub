const fs = require('fs');
const cloudinary = require('cloudinary').v2;

// Cloudinary's SDK aborts a single request after 60 s by default. A large video
// can easily exceed that, so the upload call gets a longer budget and, above
// the chunk threshold, is sent in resumable chunks instead of one request.
const UPLOAD_TIMEOUT_MS = Number(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS) || 10 * 60 * 1000;
const VIDEO_CHUNK_BYTES = 6 * 1024 * 1024;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Uploads a local file to Cloudinary and returns the upload result.
 * Automatically handles both images and videos.
 */
const uploadToCloudinary = async (filePath, options = {}) => {
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(filePath).size;
  } catch {
    sizeBytes = 0;
  }
  const chunked = options.resourceType === 'video' || (sizeBytes > VIDEO_CHUNK_BYTES && !options.resourceType);

  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'auto', // Detects if it's an image or a video automatically
        timeout: UPLOAD_TIMEOUT_MS,
        ...(chunked && sizeBytes > VIDEO_CHUNK_BYTES
          ? { chunk_size: VIDEO_CHUNK_BYTES }
          : {}),
        // A caller that passes a full public_id (new media scheme) must not
        // also pass `folder`, so the default only applies when none is given.
        ...(options.publicId
          ? { public_id: options.publicId }
          : { folder: options.folder || 'gaming-hub-media' }),
        ...(options.resourceType ? { resource_type: options.resourceType } : {}),
        ...(options.imageMetadata === false ? { image_metadata: false } : {})
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
};

/**
 * Deletes a file from Cloudinary using its public_id.
 * Requires the correct resource_type ('video' or 'image').
 */
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(
      publicId,
      { resource_type: resourceType, invalidate: true },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
};

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };
