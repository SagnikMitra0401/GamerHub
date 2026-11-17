const cloudinary = require('cloudinary').v2;

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
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'auto', // Detects if it's an image or a video automatically
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
      { resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
};

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };
