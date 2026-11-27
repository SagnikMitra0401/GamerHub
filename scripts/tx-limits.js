/**
 * Does an erasure fit in one transaction?
 *
 * MongoDB bounds a transaction by its lifetime (60 seconds by default) and by
 * the 16 MB document limit that applies to the oplog entry it writes. The
 * erasure touches more collections than any other flow, so it is the one that
 * could meet either bound.
 *
 *   node scripts/tx-limits.js
 *
 * Runs against a THROWAWAY database on the configured cluster. It does not try
 * to guess the limits: it builds an account with a large content footprint,
 * erases it, and prints the wall time and the bytes the commit rewrote so both
 * can be compared with the server's bounds. A second, small account is erased
 * after the server refuses its commit for size, which exercises the sequential
 * retry in `server/utils/transaction.js`.
 */
require('dotenv').config();
const assert = require('assert/strict');
const mongoose = require('mongoose');

const DB = `gamerhub_txlimits_${Date.now().toString(36)}`;
const url = new URL(process.env.MONGO_URI);
url.pathname = `/${DB}`;
process.env.MONGO_URI = url.toString();
process.env.NODE_ENV = 'test';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const User = require('../server/models/User');
const Post = require('../server/models/Post');
const Comment = require('../server/models/Comment');
const Message = require('../server/models/Message');
const Notification = require('../server/models/Notification');
const Community = require('../server/models/Community');
const Party = require('../server/models/Party');
const SquadChat = require('../server/models/SquadChat');
const SquadChatMessage = require('../server/models/SquadChatMessage');
const { transactionsSupported } = require('../server/utils/transaction');
const { eraseAccount } = require('../server/utils/accountErasure');

const MESSAGES = Number(process.env.TX_LIMIT_MESSAGES || 4000);
const POSTS = Number(process.env.TX_LIMIT_POSTS || 2000);
const COMMENTS = Number(process.env.TX_LIMIT_COMMENTS || 3000);
const NOTIFICATIONS = Number(process.env.TX_LIMIT_NOTIFICATIONS || 1500);
const SQUAD_MESSAGES = Number(process.env.TX_LIMIT_SQUAD_MESSAGES || 300);

// The server's defaults, as documented for MongoDB 7.
const LIFETIME_LIMIT_MS = 60_000;
const TX_BYTES_LIMIT = 16 * 1024 * 1024;

const MB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
const stamp = () => new Date();

/** Documents per collection, written raw so a probe is not a schema test. */
function docs(count, build) {
  return Array.from({ length: count }, (_, index) => build(index));
}

async function bytesOf(Model, match) {
  const [row] = await Model.aggregate([
    { $match: match },
    { $group: { _id: null, docs: { $sum: 1 }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } },
  ]);
  return row || { docs: 0, bytes: 0 };
}

