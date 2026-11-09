const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDomain,
  txtRecordMatches,
  checkDnsToken
} = require('../utils/domainVerification');

const TOKEN = '0123456789abcdef0123456789abcdef';

test('domain normalization rejects schemes and malformed hosts', () => {
  assert.equal(normalizeDomain('Studio.Example.'), 'studio.example');
  assert.equal(normalizeDomain('https://studio.example'), '');
  assert.equal(normalizeDomain('localhost'), '');
});

test('TXT matching handles chunked records and exact tokens only', () => {
  assert.equal(txtRecordMatches([['gamerhub-verify=', TOKEN]], TOKEN), true);
  assert.equal(txtRecordMatches([`  gamerhub-verify=${TOKEN}  `], TOKEN), true);
  assert.equal(txtRecordMatches([`gamerhub-verify=${TOKEN}`], `${TOKEN}0`), false);
  assert.equal(txtRecordMatches([], TOKEN), false);
});

test('a matching injected DNS response verifies the domain', async () => {
  const result = await checkDnsToken({
    domain: 'studio.example',
    token: TOKEN,
    resolveTxt: async (host) => {
      assert.equal(host, '_gamerhub-verify.studio.example');
      return [[`gamerhub-verify=${TOKEN}`]];
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.domain, 'studio.example');
});

test('missing DNS records fail closed without exposing resolver errors', async () => {
  const result = await checkDnsToken({
    domain: 'studio.example',
    token: TOKEN,
    resolveTxt: async () => {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DNS_RECORD_MISSING');
  assert.doesNotMatch(result.reason, /ENOTFOUND/);
});
