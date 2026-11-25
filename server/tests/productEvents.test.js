process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedEventName, sanitizeEventProps } = require('../utils/productEvents');
const { buildFunnel, summarizeFunnelRows, DAY7_IGNORED_EVENTS } = require('../utils/funnel');
const {
  redactSensitive,
  resolveRequestId,
  observabilityStatus,
} = require('../utils/observability');

test('the product event allowlist is explicit', () => {
  for (const name of [
    'signup',
    'onboarding_started',
    'onboarding_completed',
    'onboarding_skipped',
    'first_join',
    'first_follow',
    'first_post',
    'first_comment',
    'first_message',
    'password_reset_requested',
    'password_reset_completed',
    'email_verified',
    'notification_opened',
    'notification_clicked',
  ]) {
    assert.equal(isAllowedEventName(name), true, name);
  }
  assert.equal(isAllowedEventName('message_body'), false);
  assert.equal(isAllowedEventName(''), false);
  assert.equal(isAllowedEventName(null), false);
});

test('event props reject sensitive keys, nested values and email addresses', () => {
  const clean = sanitizeEventProps({
    surface: 'bell',
    kind: 'comment',
    email: 'player@example.com',
    token: 'secret-token',
    message: 'private message text',
    body: 'private body',
    nested: { anything: true },
    list: ['a'],
    count: 3,
    enabled: true,
    'bad key': 'nope',
  });

  assert.deepEqual(clean, {
    surface: 'bell',
    kind: 'comment',
    count: 3,
    enabled: true,
  });
});

test('event props are capped at ten keys and long strings are clipped', () => {
  const input = {};
  for (let index = 0; index < 14; index += 1) input[`key_${index}`] = index;
  input.long = 'x'.repeat(400);

  const clean = sanitizeEventProps(input);
  assert.equal(Object.keys(clean).length, 10);
  assert.equal(clean.long, undefined, 'the eleventh field must not be kept');
  assert.equal(sanitizeEventProps({ note: 'x'.repeat(400) }).note.length, 120);
});

test('an empty or malformed props object becomes an empty object', () => {
  assert.deepEqual(sanitizeEventProps(null), {});
  assert.deepEqual(sanitizeEventProps('not-an-object'), {});
  assert.deepEqual(sanitizeEventProps([]), {});
});

test('the funnel reports distinct-user step conversions', () => {
  const funnel = buildFunnel({
    signups: 100,
    onboardingCompleted: 60,
    onboardingSkipped: 10,
    firstConnection: 30,
    firstContribution: 15,
    day7Returned: 6,
    day7Cohort: 20,
  });

  assert.deepEqual(
    funnel.steps.map((step) => step.key),
    ['signup', 'onboarding_completed', 'first_connection', 'first_contribution', 'day_7_return'],
  );
  assert.equal(funnel.steps[1].rateFromSignup, 60);
  assert.equal(funnel.steps[2].rateFromPrevious, 50);
  assert.equal(funnel.steps[3].rateFromSignup, 15);
  assert.equal(funnel.day7.rate, 30);
  assert.equal(funnel.day7.approximate, true);
  assert.equal(funnel.skippedOnboarding, 10);
});

test('funnel rows dedupe accounts and nest connection under onboarding', () => {
  const counts = summarizeFunnelRows([
    { names: ['signup'] },
    { names: ['signup', 'signup'] },
    { names: ['signup', 'onboarding_skipped', 'first_join'] },
    { names: ['signup', 'onboarding_completed'] },
    { names: ['signup', 'onboarding_completed', 'first_join'] },
    { names: ['signup', 'onboarding_completed', 'first_join', 'first_post'] },
  ]);

  assert.deepEqual(counts, {
    signups: 6,
    onboardingCompleted: 3,
    onboardingSkipped: 1,
    firstConnection: 2,
    firstContribution: 1,
  });
});

test('day-7 retention ignores notification engagement events', () => {
  assert.deepEqual(DAY7_IGNORED_EVENTS, ['notification_opened', 'notification_clicked']);
});

test('funnel rates are zero rather than NaN when a denominator is empty', () => {
  const funnel = buildFunnel();
  for (const step of funnel.steps) {
    assert.equal(Number.isNaN(step.rateFromSignup), false);
  }
  assert.equal(funnel.day7.rate, 0);
});

test('request ids accept safe caller values and replace unsafe ones', () => {
  assert.equal(resolveRequestId('req-12345678'), 'req-12345678');
  assert.match(resolveRequestId('bad id with spaces'), /^[0-9a-f-]{36}$/);
  assert.match(resolveRequestId(undefined), /^[0-9a-f-]{36}$/);
});

test('observability redacts email, query tokens and bearer credentials', () => {
  const safe = redactSensitive(
    'player@example.com token=abc123 password=hunter2 Authorization: Bearer abc.def ' +
      '{"token":"json-leak","cookie":"session-leak"} ' +
      'access_token=access-leak client_secret=client-leak Bearer a+b/c=',
  );
  assert.equal(safe.includes('player@example.com'), false);
  assert.equal(safe.includes('abc123'), false);
  assert.equal(safe.includes('hunter2'), false);
  assert.equal(safe.includes('Bearer abc.def'), false);
  assert.equal(safe.includes('json-leak'), false);
  assert.equal(safe.includes('session-leak'), false);
  assert.equal(safe.includes('access-leak'), false);
  assert.equal(safe.includes('client-leak'), false);
  assert.equal(safe.includes('a+b/c='), false);
  assert.equal(observabilityStatus().requestIds, true);
  assert.equal(observabilityStatus().productEventRetentionDays, 180);
});
