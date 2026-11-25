const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseYouTubeId,
  findYouTubeIdInText,
  youtubeThumbnail,
  youtubeEmbedUrl,
  normalizeDuration,
} = require('../utils/videoSource');

test('parseYouTubeId accepts every common YouTube URL shape', () => {
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://youtube.com/watch?list=PL1&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://m.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://music.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('parseYouTubeId rejects look-alike hosts, bad ids and non-http schemes', () => {
  assert.equal(parseYouTubeId('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeId('https://youtu.be/short'), null);
  assert.equal(parseYouTubeId('javascript:alert(1)'), null);
  assert.equal(parseYouTubeId('not a url'), null);
  assert.equal(parseYouTubeId(''), null);
  assert.equal(parseYouTubeId(null), null);
});

test('findYouTubeIdInText finds the first valid link in a post body', () => {
  const text = 'watch this https://example.com/nope and then https://youtu.be/dQw4w9WgXcQ';
  assert.equal(findYouTubeIdInText(text), 'dQw4w9WgXcQ');
  assert.equal(findYouTubeIdInText('no links here'), null);
  assert.equal(findYouTubeIdInText(undefined), null);
});

test('thumbnail and embed URLs use the privacy-enhanced host', () => {
  assert.equal(youtubeThumbnail('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(youtubeThumbnail(null), null);

  const embed = youtubeEmbedUrl('dQw4w9WgXcQ', { autoplay: true });
  assert.match(embed, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.match(embed, /autoplay=1/);
  assert.match(embed, /rel=0/);
  assert.equal(youtubeEmbedUrl(null), null);
});

test('normalizeDuration bounds and rounds, and rejects unusable values', () => {
  assert.equal(normalizeDuration('42.6'), 43);
  assert.equal(normalizeDuration(0), null);
  assert.equal(normalizeDuration(-5), null);
  assert.equal(normalizeDuration('abc'), null);
  assert.equal(normalizeDuration(99_999), 36_000);
  assert.equal(normalizeDuration(90, 60), 60);
});
