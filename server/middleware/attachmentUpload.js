const multer = require('multer');

const { MAX_ATTACHMENT_BYTES, ALLOWED_IMAGE_TYPES } = require('../utils/fileValidator');

/**
 * Channel image uploads live in memory, never on disk.
 *
 * Render's filesystem is ephemeral, so a temp file would only add a window where
 * an unvalidated upload exists as a real file. The buffer is validated by magic
 * bytes in the controller before anything is persisted anywhere.
 */
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_BYTES,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
    }
    return cb(null, true);
  }
});

module.exports = attachmentUpload;
