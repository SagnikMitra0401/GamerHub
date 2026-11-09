/** Typed HTTP error so controllers can `throw` instead of building responses. */
class HttpError extends Error {
  constructor(statusCode, message, { code = null, details = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    if (code) this.code = code;
    if (details) this.details = details;
    this.expose = true;
  }
}

const badRequest = (message, opts) => new HttpError(400, message, opts);
const forbidden = (message = 'Forbidden', opts) => new HttpError(403, message, opts);
const notFound = (message = 'Resource not found', opts) => new HttpError(404, message, opts);
const conflict = (message, opts) => new HttpError(409, message, opts);

module.exports = { HttpError, badRequest, forbidden, notFound, conflict };
