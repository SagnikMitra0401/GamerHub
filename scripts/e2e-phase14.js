/**
 * Phase 14 end-to-end verification — account recovery.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase14.js
 *
 * Email uses the in-memory transport, so this suite never contacts the bridge and
 * never prints a real token.
 */
require('dotenv').config();
const http = require('http');
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e14_${Date.now().toString(36)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

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
process.env.ACCOUNT_EMAIL_RATE_LIMIT_MAX = '1000';
process.env.ACCOUNT_PASSWORD_RATE_LIMIT_MAX = '1000';
process.env.NOTIFICATION_ENGAGEMENT_RATE_LIMIT_MAX = '2';
process.env.EMAIL_TRANSPORT = 'memory';
process.env.DISABLE_RETENTION_WORKER = '1';
// Deterministic operability assertions, independent of the developer's .env.
process.env.REDIS_ENABLED = '0';
delete process.env.SENTRY_DSN;

const connectDB = require('../server/config/db');
const app = require('../server/app');
const Notification = require('../server/models/Notification');
const ProductEvent = require('../server/models/ProductEvent');
const User = require('../server/models/User');
const { purgeExpiredNotifications } = require('../server/jobs/retention');
const { getOutbox, resetOutbox } = require('../server/utils/email');
const { recordEvent } = require('../server/utils/productEvents');
const { notifyUser } = require('../server/utils/notify');

const { api, check, report, setBase, registerUser } = require('./lib/e2e-harness');

const waitForMail = async (to, subject, timeoutMs = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const mail = getOutbox()
      .filter((item) => item.to === to && item.subject === subject)
      .at(-1);
    if (mail) return mail;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${subject} to ${to}`);
};

const tokenFrom = (mail, path) => {
  const match = String(mail?.text || '').match(new RegExp(`${path}\\?token=([^\\s]+)`));
  assert.ok(match, `no token in ${path} mail`);
  return decodeURIComponent(match[1]);
};

/** The 8-digit code, read from the in-process outbox. Never fetched over HTTP. */
const codeFrom = (mail) => {
  const match = String(mail?.text || '').match(/(?<!\d)(\d{8})(?!\d)/);
  assert.ok(match, 'no 8-digit code in mail');
  return match[1];
};

const waitForProductEvent = async (filter, timeoutMs = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const event = await ProductEvent.findOne(filter).lean();
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for product event ${JSON.stringify(filter)}`);
};

