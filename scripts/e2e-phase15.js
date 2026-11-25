/**
 * Phase 15 end-to-end verification — catalog, admin console and media ledger.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase15.js
 *
 * Provider calls are avoided: games are seeded directly, so the suite proves
 * the product surfaces without depending on FreeToGame's uptime.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e15_${Date.now().toString(36)}`;

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
process.env.CATALOG_RATE_LIMIT_MAX = '10000';
process.env.ADMIN_RATE_LIMIT_MAX = '10000';
process.env.EMAIL_TRANSPORT = 'memory';
process.env.DISABLE_RETENTION_WORKER = '1';
process.env.REDIS_ENABLED = '0';
process.env.MEDIA_ENV = 'test';
delete process.env.SENTRY_DSN;

const connectDB = require('../server/config/db');
const app = require('../server/app');

const User = require('../server/models/User');
const Post = require('../server/models/Post');
const Community = require('../server/models/Community');
const Channel = require('../server/models/Channel');
const Message = require('../server/models/Message');
const Report = require('../server/models/Report');
const DmReport = require('../server/models/DmReport');
const Game = require('../server/models/Game');
const MediaAsset = require('../server/models/MediaAsset');

const { api, check, report, setBase, registerUser } = require('./lib/e2e-harness');

const gameDoc = (title, slug, extra = {}) => ({
  slug,
  title,
  key: title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim(),
  summary: `${title} summary`,
  genres: ['Shooter'],
  platforms: ['PC'],
  releaseYear: 2024,
  status: 'published',
  source: 'seed',
  stats: { favoriteCount: 0 },
  ...extra,
});

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  try {
    const alice = await registerUser('alice15');
    const bob = await registerUser('bob15');
    const admin = await registerUser('admin15');
    const moderator = await registerUser('mod15');

    const aliceMe = await api('/api/auth/me', { cookie: alice.cookie });
    const bobMe = await api('/api/auth/me', { cookie: bob.cookie });
    const adminMe = await api('/api/auth/me', { cookie: admin.cookie });
    const modMe = await api('/api/auth/me', { cookie: moderator.cookie });

    const aliceId = aliceMe.data.user._id;
    const bobId = bobMe.data.user._id;
    const adminId = adminMe.data.user._id;

    await User.updateOne(
      { _id: adminId },
      { $set: { role: 'admin', emailVerifiedAt: new Date() } },
    );
    await User.updateOne(
      { _id: modMe.data.user._id },
      { $set: { role: 'moderator', emailVerifiedAt: new Date() } },
    );

    const valorant = await Game.create(gameDoc('Valorant', 'valorant', { releaseYear: 2020 }));
    const halo = await Game.create(
      gameDoc('Halo Infinite', 'halo-infinite', {
        releaseYear: 2021,
        genres: ['Shooter', 'Sci-Fi'],
      }),
    );
    await Game.create(
      gameDoc('Stardew Valley', 'stardew-valley', {
        genres: ['Simulation'],
        releaseYear: 2016,
      }),
    );
    await Game.create(gameDoc('Valorant Mobile', 'valorant-mobile', { releaseYear: 2025 }));

    // ── Catalog ─────────────────────────────────────────────────────────────
    const list = await api('/api/games?limit=10');
    check('the catalog lists seeded games with facets', () => {
      assert.equal(list.status, 200, JSON.stringify(list.data));
      assert.equal(list.data.games.length >= 4, true);
      assert.ok(list.data.facets.genres.includes('Shooter'));
      assert.equal(list.data.provider.primary, 'FreeToGame');
    });

    const search = await api('/api/games?q=halo');
    check('catalog search matches a title', () => {
      assert.equal(search.status, 200, JSON.stringify(search.data));
      assert.equal(search.data.games.length, 1);
      assert.equal(search.data.games[0].slug, 'halo-infinite');
    });

    const filtered = await api('/api/games?genre=Simulation');
    check('catalog genre filter narrows results', () => {
      assert.equal(filtered.status, 200);
      assert.equal(filtered.data.games.length, 1);
      assert.equal(filtered.data.games[0].slug, 'stardew-valley');
    });

    const rails = await api('/api/games/rails');
    check('rails return only populated sections', () => {
      assert.equal(rails.status, 200, JSON.stringify(rails.data));
      assert.equal(rails.data.rails.length > 0, true);
      assert.equal(
        rails.data.rails.every((rail) => rail.games.length > 0),
        true,
      );
    });

    const detail = await api('/api/games/valorant');
    check('a game page reports live counters', () => {
      assert.equal(detail.status, 200, JSON.stringify(detail.data));
      assert.equal(detail.data.title, 'Valorant');
      assert.equal(detail.data.following, false);
      assert.equal(detail.data.stats.favoriteCount, 0);
    });

    const followed = await api('/api/games/valorant/follow', {
      method: 'POST',
      cookie: alice.cookie,
    });
    check('following a game updates the user and the counter', () => {
      assert.equal(followed.status, 200, JSON.stringify(followed.data));
      assert.equal(followed.data.following, true);
    });

    const afterFollow = await api('/api/games/valorant', { cookie: alice.cookie });
    check('the game page reflects the follow immediately', () => {
      assert.equal(afterFollow.data.following, true);
      assert.equal(afterFollow.data.stats.favoriteCount, 1);
    });

    const unfollowed = await api('/api/games/valorant/follow', {
      method: 'POST',
      cookie: alice.cookie,
    });
    check('unfollowing removes the game again', () => {
      assert.equal(unfollowed.data.following, false);
    });

    const onboarded = await api('/api/discover/onboarding/complete', {
      method: 'POST',
      cookie: alice.cookie,
      body: { games: ['Halo Infinite'], platforms: ['PC'] },
    });
    check('onboarding creates canonical game links', () => {
      assert.equal(onboarded.status, 200, JSON.stringify(onboarded.data));
      assert.deepEqual(onboarded.data.preferences.favoriteGames, ['Halo Infinite']);
    });

    const haloAfterOnboarding = await api('/api/games/halo-infinite');
    check('the onboarding choice increments the canonical counter', () => {
      assert.equal(haloAfterOnboarding.data.stats.favoriteCount, 1);
    });

    // ── Admin access control ────────────────────────────────────────────────
    const denied = await api('/api/admin/users', { cookie: alice.cookie });
    check('a normal account cannot list users', () => {
      assert.equal(denied.status, 403);
    });

    const users = await api('/api/admin/users?limit=10', { cookie: admin.cookie });
    check('an administrator can list and search accounts', () => {
      assert.equal(users.status, 200, JSON.stringify(users.data));
      assert.equal(users.data.items.length >= 4, true);
    });

    const searchedUsers = await api('/api/admin/users?q=alice15', { cookie: admin.cookie });
    check('account search matches the username', () => {
      assert.equal(searchedUsers.status, 200);
      assert.equal(searchedUsers.data.items.length, 1);
      assert.equal(searchedUsers.data.items[0].username, 'alice15');
    });

    const userDetail = await api(`/api/admin/users/${aliceId}`, { cookie: admin.cookie });
    check('account detail reports activity and moderation state', () => {
      assert.equal(userDetail.status, 200, JSON.stringify(userDetail.data));
      assert.equal(typeof userDetail.data.activity.posts, 'number');
      assert.equal(userDetail.data.user.role, 'user');
    });

    const selfDemote = await api(`/api/admin/users/${adminId}/role`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { role: 'user' },
    });
    check('an administrator cannot demote themselves', () => {
      assert.equal(selfDemote.status, 403);
    });

    const promote = await api(`/api/admin/users/${bobId}/role`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { role: 'moderator' },
    });
    check('promoting a moderator is recorded and applied', () => {
      assert.equal(promote.status, 200, JSON.stringify(promote.data));
      assert.equal(promote.data.user.role, 'moderator');
    });

    const modCases = await api('/api/admin/cases', { cookie: bob.cookie });
    check('a moderator can open the moderation queue', () => {
      assert.equal(modCases.status, 200);
    });

    const modUsers = await api('/api/admin/users', { cookie: bob.cookie });
    check('a moderator cannot manage accounts', () => {
      assert.equal(modUsers.status, 403);
    });

    const suspend = await api(`/api/admin/users/${aliceId}/status`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { action: 'suspend', reason: 'Automated abuse ring' },
    });
    check('suspending an account requires a reason and succeeds', () => {
      assert.equal(suspend.status, 200, JSON.stringify(suspend.data));
      assert.equal(suspend.data.user.status, 'suspended');
    });

    const suspendedSession = await api('/api/auth/me', { cookie: alice.cookie });
    check('a suspended account loses its existing sessions', () => {
      // The session version bump is checked before the account gate, so the old
      // cookie is rejected as stale (401) rather than suspended (403).
      assert.ok([401, 403].includes(suspendedSession.status), String(suspendedSession.status));
    });

    const suspendedLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice15@example.com', password: 'password123' },
    });
    check('a suspended account cannot sign back in', () => {
      assert.equal(suspendedLogin.status, 403);
    });

    const reinstate = await api(`/api/admin/users/${aliceId}/status`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { action: 'reinstate', reason: 'Appeal accepted' },
    });
    check('reinstating restores the account', () => {
      assert.equal(reinstate.status, 200, JSON.stringify(reinstate.data));
      assert.equal(reinstate.data.user.status, 'active');
    });

    const aliceLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice15@example.com', password: 'password123' },
    });
    check('a reinstated account can sign in again', () => {
      assert.equal(aliceLogin.status, 200, JSON.stringify(aliceLogin.data));
    });
    const aliceCookie = aliceLogin.cookie;

    // ── Content moderation ──────────────────────────────────────────────────
    const post = await api('/api/posts', {
      method: 'POST',
      cookie: aliceCookie,
      body: { title: 'Moderation QA post', content: 'A post used by the phase 15 suite.' },
    });
    check('the test post exists', () => {
      assert.equal(post.status, 201, JSON.stringify(post.data));
    });

    const postList = await api('/api/admin/content/posts?q=Moderation QA', {
      cookie: admin.cookie,
    });
    check('staff can find a post in the content browser', () => {
      assert.equal(postList.status, 200, JSON.stringify(postList.data));
      assert.equal(
        postList.data.items.some((item) => item._id === idOf(post.data)),
        true,
      );
    });

    const hide = await api(`/api/admin/content/posts/${idOf(post.data)}/visibility`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { hidden: true, reason: 'Off-topic spam' },
    });
    check('hiding a post records the decision', () => {
      assert.equal(hide.status, 200, JSON.stringify(hide.data));
      assert.ok(hide.data.post.hiddenAt);
    });

    const hiddenRead = await api(`/api/posts/${idOf(post.data)}`);
    check('a hidden post disappears from public reads', () => {
      assert.equal(hiddenRead.status, 404);
    });

    const restore = await api(`/api/admin/content/posts/${idOf(post.data)}/visibility`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { hidden: false, reason: 'Appeal accepted' },
    });
    check('restoring a post makes it readable again', () => {
      assert.equal(restore.status, 200);
      assert.equal(restore.data.post.hiddenAt, null);
    });

    const publicRead = await api(`/api/posts/${idOf(post.data)}`);
    check('the restored post is public', () => {
      assert.equal(publicRead.status, 200);
    });

    // ── Cases: DM + server report ───────────────────────────────────────────
    const community = await Community.create({
      name: 'Phase 15 Mod QA',
      slug: 'phase15-mod-qa',
      ownerId: bobId,
      members: [{ userId: bobId, role: 'owner' }],
    });
    const channel = await Channel.create({
      communityId: community._id,
      name: 'general',
      type: 'text',
    });
    const reportedMessage = await Message.create({
      channelId: channel._id,
      communityId: community._id,
      senderId: bobId,
      text: 'reported content that should be tombstoned',
    });
    await Report.create({
      communityId: community._id,
      reporterId: aliceId,
      targetType: 'message',
      targetId: reportedMessage._id,
      reason: 'spam',
    });
    await DmReport.create({
      reporterId: aliceId,
      conversationId: new mongoose.Types.ObjectId(),
      reportedUserId: bobId,
      reason: 'harassment',
      note: 'DM case fixture',
    });

    const cases = await api('/api/admin/cases?status=open', { cookie: admin.cookie });
    check('the unified queue merges DM and server reports', () => {
      assert.equal(cases.status, 200, JSON.stringify(cases.data));
      const sources = new Set(cases.data.items.map((item) => item.source));
      assert.ok(sources.has('dm'));
      assert.ok(sources.has('community'));
    });

    const communityCase = cases.data.items.find((item) => item.source === 'community');
    const resolved = await api(`/api/admin/cases/community/${communityCase.id}/resolve`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { decision: 'remove_content', note: 'Confirmed spam' },
    });
    check('resolving a server case tombstones the reported message', () => {
      assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
      assert.equal(resolved.data.contentRemoved, true);
    });

    const tombstoned = await Message.findById(reportedMessage._id).lean();
    check('the reported message is retained as a tombstone', () => {
      assert.equal(tombstoned.isDeleted, true);
      assert.match(tombstoned.text, /removed by moderation/);
    });

    const dmCase = cases.data.items.find((item) => item.source === 'dm');
    const dmResolved = await api(`/api/admin/cases/dm/${dmCase.id}/resolve`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { decision: 'dismiss', note: 'No violation found' },
    });
    check('a DM case can be dismissed', () => {
      assert.equal(dmResolved.status, 200, JSON.stringify(dmResolved.data));
    });

    const audit = await api('/api/admin/audit?action=PLATFORM_STATUS_UPDATE', {
      cookie: admin.cookie,
    });
    check('platform actions appear in the audit log', () => {
      assert.equal(audit.status, 200, JSON.stringify(audit.data));
      assert.equal(audit.data.items.length >= 1, true);
      assert.equal(audit.data.items[0].actionType, 'PLATFORM_STATUS_UPDATE');
    });

    // ── Catalog administration ──────────────────────────────────────────────
    const adminGames = await api('/api/admin/games?limit=20', { cookie: admin.cookie });
    check('staff can list the catalog with status counts', () => {
      assert.equal(adminGames.status, 200, JSON.stringify(adminGames.data));
      assert.equal(adminGames.data.total >= 4, true);
      assert.equal(typeof adminGames.data.counts.published, 'number');
    });

    const hideGame = await api(`/api/admin/games/${halo._id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { status: 'hidden' },
    });
    check('hiding a game removes it from the public catalog', () => {
      assert.equal(hideGame.status, 200, JSON.stringify(hideGame.data));
    });

    const hiddenDetail = await api('/api/games/halo-infinite');
    check('a hidden game is not publicly readable', () => {
      assert.equal(hiddenDetail.status, 404);
    });

    await api(`/api/admin/games/${halo._id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { status: 'published' },
    });

    const mobile = await Game.findOne({ slug: 'valorant-mobile' }).lean();
    const merged = await api(`/api/admin/games/${mobile._id}/merge`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { intoId: String(valorant._id) },
    });
    check('merging a duplicate records it as merged', () => {
      assert.equal(merged.status, 200, JSON.stringify(merged.data));
      assert.equal(merged.data.primary.slug, 'valorant');
    });

    const mergedRow = await Game.findById(mobile._id).lean();
    check('the merged row points at the survivor', () => {
      assert.equal(mergedRow.status, 'merged');
      assert.equal(String(mergedRow.mergedInto), String(valorant._id));
    });

    const aliasSearch = await api('/api/games?q=mobile');
    check('the survivor answers to the merged alias', () => {
      assert.equal(aliasSearch.status, 200, JSON.stringify(aliasSearch.data));
      assert.equal(
        aliasSearch.data.games.some((game) => game.slug === 'valorant'),
        true,
      );
    });

    // ── Media ledger ────────────────────────────────────────────────────────
    await MediaAsset.create([
      {
        surface: 'post',
        publicId: 'test/post-one',
        status: 'ready',
        bytes: 1000,
        resourceType: 'image',
      },
      {
        surface: 'chat',
        publicId: 'test/chat-one',
        status: 'ready',
        bytes: 500,
        resourceType: 'image',
      },
    ]);

    const storage = await api('/api/admin/storage', { cookie: admin.cookie });
    check('the storage panel totals assets by surface', () => {
      assert.equal(storage.status, 200, JSON.stringify(storage.data));
      assert.equal(storage.data.totals.assets >= 2, true);
      assert.equal(storage.data.totals.bytes >= 1500, true);
      assert.equal(
        storage.data.bySurface.some((row) => row.surface === 'post'),
        true,
      );
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
  }

  const failed = report();
  if (failed.length) process.exit(1);
}

/** Posts expose either `_id` (populated) or `id`; normalise for URLs. */
function idOf(document) {
  return String(document?._id || document?.id || '');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
