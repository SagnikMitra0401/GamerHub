const crypto = require('crypto');
const { PRODUCT_EVENT_TTL_DAYS } = require('../models/ProductEvent');

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;

const releaseTag = () =>
  String(
    process.env.RELEASE_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    'development'
  ).slice(0, 80);

/** Replace common PII or credential shapes before a log line is written. */
function redactSensitive(value) {
  return String(value || '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b([A-Za-z0-9_-]*(?:token|password|secret|authorization|cookie))"?\s*[:=]\s*("[^"]*"|'[^']*'|[^\s&,}]+)/gi, '$1=[redacted]');
}

function newRequestId() {
  return crypto.randomUUID();
}

function resolveRequestId(headerValue) {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : newRequestId();
}

function logJson(level, event, fields = {}) {
  // Test output stays readable; production and local development get one JSON
  // object per line so a log collector can index it.
  if (process.env.NODE_ENV === 'test' || process.env.LOG_JSON === '0') return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    release: releaseTag(),
    ...fields
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else console.log(text);
}

function logServerError(err, req) {
  logJson('error', 'server_error', {
    requestId: req?.id || null,
    name: err?.name || 'Error',
    message: redactSensitive(err?.message || 'Internal server error'),
    stack: redactSensitive(err?.stack || ''),
    method: req?.method || null,
    path: req?.path || null
  });
}

function observabilityStatus() {
  return {
    requestIds: true,
    structuredLogs: true,
    errorReporting: 'structured-json',
    release: releaseTag(),
    productEventRetentionDays: PRODUCT_EVENT_TTL_DAYS
  };
}

module.exports = {
  REQUEST_ID_HEADER,
  releaseTag,
  redactSensitive,
  resolveRequestId,
  logJson,
  logServerError,
  observabilityStatus
};