async function buildLargeAccount() {
  const user = await User.create({
    username: 'txlimitheavy',
    email: 'txlimitheavy@example.com',
    passwordHash: 'not-a-real-hash',
  });
  const other = await User.create({
    username: 'txlimitother',
    email: 'txlimitother@example.com',
    passwordHash: 'not-a-real-hash',
  });

  const postIds = docs(POSTS, () => new mongoose.Types.ObjectId());
  const text = 'a'.repeat(400);

  // The account's own messages are tombstoned in place, so each one is a full
  // document rewrite inside the commit. This is the write that could grow past
  // the oplog limit.
  await Message.collection.insertMany(
    docs(MESSAGES, (index) => ({
      senderId: user._id,
      communityId: other._id,
      channelId: other._id,
      text,
      createdAt: stamp(),
      updatedAt: stamp(),
      __v: 0,
      probe: index,
    })),
  );
  // Messages in other people's rows that quote this account: rewritten too.
  await Message.collection.insertMany(
    docs(200, () => ({
      senderId: other._id,
      replyTo: { messageId: new mongoose.Types.ObjectId(), preview: text, senderName: 'x' },
      mentions: [{ userId: user._id, username: 'txlimitheavy' }],
      text,
      createdAt: stamp(),
      updatedAt: stamp(),
      __v: 0,
    })),
  );

  await Post.collection.insertMany(
    docs(POSTS, (index) => ({
      _id: postIds[index],
      userId: index % 5 === 0 ? other._id : user._id,
      title: 'post',
      content: text,
      likes: index % 5 === 0 ? [user._id, other._id] : [],
      likeCount: index % 5 === 0 ? 2 : 0,
      createdAt: stamp(),
      updatedAt: stamp(),
      __v: 0,
    })),
  );
  await Comment.collection.insertMany(
    docs(COMMENTS, (index) => ({
      postId: postIds[index % postIds.length],
      userId: index % 10 === 0 ? other._id : user._id,
      text,
      createdAt: stamp(),
      updatedAt: stamp(),
      __v: 0,
    })),
  );
  await Notification.collection.insertMany(
    docs(NOTIFICATIONS, () => ({
      userId: user._id,
      type: 'system',
      title: 'notice',
      message: text,
      metadata: { username: 'txlimitheavy' },
      createdAt: stamp(),
      updatedAt: stamp(),
      __v: 0,
    })),
  );

  const community = await Community.create({
    name: 'TX Limits',
    slug: 'tx-limits',
    ownerId: other._id,
    members: [
      { userId: other._id, role: 'owner', joinedAt: stamp() },
      { userId: user._id, role: 'member', joinedAt: stamp() },
    ],
  });
  const party = await Party.create({
    gameTitle: 'TX Limits Squad',
    leaderId: other._id,
    members: [
      { userId: other._id, role: 'leader', joinedAt: stamp() },
      { userId: user._id, role: 'member', joinedAt: stamp() },
    ],
  });
  const chat = await SquadChat.create({
    squadId: party._id,
    ownerUserId: other._id,
    ownerUsername: 'txlimitother',
    memberIds: [other._id, user._id],
    state: 'active',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await SquadChatMessage.insertMany(
    docs(SQUAD_MESSAGES, () => ({
      chatId: chat._id,
      squadId: party._id,
      authorUserId: user._id,
      authorUsername: 'txlimitheavy',
      text: 'gg',
      createdAt: stamp(),
      updatedAt: stamp(),
      __v: 0,
    })),
  );

  return { user, other, community, party, chat };
}

async function main() {
  await connectDB();
  assert.equal(
    await transactionsSupported(),
    true,
    'this probe needs a replica set; the deployment has none',
  );

  // A fresh database builds indexes on first write, and a transaction cannot
  // write to a collection whose catalog is changing. Finish the builds first.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  await Promise.all([SquadChat.init(), SquadChatMessage.init()]);

  const fixture = await buildLargeAccount();

  const own = await bytesOf(Message, { senderId: fixture.user._id });
  const quoted = await bytesOf(Message, { 'mentions.userId': fixture.user._id });
  const liked = await bytesOf(Post, { likes: fixture.user._id });
  const rewriteBytes = own.bytes + quoted.bytes + liked.bytes;

  const started = process.hrtime.bigint();
  const result = await eraseAccount(fixture.user);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const [erasedUser, posts, comments, notices, chat, squadMessages, community] = await Promise.all([
    User.findById(fixture.user._id).select('status username').lean(),
    Post.countDocuments({ userId: fixture.user._id }),
    Comment.countDocuments({ userId: fixture.user._id }),
    Notification.countDocuments({ userId: fixture.user._id }),
    SquadChat.findById(fixture.chat._id).select('memberIds').lean(),
    SquadChatMessage.countDocuments({ authorUserId: fixture.user._id }),
    Community.findById(fixture.community._id).select('members').lean(),
  ]);

  assert.equal(result.erased, true, 'the erasure did not report success');
  assert.equal(erasedUser.status, 'deleted');
  assert.equal(posts, 0, `${posts} posts remained`);
  assert.equal(comments, 0, `${comments} comments remained`);
  assert.equal(notices, 0, `${notices} notifications remained`);
  assert.equal(
    (chat.memberIds || []).some((id) => String(id) === String(fixture.user._id)),
    false,
    'the squad chat still lists the erased account',
  );
  assert.equal(squadMessages, 0, 'the squad chat messages remained');
  assert.equal(
    (community.members || []).some((member) => String(member.userId) === String(fixture.user._id)),
    false,
    'the community still lists the erased account',
  );

  console.log('erasure fixture');
  console.log(
    `  ${MESSAGES + 200} messages, ${POSTS} posts, ${COMMENTS} comments, ` +
      `${NOTIFICATIONS} notifications, ${SQUAD_MESSAGES} squad messages`,
  );
  console.log(
    `  rewritten in full: ${MB(rewriteBytes)} of documents ` +
      `(${own.docs} own messages, ${quoted.docs} quoting, ${liked.docs} liked posts)`,
  );
  console.log(
    `  committed in ${elapsedMs.toFixed(0)} ms of ${LIFETIME_LIMIT_MS} ms; ` +
      `rewritten payload ${MB(rewriteBytes)} of ${MB(TX_BYTES_LIMIT)}`,
  );

  // ---- A commit the server refuses for size -------------------------------
  // Nothing was committed, so repeating the flow outside a transaction is safe
  // and leaves no partial state. The one-shot failure stands in for MongoDB
  // refusing an oplog entry that is too large.
  const small = await User.create({
    username: 'txlimitfallback',
    email: 'txlimitfallback@example.com',
    passwordHash: 'not-a-real-hash',
  });
  await Post.create({ userId: small._id, title: 'kept', content: 'x' });

  const originalDelete = Post.deleteMany;
  let attempts = 0;
  Post.deleteMany = function patchedDelete(...args) {
    attempts += 1;
    if (attempts === 1) {
      const err = new Error('Transaction is too large to fit in the oplog');
      err.code = 220;
      return Promise.reject(err);
    }
    return originalDelete.apply(this, args);
  };

  let fallbackResult;
  try {
    fallbackResult = await eraseAccount(small);
  } finally {
    Post.deleteMany = originalDelete;
  }

  const fallbackUser = await User.findById(small._id).select('status').lean();
  const fallbackPosts = await Post.countDocuments({ userId: small._id });
  assert.equal(attempts > 1, true, 'the transaction was not retried outside the transaction');
  assert.equal(fallbackResult.erased, true, 'the fallback did not finish the erasure');
  assert.equal(fallbackUser.status, 'deleted');
  assert.equal(fallbackPosts, 0, 'the fallback left posts behind');

  console.log(
    `  a commit refused for size was repeated sequentially and finished ` +
      `(${attempts} passes, 0 rows left)`,
  );

  // ---- Overlap between two erasures of the same account -------------------
  // The claim is the guard: a second run must report already-erased instead of
  // deleting the same rows twice.
  const again = await eraseAccount(small);
  assert.equal(again.erased, false);
  assert.equal(again.reason, 'already-erased');
  console.log('  a second erasure of the same account is a no-op');

  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
