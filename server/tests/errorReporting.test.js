const test = require('node:test');
const assert = require('node:assert/strict');

const SENTRY_PATH = require.resolve('@sentry/node');
const sentry = {
  options: null,
  errors: [],
  tags: {},
  init(options) {
    this.options = options;
  },
  withScope(callback) {
    callback({
      setTag: (key, value) => {
        this.tags[key] = value;
      },
    });
  },
  captureException(err) {
    this.errors.push(err);
  },
};

require.cache[SENTRY_PATH] = {
  id: SENTRY_PATH,
  filename: SENTRY_PATH,
  loaded: true,
  exports: sentry,
};

const {
  initErrorReporting,
  captureServerError,
  errorReportingStatus,
  resetErrorReporting,
  scrubEvent,
} = require('../utils/errorReporting');

const clear = () => {
  sentry.options = null;
  sentry.errors = [];
  sentry.tags = {};
  delete process.env.SENTRY_DSN;
  resetErrorReporting();
};

test('without a DSN, reporting stays on structured JSON', () => {
  clear();
  assert.equal(initErrorReporting(), false);
  assert.equal(errorReportingStatus().provider, 'structured-json');
  assert.equal(errorReportingStatus().configured, false);
  assert.equal(captureServerError(new Error('nope')), false);
});

test('a DSN initialises Sentry with release tagging and no PII', () => {
  clear();
  process.env.SENTRY_DSN = 'https://public@o1.ingest.sentry.io/1';
  assert.equal(initErrorReporting(), true);
  assert.equal(sentry.options.sendDefaultPii, false);
  assert.equal(sentry.options.tracesSampleRate, 0);
  assert.equal(typeof sentry.options.release, 'string');
  assert.equal(errorReportingStatus().provider, 'sentry');
});

test('capturing an error sends request tags but not request bodies', () => {
  clear();
  process.env.SENTRY_DSN = 'https://public@o1.ingest.sentry.io/1';
  const err = new Error('boom');
  assert.equal(
    captureServerError(err, {
      id: 'req-12345678',
      method: 'POST',
      path: '/api/posts',
      headers: { cookie: 'must-not-leak' },
      body: { password: 'must-not-leak' },
    }),
    true,
  );

  assert.equal(sentry.errors.length, 1);
  assert.equal(sentry.tags.request_id, 'req-12345678');
  assert.equal(sentry.tags.route, '/api/posts');
  assert.equal(sentry.tags.release, sentry.options.release);
  assert.equal(sentry.tags.cookie, undefined);
});

test('the beforeSend scrubber removes credentials and request bodies', () => {
  const event = scrubEvent({
    message: 'player@example.com token=abc123',
    request: {
      url: 'https://example.com/reset?token=abc123',
      data: { password: 'hunter2' },
      cookies: { session: 'abc' },
      headers: { authorization: 'Bearer abc' },
    },
    exception: { values: [{ value: 'failed for player@example.com' }] },
    breadcrumbs: [{ message: 'token=abc123', data: { body: 'private' } }],
  });

  assert.equal(event.message.includes('player@example.com'), false);
  assert.equal(event.message.includes('abc123'), false);
  assert.equal(event.request.url, 'https://example.com/reset');
  assert.equal(event.request.data, undefined);
  assert.equal(event.request.cookies, undefined);
  assert.equal(event.request.headers, undefined);
  assert.equal(event.exception.values[0].value.includes('player@example.com'), false);
  assert.equal(event.breadcrumbs[0].message.includes('abc123'), false);
  assert.equal(event.breadcrumbs[0].data.body, undefined);
});
