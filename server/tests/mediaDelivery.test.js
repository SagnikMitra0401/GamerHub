const test = require('node:test');
const assert = require('node:assert/strict');

const { cloudinary } = require('../config/cloudinary');
const MediaAsset = require('../models/MediaAsset');
const { TRANSFORMS, deliverySet } = require('../utils/mediaDelivery');

// No network: cloudinary.url only needs a cloud name to render a path.
cloudinary.config({ cloud_name: 'demo', api_key: 'key', api_secret: 'secret', secure: true });

test('the video variant caps width and asks Cloudinary for automatic quality', () => {
  assert.deepEqual(TRANSFORMS.video, { width: 1280, crop: 'limit', quality: 'auto' });

  const video = deliverySet('gamerhub/dev/post/clip', { resourceType: 'video', format: 'mp4' });
  assert.match(video.video, /\/video\/upload\//);
  assert.match(video.video, /w_1280/);
  assert.match(video.video, /c_limit/);
  assert.match(video.video, /q_auto/);
  assert.match(video.video, /\.mp4(\?|$)/);
});

test('image deliveries do not advertise a video URL', () => {
  const image = deliverySet('gamerhub/dev/post/still', { resourceType: 'image' });
  assert.equal(image.video, null);
});

test('the media ledger can persist the video derivative', () => {
  // Mongoose drops fields absent from the schema; without this path every
  // upload silently falls back to the raw secure_url.
  assert.ok(MediaAsset.schema.path('derivatives.video'));
});
