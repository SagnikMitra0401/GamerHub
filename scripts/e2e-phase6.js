/**
 * Phase 6 end-to-end verification.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase6.js
 *
 * Covers the surface the other two suites do not: auth lifecycle, post edit
 * windows, comment ownership, bookmarks, gamer passport limits, preferences,
 * presence projection, notification cursors, LFG accept/reject, channel history
 * cursors, audit immutability, admin observability, input hardening, and the
 * degraded (Redis-disabled) write path.
 *
 * It also asserts the Redis-off contract explicitly, so a future Redis
 * re-enable that forgets the fallback fails here rather than in production.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const E2E_DB = `gamerhub_e2e6_${Date.now().toString(36)}`;

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
process.env.PREVIEW_RATE_LIMIT_MAX = '10000';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const app = require('../server/app');
const { initSocket } = require('../server/config/socket');
const { getRedis, isConfigured } = require('../server/config/redis');
const { startLikeFlushWorker, flushLikeBuffer } = require('../server/utils/likeBuffer');
const { cacheWrap, resetCacheLayer } = require('../server/utils/redisCache');

const User = require('../server/models/User');
const Post = require('../server/models/Post');
const Comment = require('../server/models/Comment');
const Community = require('../server/models/Community');
const Channel = require('../server/models/Channel');
const Message = require('../server/models/Message');
const Notification = require('../server/models/Notification');
const AuditLog = require('../server/models/AuditLog');

const {
  api, check, registerUser, report, setBase
} = require('./lib/e2e-harness');

const register = registerUser;

const cookieFor = (userId) => `jwt=${jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  // Text search needs the schema's text index; on a fresh database it is built
  // asynchronously after the model is first used.
  await Post.init();

  const ada = await register('ada');
  const ben = await register('ben');
  const cody = await register('cody');

  try {
    await scenarios({ ada, ben, cody });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

async function scenarios(ctx) {
  const { ada, ben, cody } = ctx;

  // ── auth ──────────────────────────────────────────────────────────────────
  console.log('\n[auth lifecycle]');
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { username: 'dee', email: 'dee@example.com', password: 'password123' }
  });
  check('register returns 201 with a session cookie', () => {
    assert.equal(reg.status, 201);
    assert.match(reg.setCookie.join(';'), /jwt=/);
    // The account owner may see their own email; the hash never leaves the DB.
    assert.equal(reg.data.user.email, 'dee@example.com');
    assert.equal(reg.data.user.passwordHash, undefined);
  });
  check('session cookie is HttpOnly', () =>
    assert.match(reg.setCookie.join(';'), /HttpOnly/i));

  const dupName = await api('/api/auth/register', {
    method: 'POST',
    body: { username: 'ada', email: 'other@example.com', password: 'password123' }
  });
  check('duplicate username is rejected', () => assert.equal(dupName.status, 409));

  const dupEmail = await api('/api/auth/register', {
    method: 'POST',
    body: { username: 'zeta', email: 'ada@example.com', password: 'password123' }
  });
  check('duplicate email is rejected', () => assert.equal(dupEmail.status, 409));

  const shortPw = await api('/api/auth/register', {
    method: 'POST',
    body: { username: 'epsilon', email: 'epsilon@example.com', password: 'short' }
  });
  check('short password is rejected', () => assert.equal(shortPw.status, 400));

  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'wrong-password' }
  });
  check('wrong password is 401', () => assert.equal(badLogin.status, 401));

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'ADA@example.com', password: 'password123' }
  });
  check('login is case-insensitive on email', () => {
    assert.equal(login.status, 200);
    assert.equal(login.data.user.username, 'ada');
  });

  const me = await api('/api/auth/me', { cookie: ada.cookie });
  check('GET /auth/me returns the session user', () => {
    assert.equal(me.status, 200);
    assert.equal(me.data.user.username, 'ada');
    assert.equal(me.data.user.passwordHash, undefined);
  });
  const meAnon = await api('/api/auth/me');
  check('unauthenticated /auth/me is 401', () => assert.equal(meAnon.status, 401));

  const bearerOnly = await api('/api/auth/me', { token: ada.token });
  check('Bearer alone does not authenticate REST (cookie-only)', () =>
    assert.equal(bearerOnly.status, 401));

  const profile = await api('/api/auth/profile', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { bio: '  Main: Valorant  ', preferredPlatforms: ['PC', 'Xbox'] }
  });
  check('profile update succeeds', () => assert.equal(profile.status, 200, JSON.stringify(profile.data)));
  const meAfter = await api('/api/auth/me', { cookie: ada.cookie });
  check('bio is trimmed and platforms persist', () => {
    assert.equal(meAfter.data.user.bio, 'Main: Valorant');
    assert.deepEqual(meAfter.data.user.preferredPlatforms, ['PC', 'Xbox']);
  });

  const badPlatform = await api('/api/auth/profile', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { preferredPlatforms: ['PC', 'Dreamcast'] }
  });
  check('unknown platform is rejected on profile update', () =>
    assert.equal(badPlatform.status, 400));

  const logout = await api('/api/auth/logout', { method: 'POST', cookie: ada.cookie });
  check('logout clears the jwt cookie', () => {
    assert.equal(logout.status, 200);
    assert.match(logout.setCookie.join(';'), /jwt=;/);
    assert.match(logout.setCookie.join(';'), /1970/);
  });

  // ── post lifecycle ────────────────────────────────────────────────────────
  console.log('\n[post lifecycle]');
  const created = await api('/api/posts', {
    method: 'POST',
    cookie: ada.cookie,
    body: {
      title: 'Quantum build guide',
      content: 'Frame pacing\u0000 notes for the quantum setup',
      tags: ['FPS', '#FPS', ' fps ', 'RPG']
    }
  });
  check('post is created', () => assert.equal(created.status, 201, JSON.stringify(created.data)));
  check('tags are normalised and deduped', () =>
    assert.deepEqual(created.data.tags, ['fps', 'rpg']));
  check('control characters are stripped from the body', () =>
    assert.equal(created.data.content, 'Frame pacing notes for the quantum setup'));

  const postId = created.data._id;
  const edited = await api(`/api/posts/${postId}`, {
    method: 'PUT',
    cookie: ada.cookie,
    body: { title: 'Quantum build guide v2' }
  });
  check('author edits within the 5 minute window', () => {
    assert.equal(edited.status, 200);
    assert.equal(edited.data.title, 'Quantum build guide v2');
  });

  const editOther = await api(`/api/posts/${postId}`, {
    method: 'PUT',
    cookie: ben.cookie,
    body: { title: 'hijacked' }
  });
  check('non-author cannot edit a post', () => assert.equal(editOther.status, 403));

  const deleteOther = await api(`/api/posts/${postId}`, { method: 'DELETE', cookie: ben.cookie });
  check('non-author cannot delete a post', () => assert.equal(deleteOther.status, 403));

  // `createdAt` is immutable in the Mongoose schema, so age the document
  // through the driver to simulate an old post.
  await Post.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(postId) },
    { $set: { createdAt: new Date(Date.now() - 10 * 60_000) } }
  );
  const lateEdit = await api(`/api/posts/${postId}`, {
    method: 'PUT',
    cookie: ada.cookie,
    body: { title: 'too late' }
  });
  check('editing after 5 minutes is rejected', () => assert.equal(lateEdit.status, 403));

  // ── likes (Redis disabled) ────────────────────────────────────────────────
  console.log('\n[likes — memory/direct path]');
  check('Redis client is disabled', () => {
    assert.equal(getRedis(), null);
    assert.equal(isConfigured(), false);
  });
  check('flush worker is not started without Redis', () => assert.equal(startLikeFlushWorker(), null));
  const flushed = await flushLikeBuffer();
  check('flushing an absent buffer writes nothing', () => assert.equal(flushed, 0));

  const like1 = await api(`/api/posts/${postId}/like`, { method: 'POST', cookie: ben.cookie });
  check('like is written directly (no buffering)', () => {
    assert.equal(like1.status, 200);
    assert.equal(like1.data.liked, true);
    assert.equal(like1.data.buffered, undefined);
    assert.equal(like1.data.likeCount, 1);
  });
  const stored = await Post.findById(postId).select('likes likeCount').lean();
  check('like is durable immediately', () => {
    assert.equal(stored.likes.length, 1);
    assert.equal(stored.likeCount, 1);
  });

  const unlike1 = await api(`/api/posts/${postId}/like`, { method: 'POST', cookie: ben.cookie });
  check('second click unlikes and never goes negative', () => {
    assert.equal(unlike1.data.liked, false);
    assert.equal(unlike1.data.likeCount, 0);
  });

  const cyLike = await api(`/api/posts/${postId}/like`, { method: 'POST', cookie: cody.cookie });
  check('another user can like the same post', () => {
    assert.equal(cyLike.data.liked, true);
    assert.equal(cyLike.data.likeCount, 1);
  });

  const badLike = await api('/api/posts/not-an-id/like', { method: 'POST', cookie: ben.cookie });
  check('invalid post id is a 400', () => assert.equal(badLike.status, 400));
  const missingLike = await api(`/api/posts/${new mongoose.Types.ObjectId()}/like`, {
    method: 'POST',
    cookie: ben.cookie
  });
  check('liking a missing post is a 404', () => assert.equal(missingLike.status, 404));

  const likeAnon = await api(`/api/posts/${postId}/like`, { method: 'POST' });
  check('liking requires authentication', () => assert.equal(likeAnon.status, 401));

  const feed = await api('/api/posts?sort=most_liked&limit=10');
  check('feed exposes the stored likeCount', () => {
    const row = feed.data.find((p) => p._id === postId);
    assert.ok(row, 'post missing from feed');
    assert.equal(row.likeCount, 1);
  });

  // ── viral medal at 10 likes ───────────────────────────────────────────────
  const hash = await bcrypt.hash('password123', 4);
  const voters = await User.insertMany(
    Array.from({ length: 10 }, (_, i) => ({
      username: `voter${i}`,
      email: `voter${i}@example.com`,
      passwordHash: hash
    }))
  );
  const viralPost = await api('/api/posts', {
    method: 'POST',
    cookie: ada.cookie,
    body: { title: 'Ten likes please', content: 'viral test', tags: ['fps'] }
  });
  const xpBefore = (await User.findById(ada.id).select('xp').lean()).xp;
  for (const voter of voters) {
    const res = await api(`/api/posts/${viralPost.data._id}/like`, {
      method: 'POST',
      cookie: cookieFor(voter._id)
    });
    assert.equal(res.status, 200, `voter like failed: ${JSON.stringify(res.data)}`);
  }
  const viralDoc = await Post.findById(viralPost.data._id).select('likeCount likes').lean();
  check('ten distinct likes are counted exactly once each', () => {
    assert.equal(viralDoc.likeCount, 10);
    assert.equal(viralDoc.likes.length, 10);
  });
  // awardXp is fire-and-forget on the like path; give it a beat to land.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const adaAfter = await User.findById(ada.id).select('xp medals').lean();
  check('viral_gamer medal is awarded at ten likes', () => {
    assert.ok(adaAfter.medals.some((m) => m.id === 'viral_gamer'), JSON.stringify(adaAfter.medals));
    assert.equal(adaAfter.xp, xpBefore + 50);
  });

  // ── feed modes ────────────────────────────────────────────────────────────
  console.log('\n[feed modes]');
  const emptyFollowing = await api('/api/posts?feed=following', { cookie: cody.cookie });
  check('following feed is empty before following anyone', () =>
    assert.deepEqual(emptyFollowing.data, []));

  await api(`/api/users/${ada.username}/follow`, { method: 'POST', cookie: cody.cookie });
  const followingFeed = await api('/api/posts?feed=following', { cookie: cody.cookie });
  check('following feed shows the followed author', () => {
    assert.ok(followingFeed.data.length >= 1);
    assert.ok(followingFeed.data.every((p) => p.userId.username === 'ada'));
  });

  const channelFeed = await api('/api/posts?channel=FPS');
  check('channel filter is case-insensitive', () =>
    assert.ok(channelFeed.data.every((p) => p.tags.includes('fps'))));

  const page1 = await api('/api/posts?limit=1&page=1');
  const page2 = await api('/api/posts?limit=1&page=2');
  check('pagination returns distinct rows', () => {
    assert.equal(page1.data.length, 1);
    assert.equal(page2.data.length, 1);
    assert.notEqual(page1.data[0]._id, page2.data[0]._id);
  });

  // ── comments ──────────────────────────────────────────────────────────────
  console.log('\n[comments]');
  const comment = await api(`/api/posts/${postId}/comments`, {
    method: 'POST',
    cookie: cody.cookie,
    body: { text: 'Great guide' }
  });
  check('comment is created and populated', () => {
    assert.equal(comment.status, 201);
    assert.equal(comment.data.text, 'Great guide');
    assert.equal(comment.data.userId.username, 'cody');
  });
  const commentId = comment.data._id;

  const postAfterComment = await api(`/api/posts/${postId}`);
  check('commentCount is incremented', () => assert.equal(postAfterComment.data.commentCount, 1));

  const emptyComment = await api(`/api/posts/${postId}/comments`, {
    method: 'POST',
    cookie: cody.cookie,
    body: { text: '   ' }
  });
  check('empty comment is rejected', () => assert.equal(emptyComment.status, 400));

  const ghostComment = await api(`/api/posts/${new mongoose.Types.ObjectId()}/comments`, {
    method: 'POST',
    cookie: cody.cookie,
    body: { text: 'ghost' }
  });
  check('comment on a missing post is a 404', () => assert.equal(ghostComment.status, 404));

  const list = await api(`/api/posts/${postId}/comments`);
  check('comments are listed oldest first', () => {
    assert.equal(list.status, 200);
    assert.equal(list.data[0].text, 'Great guide');
  });

  const editComment = await api(`/api/posts/${postId}/comments/${commentId}`, {
    method: 'PUT',
    cookie: ben.cookie,
    body: { text: 'hijack' }
  });
  check('only the comment author can edit it', () => assert.equal(editComment.status, 403));

  const ownEdit = await api(`/api/posts/${postId}/comments/${commentId}`, {
    method: 'PUT',
    cookie: cody.cookie,
    body: { text: 'Great guide, thanks!' }
  });
  check('comment author can edit', () => assert.equal(ownEdit.status, 200));

  await new Promise((resolve) => setTimeout(resolve, 400));
  const cyUser = await User.findById(cody.id).select('xp medals').lean();
  check('first comment awards the gamer_critic medal', () => {
    assert.ok(cyUser.medals.some((m) => m.id === 'gamer_critic'));
  });

  // ── bookmarks ─────────────────────────────────────────────────────────────
  console.log('\n[bookmarks & favourites]');
  const saved = await api(`/api/users/saved/${postId}`, { method: 'POST', cookie: ben.cookie });
  check('post is bookmarked', () => assert.deepEqual(saved.data, { saved: true, postId }));

  const savedList = await api('/api/users/me/saved', { cookie: ben.cookie });
  check('bookmark appears in the saved list', () => {
    assert.equal(savedList.status, 200);
    assert.ok(savedList.data.some((p) => p._id === postId));
  });

  const unsaved = await api(`/api/users/saved/${postId}`, { method: 'POST', cookie: ben.cookie });
  check('second toggle removes the bookmark', () => assert.equal(unsaved.data.saved, false));

  const fav = await api('/api/users/channels/favourite', {
    method: 'POST',
    cookie: ben.cookie,
    body: { channel: ' FPS ' }
  });
  check('favourite channel is normalised', () => {
    assert.equal(fav.status, 200);
    assert.deepEqual(fav.data.favoriteChannels, ['fps']);
  });

  const favBad = await api('/api/users/channels/favourite', {
    method: 'POST',
    cookie: ben.cookie,
    body: {}
  });
  check('favourite channel without a name is a 400', () => assert.equal(favBad.status, 400));

  // ── follow graph ──────────────────────────────────────────────────────────
  console.log('\n[follow graph]');
  const follow = await api(`/api/users/${ada.username}/follow`, {
    method: 'POST',
    cookie: ben.cookie
  });
  check('follow toggles on', () => {
    assert.equal(follow.status, 200);
    assert.equal(follow.data.following, true);
    assert.ok(follow.data.followers.some((f) => f.username === 'ben'));
  });

  const selfFollow = await api(`/api/users/${ben.username}/follow`, {
    method: 'POST',
    cookie: ben.cookie
  });
  check('following yourself is rejected', () => assert.equal(selfFollow.status, 400));

  const adaProfile = await api(`/api/users/${ada.username}`, { cookie: ben.cookie });
  check('profile reports the viewer relationship', () => {
    assert.equal(adaProfile.data.isFollowing, true);
    assert.equal(adaProfile.data.postCount >= 2, true);
  });
  check('public profile hides private collections and credentials', () => {
    for (const field of ['savedPosts', 'favoriteChannels', 'preferences', 'email', 'passwordHash']) {
      assert.equal(adaProfile.data[field], undefined, `${field} leaked`);
    }
  });

  const unfollow = await api(`/api/users/${ada.username}/follow`, {
    method: 'POST',
    cookie: ben.cookie
  });
  check('follow toggles off', () => assert.equal(unfollow.data.following, false));

  const followMissing = await api('/api/users/nobody/follow', {
    method: 'POST',
    cookie: ben.cookie
  });
  check('following a missing user is a 404', () => assert.equal(followMissing.status, 404));

  // ── gamer passport ────────────────────────────────────────────────────────
  console.log('\n[gamer passport]');
  const passport = await api('/api/users/me/passport', {
    method: 'PUT',
    cookie: ada.cookie,
    body: {
      customQuote: 'Q'.repeat(200),
      gameIds: { riotId: 'Ada#EUW', steamId: ' 7656119 ' },
      activeGames: [
        { gameName: 'Valorant', platform: 'PC', rankOrLevel: 'Immortal' },
        { gameName: 'Halo', platform: 'Atari', rankOrLevel: '1' }
      ],
      hardwareRigs: [
        { rigName: 'Main', deviceType: 'PC', specs: { cpu: 'Ryzen 7', gpu: 'RTX 4070' } },
        { rigName: 'Backup', deviceType: 'Laptop', isPrimary: true }
      ]
    }
  });
  check('passport update succeeds', () => assert.equal(passport.status, 200, JSON.stringify(passport.data)));
  check('quote is capped at 120 characters', () =>
    assert.equal(passport.data.customQuote.length, 120));
  check('game ids are trimmed', () =>
    assert.equal(passport.data.gameIds.steamId, '7656119'));
  check('unknown platforms fall back to PC', () =>
    assert.equal(passport.data.activeGames[1].platform, 'PC'));
  check('exactly one rig is primary', () => {
    const primaries = passport.data.hardwareRigs.filter((r) => r.isPrimary);
    assert.equal(primaries.length, 1);
    assert.equal(primaries[0].rigName, 'Backup');
  });

  const manyGames = await api('/api/users/me/passport', {
    method: 'PUT',
    cookie: ben.cookie,
    body: { activeGames: Array.from({ length: 14 }, (_, i) => ({ gameName: `Game ${i}` })) }
  });
  check('active games are capped at ten', () =>
    assert.equal(manyGames.data.activeGames.length, 10));

  const noPrimary = await api('/api/users/me/passport', {
    method: 'PUT',
    cookie: cody.cookie,
    body: { hardwareRigs: [{ rigName: 'Only' }, { rigName: 'Second' }] }
  });
  check('first rig becomes primary when none is flagged', () =>
    assert.equal(noPrimary.data.hardwareRigs[0].isPrimary, true));

  // ── preferences & presence ────────────────────────────────────────────────
  console.log('\n[preferences & presence]');
  const prefs = await api('/api/users/me/preferences', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: {
      favoriteGames: ['Elden Ring', 'Elden Ring', 'Halo'],
      favoriteGenres: ['Soulslike'],
      platforms: ['PC', 'Xbox']
    }
  });
  check('preferences save and dedupe', () => {
    assert.equal(prefs.status, 200);
    assert.deepEqual(prefs.data.preferences.favoriteGames, ['Elden Ring', 'Halo']);
  });

  const badPrefs = await api('/api/users/me/preferences', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { platforms: ['PC', 'Dreamcast'] }
  });
  check('unknown platform is rejected', () => assert.equal(badPrefs.status, 400));

  const emptyPrefs = await api('/api/users/me/preferences', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: {}
  });
  check('empty preference payload is rejected', () => assert.equal(emptyPrefs.status, 400));

  const badPresence = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { status: 'sleeping' }
  });
  check('unknown presence status is rejected', () => assert.equal(badPresence.status, 400));

  const gameMissing = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { status: 'in_game' }
  });
  check('in_game requires an active game', () => assert.equal(gameMissing.status, 400));

  const inGame = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { status: 'in_game', activeGame: 'Valorant' }
  });
  check('in_game presence is stored', () => {
    assert.equal(inGame.status, 200);
    assert.equal(inGame.data.presence.activeGame, 'Valorant');
  });

  const invisible = await api('/api/users/presence', {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { status: 'invisible' }
  });
  check('invisible presence is accepted', () => assert.equal(invisible.status, 200));
  const adaAsBen = await api(`/api/users/${ada.username}`, { cookie: ben.cookie });
  check('invisible is projected as offline to other users', () =>
    assert.equal(adaAsBen.data.presence.status, 'offline'));
  // The public profile endpoint masks presence for every viewer; the owner's
  // own raw choice travels on the session document instead.
  const mePresence = await api('/api/auth/me', { cookie: ada.cookie });
  check('the session carries the owner\'s raw presence', () =>
    assert.equal(mePresence.data.user.presence.status, 'invisible'));

  // ── search ────────────────────────────────────────────────────────────────
  console.log('\n[search]');
  const shortQuery = await api('/api/users/search?q=a');
  check('one-character search is rejected', () => assert.equal(shortQuery.status, 400));

  const search = await api('/api/users/search?q=quantum');
  check('unified search returns matching posts', () => {
    assert.equal(search.status, 200);
    assert.ok(search.data.posts.some((p) => p.title.includes('Quantum')));
  });

  const userSearch = await api('/api/users/search?q=ad');
  check('username prefix search finds the user', () =>
    assert.ok(userSearch.data.users.some((u) => u.username === 'ada')));
  check('user search leaks no email', () =>
    assert.equal(JSON.stringify(userSearch.data.users).includes('@example.com'), false));

  const tagSuggest = await api('/api/posts/tags/suggest?q=fp');
  check('tag autocomplete matches the prefix', () =>
    assert.ok(tagSuggest.data.some((t) => t.tag === 'fps' && t.count >= 1)));

  const tagEmpty = await api('/api/posts/tags/suggest?q=');
  check('empty tag query returns an empty list', () => assert.deepEqual(tagEmpty.data, []));

  const injection = await api('/api/posts/tags/suggest?q=.*');
  check('tag autocomplete escapes regex metacharacters', () => assert.equal(injection.status, 200));

  // ── communities ───────────────────────────────────────────────────────────
  console.log('\n[communities]');
  const communityRes = await api('/api/communities', {
    method: 'POST',
    cookie: ada.cookie,
    body: { name: 'Phase6 Guild', description: 'testing', icon: '🛠️' }
  });
  check('community is created with an owner role', () => {
    assert.equal(communityRes.status, 201, JSON.stringify(communityRes.data));
    assert.equal(communityRes.data.callerRole, 'owner');
  });
  const communityId = communityRes.data._id;
  const slug = communityRes.data.slug;

  const detail = await api(`/api/communities/${slug}`, { cookie: ada.cookie });
  check('new community has a general channel', () => {
    assert.equal(detail.status, 200);
    assert.ok(detail.data.channels.some((c) => c.name === 'general'));
  });
  const generalId = detail.data.channels.find((c) => c.name === 'general')._id;

  const listed = await api('/api/communities', { cookie: ben.cookie });
  check('community appears in the public list with a member count', () => {
    const row = listed.data.find((c) => c.slug === slug);
    assert.ok(row);
    assert.equal(row.memberCount, 1);
  });

  const join = await api(`/api/communities/${communityId}/join`, {
    method: 'POST',
    cookie: ben.cookie
  });
  check('public community can be joined', () => {
    assert.equal(join.status, 200);
    assert.equal(join.data.role, 'member');
  });

  const joinAgain = await api(`/api/communities/${communityId}/join`, {
    method: 'POST',
    cookie: ben.cookie
  });
  check('joining twice is a 400', () => assert.equal(joinAgain.status, 400));

  const channel = await api(`/api/communities/${communityId}/channels`, {
    method: 'POST',
    cookie: ada.cookie,
    body: { name: 'lounge', topic: 'chill' }
  });
  check('channel is created', () => assert.equal(channel.status, 201));
  const channelId = channel.data._id;

  const retopic = await api(`/api/communities/${communityId}/channels/${channelId}`, {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { topic: 'chill & hang out' }
  });
  check('channel topic can be updated', () => {
    assert.equal(retopic.status, 200);
    assert.equal(retopic.data.topic, 'chill & hang out');
  });

  const noFields = await api(`/api/communities/${communityId}/channels/${channelId}`, {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { name: 'ignored' }
  });
  check('an update with no known fields is a 400', () => assert.equal(noFields.status, 400));

  const slowBad = await api(`/api/communities/${communityId}/channels/${channelId}`, {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { slowModeSeconds: 999 }
  });
  check('slowmode above the cap is rejected', () => assert.equal(slowBad.status, 400));

  const slowOk = await api(`/api/communities/${communityId}/channels/${channelId}`, {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { slowModeSeconds: 30 }
  });
  const afterSlow = await api(`/api/communities/${slug}`, { cookie: ada.cookie });
  check('slowmode accepts a valid value', () => {
    assert.equal(slowOk.status, 200);
    assert.equal(
      afterSlow.data.channels.find((c) => c._id === channelId).slowModeSeconds,
      30
    );
  });

  await Message.insertMany(
    Array.from({ length: 3 }, (_, i) => ({
      channelId,
      communityId,
      senderId: ada.id,
      text: `history ${i}`
    }))
  );
  const history1 = await api(`/api/communities/channels/${channelId}/messages?limit=2`, {
    cookie: ben.cookie
  });
  check('channel history is cursor-paginated', () => {
    assert.equal(history1.status, 200);
    assert.equal(history1.data.messages.length, 2);
    assert.equal(history1.data.hasMore, true);
    assert.equal(history1.data.messages[1].text, 'history 2');
  });
  const oldest = history1.data.messages[0]._id;
  const history2 = await api(
    `/api/communities/channels/${channelId}/messages?limit=2&before=${oldest}`,
    { cookie: ben.cookie }
  );
  check('older messages load from the cursor', () => {
    assert.equal(history2.data.messages.length, 1);
    assert.equal(history2.data.messages[0].text, 'history 0');
    assert.equal(history2.data.hasMore, false);
  });
  const badCursor = await api(
    `/api/communities/channels/${channelId}/messages?before=not-an-id`,
    { cookie: ben.cookie }
  );
  check('invalid history cursor is a 400', () => assert.equal(badCursor.status, 400));

  const outsiderHistory = await api(`/api/communities/channels/${channelId}/messages`, {
    cookie: cody.cookie
  });
  check('non-members cannot read channel history', () => assert.equal(outsiderHistory.status, 403));

  const audit = await api(`/api/communities/${communityId}/audit`, { cookie: ada.cookie });
  check('audit log records the channel work', () => {
    assert.equal(audit.status, 200);
    const types = new Set(audit.data.entries.map((e) => e.actionType));
    assert.ok(types.has('CHANNEL_CREATE'), JSON.stringify([...types]));
  });
  const auditWrite = await api(`/api/communities/${communityId}/audit`, {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { actionType: 'FORGED' }
  });
  check('audit log has no write route', () => assert.equal(auditWrite.status, 404));

  const forbiddenChannel = await api(`/api/communities/${communityId}/channels`, {
    method: 'POST',
    cookie: cody.cookie,
    body: { name: 'intruder' }
  });
  check('non-members cannot create channels', () => assert.equal(forbiddenChannel.status, 403));

  const leave = await api(`/api/communities/${communityId}/leave`, {
    method: 'POST',
    cookie: ben.cookie
  });
  check('member can leave', () => assert.equal(leave.status, 200));

  const deleteByMember = await api(`/api/communities/${communityId}`, {
    method: 'DELETE',
    cookie: cody.cookie
  });
  check('only the owner can delete a community', () => assert.equal(deleteByMember.status, 403));

  // ── notifications ─────────────────────────────────────────────────────────
  console.log('\n[notifications]');
  const leaderNotifs = await api('/api/notifications?limit=2', { cookie: ada.cookie });
  check('notification list is cursor-shaped', () => {
    assert.equal(leaderNotifs.status, 200);
    assert.ok(Array.isArray(leaderNotifs.data.items));
    assert.equal(typeof leaderNotifs.data.unreadCount, 'number');
    assert.equal(leaderNotifs.data.hasMore, false);
  });

  await Notification.insertMany(
    ['first', 'second', 'third'].map((title, i) => ({
      userId: ada.id,
      title,
      message: title,
      createdAt: new Date(Date.now() - i * 1000)
    }))
  );

  const pageOne = await api('/api/notifications?limit=2', { cookie: ada.cookie });
  check('first notification page exposes a cursor', () => {
    assert.equal(pageOne.data.items.length, 2);
    assert.equal(pageOne.data.hasMore, true);
    assert.ok(pageOne.data.nextCursor);
  });
  const pageTwo = await api(
    `/api/notifications?limit=2&before=${encodeURIComponent(pageOne.data.nextCursor)}`,
    { cookie: ada.cookie }
  );
  check('second page continues without overlap', () => {
    const firstIds = new Set(pageOne.data.items.map((n) => String(n._id)));
    assert.equal(pageTwo.data.items.length >= 1, true);
    assert.equal(pageTwo.data.items.some((n) => firstIds.has(String(n._id))), false);
  });

  const badCursorNotif = await api('/api/notifications?before=garbage', { cookie: ada.cookie });
  check('invalid notification cursor is a 400', () => assert.equal(badCursorNotif.status, 400));

  const unreadOnly = await api('/api/notifications?unread=1&limit=50', { cookie: ada.cookie });
  check('unread filter returns only unread pings', () =>
    assert.ok(unreadOnly.data.items.every((n) => n.read === false)));

  const target = unreadOnly.data.items[0];
  const readOne = await api(`/api/notifications/${target._id}/read`, {
    method: 'PATCH',
    cookie: ada.cookie
  });
  check('marking one notification read lowers the badge', () =>
    assert.equal(readOne.data.unreadCount, unreadOnly.data.unreadCount - 1));

  const foreignRead = await api(`/api/notifications/${target._id}/read`, {
    method: 'PATCH',
    cookie: ben.cookie
  });
  check('another user cannot mark my notification', () => assert.equal(foreignRead.status, 404));

  const readAll = await api('/api/notifications/read-all', { method: 'POST', cookie: ada.cookie });
  check('mark-all-read clears the badge', () => assert.equal(readAll.data.unreadCount, 0));

  // ── LFG ───────────────────────────────────────────────────────────────────
  console.log('\n[lfg board]');
  const party = await api('/api/lfg', {
    method: 'POST',
    cookie: ada.cookie,
    body: {
      gameTitle: 'Valorant',
      activity: 'Ranked climb',
      maxSlots: 2,
      requirements: { minRank: 'Gold', micRequired: true }
    }
  });
  check('squad is created', () => assert.equal(party.status, 201, JSON.stringify(party.data)));
  check('expiry is six hours out', () => {
    const hours = (new Date(party.data.expiresAt) - Date.now()) / 3_600_000;
    assert.ok(hours > 5.9 && hours <= 6.01, `got ${hours}h`);
  });
  check('leader occupies one slot', () => {
    assert.equal(party.data.openSlots, 1);
    assert.equal(party.data.members.length, 1);
  });
  const partyId = party.data._id;

  const badSlots = await api('/api/lfg', {
    method: 'POST',
    cookie: ada.cookie,
    body: { gameTitle: 'Valorant', maxSlots: 9 }
  });
  check('out-of-range squad size is rejected', () => assert.equal(badSlots.status, 400));

  const missingGame = await api('/api/lfg', {
    method: 'POST',
    cookie: ada.cookie,
    body: { maxSlots: 4 }
  });
  check('squad without a game is rejected', () => assert.equal(missingGame.status, 400));

  const board = await api('/api/lfg?game=valo&mic=1&openSlots=1');
  check('board filters by game, mic and open slots', () =>
    assert.ok(board.data.items.some((p) => p._id === partyId)));

  const request = await api(`/api/lfg/${partyId}/request`, {
    method: 'POST',
    cookie: ben.cookie,
    body: { message: 'I can play' }
  });
  check('join request is accepted', () => assert.equal(request.status, 200));

  const duplicateRequest = await api(`/api/lfg/${partyId}/request`, {
    method: 'POST',
    cookie: ben.cookie,
    body: {}
  });
  check('duplicate join request is a 409', () => assert.equal(duplicateRequest.status, 409));

  const leaderRequest = await api(`/api/lfg/${partyId}/request`, {
    method: 'POST',
    cookie: ada.cookie
  });
  check('the leader cannot request their own squad', () => assert.equal(leaderRequest.status, 409));

  const leaderView = await api(`/api/lfg/${partyId}`, { cookie: ada.cookie });
  check('requests are visible to the leader only', () => {
    assert.equal(leaderView.data.requestCount, 1);
    assert.equal(leaderView.data.requests[0].user.username, 'ben');
  });
  const applicantView = await api(`/api/lfg/${partyId}`, { cookie: ben.cookie });
  check('applicants cannot see the request queue', () =>
    assert.equal(applicantView.data.requests, undefined));

  const benId = ben.id;
  const respondByApplicant = await api(`/api/lfg/${partyId}/respond`, {
    method: 'PATCH',
    cookie: ben.cookie,
    body: { userId: benId, action: 'accept' }
  });
  check('only the leader can respond to requests', () =>
    assert.equal(respondByApplicant.status, 403));

  const accepted = await api(`/api/lfg/${partyId}/respond`, {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { userId: benId, action: 'accept' }
  });
  check('leader accepts the request', () => {
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.party.members.length, 2);
    assert.equal(accepted.data.party.openSlots, 0);
  });
  const fullBoard = await api('/api/lfg?openSlots=1&limit=50');
  check('a full squad leaves the open board', () =>
    assert.equal(fullBoard.data.items.some((p) => p._id === partyId), false));

  const acceptNotif = await Notification.findOne({
    userId: ben.id,
    type: 'lfg_accepted'
  }).lean();
  check('acceptance notifies the applicant', () => assert.ok(acceptNotif));

  const rejectParty = await api('/api/lfg', {
    method: 'POST',
    cookie: ada.cookie,
    body: { gameTitle: 'Apex Legends', maxSlots: 3 }
  });
  await api(`/api/lfg/${rejectParty.data._id}/request`, {
    method: 'POST',
    cookie: cody.cookie
  });
  const rejected = await api(`/api/lfg/${rejectParty.data._id}/respond`, {
    method: 'PATCH',
    cookie: ada.cookie,
    body: { userId: cody.id, action: 'reject' }
  });
  check('leader rejects a request', () => {
    assert.equal(rejected.status, 200);
    assert.equal(rejected.data.party.requestCount, 0);
  });

  const closeByOther = await api(`/api/lfg/${partyId}`, {
    method: 'DELETE',
    cookie: ben.cookie
  });
  check('only the leader can close a squad', () => assert.equal(closeByOther.status, 403));

  const closed = await api(`/api/lfg/${partyId}`, { method: 'DELETE', cookie: ada.cookie });
  check('leader closes the squad', () => assert.equal(closed.status, 200));

  const mine = await api('/api/lfg/mine', { cookie: ada.cookie });
  check('closed squads are excluded from "my squads"', () =>
    assert.equal(mine.data.items.some((p) => p._id === partyId), false));

  // ── game catalog ──────────────────────────────────────────────────────────
  console.log('\n[game catalog]');
  const catalog = await api('/api/games?limit=5');
  check('catalog responds or degrades cleanly', () =>
    assert.ok([200, 503].includes(catalog.status), `got ${catalog.status}`));
  if (catalog.status === 200) {
    check('catalog payload is normalised', () => {
      assert.ok(Array.isArray(catalog.data.games));
      assert.equal(typeof catalog.data.catalogSize, 'number');
    });
    const gameId = catalog.data.games[0]?.id;
    const detailGame = gameId ? await api(`/api/games/${gameId}`) : { status: 0, data: {} };
    check('game detail is served for a catalog id', () => {
      assert.ok(gameId, 'catalog returned no ids');
      assert.equal(detailGame.status, 200);
      assert.equal(String(detailGame.data.id), String(gameId));
    });
  } else {
    // Upstream (FreeToGame) occasionally rate-limits. Assert the documented
    // degraded contract instead of skipping, so the check count is stable.
    check('catalog degrades to a 503 with a safe message', () => {
      assert.equal(catalog.status, 503);
      assert.match(catalog.data.message, /temporarily unavailable/i);
    });
    check('catalog never leaks upstream error details', () =>
      assert.equal(JSON.stringify(catalog.data).includes('FreeToGame'), false));
  }
  const badGame = await api('/api/games/not-a-real-id');
  check('invalid game id is a 400', () => assert.equal(badGame.status, 400));

  // ── admin ─────────────────────────────────────────────────────────────────
  console.log('\n[admin observability]');
  await User.updateOne({ _id: ada.id }, { $set: { role: 'admin' } });

  const healthAsUser = await api('/api/admin/system-health', { cookie: ben.cookie });
  check('non-admins cannot read system health', () => assert.equal(healthAsUser.status, 403));

  const health = await api('/api/admin/system-health', { cookie: ada.cookie });
  check('admin reads system health', () => assert.equal(health.status, 200));
  check('database is reported connected', () =>
    assert.equal(health.data.health.database.connected, true));
  check('Redis is reported disabled, not faked', () =>
    assert.deepEqual(health.data.health.services.redis, {
      configured: false,
      cache: 'memory',
      likeBuffer: 'off'
    }));
  check('secret audit never returns values', () => {
    for (const key of health.data.security.secretIsolation.keys) {
      assert.equal(key.value, undefined, `${key.name} leaked a value`);
      assert.equal(typeof key.configured, 'boolean');
    }
    assert.equal(JSON.stringify(health.data).includes(process.env.JWT_SECRET), false);
  });
  check('collection counts are reported', () =>
    assert.equal(health.data.database.counts.users >= 4, true));

  const metrics = await api('/api/admin/metrics', { cookie: ada.cookie });
  check('metrics endpoint returns a snapshot', () => {
    assert.equal(metrics.status, 200);
    assert.equal(metrics.data.database.connected, true);
  });

  const secondHealth = await api('/api/admin/system-health', { cookie: ada.cookie });
  check('cached health is still correct', () =>
    assert.equal(secondHealth.data.database.counts.posts, health.data.database.counts.posts));

  // ── hardening ─────────────────────────────────────────────────────────────
  console.log('\n[hardening]');
  const unknown = await api('/api/definitely-not-a-route');
  check('unknown API route is a JSON 404', () => {
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.message, 'Endpoint not found');
  });

  const noSql = await api('/api/posts', {
    method: 'POST',
    cookie: ada.cookie,
    body: { title: { $gt: '' }, content: 'injection attempt' }
  });
  check('NoSQL operator in a body field is a 400, not a 500', () =>
    assert.equal(noSql.status, 400));

  const malformed = await api('/api/auth/login', {
    method: 'POST',
    body: '{"email":'
  });
  check('malformed JSON is a 400', () => assert.equal(malformed.status, 400));

  const huge = await api('/api/posts', {
    method: 'POST',
    cookie: ada.cookie,
    body: JSON.stringify({ title: 'huge', content: 'x'.repeat(200_000) })
  });
  check('oversized body is a 413', () => assert.equal(huge.status, 413));

  const evilOrigin = await api('/api/posts?limit=1', { origin: 'https://evil.example' });
  check('unknown origin is blocked', () => assert.equal(evilOrigin.status, 403));

  const goodOrigin = await api('/api/posts?limit=1', { origin: 'http://localhost:3000' });
  check('allow-listed origin is echoed', () =>
    assert.equal(goodOrigin.headers.get('access-control-allow-origin'), 'http://localhost:3000'));

  const healthHeaders = await api('/api/health');
  check('health endpoint reports ok', () => {
    assert.equal(healthHeaders.status, 200);
    assert.equal(healthHeaders.data.status, 'ok');
  });
  check('rate limit headers are present', () => {
    const limit = healthHeaders.headers.get('ratelimit-limit') || healthHeaders.headers.get('ratelimit');
    assert.ok(limit, 'no RateLimit header');
  });

  const protectedMutations = [
    ['POST', '/api/posts', { title: 'x' }],
    ['POST', `/api/posts/${postId}/like`],
    ['POST', `/api/posts/${postId}/comments`, { text: 'x' }],
    ['POST', `/api/users/${ada.username}/follow`],
    ['POST', `/api/users/saved/${postId}`],
    ['POST', '/api/lfg', { gameTitle: 'x', maxSlots: 3 }],
    ['POST', '/api/communities', { name: 'x' }],
    ['PATCH', '/api/notifications/507f1f77bcf86cd799439011/read'],
    ['GET', '/api/admin/system-health']
  ];
  const unauth = [];
  for (const [method, path, body] of protectedMutations) {
    const res = await api(path, { method, body });
    if (res.status !== 401) unauth.push(`${method} ${path} -> ${res.status}`);
  }
  check('every protected mutation rejects anonymous callers', () => assert.deepEqual(unauth, []));

  // ── delete cascade ────────────────────────────────────────────────────────
  console.log('\n[delete cascade]');
  await api(`/api/users/saved/${postId}`, { method: 'POST', cookie: ben.cookie });
  const commentsBefore = await Comment.countDocuments({ postId });
  check('post has comments before deletion', () => assert.equal(commentsBefore >= 1, true));
  const del = await api(`/api/posts/${postId}`, { method: 'DELETE', cookie: ada.cookie });
  check('author deletes the post', () => assert.equal(del.status, 200));
  const commentsAfter = await Comment.countDocuments({ postId });
  check('comments are deleted with the post', () => assert.equal(commentsAfter, 0));
  const savedAfterDelete = await api('/api/users/me/saved', { cookie: ben.cookie });
  check('deleted posts vanish from saved lists', () =>
    assert.equal(savedAfterDelete.data.some((p) => p._id === postId), false));

  // ── community teardown ────────────────────────────────────────────────────
  const delCommunity = await api(`/api/communities/${communityId}`, {
    method: 'DELETE',
    cookie: ada.cookie
  });
  check('owner deletes the community', () => assert.equal(delCommunity.status, 200));
  const gone = await api(`/api/communities/${slug}`);
  check('deleted community is no longer reachable', () => assert.equal(gone.status, 404));
  const channelCount = await Channel.countDocuments({ communityId });
  check('channels are cleaned up', () => assert.equal(channelCount, 0));
  const auditCount = await AuditLog.countDocuments({ communityId });
  check('audit rows are cleaned up with the community', () => assert.equal(auditCount, 0));

  // ── cache layer (L1 only) ─────────────────────────────────────────────────
  console.log('\n[cache without Redis]');
  resetCacheLayer();
  let loads = 0;
  const load = async () => {
    loads += 1;
    return { value: loads };
  };
  await cacheWrap('probe:one', load, 60);
  const second = await cacheWrap('probe:one', load, 60);
  check('second read is served from memory', () => {
    assert.equal(loads, 1);
    assert.equal(second.value, 1);
  });

  resetCacheLayer();
  let concurrentLoads = 0;
  await Promise.all(
    Array.from({ length: 5 }, () =>
      cacheWrap('probe:two', async () => {
        concurrentLoads += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true };
      }, 60)
    )
  );
  check('concurrent misses collapse into one load', () => assert.equal(concurrentLoads, 1));

  resetCacheLayer();
  let failing = 0;
  await assert.rejects(
    cacheWrap('probe:three', async () => {
      failing += 1;
      throw new Error('loader failed');
    }, 60),
    /loader failed/
  );
  await cacheWrap('probe:three', async () => {
    failing += 1;
    return 'recovered';
  }, 60);
  check('a failed load is never cached', () => assert.equal(failing, 2));

  const connected = await Community.findById(communityId).lean();
  check('teardown left no community document', () => assert.equal(connected, null));
}

run().catch((err) => {
  console.error('\nE2E phase 6 failed:', err);
  process.exit(1);
});
