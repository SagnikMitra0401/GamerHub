/**
 * Optional hosted error reporting.
 *
 * Sentry is deliberately server-side only: no browser SDK, no session replay,
 * no request bodies. A deployment without SENTRY_DSN keeps the existing
 * structured-JSON error log and reports `structured-json` in system health.
 *
 * Initialisation is lazy so unit tests and local runs never need the SDK to be
 * configured, and a broken SDK can never prevent the API from booting.
 */
const { redactSensitive, releaseTag } = require('./observability');

let Sentry = null;
let attempted = false;
let configured = false;
let lastError = null;

function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.message) event.message = redactSensitive(event.message);

  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = redactSensitive(event.request.url).split('?')[0];
  }

  const values = event.exception?.values;
  if (Array.isArray(values)) {
    for (const value of values) {
      if (value?.value) value.value = redactSensitive(value.value);
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (crumb?.message) crumb.message = redactSensitive(crumb.message);
      if (crumb?.data) {
        delete crumb.data.body;
        delete crumb.data.cookies;
        delete crumb.data.headers;
      }
    }
  }

  return event;
}

function initErrorReporting() {
  if (attempted) return configured;
  attempted = true;

  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return false;

  try {
    // Lazy require: local development and tests do not need to load the SDK.
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: releaseTag(),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
    });
    configured = true;
  } catch (err) {
    lastError = redactSensitive(err?.message || 'Sentry initialisation failed');
    configured = false;
  }

  return configured;
}

/**
 * Capture one server error. Returns true when a hosted report was accepted for
 * delivery; false when reporting is unconfigured or the SDK failed.
 */
function captureServerError(err, req = null) {
  if (!initErrorReporting() || !Sentry) return false;

  try {
    Sentry.withScope((scope) => {
      if (req?.id) scope.setTag('request_id', String(req.id));
      if (req?.method) scope.setTag('method', String(req.method).slice(0, 12));
      if (req?.path) scope.setTag('route', String(req.path).split('?')[0].slice(0, 160));
      scope.setTag('release', releaseTag());
      Sentry.captureException(err);
    });
    return true;
  } catch (err) {
    lastError = redactSensitive(err?.message || 'Sentry capture failed');
    return false;
  }
}

function errorReportingStatus() {
  initErrorReporting();
  return {
    provider: configured ? 'sentry' : 'structured-json',
    configured,
    release: releaseTag(),
    // Never expose SDK/driver text from a public admin response.
    error: configured || !lastError ? null : 'initialisation failed',
  };
}

/** Test helper: forget initialisation so env changes take effect. */
function resetErrorReporting() {
  attempted = false;
  configured = false;
  lastError = null;
  Sentry = null;
}

module.exports = {
  initErrorReporting,
  captureServerError,
  errorReportingStatus,
  resetErrorReporting,
  scrubEvent,
};
