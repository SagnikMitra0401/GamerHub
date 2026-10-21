const test = require('node:test');
const assert = require('node:assert/strict');

const { isPrivateIp, assertPublicHttpUrl } = require('../utils/safeFetch');

test('private and reserved IPv4 ranges are blocked', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254', // cloud metadata
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255'
  ];
  for (const ip of blocked) assert.equal(isPrivateIp(ip), true, `${ip} should be blocked`);

  const allowed = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1'];
  for (const ip of allowed) assert.equal(isPrivateIp(ip), false, `${ip} should be allowed`);
});

test('private and reserved IPv6 ranges are blocked', () => {
  const blocked = ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1'];
  for (const ip of blocked) assert.equal(isPrivateIp(ip), true, `${ip} should be blocked`);

  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
});

test('assertPublicHttpUrl rejects dangerous URLs without network access', async () => {
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), /http and https/i);
  await assert.rejects(() => assertPublicHttpUrl('javascript:alert(1)'), /http and https/i);
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1:5000/api'), /not allowed/i);
  await assert.rejects(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data'), /not allowed/i);
  await assert.rejects(() => assertPublicHttpUrl('http://[::1]/'), /not allowed/i);
  await assert.rejects(() => assertPublicHttpUrl('http://localhost:5000/'), /not allowed/i);
  await assert.rejects(() => assertPublicHttpUrl('http://metadata.google.internal/'), /not allowed/i);
  await assert.rejects(() => assertPublicHttpUrl('http://user:pass@1.1.1.1/'), /credentials/i);
  await assert.rejects(() => assertPublicHttpUrl('not a url'), /Invalid URL/i);
});

test('assertPublicHttpUrl accepts public literal IPs', async () => {
  const url = await assertPublicHttpUrl('https://1.1.1.1/');
  assert.equal(url.hostname, '1.1.1.1');
});
