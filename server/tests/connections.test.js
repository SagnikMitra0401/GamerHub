/**
 * Domain connection layer.
 *
 * Only the squads domain owns a second pool (see the module comment for why
 * splitting identity from the feed would break every populate). These tests
 * pin that decision and the guarantee that a test run can never be pointed at
 * a domain-specific production URI.
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  DOMAIN_LIMITS,
  POOLED_DOMAINS,
  domainUri,
  getDomainConnection,
  connectionOptions,
  domainStatus
} = require('../config/connections');

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

test('squads is the only pooled domain', () => {
  assert.deepEqual([...POOLED_DOMAINS], ['squads']);
  assert.equal(DOMAIN_LIMITS.squads, 20);
  assert.ok(DOMAIN_LIMITS.auth <= DOMAIN_LIMITS.communities);
});

test('stable domains resolve to the default connection', () => {
  process.env.MONGO_URI = '';
  for (const domain of ['auth', 'feed', 'communities']) {
    assert.equal(getDomainConnection(domain), mongoose.connection, domain);
  }
});

test('without a URI the squads domain degrades to the default connection', () => {
  process.env.MONGO_URI = '';
  assert.equal(getDomainConnection('squads'), mongoose.connection);
});

test('a domain URI falls back to the base URI', () => {
  process.env.NODE_ENV = 'production';
  process.env.MONGO_URI = 'mongodb://base/db';
  delete process.env.MONGO_URI_SQUADS;
  assert.equal(domainUri('squads'), 'mongodb://base/db');

  process.env.MONGO_URI_SQUADS = 'mongodb://squads/db';
  assert.equal(domainUri('squads'), 'mongodb://squads/db');
});

test('NODE_ENV=test always pins the base URI', () => {
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = 'mongodb://throwaway/db';
  process.env.MONGO_URI_SQUADS = 'mongodb://production/db';
  assert.equal(domainUri('squads'), 'mongodb://throwaway/db');
});

test('pool size is configurable per domain', () => {
  process.env.MONGO_MAX_POOL_SIZE_SQUADS = '7';
  assert.equal(connectionOptions('squads').maxPoolSize, 7);
  assert.equal(connectionOptions('auth').maxPoolSize, DOMAIN_LIMITS.auth);
  assert.equal(connectionOptions('auth').serverSelectionTimeoutMS, 5000);
});

test('domain status reports every domain and whether squads is isolated', () => {
  process.env.MONGO_URI = '';
  const status = domainStatus();
  for (const domain of ['auth', 'feed', 'communities', 'squads']) {
    assert.equal(typeof status[domain], 'string', domain);
  }
  assert.equal(status.squadsIsolated, false, 'no URI means shared connection');
});
