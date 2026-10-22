const test = require('node:test');
const assert = require('node:assert/strict');

const { safeActionUrl, safeThumbnail } = require('../utils/notify');
const youtubeBot = require('../utils/youtubeBot');

test('notification action URLs only allow internal routes or https', () => {
  assert.equal(safeActionUrl('/lfg'), '/lfg');
  assert.equal(safeActionUrl('https://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');

  assert.equal(safeActionUrl('//evil.example.com'), null);
  assert.equal(safeActionUrl('javascript:alert(1)'), null);
  assert.equal(safeActionUrl('data:text/html,x'), null);
  assert.equal(safeActionUrl('http://insecure.example.com'), null);
  assert.equal(safeActionUrl(''), null);
  assert.equal(safeActionUrl(null), null);
});

test('notification thumbnails must be https', () => {
  assert.equal(safeThumbnail('https://i.ytimg.com/vi/a/hq.jpg'), 'https://i.ytimg.com/vi/a/hq.jpg');
  assert.equal(safeThumbnail('http://i.ytimg.com/vi/a/hq.jpg'), null);
  assert.equal(safeThumbnail('javascript:alert(1)'), null);
  assert.equal(safeThumbnail(undefined), null);
});

test('the bot reports an unconfigured state without exposing a key', async () => {
  const original = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  youtubeBot.resetYoutubeCache();

  try {
    assert.equal(youtubeBot.isConfigured(), false);

    const status = youtubeBot.getStatus();
    assert.equal(status.configured, false);
    assert.equal('apiKey' in status, false);
    assert.equal(JSON.stringify(status).includes('YOUTUBE_API_KEY='), false);

    await assert.rejects(
      () => youtubeBot.searchLatestVideos('Valorant'),
      /not configured/i
    );
  } finally {
    if (original === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = original;
    youtubeBot.resetYoutubeCache();
  }
});
