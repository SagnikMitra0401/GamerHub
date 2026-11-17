const {
  REQUEST_ID_HEADER,
  resolveRequestId,
  logJson
} = require('../utils/observability');

/**
 * Attach a request id to every request and response, then emit one structured
 * access log line. Query strings are deliberately excluded: reset/verify tokens
 * and search terms must never end up in log storage.
 */
function requestContext(req, res, next) {
  req.id = resolveRequestId(req.get(REQUEST_ID_HEADER));
  res.setHeader(REQUEST_ID_HEADER, req.id);

  const started = process.hrtime.bigint();
  res.once('finish', () => {
    if (process.env.LOG_HTTP === '0') return;
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    logJson('info', 'http_request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100
    });
  });

  next();
}

module.exports = requestContext;
