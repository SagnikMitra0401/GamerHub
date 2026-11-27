/**
 * Phase 16 end-to-end verification — stories, clips, broadcast channels.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase16.js
 *
 * No Cloudinary call is made: the upload-limit check is rejected before any
 * media is stored, YouTube posts are link-only, and stories are text-only.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e16_${Date.now().toString(36)}`;

function tempMongoUri() {
  const url = new URL(process.env.MONGO_URI);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

process.env.MONGO_URI = tempMongoUri();
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.STORY_RATE_LIMIT_MAX = '1000';
process.env.BROADCAST_RATE_LIMIT_MAX = '1000';
process.env.EMAIL_TRANSPORT = 'memory';
process.env.DISABLE_RETENTION_WORKER = '1';
process.env.REDIS_ENABLED = '0';
process.env.MEDIA_ENV = 'test';
delete process.env.SENTRY_DSN;

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');

const User = require('../server/models/User');
const Story = require('../server/models/Story');
const StoryView = require('../server/models/StoryView');
const BroadcastChannel = require('../server/models/BroadcastChannel');
const Notification = require('../server/models/Notification');

const {
  api,
  check,
  report,
  setBase,
  registerUser,
  connectSocket,
  waitFor,
} = require('./lib/e2e-harness');

async function uploadTooLargePost(base, cookie) {
  const form = new FormData();
  form.append('title', 'Oversized image post');
  form.append('media', new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
  // Multipart goes through fetch directly, so the CSRF pair has to be named
  // here the way the shared helper does it.
  const headers = { cookie };
  const csrf = /(?:^|;\s*)gh_csrf=([^;]+)/.exec(cookie || '');
  if (csrf) headers['x-csrf-token'] = csrf[1];
  const res = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers,
    body: form,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = setBase(`http://127.0.0.1:${server.address().port}`);

  try {
    const alice = await registerUser('alice16', { probeId: true });
    const bob = await registerUser('bob16', { probeId: true });
    const dave = await registerUser('dave16', { probeId: true });

    // ── Stories: visibility ─────────────────────────────────────────────────
    const storyResponse = await api('/api/stories', {
      method: 'POST',
      cookie: alice.cookie,
      body: { text: 'Ranked grind starts now', visibility: 'followers', background: 'ocean' },
    });
    check('a text status is created for followers', () => {
      assert.equal(storyResponse.status, 201, JSON.stringify(storyResponse.data));
      assert.equal(storyResponse.data.kind, 'text');
      assert.ok(storyResponse.data.expiresAt);
    });
    const storyId = String(storyResponse.data._id);

    const bobBeforeFollow = await api('/api/stories', { cookie: bob.cookie });
    check('a non-follower does not see a followers-only story', () => {
      assert.equal(bobBeforeFollow.status, 200);
      assert.equal(
        bobBeforeFollow.data.some((group) => group.author._id === alice.id),
        false,
      );
    });

    const deniedView = await api(`/api/stories/${storyId}/view`, {
      method: 'POST',
      cookie: bob.cookie,
    });
    check('a non-follower cannot mark a followers-only story as viewed', () => {
      assert.equal(deniedView.status, 403);
    });

    await User.updateOne({ _id: bob.id }, { $addToSet: { following: alice.id } });

    const bobAfterFollow = await api('/api/stories', { cookie: bob.cookie });
    check('a follower sees the story, unseen, grouped by author', () => {
      assert.equal(bobAfterFollow.status, 200, JSON.stringify(bobAfterFollow.data));
      const group = bobAfterFollow.data.find((entry) => entry.author._id === alice.id);
      assert.ok(group, 'author group present');
      assert.equal(group.seen, false);
      assert.equal(group.stories[0].seen, false);
    });

    const firstView = await api(`/api/stories/${storyId}/view`, {
      method: 'POST',
      cookie: bob.cookie,
    });
    const secondView = await api(`/api/stories/${storyId}/view`, {
      method: 'POST',
      cookie: bob.cookie,
    });
    check('viewing is idempotent and counts once', () => {
      assert.equal(firstView.status, 200, JSON.stringify(firstView.data));
      assert.equal(firstView.data.counted, true);
      assert.equal(secondView.data.counted, false);
    });

    const storyDoc = await Story.findById(storyId).lean();
    check('the story counter and receipt agree', () => {
      assert.equal(storyDoc.viewCount, 1);
    });

    const viewerRows = await StoryView.countDocuments({
      storyId: new mongoose.Types.ObjectId(storyId),
    });
    check('a single receipt row exists for the viewer', () => {
      assert.equal(viewerRows, 1);
    });

    const readersDenied = await api(`/api/stories/${storyId}/viewers`, { cookie: bob.cookie });
    check('only the author can read the viewer list', () => {
      assert.equal(readersDenied.status, 403);
    });

    const viewerList = await api(`/api/stories/${storyId}/viewers`, { cookie: alice.cookie });
    check('the author sees who watched', () => {
      assert.equal(viewerList.status, 200, JSON.stringify(viewerList.data));
      assert.equal(viewerList.data.count, 1);
      assert.equal(viewerList.data.viewers[0].username, 'bob16');
    });

    await Story.updateOne({ _id: storyId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const afterExpiry = await api('/api/stories', { cookie: alice.cookie });
    check('an expired story disappears from the rail', () => {
      assert.equal(afterExpiry.status, 200);
      assert.equal(
        afterExpiry.data.some((group) => group.author._id === alice.id),
        false,
      );
    });

    const expiredView = await api(`/api/stories/${storyId}/view`, {
      method: 'POST',
      cookie: bob.cookie,
    });
    check('an expired story cannot be viewed by id', () => {
      assert.equal(expiredView.status, 404);
    });

    const secondStory = await api('/api/stories', {
      method: 'POST',
      cookie: alice.cookie,
      body: { text: 'Second status', visibility: 'public' },
    });
    const secondStoryId = String(secondStory.data._id);

    const foreignDelete = await api(`/api/stories/${secondStoryId}`, {
      method: 'DELETE',
      cookie: bob.cookie,
    });
    check('another account cannot delete your story', () => {
      assert.equal(foreignDelete.status, 403);
    });

    const ownedDelete = await api(`/api/stories/${secondStoryId}`, {
      method: 'DELETE',
      cookie: alice.cookie,
    });
    check('the author can delete their own story', () => {
      assert.equal(ownedDelete.status, 200, JSON.stringify(ownedDelete.data));
    });

    const deletedStory = await Story.findById(secondStoryId).lean();
    check('a deleted story is removed with its receipts', () => {
      assert.equal(deletedStory, null);
    });

    // ── Clips: YouTube derivation and media typing ──────────────────────────
    const youtubePost = await api('/api/posts', {
      method: 'POST',
      cookie: alice.cookie,
      body: {
        title: 'Best clutch of the week',
        content: 'Full round breakdown',
        linkPreview: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Clutch',
          description: 'A round',
          image: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        }),
      },
    });
    check('a YouTube link post derives its id server-side', () => {
      assert.equal(youtubePost.status, 201, JSON.stringify(youtubePost.data));
      assert.equal(youtubePost.data.youtubeId, 'dQw4w9WgXcQ');
      assert.equal(youtubePost.data.videoSource, 'youtube');
    });

    const videoFeed = await api('/api/posts?mediaType=video&limit=10');
    check('the clips filter only returns uploaded video rows', () => {
      assert.equal(videoFeed.status, 200);
      assert.equal(Array.isArray(videoFeed.data), true);
      assert.equal(
        videoFeed.data.some((post) => post._id === youtubePost.data._id),
        false,
      );
      assert.equal(
        videoFeed.data.every((post) => post.mediaType === 'video'),
        true,
      );
    });

    const oversized = await uploadTooLargePost(base, alice.cookie);
    check('an oversized image is rejected before any media is stored', () => {
      assert.equal(oversized.status, 400, JSON.stringify(oversized.data));
      assert.match(String(oversized.data?.message), /5MB/i);
    });

    // ── Broadcast channels: ownership and subscriptions ─────────────────────
    const created = await api('/api/channels', {
      method: 'POST',
      cookie: alice.cookie,
      body: { name: 'Patch Notes', description: 'Every update, one place.', category: 'news' },
    });
    check('an account can create a broadcast channel', () => {
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.equal(created.data.slug, 'patch-notes');
      assert.equal(created.data.isOwner, true);
      assert.equal(created.data.canPublish, true);
    });
    const channelId = String(created.data._id);

    const foreignPublish = await api('/api/channels/patch-notes/messages', {
      method: 'POST',
      cookie: bob.cookie,
      body: { text: 'Not my channel' },
    });
    check('a non-owner cannot publish', () => {
      assert.equal(foreignPublish.status, 403);
    });

    const subscribed = await api('/api/channels/patch-notes/subscribe', {
      method: 'POST',
      cookie: bob.cookie,
    });
    const subscribedAgain = await api('/api/channels/patch-notes/subscribe', {
      method: 'POST',
      cookie: bob.cookie,
    });
    check('subscribing is idempotent and counts once', () => {
      assert.equal(subscribed.status, 200, JSON.stringify(subscribed.data));
      assert.equal(subscribed.data.created, true);
      assert.equal(subscribedAgain.data.created, false);
    });

    const channelDoc = await BroadcastChannel.findById(channelId).lean();
    check('the subscriber counter does not double count', () => {
      assert.equal(channelDoc.subscriberCount, 1);
    });

    const firstPublish = await api('/api/channels/patch-notes/messages', {
      method: 'POST',
      cookie: alice.cookie,
      body: { text: 'Servers restart at 02:00 UTC.' },
    });
    check('the owner can publish', () => {
      assert.equal(firstPublish.status, 201, JSON.stringify(firstPublish.data));
      assert.equal(firstPublish.data.text, 'Servers restart at 02:00 UTC.');
    });

    const inbox = await api('/api/channels', { cookie: bob.cookie });
    check('a new post shows as unread for subscribers', () => {
      assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
      assert.equal(inbox.data.subscriptions[0].unread, 1);
    });

    const notificationCount = await Notification.countDocuments({
      userId: bob.id,
      type: 'broadcast',
    });
    check('publishing creates one broadcast notification per post', () => {
      assert.equal(notificationCount, 1);
    });

    await api('/api/channels/patch-notes/read', { method: 'POST', cookie: bob.cookie });
    const readInbox = await api('/api/channels', { cookie: bob.cookie });
    check('marking read clears the unread badge', () => {
      assert.equal(readInbox.data.subscriptions[0].unread, 0);
    });

    const muted = await api('/api/channels/patch-notes/subscription', {
      method: 'PATCH',
      cookie: bob.cookie,
      body: { muted: true },
    });
    check('a subscriber can mute a channel', () => {
      assert.equal(muted.status, 200, JSON.stringify(muted.data));
      assert.equal(muted.data.muted, true);
    });

    const mutedPublish = await api('/api/channels/patch-notes/messages', {
      method: 'POST',
      cookie: alice.cookie,
      body: { text: 'Muted update' },
    });
    const afterMuted = await Notification.countDocuments({ userId: bob.id, type: 'broadcast' });
    check('a muted channel publishes without a notification', () => {
      assert.equal(mutedPublish.status, 201);
      assert.equal(afterMuted, 1);
    });

    await api('/api/channels/patch-notes/subscription', {
      method: 'PATCH',
      cookie: bob.cookie,
      body: { muted: false },
    });

    // ── Realtime subscription ───────────────────────────────────────────────
    const bobSocket = await connectSocket(bob.token);
    bobSocket.emit('join_broadcast', { channelId });
    const joined = await waitFor(
      bobSocket,
      'joined_broadcast',
      (payload) => payload.channelId === channelId,
    );
    check('a subscriber joins the broadcast room', () => {
      assert.ok(joined, 'join acknowledgement');
    });

    const liveEvent = waitFor(bobSocket, 'broadcast_message');
    await api('/api/channels/patch-notes/messages', {
      method: 'POST',
      cookie: alice.cookie,
      body: { text: 'Live patch notes are here.' },
    });
    const livePayload = await liveEvent;
    check('a published post reaches subscribers live', () => {
      assert.ok(livePayload, 'broadcast_message event');
      assert.equal(livePayload.text, 'Live patch notes are here.');
    });

    const unmutedNotifications = await Notification.countDocuments({
      userId: bob.id,
      type: 'broadcast',
    });
    check('unmuting restores notifications for the next post', () => {
      assert.equal(unmutedNotifications, 2);
    });

    const messages = await api('/api/channels/patch-notes/messages', { cookie: bob.cookie });
    check('subscribers can read the paged message feed', () => {
      assert.equal(messages.status, 200, JSON.stringify(messages.data));
      assert.equal(messages.data.items.length >= 3, true);
      assert.equal(messages.data.items[0].author.username, 'alice16');
    });

    const foreignDeleteMessage = await api(
      `/api/channels/patch-notes/messages/${livePayload._id}`,
      { method: 'DELETE', cookie: bob.cookie },
    );
    check('a subscriber cannot delete a post', () => {
      assert.equal(foreignDeleteMessage.status, 403);
    });

    const ownerDeleteMessage = await api(`/api/channels/patch-notes/messages/${livePayload._id}`, {
      method: 'DELETE',
      cookie: alice.cookie,
    });
    check('the owner can delete a post', () => {
      assert.equal(ownerDeleteMessage.status, 200, JSON.stringify(ownerDeleteMessage.data));
    });

    // ── Private channels and socket denial ──────────────────────────────────
    await BroadcastChannel.updateOne({ _id: channelId }, { $set: { isPublic: false } });
    const privateRead = await api('/api/channels/patch-notes', { cookie: dave.cookie });
    check('a non-subscriber cannot open a private channel', () => {
      assert.equal(privateRead.status, 403);
    });

    const daveSocket = await connectSocket(dave.token);
    daveSocket.emit('join_broadcast', { channelId });
    const deniedJoin = await waitFor(
      daveSocket,
      'error_msg',
      (payload) => payload.code === 'FORBIDDEN',
    );
    check('the socket room refuses a non-subscriber of a private channel', () => {
      assert.ok(deniedJoin, 'FORBIDDEN error');
    });

    daveSocket.disconnect();
    bobSocket.disconnect();

    // ── Ownership limit ─────────────────────────────────────────────────────
    const second = await api('/api/channels', {
      method: 'POST',
      cookie: alice.cookie,
      body: { name: 'Second channel' },
    });
    const third = await api('/api/channels', {
      method: 'POST',
      cookie: alice.cookie,
      body: { name: 'Third channel' },
    });
    const fourth = await api('/api/channels', {
      method: 'POST',
      cookie: alice.cookie,
      body: { name: 'Fourth channel' },
    });
    check('an account can own up to three channels', () => {
      assert.equal(second.status, 201, JSON.stringify(second.data));
      assert.equal(third.status, 201, JSON.stringify(third.data));
      assert.equal(fourth.status, 400, JSON.stringify(fourth.data));
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
