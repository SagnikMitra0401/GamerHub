/**
 * Phase 19 end-to-end verification — transaction boundaries.
 *
 * Runs against a THROWAWAY database on the same cluster:
 *   node scripts/e2e-phase20.js
 *
 * Every check injects a failure after the first write of a wrapped flow and then
 * reads the database back. A unit test cannot prove a rollback: only a real
 * replica set can. The suite therefore starts by proving the cluster supports
 * transactions, and treats a standalone deployment as a failed run rather than
 * a quiet pass.
 */
require('dotenv').config();
const assert = require('assert/strict');
const mongoose = require('mongoose');

const E2E_DB = `gamerhub_e2e20_${Date.now().toString(36)}`;

function tempMongoUri() {
  const url = new URL(process.env.MONGO_URI);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

process.env.MONGO_URI = tempMongoUri();
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.DISABLE_RETENTION_WORKER = '1';

const connectDB = require('../server/config/db');
const { check, report } = require('./lib/e2e-harness');
const {
  withTransaction,
  transactionsSupported,
  resetTransactionSupport,
} = require('../server/utils/transaction');
const User = require('../server/models/User');
const Post = require('../server/models/Post');
const Conversation = require('../server/models/Conversation');
const DirectMessage = require('../server/models/DirectMessage');
const BusinessProfile = require('../server/models/BusinessProfile');
const BusinessVerificationAudit = require('../server/models/BusinessVerificationAudit');
const Invitation = require('../server/models/Invitation');
const Community = require('../server/models/Community');
const Party = require('../server/models/Party');
const SquadChat = require('../server/models/SquadChat');
const SquadChatMessage = require('../server/models/SquadChatMessage');
const AccountToken = require('../server/models/AccountToken');
const Notification = require('../server/models/Notification');
const dmService = require('../server/utils/dmService');
const { notifyUser } = require('../server/utils/notify');
const { eraseAccount } = require('../server/utils/accountErasure');
const { issueEmailChallenge, PURPOSES } = require('../server/utils/emailCodes');
const authController = require('../server/controllers/authController');
const businessController = require('../server/controllers/businessController');
const invitationController = require('../server/controllers/invitationController');

async function makeUser(username, extra = {}) {
  return User.create({
    username,
    email: `${username}@example.com`,
    passwordHash: 'not-a-real-hash',
    ...extra,
  });
}

/** Minimal Express response for a controller called directly. */
function mockResponse() {
  const res = {
    statusCode: 0,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function callController(handler, req) {
  const res = mockResponse();
  let failure = null;
  await handler(req, res, (err) => {
    failure = err;
  });
  return { res, failure };
}

/** Restore a patched model method even when the call under test throws. */
async function whilePatched(target, name, replacement, fn) {
  const original = target[name];
  target[name] = replacement;
  try {
    return await fn();
  } finally {
    target[name] = original;
  }
}

async function main() {
  await connectDB();

  // An index build is a catalog change, and a transaction that writes to a
  // collection while its indexes are still being built is refused. A deployed
  // database has them; this throwaway one has to finish them first.
  await Promise.all(
    [
      User,
      Post,
      Conversation,
      DirectMessage,
      BusinessProfile,
      BusinessVerificationAudit,
      Invitation,
      Community,
      Party,
      AccountToken,
      Notification,
      SquadChat,
      SquadChatMessage,
    ].map((model) => model.init()),
  );

  const supported = await transactionsSupported();
  check('the cluster is a replica set, so a rollback is real', () => {
    assert.equal(supported, true, 'transactions are unavailable on this deployment');
  });

  // ---- The helper itself ---------------------------------------------------
  let helperFailure = null;
  try {
    await withTransaction(async () => {
      await makeUser('tx20helper');
      throw new Error('injected between writes');
    });
  } catch (err) {
    helperFailure = err;
  }
  const helperLeftover = await User.findOne({ username: 'tx20helper' }).lean();
  check('a failure between two writes rolls the first one back', () => {
    assert.ok(helperFailure, 'the injected failure did not surface');
    assert.equal(helperLeftover, null);
  });

  // A notification is a write too. This proves the session reaches a helper
  // that never receives one as an argument.
  const notified = await makeUser('tx20notified');
  try {
    await withTransaction(async () => {
      await notifyUser({ userId: notified._id, title: 'tx', message: 'x', silent: true });
      throw new Error('injected after the notification');
    });
  } catch {
    /* expected */
  }
  const rolledBackNotice = await Notification.countDocuments({ userId: notified._id });
  check('a notification written inside a transaction disappears with it', () => {
    assert.equal(rolledBackNotice, 0);
  });

  // ---- The standalone fallback --------------------------------------------
  // A deployment with no replica set cannot roll back. The helper must say so
  // and keep running the sequential code path, not pretend to be atomic.
  process.env.TRANSACTIONS = 'off';
  resetTransactionSupport();
  let fallbackFailure = null;
  try {
    await withTransaction(async () => {
      await makeUser('tx20fallback');
      throw new Error('injected between writes');
    });
  } catch (err) {
    fallbackFailure = err;
  }
  const fallbackSurvivor = await User.findOne({ username: 'tx20fallback' }).lean();
  delete process.env.TRANSACTIONS;
  resetTransactionSupport();
  check('the standalone fallback writes sequentially and leaves the first write', () => {
    assert.ok(fallbackFailure, 'the injected failure did not surface');
    assert.ok(fallbackSurvivor, 'the fallback should not roll back');
  });

  // ---- Account deletion ----------------------------------------------------
  const doomed = await makeUser('tx20erase');
  const keptPost = await Post.create({ userId: doomed._id, title: 'kept', content: 'x' });
  const doomedParty = await Party.create({
    gameTitle: 'TX Doomed Squad',
    leaderId: doomed._id,
    members: [{ userId: doomed._id, role: 'leader', joinedAt: new Date() }],
  });
  const doomedChat = await SquadChat.create({
    squadId: doomedParty._id,
    ownerUserId: doomed._id,
    ownerUsername: 'tx20erase',
    memberIds: [doomed._id],
    state: 'active',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await SquadChatMessage.create({
    chatId: doomedChat._id,
    squadId: doomedParty._id,
    authorUserId: doomed._id,
    text: 'goodbye',
  });
  let eraseFailure = null;
  await whilePatched(
    Post,
    'deleteMany',
    () => {
      throw new Error('injected during the erasure');
    },
    async () => {
      try {
        await eraseAccount(doomed);
      } catch (err) {
        eraseFailure = err;
      }
    },
  );
  const afterErase = await User.findById(doomed._id).select('status username').lean();
  const postSurvived = await Post.findById(keptPost._id).lean();
  const chatSurvived = await SquadChat.findById(doomedChat._id).select('memberIds').lean();
  const squadMessagesSurvived = await SquadChatMessage.countDocuments({ authorUserId: doomed._id });
  check('a failed erasure leaves the account and its posts untouched', () => {
    assert.ok(eraseFailure, 'the injected failure did not surface');
    assert.equal(afterErase.status, 'active');
    assert.equal(afterErase.username, 'tx20erase');
    assert.ok(postSurvived, 'the post should still exist');
  });
  // The squad-chat collection cannot join this client's transaction, so both of
  // its writes wait for the commit. Before that, an aborted erasure pulled the
  // membership and deleted the messages of an account that still existed.
  check('a failed erasure leaves the squad chat member and its messages in place', () => {
    assert.equal(
      (chatSurvived.memberIds || []).some((id) => String(id) === String(doomed._id)),
      true,
      'the chat lost a member whose erasure rolled back',
    );
    assert.equal(squadMessagesSurvived, 1, 'the chat messages were deleted before the commit');
  });

  const completed = await eraseAccount(doomed);
  const chatAfterCommit = await SquadChat.findById(doomedChat._id).select('memberIds').lean();
  const squadMessagesAfterCommit = await SquadChatMessage.countDocuments({
    authorUserId: doomed._id,
  });
  check('a committed erasure removes the squad member and their chat messages', () => {
    assert.equal(completed.erased, true);
    assert.equal(
      (chatAfterCommit.memberIds || []).some((id) => String(id) === String(doomed._id)),
      false,
    );
    assert.equal(squadMessagesAfterCommit, 0);
  });

  // ---- Recovery completion -------------------------------------------------
  const recoverer = await makeUser('tx20recover', {
    passwordHash: 'old-hash',
    hasLocalPassword: true,
    emailVerifiedAt: new Date(),
    recoveryEmail: 'tx20recover-backup@example.com',
    recoveryEmailVerifiedAt: new Date(),
    recoveryEligibleAt: new Date(Date.now() - 1000),
    sessionVersion: 3,
  });
  const { code } = await issueEmailChallenge(recoverer._id, PURPOSES.RECOVER_ACCOUNT, {
    target: 'tx20recover-backup@example.com',
  });
  let recoveryFailure = null;
  let recoveryStatus = 0;
  await whilePatched(
    AccountToken,
    'updateMany',
    () => {
      throw new Error('injected during the reset');
    },
    async () => {
      const { res, failure } = await callController(authController.verifyRecovery, {
        body: { username: 'tx20recover', code, newPassword: 'newpassword123' },
      });
      recoveryFailure = failure;
      recoveryStatus = res.statusCode;
    },
  );
  const afterRecovery = await User.findById(recoverer._id)
    .select('passwordHash sessionVersion')
    .lean();
  check('a failed recovery leaves the old password and session version', () => {
    assert.ok(recoveryFailure, 'the injected failure did not surface');
    assert.equal(recoveryStatus, 0);
    assert.equal(afterRecovery.passwordHash, 'old-hash');
    assert.equal(afterRecovery.sessionVersion, 3);
  });

  // ---- DM conversation with its first message ------------------------------
  const dmSender = await makeUser('tx20dmsend');
  const dmRecipient = await makeUser('tx20dmrecv', {
    dmSettings: { policy: { stranger: 'inbox' } },
  });
  let dmFailure = null;
  await whilePatched(
    DirectMessage,
    'create',
    () => {
      throw new Error('injected while writing the first message');
    },
    async () => {
      try {
        await dmService.createRequest({
          sender: dmSender,
          recipientId: String(dmRecipient._id),
          text: 'hello there',
          context: { type: 'profile' },
        });
      } catch (err) {
        dmFailure = err;
      }
    },
  );
  const dmConversation = await Conversation.findOne({
    participantIds: { $all: [dmSender._id, dmRecipient._id] },
  }).lean();
  check('a DM whose first message fails leaves no conversation row', () => {
    assert.ok(dmFailure, 'the injected failure did not surface');
    assert.equal(dmConversation, null);
  });

  // ---- Business review decision with its retention record ------------------
  const admin = await makeUser('tx20admin');
  const businessUser = await makeUser('tx20business');
  const businessProfile = await BusinessProfile.create({
    userId: businessUser._id,
    displayName: 'TX Studio',
    verificationStatus: 'pending',
    verificationRequestedAt: new Date(),
  });
  let decisionFailure = null;
  await whilePatched(
    BusinessVerificationAudit,
    'create',
    () => {
      throw new Error('injected while writing the audit row');
    },
    async () => {
      const { failure } = await callController(businessController.resolveBusinessVerification, {
        user: { _id: admin._id },
        params: { id: String(businessProfile._id) },
        body: { status: 'verified', note: 'checked' },
      });
      decisionFailure = failure;
    },
  );
  const afterDecision = await BusinessProfile.findById(businessProfile._id)
    .select('verificationStatus reviewDecidedAt verifiedAt')
    .lean();
  const decisionAudits = await BusinessVerificationAudit.countDocuments({
    businessProfileId: businessProfile._id,
  });
  check('a decision whose audit row fails leaves the application pending', () => {
    assert.ok(decisionFailure, 'the injected failure did not surface');
    assert.equal(afterDecision.verificationStatus, 'pending');
    assert.equal(afterDecision.reviewDecidedAt || null, null);
    assert.equal(afterDecision.verifiedAt || null, null);
    assert.equal(decisionAudits, 0);
  });

  // ---- Invitation acceptance with membership and notification --------------
  const inviter = await makeUser('tx20inviter');
  const invitee = await makeUser('tx20invitee');
  const community = await Community.create({
    name: 'TX Server',
    slug: 'tx20server',
    ownerId: inviter._id,
    members: [{ userId: inviter._id, role: 'owner', joinedAt: new Date() }],
  });
  const invitation = await Invitation.create({
    inviterUserId: inviter._id,
    recipientUserId: invitee._id,
    targetType: 'community_server',
    targetId: community._id,
    status: 'pending',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  let invitationFailure = null;
  await whilePatched(
    Invitation.prototype,
    'save',
    () => {
      throw new Error('injected after the membership write');
    },
    async () => {
      const { failure } = await callController(invitationController.acceptInvitation, {
        user: { _id: invitee._id, username: 'tx20invitee' },
        params: { id: String(invitation._id) },
      });
      invitationFailure = failure;
    },
  );
  const afterInvitee = await Community.findById(community._id).select('members').lean();
  const afterInvitation = await Invitation.findById(invitation._id).select('status').lean();
  const inviterNotices = await Notification.countDocuments({
    userId: inviter._id,
    'metadata.kind': 'invitation_accepted',
  });
  check('a failed acceptance leaves the invitation pending and the caller outside', () => {
    assert.ok(invitationFailure, 'the injected failure did not surface');
    assert.equal(afterInvitation.status, 'pending');
    assert.equal(
      (afterInvitee.members || []).some((member) => String(member.userId) === String(invitee._id)),
      false,
    );
    assert.equal(inviterNotices, 0);
  });

  // ---- Squad invitation: the chat membership waits for the commit ----------
  const squadLeader = await makeUser('tx20squadlead');
  const squadJoiner = await makeUser('tx20squadjoin');
  const party = await Party.create({
    gameTitle: 'TX Squad',
    leaderId: squadLeader._id,
    members: [{ userId: squadLeader._id, role: 'leader', joinedAt: new Date() }],
  });
  const squadChat = await SquadChat.create({
    squadId: party._id,
    ownerUserId: squadLeader._id,
    ownerUsername: 'tx20squadlead',
    memberIds: [squadLeader._id],
    state: 'active',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const squadInvite = await Invitation.create({
    inviterUserId: squadLeader._id,
    inviterUsername: 'tx20squadlead',
    recipientUserId: squadJoiner._id,
    targetType: 'squad',
    targetId: party._id,
    targetName: 'TX Squad',
    status: 'pending',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  let squadAcceptFailure = null;
  await whilePatched(
    Invitation.prototype,
    'save',
    () => {
      throw new Error('injected after the squad membership write');
    },
    async () => {
      const { failure } = await callController(invitationController.acceptInvitation, {
        user: { _id: squadJoiner._id, username: 'tx20squadjoin' },
        params: { id: String(squadInvite._id) },
      });
      squadAcceptFailure = failure;
    },
  );
  const [partyAfter, inviteAfter, chatAfter] = await Promise.all([
    Party.findById(party._id).select('members').lean(),
    Invitation.findById(squadInvite._id).select('status').lean(),
    SquadChat.findById(squadChat._id).select('memberIds').lean(),
  ]);
  check('a failed squad acceptance leaves no phantom chat member', () => {
    assert.ok(squadAcceptFailure, 'the injected failure did not surface');
    assert.equal(inviteAfter.status, 'pending');
    assert.equal(
      (partyAfter.members || []).some(
        (member) => String(member.userId) === String(squadJoiner._id),
      ),
      false,
    );
    assert.equal(
      (chatAfter.memberIds || []).some((id) => String(id) === String(squadJoiner._id)),
      false,
      'the chat gained a member whose acceptance rolled back',
    );
  });

  const { failure: squadRetryFailure } = await callController(
    invitationController.acceptInvitation,
    {
      user: { _id: squadJoiner._id, username: 'tx20squadjoin' },
      params: { id: String(squadInvite._id) },
    },
  );
  const chatJoined = await SquadChat.findById(squadChat._id).select('memberIds').lean();
  check('an accepted squad invitation adds the chat member after the commit', () => {
    assert.equal(squadRetryFailure, null);
    assert.equal(
      (chatJoined.memberIds || []).some((id) => String(id) === String(squadJoiner._id)),
      true,
    );
  });

  const failures = report();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  process.exitCode = failures.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