const waitForNoProductEvent = async (filter, timeoutMs = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await ProductEvent.exists(filter))) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for product event deletion ${JSON.stringify(filter)}`);
};

async function run() {
  await connectDB();
  console.log(`Using throwaway database: ${E2E_DB}`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  setBase(`http://127.0.0.1:${server.address().port}`);

  try {
    resetOutbox();
    const alice = await registerUser('alice14');
    const aliceMe = await api('/api/auth/me', { cookie: alice.cookie });
    check('a new local account starts unverified', () => {
      assert.equal(aliceMe.status, 200, JSON.stringify(aliceMe.data));
      assert.equal(aliceMe.data.user.emailVerified, false);
    });

    const aliceAccount = await api('/api/account', { cookie: alice.cookie });
    check('the account settings payload reports verification state', () => {
      assert.equal(aliceAccount.status, 200, JSON.stringify(aliceAccount.data));
      assert.equal(aliceAccount.data.emailVerified, false);
    });

    const verificationMail = await waitForMail(
      'alice14@example.com',
      'Your GamerHub confirmation code',
    );
    const verificationCode = codeFrom(verificationMail);
    const verified = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: alice.cookie,
      body: { code: verificationCode },
    });
    check('a valid email code confirms the email', () => {
      assert.equal(verified.status, 200, JSON.stringify(verified.data));
      assert.equal(verified.data.emailVerified, true);
    });

    const verifiedMe = await api('/api/auth/me', { cookie: alice.cookie });
    check('the session reflects the verified email immediately', () => {
      assert.equal(verifiedMe.data.user.emailVerified, true);
    });

    const reusedVerification = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: alice.cookie,
      body: { code: verificationCode },
    });
    check('re-submitting a consumed code is an idempotent no-op', () => {
      assert.equal(reusedVerification.status, 200);
      assert.equal(reusedVerification.data.alreadyVerified, true);
    });

    const carolEarly = await registerUser('carol14early');
    await waitForMail('carol14early@example.com', 'Your GamerHub confirmation code');
    const foreignCode = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: carolEarly.cookie,
      body: { code: verificationCode },
    });
    check("another account's code cannot verify this session", () => {
      assert.equal(foreignCode.status, 400, JSON.stringify(foreignCode.data));
    });

    const resendAfterVerified = await api('/api/auth/verify-email/resend', {
      method: 'POST',
      cookie: alice.cookie,
    });
    check('resending after verification is a harmless no-op', () => {
      assert.equal(resendAfterVerified.status, 200);
      assert.equal(resendAfterVerified.data.alreadyVerified, true);
    });

    resetOutbox();
    const bob = await registerUser('bob14');
    const blockedChange = await api('/api/auth/password', {
      method: 'PATCH',
      cookie: bob.cookie,
      body: { currentPassword: 'password123', password: 'newpassword123' },
    });
    check('password change is refused until the email is verified', () => {
      assert.equal(blockedChange.status, 403, JSON.stringify(blockedChange.data));
      assert.equal(blockedChange.data.code, 'EMAIL_NOT_VERIFIED');
    });

    resetOutbox();
    const dave = await registerUser('dave14');
    const firstDaveMail = await waitForMail(
      'dave14@example.com',
      'Your GamerHub confirmation code',
    );
    const daveResend = await api('/api/auth/verify-email/resend', {
      method: 'POST',
      cookie: dave.cookie,
    });
    check('a resend issues a fresh confirmation code', () => assert.equal(daveResend.status, 200));
    const daveMails = getOutbox().filter(
      (item) =>
        item.to === 'dave14@example.com' && item.subject === 'Your GamerHub confirmation code',
    );
    const firstDaveCode = codeFrom(firstDaveMail);
    const latestDaveCode = codeFrom(daveMails.at(-1));
    const staleDave = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: dave.cookie,
      body: { code: firstDaveCode },
    });
    const freshDave = await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: dave.cookie,
      body: { code: latestDaveCode },
    });
    check('only the newest code stays live', () => {
      assert.notEqual(firstDaveCode, latestDaveCode);
      assert.equal(staleDave.status, 400);
      assert.equal(freshDave.status, 200);
    });

    const unknownEmail = `missing14_${Date.now().toString(36)}@example.com`;
    const unknownReset = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: unknownEmail },
    });
    resetOutbox();
    const aliceReset = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'alice14@example.com' },
    });
    check('forgot-password is enumeration-safe', () => {
      assert.equal(unknownReset.status, 202);
      assert.equal(aliceReset.status, 202);
      assert.deepEqual(aliceReset.data, unknownReset.data);
      assert.match(String(aliceReset.data.message), /if an account exists/i);
    });

    const resetMail = await waitForMail('alice14@example.com', 'Reset your GamerHub password');
    const resetToken = tokenFrom(resetMail, '/reset-password');
    const reset = await api('/api/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, password: 'newpassword123' },
    });
    check('a valid reset token changes the password', () => {
      assert.equal(reset.status, 200, JSON.stringify(reset.data));
      assert.equal(reset.data.reset, true);
    });

    const oldSession = await api('/api/auth/me', { cookie: alice.cookie });
    check('resetting a password revokes the old session', () =>
      assert.equal(oldSession.status, 401),
    );

    const oldLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice14@example.com', password: 'password123' },
    });
    check('the old password no longer signs in', () => assert.equal(oldLogin.status, 401));

    const newLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice14@example.com', password: 'newpassword123' },
    });
    check('the new password signs in', () =>
      assert.equal(newLogin.status, 200, JSON.stringify(newLogin.data)),
    );

    const reusedReset = await api('/api/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, password: 'anotherpassword123' },
    });
    check('a reset token cannot be used twice', () => assert.equal(reusedReset.status, 400));

    resetOutbox();
    const carol = await registerUser('carol14');
    const carolMail = await waitForMail('carol14@example.com', 'Your GamerHub confirmation code');
    await api('/api/auth/verify-email/code', {
      method: 'POST',
      cookie: carol.cookie,
      body: { code: codeFrom(carolMail) },
    });

    const changed = await api('/api/auth/password', {
      method: 'PATCH',
      cookie: carol.cookie,
      body: { currentPassword: 'password123', password: 'changed123' },
    });
    check('a verified account can change its password with the current one', () => {
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      assert.equal(changed.data.reauthRequired, true);
    });

    const carolOldSession = await api('/api/auth/me', { cookie: carol.cookie });
    check('changing a password revokes the old session', () =>
      assert.equal(carolOldSession.status, 401),
    );

    const carolNewLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'carol14@example.com', password: 'changed123' },
    });
    check('the changed password signs in', () =>
      assert.equal(carolNewLogin.status, 200, JSON.stringify(carolNewLogin.data)),
    );

    // ── 14B: game-first onboarding and discovery ────────────────────────────
    const owner = await registerUser('owner14b');
    const nina = await registerUser('nina14b');
    const ninaMe = await api('/api/auth/me', { cookie: nina.cookie });
    check('a new account starts with onboarding incomplete', () => {
      assert.equal(ninaMe.status, 200, JSON.stringify(ninaMe.data));
      assert.equal(ninaMe.data.user.onboardingCompletedAt, null);
    });

    const publicCommunity = await api('/api/communities', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        name: 'Valorant Onboarding QA',
        description: 'A public server for the onboarding discovery test.',
        games: ['Valorant', 'Apex Legends'],
      },
    });
    check('community game tags persist on creation', () => {
      assert.equal(publicCommunity.status, 201, JSON.stringify(publicCommunity.data));
      assert.deepEqual(publicCommunity.data.games, ['Valorant', 'Apex Legends']);
    });

    const privateCommunity = await api('/api/communities', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        name: 'Private Onboarding QA',
        description: 'Must never appear in discovery.',
        games: ['Valorant'],
        isPrivate: true,
      },
    });

    await api('/api/users/me/preferences', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { favoriteGames: ['Valorant'], platforms: ['PC'] },
    });

    const squad = await api('/api/lfg', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        gameTitle: 'Valorant',
        activity: 'Ranked',
        maxSlots: 5,
        requirements: { minRank: '', micRequired: true },
      },
    });
    check('a matching open squad exists for discovery', () => {
      assert.equal(squad.status, 201, JSON.stringify(squad.data));
      assert.equal(squad.data.gameTitle, 'Valorant');
    });

    const discover = await api('/api/discover/onboarding?games=Valorant&platforms=PC', {
      cookie: nina.cookie,
    });
    check('discovery returns matching squads, servers and players', () => {
      assert.equal(discover.status, 200, JSON.stringify(discover.data));
      assert.equal(discover.data.games[0], 'Valorant');
      assert.equal(
        discover.data.squads.some((item) => item.gameTitle === 'Valorant'),
        true,
      );
      assert.equal(
        discover.data.communities.some((item) => item.id === String(publicCommunity.data._id)),
        true,
      );
      assert.equal(
        discover.data.players.some((item) => item.username === 'owner14b'),
        true,
      );
    });

    check('discovery never exposes private servers or private user fields', () => {
      const community = discover.data.communities.find(
        (item) => item.id === String(publicCommunity.data._id),
      );
      const player = discover.data.players.find((item) => item.username === 'owner14b');
      assert.equal(community.members, undefined);
      assert.equal(community.email, undefined);
      assert.equal(player.email, undefined);
      assert.equal(player.preferences, undefined);
      assert.deepEqual(player.sharedGames, ['Valorant']);
      assert.equal(
        discover.data.communities.some((item) => item.name === 'Private Onboarding QA'),
        false,
      );
      assert.equal(privateCommunity.status, 201);
    });

    const fallback = await api('/api/discover/onboarding?games=NoSuchGame', {
      cookie: nina.cookie,
    });
    check('discovery falls back to popular public suggestions instead of an empty page', () => {
      assert.equal(fallback.status, 200, JSON.stringify(fallback.data));
      assert.equal(fallback.data.fallback.squads, true);
      assert.equal(fallback.data.fallback.communities, true);
      assert.equal(fallback.data.squads.length > 0, true);
      assert.equal(fallback.data.communities.length > 0, true);
    });

    const ownerMe = await api('/api/auth/me', { cookie: owner.cookie });
    const block = await api(`/api/account/block/${ownerMe.data.user._id}`, {
      method: 'POST',
      cookie: nina.cookie,
    });
    const blockedDiscover = await api('/api/discover/onboarding?games=Valorant', {
      cookie: nina.cookie,
    });
    check('blocking removes the player and their squad from discovery', () => {
      assert.equal(block.status, 200, JSON.stringify(block.data));
      assert.equal(
        blockedDiscover.data.players.some((item) => item.username === 'owner14b'),
        false,
      );
      assert.equal(
        blockedDiscover.data.squads.some((item) => item.leader?.username === 'owner14b'),
        false,
      );
    });
    await api(`/api/account/block/${ownerMe.data.user._id}`, {
      method: 'DELETE',
      cookie: nina.cookie,
    });

    const join = await api(`/api/communities/${publicCommunity.data._id}/join`, {
      method: 'POST',
      cookie: nina.cookie,
    });
    const afterJoin = await api('/api/discover/onboarding?games=Valorant', {
      cookie: nina.cookie,
    });
    check('joined servers leave the suggestion list', () => {
      assert.equal(join.status, 200, JSON.stringify(join.data));
      assert.equal(
        afterJoin.data.communities.some((item) => item.id === String(publicCommunity.data._id)),
        false,
      );
    });

    const complete = await api('/api/discover/onboarding/complete', {
      method: 'POST',
      cookie: nina.cookie,
      body: { games: ['Valorant', 'Apex Legends', 'Elden Ring'], platforms: ['PC', 'Xbox'] },
    });
    check('finishing onboarding saves preferences and stamps completion', () => {
      assert.equal(complete.status, 200, JSON.stringify(complete.data));
      assert.ok(complete.data.onboardingCompletedAt);
      assert.deepEqual(complete.data.preferences.favoriteGames, [
        'Valorant',
        'Apex Legends',
        'Elden Ring',
      ]);
      assert.deepEqual(complete.data.preferences.platforms, ['PC', 'Xbox']);
    });

    const completedMe = await api('/api/auth/me', { cookie: nina.cookie });
    check('the session reports onboarding as complete', () => {
      assert.ok(completedMe.data.user.onboardingCompletedAt);
      assert.equal(
        completedMe.data.user.onboardingCompletedAt,
        complete.data.onboardingCompletedAt,
      );
    });

    const anonymousDiscover = await api('/api/discover/onboarding?games=Valorant');
    check('discovery requires a signed-in player', () =>
      assert.equal(anonymousDiscover.status, 401),
    );

    // ── 14C: notification history and category preferences ─────────────────
    const notificationAccount = await api('/api/account', { cookie: owner.cookie });
    check('accounts expose all six notification preferences by default', () => {
      assert.equal(notificationAccount.status, 200, JSON.stringify(notificationAccount.data));
      assert.deepEqual(notificationAccount.data.notificationSettings, {
        comments: true,
        follows: true,
        likes: true,
        lfg: true,
        bot: true,
        broadcast: true,
      });
    });

    const anonymousNotifications = await api('/api/notifications');
    check('notification history requires a signed-in player', () => {
      assert.equal(anonymousNotifications.status, 401);
    });

    const ninaRequest = await api(`/api/lfg/${squad.data._id}/request`, {
      method: 'POST',
      cookie: nina.cookie,
      body: { message: 'Nina would like a slot.' },
    });
    const bobRequest = await api(`/api/lfg/${squad.data._id}/request`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { message: 'Bob would like a slot.' },
    });
    check('two squad requests create two leader notifications', () => {
      assert.equal(ninaRequest.status, 200, JSON.stringify(ninaRequest.data));
      assert.equal(bobRequest.status, 200, JSON.stringify(bobRequest.data));
    });

    const firstNotificationPage = await api('/api/notifications?limit=1', {
      cookie: owner.cookie,
    });
    check('notification history pages with an opaque cursor and unread count', () => {
      assert.equal(firstNotificationPage.status, 200, JSON.stringify(firstNotificationPage.data));
      assert.equal(firstNotificationPage.data.items.length, 1);
      assert.ok(firstNotificationPage.data.nextCursor);
      assert.equal(firstNotificationPage.data.hasMore, true);
      assert.ok(firstNotificationPage.data.unreadCount >= 2);
    });

    const olderNotificationPage = await api(
      `/api/notifications?limit=1&before=${encodeURIComponent(firstNotificationPage.data.nextCursor)}`,
      { cookie: owner.cookie },
    );
    check('the cursor returns older notifications without repeating the first page', () => {
      assert.equal(olderNotificationPage.status, 200, JSON.stringify(olderNotificationPage.data));
      assert.equal(olderNotificationPage.data.items.length, 1);
      assert.notEqual(
        olderNotificationPage.data.items[0]._id,
        firstNotificationPage.data.items[0]._id,
      );
    });

    const foreignRead = await api(
      `/api/notifications/${firstNotificationPage.data.items[0]._id}/read`,
      {
        method: 'PATCH',
        cookie: nina.cookie,
      },
    );
    check('one player cannot read another player’s notification', () => {
      assert.equal(foreignRead.status, 404, JSON.stringify(foreignRead.data));
    });

    const markedRead = await api(
      `/api/notifications/${firstNotificationPage.data.items[0]._id}/read`,
      {
        method: 'PATCH',
        cookie: owner.cookie,
      },
    );
    check('marking a notification read returns the remaining unread count', () => {
      assert.equal(markedRead.status, 200, JSON.stringify(markedRead.data));
      assert.equal(markedRead.data.notification.read, true);
      assert.equal(typeof markedRead.data.unreadCount, 'number');
    });

    const savedPreferences = await api('/api/account/notification-settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { lfg: false, comments: false },
    });
    check('category preferences save partially and keep the rest enabled', () => {
      assert.equal(savedPreferences.status, 200, JSON.stringify(savedPreferences.data));
      assert.deepEqual(savedPreferences.data.notificationSettings, {
        comments: false,
        follows: true,
        likes: true,
        lfg: false,
        bot: true,
        broadcast: true,
      });
    });

    const unknownPreference = await api('/api/account/notification-settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { mentions: false },
    });
    check('unknown notification preferences are rejected', () => {
      assert.equal(unknownPreference.status, 400);
      assert.match(
        String(unknownPreference.data?.message || ''),
        /unknown notification preference/i,
      );
    });

    await api('/api/notifications/read-all', { method: 'POST', cookie: owner.cookie });
    const mutedSquad = await api('/api/lfg', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        gameTitle: 'Apex Legends',
        activity: 'Ranked',
        maxSlots: 3,
        requirements: { minRank: '', micRequired: false },
      },
    });
    await api(`/api/lfg/${mutedSquad.data._id}/request`, {
      method: 'POST',
      cookie: nina.cookie,
      body: { message: 'Muted category check.' },
    });
    const mutedHistory = await api('/api/notifications?unread=1&limit=5', {
      cookie: owner.cookie,
    });
    check('switching squad notifications off suppresses new pings at creation', () => {
      assert.equal(mutedHistory.status, 200, JSON.stringify(mutedHistory.data));
      assert.equal(mutedHistory.data.items.length, 0);
    });

    await api('/api/account/notification-settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { lfg: true },
    });
    const enabledSquad = await api('/api/lfg', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        gameTitle: 'Elden Ring',
        activity: 'Co-op',
        maxSlots: 3,
        requirements: { minRank: '', micRequired: false },
      },
    });
    await api(`/api/lfg/${enabledSquad.data._id}/request`, {
      method: 'POST',
      cookie: nina.cookie,
      body: { message: 'Enabled category check.' },
    });
    const enabledHistory = await api('/api/notifications?unread=1&limit=5', {
      cookie: owner.cookie,
    });
    check('switching squad notifications back on restores new pings', () => {
      assert.equal(enabledHistory.status, 200, JSON.stringify(enabledHistory.data));
      assert.equal(
        enabledHistory.data.items.some((item) => /New squad request/.test(item.title)),
        true,
      );
    });

    // ── 14C: social triggers and notification retention ────────────────────
    await api('/api/account/notification-settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { comments: true, follows: true, likes: true },
    });

    const socialPost = await api('/api/posts', {
      method: 'POST',
      cookie: owner.cookie,
      body: { title: 'Social trigger QA', content: 'Comment and like this post.' },
    });
    check('the social-trigger post exists', () => {
      assert.equal(socialPost.status, 201, JSON.stringify(socialPost.data));
    });
    const socialPostId = socialPost.data._id;

    const socialHistory = async () => {
      const page = await api('/api/notifications?limit=50', { cookie: owner.cookie });
      assert.equal(page.status, 200, JSON.stringify(page.data));
      return page.data.items;
    };

    const followed = await api('/api/users/owner14b/follow', {
      method: 'POST',
      cookie: bob.cookie,
    });
    check('a new follower is accepted', () => {
      assert.equal(followed.status, 200, JSON.stringify(followed.data));
    });
    const followItems = (await socialHistory()).filter((item) => item.metadata?.kind === 'follow');
    check('the follow notification is addressed to the followed player', () => {
      assert.equal(followItems.length, 1);
      assert.match(followItems[0].title, /followed you/i);
      assert.equal(followItems[0].actionUrl, '/u/bob14');
    });

    await api('/api/users/owner14b/follow', { method: 'POST', cookie: bob.cookie });
    await api('/api/users/owner14b/follow', { method: 'POST', cookie: bob.cookie });
    const refollowItems = (await socialHistory()).filter(
      (item) => item.metadata?.kind === 'follow',
    );
    check('unfollow and re-follow never duplicates the follow ping', () => {
      assert.equal(refollowItems.length, 1);
    });

    const socialComment = await api(`/api/posts/${socialPostId}/comments`, {
      method: 'POST',
      cookie: nina.cookie,
      body: { text: 'This is a social trigger comment.' },
    });
    check('the comment is created', () => {
      assert.equal(socialComment.status, 201, JSON.stringify(socialComment.data));
    });
    const commentItems = (await socialHistory()).filter(
      (item) => item.metadata?.kind === 'comment',
    );
    check('a comment creates exactly one notification for the post author', () => {
      assert.equal(commentItems.length, 1);
      assert.equal(commentItems[0].metadata.commentId, socialComment.data._id);
      assert.match(commentItems[0].title, /commented on your post/i);
    });

    await api(`/api/posts/${socialPostId}/comments`, {
      method: 'POST',
      cookie: owner.cookie,
      body: { text: 'Replying to myself must stay silent.' },
    });
    const afterSelfComment = (await socialHistory()).filter(
      (item) => item.metadata?.kind === 'comment',
    );
    check('the author commenting on their own post does not notify them', () => {
      assert.equal(afterSelfComment.length, 1);
    });

    const firstLike = await api(`/api/posts/${socialPostId}/like`, {
      method: 'POST',
      cookie: bob.cookie,
    });
    check('the first like succeeds', () => {
      assert.equal(firstLike.status, 200, JSON.stringify(firstLike.data));
      assert.equal(firstLike.data.likeCount, 1);
    });
    const likeItems = (await socialHistory()).filter(
      (item) => item.metadata?.kind === 'like_milestone',
    );
    check('the first like creates one milestone notification', () => {
      assert.equal(likeItems.length, 1);
      assert.equal(likeItems[0].metadata.milestone, 1);
    });

    await api(`/api/posts/${socialPostId}/like`, { method: 'POST', cookie: bob.cookie });
    await api(`/api/posts/${socialPostId}/like`, { method: 'POST', cookie: bob.cookie });
    const afterRelike = (await socialHistory()).filter(
      (item) => item.metadata?.kind === 'like_milestone',
    );
    check('unlike and re-like never duplicates a like milestone', () => {
      assert.equal(afterRelike.length, 1);
    });

    await api('/api/account/notification-settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { comments: false },
    });
    await api(`/api/posts/${socialPostId}/comments`, {
      method: 'POST',
      cookie: nina.cookie,
      body: { text: 'This comment should be suppressed.' },
    });
    const afterMutedComment = (await socialHistory()).filter(
      (item) => item.metadata?.kind === 'comment',
    );
    check('switching comments off suppresses new comment notifications', () => {
      assert.equal(afterMutedComment.length, 1);
    });
    await api('/api/account/notification-settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { comments: true },
    });

    const ownPost = await api('/api/posts', {
      method: 'POST',
      cookie: owner.cookie,
      body: { title: 'Self-like QA', content: 'This should not notify the author.' },
    });
    await api(`/api/posts/${ownPost.data._id}/like`, { method: 'POST', cookie: owner.cookie });
    const selfLikeItems = (await socialHistory()).filter(
      (item) =>
        item.metadata?.kind === 'like_milestone' && item.metadata.postId === ownPost.data._id,
    );
    check('liking your own post does not create a milestone notification', () => {
      assert.equal(selfLikeItems.length, 0);
    });

    // ── 14C: paired-account block guard ─────────────────────────────────────
    // A blocked actor must be unable to produce a social ping even when the
    // underlying action itself is accepted. A second, unblocked actor proves
    // the same event does notify when no block exists.
    const blockAuthor = await registerUser('blockauthor14c');
    const blockedPeer = await registerUser('blockedpeer14c', { probeId: true });
    const allowedPeer = await registerUser('allowedpeer14c', { probeId: true });

    const blockPost = await api('/api/posts', {
      method: 'POST',
      cookie: blockAuthor.cookie,
      body: { title: 'Blocked social QA', content: 'Blocked peers must stay silent.' },
    });
    check('the paired-account post exists', () => {
      assert.equal(blockPost.status, 201, JSON.stringify(blockPost.data));
    });
    const blockPostId = blockPost.data._id;

    const blockResponse = await api(`/api/account/block/${blockedPeer.id}`, {
      method: 'POST',
      cookie: blockAuthor.cookie,
    });
    check('the author blocks one peer', () => {
      assert.equal(blockResponse.status, 200, JSON.stringify(blockResponse.data));
    });

    const blockedHistory = async () => {
      const page = await api('/api/notifications?limit=50', { cookie: blockAuthor.cookie });
      assert.equal(page.status, 200, JSON.stringify(page.data));
      return page.data.items;
    };

    const blockedFollow = await api('/api/users/blockauthor14c/follow', {
      method: 'POST',
      cookie: blockedPeer.cookie,
    });
    const blockedComment = await api(`/api/posts/${blockPostId}/comments`, {
      method: 'POST',
      cookie: blockedPeer.cookie,
      body: { text: 'This blocked comment must not ping.' },
    });
    const blockedLike = await api(`/api/posts/${blockPostId}/like`, {
      method: 'POST',
      cookie: blockedPeer.cookie,
    });
    const afterBlockedActions = await blockedHistory();
    check('blocked actions are accepted but create no social notifications', () => {
      assert.equal(blockedFollow.status, 200, JSON.stringify(blockedFollow.data));
      assert.equal(blockedComment.status, 201, JSON.stringify(blockedComment.data));
      assert.equal(blockedLike.status, 200, JSON.stringify(blockedLike.data));
      assert.equal(
        afterBlockedActions.filter(
          (item) => item.metadata?.kind === 'follow' && item.metadata.followerId === blockedPeer.id,
        ).length,
        0,
      );
      assert.equal(
        afterBlockedActions.filter(
          (item) =>
            item.metadata?.kind === 'comment' &&
            item.metadata.commentId === blockedComment.data._id,
        ).length,
        0,
      );
      assert.equal(
        afterBlockedActions.filter(
          (item) =>
            item.metadata?.kind === 'like_milestone' && item.metadata.postId === blockPostId,
        ).length,
        0,
      );
    });

    // Return the post to zero so the unblocked peer can cross the first-like
    // milestone on its own; the blocked peer's earlier like left no ping row.
    await api(`/api/posts/${blockPostId}/like`, { method: 'POST', cookie: blockedPeer.cookie });
    const allowedFollow = await api('/api/users/blockauthor14c/follow', {
      method: 'POST',
      cookie: allowedPeer.cookie,
    });
    const allowedComment = await api(`/api/posts/${blockPostId}/comments`, {
      method: 'POST',
      cookie: allowedPeer.cookie,
      body: { text: 'This unblocked comment should ping once.' },
    });
    const allowedLike = await api(`/api/posts/${blockPostId}/like`, {
      method: 'POST',
      cookie: allowedPeer.cookie,
    });
    const afterAllowedActions = await blockedHistory();
    check('the unblocked peer creates the expected follow, comment and like pings', () => {
      assert.equal(allowedFollow.status, 200, JSON.stringify(allowedFollow.data));
      assert.equal(allowedComment.status, 201, JSON.stringify(allowedComment.data));
      assert.equal(allowedLike.status, 200, JSON.stringify(allowedLike.data));
      assert.equal(
        afterAllowedActions.filter(
          (item) => item.metadata?.kind === 'follow' && item.metadata.followerId === allowedPeer.id,
        ).length,
        1,
      );
      assert.equal(
        afterAllowedActions.filter(
          (item) =>
            item.metadata?.kind === 'comment' &&
            item.metadata.commentId === allowedComment.data._id,
        ).length,
        1,
      );
      assert.equal(
        afterAllowedActions.filter(
          (item) =>
            item.metadata?.kind === 'like_milestone' && item.metadata.postId === blockPostId,
        ).length,
        1,
      );
    });
    check(
      'the blocked peer still creates no social notifications after the control actions',
      () => {
        assert.equal(
          afterAllowedActions.filter(
            (item) =>
              item.metadata?.kind === 'follow' && item.metadata.followerId === blockedPeer.id,
          ).length,
          0,
        );
        assert.equal(
          afterAllowedActions.filter(
            (item) =>
              item.metadata?.kind === 'comment' &&
              item.metadata.commentId === blockedComment.data._id,
          ).length,
          0,
        );
      },
    );

    // ── 14D: activation telemetry and launch readiness ─────────────────────
    const launchAdmin = await registerUser('launchadmin14d', { probeId: true });
    await User.updateOne({ _id: launchAdmin.id }, { $set: { role: 'admin' } });
    const launchUser = await registerUser('funneluser14d', { probeId: true });

    const signupEvent = await waitForProductEvent({ userId: launchUser.id, name: 'signup' });
    check('registration records a signup event', () => {
      assert.equal(signupEvent.name, 'signup');
      assert.equal(signupEvent.props.source, 'local');
    });

    const redactedEvent = await recordEvent('signup', launchUser.id, {
      source: 'duplicate',
      email: 'must-not-appear@example.com',
      text: 'must-not-appear',
      token: 'must-not-appear',
      count: 1,
    });
    check('product-event props drop sensitive fields', () => {
      assert.equal(redactedEvent.props.email, undefined);
      assert.equal(redactedEvent.props.text, undefined);
      assert.equal(redactedEvent.props.token, undefined);
      assert.equal(redactedEvent.props.source, 'duplicate');
      assert.equal(redactedEvent.props.count, 1);
    });

    const startOnboarding = await api('/api/discover/onboarding/start', {
      method: 'POST',
      cookie: launchUser.cookie,
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'onboarding_started' });
    check('opening onboarding records onboarding_started once', () => {
      assert.equal(startOnboarding.status, 200);
    });

    const finishOnboarding = await api('/api/discover/onboarding/complete', {
      method: 'POST',
      cookie: launchUser.cookie,
      body: { games: ['Valorant'], platforms: ['PC'], skipped: false },
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'onboarding_completed' });
    check('finishing onboarding records onboarding_completed', () => {
      assert.equal(finishOnboarding.status, 200, JSON.stringify(finishOnboarding.data));
    });

    const skipUser = await registerUser('funnelskip14d', { probeId: true });
    await api('/api/discover/onboarding/complete', {
      method: 'POST',
      cookie: skipUser.cookie,
      body: { games: [], platforms: [], skipped: true },
    });
    await waitForProductEvent({ userId: skipUser.id, name: 'onboarding_skipped' });
    check('skipping onboarding is recorded separately from completion', () => {
      assert.ok(skipUser.id);
    });

    const funnelCommunity = await api('/api/communities', {
      method: 'POST',
      cookie: launchAdmin.cookie,
      body: {
        name: 'Funnel QA Server',
        description: 'Activation telemetry QA.',
        games: ['Valorant'],
      },
    });
    const funnelJoin = await api(`/api/communities/${funnelCommunity.data._id}/join`, {
      method: 'POST',
      cookie: launchUser.cookie,
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'first_join' });
    check('a first community join records first_join', () => {
      assert.equal(funnelJoin.status, 200, JSON.stringify(funnelJoin.data));
    });

    const funnelFollow = await api('/api/users/launchadmin14d/follow', {
      method: 'POST',
      cookie: launchUser.cookie,
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'first_follow' });
    check('a first follow records first_follow', () => {
      assert.equal(funnelFollow.status, 200, JSON.stringify(funnelFollow.data));
    });

    const funnelPost = await api('/api/posts', {
      method: 'POST',
      cookie: launchUser.cookie,
      body: { title: 'Funnel first post', content: 'Activation telemetry QA post.' },
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'first_post' });
    check('a first post records first_post', () => {
      assert.equal(funnelPost.status, 201, JSON.stringify(funnelPost.data));
    });

    const adminPost = await api('/api/posts', {
      method: 'POST',
      cookie: launchAdmin.cookie,
      body: { title: 'Funnel admin post', content: 'A post to comment on.' },
    });
    const funnelComment = await api(`/api/posts/${adminPost.data._id}/comments`, {
      method: 'POST',
      cookie: launchUser.cookie,
      body: { text: 'First funnel comment.' },
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'first_comment' });
    check('a first comment records first_comment', () => {
      assert.equal(funnelComment.status, 201, JSON.stringify(funnelComment.data));
    });

    const funnelPeer = await registerUser('funnelpeer14d', { probeId: true });
    await api('/api/users/funnelpeer14d/follow', { method: 'POST', cookie: launchUser.cookie });
    await api('/api/users/funneluser14d/follow', { method: 'POST', cookie: funnelPeer.cookie });
    const funnelDm = await api('/api/messages/requests', {
      method: 'POST',
      cookie: launchUser.cookie,
      body: { recipientId: funnelPeer.id, text: 'First funnel message.' },
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'first_message' });
    check('a first direct message records first_message', () => {
      assert.equal(funnelDm.status, 201, JSON.stringify(funnelDm.data));
      assert.equal(funnelDm.data.direct, true);
    });

    const funnelPing = await notifyUser({
      userId: launchUser.id,
      title: 'Funnel click QA',
      message: 'Open this notification.',
      actionUrl: '/notifications',
      metadata: { kind: 'comment' },
    });
    const openedNotification = await api('/api/notifications/opened', {
      method: 'POST',
      cookie: launchUser.cookie,
      body: { surface: 'page' },
    });
    const clickedNotification = await api(`/api/notifications/${funnelPing._id}/clicked`, {
      method: 'POST',
      cookie: launchUser.cookie,
      body: { surface: 'page' },
    });
    await waitForProductEvent({ userId: launchUser.id, name: 'notification_opened' });
    await waitForProductEvent({ userId: launchUser.id, name: 'notification_clicked' });
    check('notification open and click endpoints record engagement', () => {
      assert.equal(openedNotification.status, 200);
      assert.equal(clickedNotification.status, 200);
    });

    const limitedEngagementUser = await registerUser('engagementlimit14d', { probeId: true });
    const overLimitOpened = await api('/api/notifications/opened', {
      method: 'POST',
      cookie: launchUser.cookie,
      body: { surface: 'bell' },
    });
    const limitedFirst = await api('/api/notifications/opened', {
      method: 'POST',
      cookie: limitedEngagementUser.cookie,
      body: { surface: 'bell' },
    });
    const limitedSecond = await api('/api/notifications/opened', {
      method: 'POST',
      cookie: limitedEngagementUser.cookie,
      body: { surface: 'bell' },
    });
    const limitedThird = await api('/api/notifications/opened', {
      method: 'POST',
      cookie: limitedEngagementUser.cookie,
      body: { surface: 'bell' },
    });
    check('notification engagement telemetry is rate-limited per user', () => {
      assert.equal(overLimitOpened.status, 429);
      assert.deepEqual(
        [limitedFirst.status, limitedSecond.status, limitedThird.status],
        [200, 200, 429],
      );
    });

    const eraseEventUser = await registerUser('eventerase14d', { probeId: true });
    await recordEvent('signup', eraseEventUser.id, { source: 'erasure-qa' });
    const eventExport = await api('/api/account/data-export', {
      cookie: eraseEventUser.cookie,
      raw: true,
    });
    const eventExportBody = JSON.parse(eventExport.text);
    check("the data export includes the caller's product events", () => {
      assert.equal(eventExport.status, 200);
      assert.ok(
        eventExportBody.analytics.productEvents.some((event) => event.name === 'signup'),
        'signup event missing from export',
      );
    });

    const erasedEventUser = await api('/api/account/delete-now', {
      method: 'POST',
      cookie: eraseEventUser.cookie,
      body: { confirmUsername: 'eventerase14d', password: 'password123' },
    });
    await waitForNoProductEvent({ userId: eraseEventUser.id });
    check("account erasure removes that account's product events", () => {
      assert.equal(erasedEventUser.status, 200, JSON.stringify(erasedEventUser.data));
    });

    const healthResponse = await api('/api/health');
    check('every response carries a request id', () => {
      assert.match(healthResponse.headers.get('x-request-id') || '', /^[A-Za-z0-9._:-]{8,80}$/);
    });

    const staleCohortUser = await registerUser('stalecohort14d', { probeId: true });
    const staleSignup = await waitForProductEvent({ userId: staleCohortUser.id, name: 'signup' });
    // Use the raw collection: Mongoose timestamp handling can restore or
    // ignore createdAt on a model update, which would defeat this fixture.
    await ProductEvent.collection.updateOne(
      { _id: staleSignup._id },
      { $set: { createdAt: new Date(Date.now() - 40 * DAY_MS) } },
    );
    await recordEvent('onboarding_completed', staleCohortUser.id, { source: 'stale-cohort-qa' });

    // Two accounts with an eligible signup 7.5 days ago. Only the second one
    // performs a meaningful action in [signup + 7d, signup + 8d); the first
    // merely opens a notification and must not count as retained.
    const day7EngagementUser = await registerUser('day7engagement14d', { probeId: true });
    const day7ActiveUser = await registerUser('day7active14d', { probeId: true });
    const day7SignupAt = new Date(Date.now() - 7.5 * DAY_MS);
    const day7WindowAt = new Date(Date.now() - 0.5 * DAY_MS);
    await ProductEvent.collection.insertMany([
      {
        userId: new mongoose.Types.ObjectId(day7EngagementUser.id),
        name: 'signup',
        props: { source: 'day7-fixture' },
        createdAt: day7SignupAt,
      },
      {
        userId: new mongoose.Types.ObjectId(day7EngagementUser.id),
        name: 'notification_opened',
        props: { surface: 'bell' },
        createdAt: day7WindowAt,
      },
      {
        userId: new mongoose.Types.ObjectId(day7ActiveUser.id),
        name: 'signup',
        props: { source: 'day7-fixture' },
        createdAt: day7SignupAt,
      },
      {
        userId: new mongoose.Types.ObjectId(day7ActiveUser.id),
        name: 'first_post',
        props: { source: 'day7-fixture' },
        createdAt: day7WindowAt,
      },
    ]);

    const anonymousFunnel = await api('/api/admin/funnel');
    const userFunnel = await api('/api/admin/funnel', { cookie: launchUser.cookie });
    const adminFunnel = await api('/api/admin/funnel?days=28', { cookie: launchAdmin.cookie });
    check('the activation funnel is admin-only', () => {
      assert.equal(anonymousFunnel.status, 401);
      assert.equal(userFunnel.status, 403);
      assert.equal(adminFunnel.status, 200, JSON.stringify(adminFunnel.data));
    });

    check('the funnel returns distinct-user step counts and conversions', () => {
      assert.deepEqual(
        adminFunnel.data.steps.map((step) => step.key),
        [
          'signup',
          'onboarding_completed',
          'first_connection',
          'first_contribution',
          'day_7_return',
        ],
      );
      assert.equal(adminFunnel.data.steps[0].users >= 5, true);
      assert.equal(adminFunnel.data.steps[1].users >= 1, true);
      assert.equal(adminFunnel.data.steps[2].users >= 1, true);
      assert.equal(adminFunnel.data.steps[3].users >= 1, true);
      assert.equal(adminFunnel.data.day7.approximate, true);
    });

    check('day-7 return ignores notification engagement', () => {
      assert.equal(adminFunnel.data.day7.cohort, 2);
      assert.equal(adminFunnel.data.day7.returned, 1);
    });

    const signupIds = await ProductEvent.distinct('userId', {
      name: 'signup',
      createdAt: { $gte: new Date(adminFunnel.data.since) },
    });
    check('the signup step counts each account once', () => {
      assert.equal(adminFunnel.data.steps[0].users, signupIds.length);
    });

    const funnelSince = new Date(adminFunnel.data.since);
    const funnelCohort = await ProductEvent.distinct('userId', {
      name: 'signup',
      userId: { $ne: null },
      createdAt: { $gte: funnelSince },
    });
    const funnelCompleted = await ProductEvent.distinct('userId', {
      name: 'onboarding_completed',
      userId: { $in: funnelCohort },
      createdAt: { $gte: funnelSince },
    });
    const funnelConnected = await ProductEvent.distinct('userId', {
      name: { $in: ['first_join', 'first_follow'] },
      userId: { $in: funnelCompleted },
      createdAt: { $gte: funnelSince },
    });
    const funnelContributed = await ProductEvent.distinct('userId', {
      name: { $in: ['first_post', 'first_comment', 'first_message'] },
      userId: { $in: funnelConnected },
      createdAt: { $gte: funnelSince },
    });
    check('every funnel step is restricted to the same signup cohort', () => {
      assert.deepEqual(
        adminFunnel.data.steps.slice(0, 4).map((step) => step.users),
        [
          funnelCohort.length,
          funnelCompleted.length,
          funnelConnected.length,
          funnelContributed.length,
        ],
      );
      assert.equal(funnelCohort.map(String).includes(String(staleCohortUser.id)), false);
      assert.equal(adminFunnel.data.steps[1].users <= adminFunnel.data.steps[0].users, true);
      assert.equal(adminFunnel.data.steps[2].users <= adminFunnel.data.steps[1].users, true);
      assert.equal(adminFunnel.data.steps[3].users <= adminFunnel.data.steps[2].users, true);
    });

    const readiness = await api('/api/health/ready');
    check('readiness pings MongoDB and reports the dependency state', () => {
      assert.equal(readiness.status, 200, JSON.stringify(readiness.data));
      assert.equal(readiness.data.status, 'ready');
      assert.equal(readiness.data.checks.database.ok, true);
      assert.equal(readiness.data.checks.redis.status, 'disabled');
    });

    const systemHealth = await api('/api/admin/system-health', { cookie: launchAdmin.cookie });
    check('system health exposes launch instrumentation and event counts', () => {
      assert.equal(systemHealth.status, 200, JSON.stringify(systemHealth.data));
      assert.equal(systemHealth.data.observability.requestIds, true);
      assert.equal(systemHealth.data.observability.structuredLogs, true);
      assert.equal(systemHealth.data.observability.errorReporting, 'structured-json');
      assert.equal(systemHealth.data.observability.errorReportingConfigured, false);
      assert.equal(systemHealth.data.rateLimits.mode, 'memory');
      assert.equal(systemHealth.data.database.counts.productEvents > 0, true);
    });

    const ownerMeForRetention = await api('/api/auth/me', { cookie: owner.cookie });
    const ownerId = ownerMeForRetention.data.user._id;
    const ordinaryRetention = await Notification.create({
      userId: ownerId,
      type: 'social',
      title: 'Ordinary retention QA',
      metadata: { kind: 'comment' },
    });
    const expiredNotification = await Notification.create({
      userId: ownerId,
      type: 'social',
      title: 'Expired retention QA',
      metadata: { kind: 'comment' },
      retentionAt: new Date(Date.now() - 60_000),
    });
    const durableNotification = await Notification.create({
      userId: ownerId,
      type: 'social',
      title: 'Durable retention QA',
      metadata: { kind: 'follow_request' },
    });
    check('ordinary notifications receive a 15-day retention date', () => {
      const days = (ordinaryRetention.retentionAt.getTime() - Date.now()) / 86_400_000;
      assert.ok(days > 14.9 && days <= 15, String(days));
    });
    check('important notices are exempt from retention', () => {
      assert.equal(durableNotification.retentionAt, null);
    });
    const purged = await purgeExpiredNotifications();
    const expiredExists = await Notification.exists({ _id: expiredNotification._id });
    const durableExists = await Notification.exists({ _id: durableNotification._id });
    check('the retention sweep deletes only the expired ordinary notification', () => {
      assert.equal(purged >= 1, true);
      assert.equal(expiredExists, null);
      assert.ok(durableExists);
    });
    await Notification.deleteMany({
      _id: { $in: [ordinaryRetention._id, durableNotification._id] },
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
