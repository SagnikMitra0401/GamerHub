process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { sendEmail, transportMode } = require('../utils/email');

let server;
let port;
let received = [];
let reply = { status: 200, body: { ok: true } };

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      received.push({
        method: req.method,
        headers: req.headers,
        body: JSON.parse(raw),
      });
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function configure(secret = 'test-bridge-secret') {
  process.env.EMAIL_TRANSPORT = 'apps-script';
  process.env.GMAIL_BRIDGE_URL = `http://127.0.0.1:${port}/exec`;
  process.env.GMAIL_BRIDGE_SECRET = secret;
}

test('apps-script transport posts the message and secret over HTTP', async () => {
  received = [];
  reply = { status: 200, body: { ok: true } };
  configure();

  const result = await sendEmail({
    to: 'player@example.com',
    subject: 'Confirm your GamerHub email',
    text: 'Open the link',
    html: '<p>Open the link</p>',
  });

  assert.deepEqual(result, { id: 'apps-script' });
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].body.secret, 'test-bridge-secret');
  assert.equal(received[0].body.to, 'player@example.com');
  assert.equal(received[0].body.subject, 'Confirm your GamerHub email');
  assert.equal(received[0].body.html, '<p>Open the link</p>');
});

test('a bridge URL selects apps-script in automatic mode', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  delete process.env.EMAIL_TRANSPORT;
  process.env.GMAIL_BRIDGE_URL = `http://127.0.0.1:${port}/exec`;

  assert.equal(transportMode(), 'apps-script');

  process.env.NODE_ENV = previousNodeEnv;
});

test('the bridge response must explicitly report ok', async () => {
  configure();
  reply = { status: 200, body: { ok: false, error: 'forbidden' } };

  await assert.rejects(
    sendEmail({ to: 'player@example.com', subject: 'Test', text: 'Body' }),
    /Email bridge rejected the message \(200: forbidden\)/,
  );
});

test('the bridge requires a secret before making a request', async () => {
  received = [];
  configure('');
  reply = { status: 200, body: { ok: true } };

  await assert.rejects(
    sendEmail({ to: 'player@example.com', subject: 'Test', text: 'Body' }),
    /GMAIL_BRIDGE_SECRET is not configured/,
  );
  assert.equal(received.length, 0);
});
