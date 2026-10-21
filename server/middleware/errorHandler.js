const { HttpError } = require('../utils/httpError');

/**
 * Single JSON error responder.
 * - HttpError carries a safe, user-facing message.
 * - Mongoose validation/cast/duplicate errors are mapped to 4xx.
 * - Everything else is a generic 500: internal messages (Mongo aggregation
 *   text, stack traces) never reach the client.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({
      message: err.message,
      ...(err.code ? { code: err.code } : {})
    });
  }

  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors || {})
      .map((e) => e.message)
      .join(', ');
    return res.status(400).json({ message: message || 'Invalid request payload' });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid resource identifier' });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      message: 'That value is already taken',
      field: Object.keys(err.keyValue || {})[0] || null
    });
  }

  if (err.name === 'MulterError') {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Videos are limited to 10MB, images to 5MB.'
        : 'Upload failed';
    return res.status(400).json({ message });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Malformed JSON body' });
  }

  console.error('[API] unhandled error:', err);
  return res.status(500).json({ message: 'Internal server error' });
};

module.exports = errorHandler;
