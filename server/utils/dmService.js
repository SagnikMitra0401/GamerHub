/**
 * Direct-message domain service.
 *
 * Controllers stay thin; every rule that decides whether a thread exists, who
 * may read it, and how a request becomes a conversation lives here. The service
 * returns plain view objects so no route can accidentally serialise a whole
 * user document (email, block lists, settings) into a chat response.
 */
const mongoose = require('mongoose');

const Conversation = require('../models/Conversation');
const DirectMessage = require('../models/DirectMessage');
const DmReport = require('../models/DmReport');
const DmSenderReputation = require('../models/DmSenderReputation');
const BusinessProfile = require('../models/BusinessProfile');
const User = require('../models/User');
const Post = require('../models/Post');
const Community = require('../models/Community');
const Party = require('../models/Party');

const { badRequest, forbidden, notFound, conflict } = require('./httpError');
const { isBlockedBetween } = require('./privacy');
const { sanitizeLine } = require('./sanitize');
const { notifyUser } = require('./notify');
const { invalidateVisibility } = require('./visibility');
const {
  DM_CONTEXT_TYPES,
  DM_REPORT_REASONS,
  REQUEST_LIMITS,
  DAY_MS,
  idOf,
  normalizeDmSettings,
  evaluateDmPermission,
  relationshipFor,
  validateRequestText,
  validateBusinessRequest,
  normalizeDmMessage,
  quotaState,
  cooldownActive,
  sanitizeLabels,
  requestFingerprint,
  chooseRequestFilter,
  reputationTier,
  isQuietHours
} = require('./dmPolicy');

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const COOLDOWN_MS = REQUEST_LIMITS.cooldownDays * DAY_MS;
const REQUEST_TTL_MS = REQUEST_LIMITS.expiryDays * DAY_MS;

const PARTICIPANT_FIELDS = '_id username level role profileType status';
const RECIPIENT_FIELDS =
  '_id username level role profileType status followers following blockedUsers dmSettings createdAt authIdentities';

function unreadFor(conversation, userId) {
  const raw = conversation?.unreadCounts;
  if (!raw) return 0;
  if (typeof raw.get === 'function') return Number(raw.get(String(userId))) || 0;
  return Number(raw[String(userId)]) || 0;
}

function hasUser(list, userId) {
  return Array.isArray(list) && list.some((entry) => idOf(entry) === String(userId));
}

function labelsFor(conversation, userId) {
  return (conversation?.labels || [])
    .filter((entry) => String(entry.ownerId) === String(userId))
    .map((entry) => entry.value)
    .filter(Boolean);
}

function otherParticipant(conversation, userId) {
  const me = String(userId);
  return (conversation.participantIds || []).find((id) => String(id) !== me) || null;
}

function publicCounterpart(user) {
  if (!user) return null;
  return {
    _id: String(user._id),
    username: user.username,
    level: user.level || 1,
    role: user.role || 'user',
    profileType: user.profileType || 'personal'
  };
}

function toConversationView(conversation, viewerId, counterpart) {
  const me = String(viewerId);
  const isInitiator = String(conversation.initiatorId) === me;
  const isRecipient = String(conversation.recipientId) === me;
  const isActive = conversation.state === 'active';
  const isFiltered = isRecipient && conversation.state === 'request' && Boolean(conversation.filteredAt);
  return {
    _id: String(conversation._id),
    state: conversation.state,
    context: conversation.context,
    contextLabel: conversation.contextLabel || '',
    createdAt: conversation.createdAt,
    acceptedAt: conversation.acceptedAt || null,
    lastMessageAt: conversation.lastMessageAt || null,
    lastMessagePreview: isActive ? conversation.lastMessagePreview || '' : '',
    unread: isActive ? unreadFor(conversation, me) : 0,
    counterpart: publicCounterpart(counterpart),
    isInitiator,
    isRecipient,
    canReply: isActive,
    muted: hasUser(conversation.mutedBy, me),
    archived: hasUser(conversation.archivedBy, me),
    businessThread: Boolean(conversation.businessThread),
    labels: labelsFor(conversation, me),
    // The sender must not learn that a recipient filtered them. Only the
    // recipient's own view carries the flag and its reason.
    filtered: isFiltered,
    filterReason: isFiltered ? conversation.filterReason || null : null,
    filterMatched: isFiltered && conversation.filterReason === 'hidden_word'
      ? conversation.filterMatched || ''
      : '',
    request:
      conversation.state === 'request'
        ? {
            text: conversation.requestText || '',
            createdAt: conversation.createdAt,
            expiresAt: conversation.requestExpiresAt,
            canRespond: isRecipient,
            business: conversation.requestIntent
              ? {
                  intent: conversation.requestIntent,
                  company: conversation.requestCompany || '',
                  website: conversation.requestWebsite || '',
                  budgetBand: conversation.requestBudgetBand || null,
                  timeline: conversation.requestTimeline || ''
                }
              : null
          }
        : null,
    retryAfter: conversation.retryAfter || null
  };
}

function toMessageView(message, viewerId) {
  return {
    _id: String(message._id),
    text: message.text,
    kind: message.kind || 'text',
    createdAt: message.createdAt,
    deleted: Boolean(message.deletedAt),
    mine: String(message.authorId) === String(viewerId),
    author: String(message.authorId)
  };
}

/**
 * Team views are built from the owner's conversation, then stripped of the
 * owner's private labels and quick replies. A viewer cannot reply; an agent
 * can reply and respond to requests, but moderation stays with the owner.
 */
function toTeamConversationView(conversation, ownerId, role, counterpart) {
  const base = toConversationView(conversation, ownerId, counterpart);
  const active = conversation.state === 'active';
  return {
    ...base,
    labels: [],
    unread: active ? unreadFor(conversation, ownerId) : 0,
    canReply: active && role === 'agent',
    request: base.request
      ? { ...base.request, canRespond: role === 'agent' && base.request.canRespond }
      : null,
    team: { ownerId: String(ownerId), role }
  };
}

async function findCounterparts(conversations, viewerId) {
  const ids = new Set();
  for (const conversation of conversations) {
    const other = otherParticipant(conversation, viewerId);
    if (other) ids.add(String(other));
  }
  if (!ids.size) return new Map();
  const users = await User.find({ _id: { $in: [...ids] } })
    .select(PARTICIPANT_FIELDS)
    .lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

/**
 * Resolve the claimed context and prove the sender actually has it. A client
 * cannot turn "I saw a public post" into "we share a server" by sending a type.
 */
async function resolveContext({ sender, recipient, context }) {
  const source = context && typeof context === 'object' ? context : {};
  const type = source.type || 'profile';
  if (!DM_CONTEXT_TYPES.includes(type)) {
    throw badRequest('Unknown message context.');
  }

  if (type === 'profile') {
    return { type, id: null, label: `@${recipient.username}` };
  }

  if (!isId(source.id)) throw badRequest('That context is no longer available.');
  const contextId = source.id;

  if (type === 'post') {
    const post = await Post.findById(contextId).select('_id title userId').lean();
    if (!post || String(post.userId) !== String(recipient._id)) {
      throw badRequest('That post does not belong to this player.');
    }
    return { type, id: post._id, label: sanitizeLine(post.title, 80) };
  }

  if (type === 'community') {
    const community = await Community.findById(contextId)
      .select('_id name members bannedUsers')
      .lean();
    if (!community) throw badRequest('That server no longer exists.');
    const senderMember = (community.members || []).some((member) => String(member.userId) === String(sender._id));
    const recipientMember = (community.members || []).some((member) => String(member.userId) === String(recipient._id));
    if (!senderMember || !recipientMember) {
      throw badRequest('You do not share that server.');
    }
    return { type, id: community._id, label: sanitizeLine(community.name, 80) };
  }

  // squad
  const party = await Party.findById(contextId)
    .select('_id gameTitle leaderId members state expiresAt')
    .lean();
  if (!party) throw badRequest('That squad no longer exists.');
  if (party.expiresAt && new Date(party.expiresAt).getTime() <= Date.now()) {
    throw badRequest('That squad has ended.');
  }
  if (['completed', 'cancelled'].includes(party.state)) {
    throw badRequest('That squad has ended.');
  }
  const member = (userId) =>
    String(party.leaderId) === String(userId) ||
    (party.members || []).some((entry) => String(entry.userId) === String(userId));
  if (!member(sender._id) || !member(recipient._id)) {
    throw badRequest('You are not both in that squad.');
  }
  return { type, id: party._id, label: sanitizeLine(party.gameTitle, 80) };
}

async function requestCounts(senderId) {
  const now = Date.now();
  const [sentToday, sentThisWeek] = await Promise.all([
    Conversation.countDocuments({
      initiatorId: senderId,
      lastRequestAt: { $gte: new Date(now - DAY_MS) }
    }),
    Conversation.countDocuments({
      initiatorId: senderId,
      lastRequestAt: { $gte: new Date(now - 7 * DAY_MS) }
    })
  ]);
  return { sentToday, sentThisWeek };
}

async function markExpired(conversation) {
  const retryAfter = new Date(
    new Date(conversation.requestExpiresAt || Date.now()).getTime() + COOLDOWN_MS
  );
  conversation.state = 'expired';
  conversation.retryAfter = retryAfter;
  await conversation.save();
  return retryAfter;
}

async function bumpReputation(userId, increments) {
  if (!userId) return null;
  try {
    const reputation = await DmSenderReputation.findOneAndUpdate(
      { userId },
      { $inc: increments, $setOnInsert: { userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!reputation) return null;
    const tier = reputationTier({ reports: reputation.reports, blocks: reputation.blocks });
    if (reputation.tier !== tier) {
      reputation.tier = tier;
      await reputation.save();
    }
    return reputation;
  } catch (err) {
    // Reputation is an internal signal; a counter failure must not break the
    // message the person actually asked to send.
    if (err.code !== 11000) console.error('[DM] reputation update failed:', err.message);
    return null;
  }
}

async function createMessage({ conversation, authorId, text, createdAt }) {
  const message = await DirectMessage.create({
    conversationId: conversation._id,
    authorId,
    text,
    ...(createdAt ? { createdAt } : {})
  });
  return message;
}

async function notifyMessage({ conversation, author, message }) {
  const other = otherParticipant(conversation, author._id);
  if (!other) return;
  if (hasUser(conversation.mutedBy, other)) return;

  const recipient = await User.findById(other).select('dmSettings').lean();
  await notifyUser({
    userId: other,
    type: 'social',
    title: `New message from @${author.username}`,
    message: 'Open your inbox to read it.',
    actionUrl: `/messages?thread=${conversation._id}`,
    metadata: { conversationId: String(conversation._id), kind: 'dm_message' },
    dedupeKey: `dm:${conversation._id}:${message._id}`,
    silent: isQuietHours(recipient?.dmSettings)
  });
}

/**
 * POST /api/messages/requests
 * Starts either an active thread (policy `inbox`) or a pending request.
 */
async function createRequest({
  sender,
  recipientId,
  text,
  context,
  intent,
  company,
  website,
  budgetBand,
  timeline
}) {
  if (!isId(recipientId)) throw badRequest('Invalid player.');
  if (String(sender._id) === String(recipientId)) throw badRequest('You cannot message yourself.');

  const recipient = await User.findById(recipientId).select(RECIPIENT_FIELDS).lean();
  if (!recipient) throw notFound('Player not found.');

  if (isBlockedBetween(sender, recipient)) {
    throw forbidden('You cannot message this player.', { code: 'DM_BLOCKED' });
  }
  if (['deleted', 'deletion_pending', 'suspended', 'frozen'].includes(recipient.status)) {
    throw forbidden('This player is not available.', { code: 'DM_UNAVAILABLE' });
  }

  const resolved = await resolveContext({ sender, recipient, context });
  const settings = normalizeDmSettings(recipient.dmSettings);
  if (settings.availability === 'paused') {
    throw forbidden('This player has paused new messages.', { code: 'DM_PAUSED' });
  }
  const senderIsBusiness = sender.profileType === 'creator_business';
  const businessProfile = senderIsBusiness
    ? await BusinessProfile.findOne({ userId: sender._id }).lean()
    : null;
  const relationship = relationshipFor({ sender, recipient });
  const gate = evaluateDmPermission({
    sender,
    recipient,
    settings,
    contextType: resolved.type,
    relationship,
    senderIsBusiness
  });
  if (!gate.allowed) throw forbidden(gate.reason, { code: gate.code });

  // Verification is an outreach gate, not a profile badge. A disclosed
  // business may still use mutual inbox threads, but cold contact waits for a
  // reviewed domain.
  if (senderIsBusiness && gate.mode !== 'inbox') {
    if (!businessProfile || businessProfile.verificationStatus !== 'verified') {
      throw forbidden('Verify your business domain before sending cold requests.', {
        code: 'DM_BUSINESS_UNVERIFIED'
      });
    }
    if (businessProfile.outreachPaused) {
      throw forbidden('Business outreach is paused while recent reports are reviewed.', {
        code: 'DM_BUSINESS_PAUSED'
      });
    }
  }

  const pairKey = Conversation.pairKeyFor(sender._id, recipient._id);
  let conversation = await Conversation.findOne({ pairKey });
  const now = new Date();

  if (conversation) {
    if (conversation.state === 'active') {
      throw conflict('You are already connected to this player.', { code: 'DM_ALREADY_CONNECTED' });
    }
    if (conversation.state === 'erased' || conversation.state === 'archived') {
      throw forbidden('This conversation is no longer available.', { code: 'DM_UNAVAILABLE' });
    }
    if (conversation.state === 'request') {
      if (conversation.requestExpiresAt && new Date(conversation.requestExpiresAt) > now) {
        throw conflict('A request is already waiting for a reply.', { code: 'DM_PENDING' });
      }
      const retryAfter = new Date(
        new Date(conversation.requestExpiresAt || now).getTime() + COOLDOWN_MS
      );
      if (retryAfter > now) {
        conversation.state = 'expired';
        conversation.retryAfter = retryAfter;
        await conversation.save();
        throw forbidden('That request expired without a reply.', {
          code: 'DM_COOLDOWN',
          details: { retryAfter }
        });
      }
      // The request cooled down while nobody looked; the reuse branch below
      // starts a fresh one instead of throwing forever.
      conversation.state = 'expired';
      conversation.retryAfter = retryAfter;
    }
    if (conversation.state === 'blocked') {
      if (cooldownActive(conversation.retryAfter, now)) {
        throw forbidden('You cannot message this player yet.', {
          code: 'DM_COOLDOWN',
          details: { retryAfter: conversation.retryAfter }
        });
      }
    }
    if (['declined', 'expired'].includes(conversation.state) && cooldownActive(conversation.retryAfter, now)) {
      throw forbidden('You cannot message this player yet.', {
        code: 'DM_COOLDOWN',
        details: { retryAfter: conversation.retryAfter }
      });
    }
  }

  // Access is allowed. Direct (mutual inbox) writes an active thread; anything
  // else is a request with a single plain-text opener.
  if (gate.mode === 'inbox') {
    const normalized = normalizeDmMessage(text);
    if (!normalized.ok) throw badRequest(normalized.reason);

    if (conversation) {
      conversation.state = 'active';
      conversation.acceptedAt = now;
      conversation.requestText = '';
      conversation.requestExpiresAt = null;
      conversation.retryAfter = null;
      conversation.declinedAt = null;
      conversation.blockedBy = null;
      conversation.blockedAt = null;
      conversation.filteredAt = null;
      conversation.filterReason = null;
      conversation.filterMatched = '';
      conversation.requestFingerprint = '';
      conversation.requestIntent = null;
      conversation.requestCompany = '';
      conversation.requestWebsite = '';
      conversation.requestBudgetBand = null;
      conversation.requestTimeline = '';
      conversation.businessThread = senderIsBusiness;
      conversation.context = resolved.type;
      conversation.contextId = resolved.id;
      conversation.contextLabel = resolved.label || '';
    } else {
      conversation = new Conversation({
        pairKey,
        participantIds: [sender._id, recipient._id],
        initiatorId: sender._id,
        recipientId: recipient._id,
        state: 'active',
        acceptedAt: now,
        context: resolved.type,
        contextId: resolved.id,
        contextLabel: resolved.label || '',
        businessThread: senderIsBusiness,
        unreadCounts: { [String(recipient._id)]: 1, [String(sender._id)]: 0 }
      });
    }
    conversation.lastMessageAt = now;
    conversation.lastMessagePreview = sanitizeLine(normalized.text, 120);
    conversation.lastRequestAt = conversation.lastRequestAt || null;
    conversation.unreadCounts = {
      [String(recipient._id)]: 1,
      [String(sender._id)]: 0
    };
    await conversation.save();

    const message = await createMessage({
      conversation,
      authorId: sender._id,
      text: normalized.text,
      createdAt: now
    });
    await notifyMessage({ conversation, author: sender, message });

    return {
      conversation: toConversationView(conversation, sender._id, recipient),
      message: toMessageView(message, sender._id),
      direct: true
    };
  }

  let normalized;
  let businessBrief = null;
  if (senderIsBusiness) {
    const parsed = validateBusinessRequest({
      text,
      intent,
      company,
      website,
      budgetBand,
      timeline,
      business: businessProfile
    });
    if (!parsed.ok) throw badRequest(parsed.reason);
    normalized = { ok: true, text: parsed.value.text };
    businessBrief = parsed.value;
  } else {
    normalized = validateRequestText(text);
    if (!normalized.ok) throw badRequest(normalized.reason);
  }

  const counts = await requestCounts(sender._id);
  const quota = quotaState({
    ...counts,
    lastRequestAt: conversation?.lastRequestAt || null,
    accountCreatedAt: sender.createdAt,
    now
  });
  if (!quota.allowed) throw forbidden(quota.reason, { code: quota.code });

  const fingerprint = requestFingerprint(normalized.text);
  const [campaignCount, reputation] = await Promise.all([
    Conversation.countDocuments({
      initiatorId: sender._id,
      requestFingerprint: fingerprint,
      lastRequestAt: { $gte: new Date(now.getTime() - DAY_MS) }
    }),
    DmSenderReputation.findOne({ userId: sender._id }).select('tier').lean()
  ]);
  const filter = chooseRequestFilter({
    text: normalized.text,
    hiddenWords: settings.hiddenWords,
    reputationTier: reputation?.tier || 'standard',
    campaignCount
  });

  if (conversation) {
    // Reuse the pair row after a cooldown. A new row would violate pairKey and
    // would also lose the moderation history attached to the old thread.
    conversation.state = 'request';
    conversation.initiatorId = sender._id;
    conversation.recipientId = recipient._id;
    conversation.requestText = normalized.text;
    conversation.requestIntent = businessBrief?.intent || null;
    conversation.requestCompany = businessBrief?.company || '';
    conversation.requestWebsite = businessBrief?.website || '';
    conversation.requestBudgetBand = businessBrief?.budgetBand || null;
    conversation.requestTimeline = businessBrief?.timeline || '';
    conversation.businessThread = Boolean(businessBrief);
    conversation.requestExpiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
    conversation.lastRequestAt = now;
    conversation.acceptedAt = null;
    conversation.declinedAt = null;
    conversation.blockedBy = null;
    conversation.blockedAt = null;
    conversation.retryAfter = null;
    conversation.context = resolved.type;
    conversation.contextId = resolved.id;
    conversation.contextLabel = resolved.label || '';
    conversation.lastMessageAt = null;
    conversation.lastMessagePreview = '';
    conversation.filteredAt = filter ? now : null;
    conversation.filterReason = filter?.reason || null;
    conversation.filterMatched = filter?.matched || '';
    conversation.requestFingerprint = fingerprint;
    conversation.unreadCounts = { [String(recipient._id)]: 0, [String(sender._id)]: 0 };
  } else {
    conversation = new Conversation({
      pairKey,
      participantIds: [sender._id, recipient._id],
      initiatorId: sender._id,
      recipientId: recipient._id,
      state: 'request',
      requestText: normalized.text,
      requestIntent: businessBrief?.intent || null,
      requestCompany: businessBrief?.company || '',
      requestWebsite: businessBrief?.website || '',
      requestBudgetBand: businessBrief?.budgetBand || null,
      requestTimeline: businessBrief?.timeline || '',
      businessThread: Boolean(businessBrief),
      requestExpiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
      lastRequestAt: now,
      context: resolved.type,
      contextId: resolved.id,
      contextLabel: resolved.label || '',
      filteredAt: filter ? now : null,
      filterReason: filter?.reason || null,
      filterMatched: filter?.matched || '',
      requestFingerprint: fingerprint,
      unreadCounts: { [String(recipient._id)]: 0, [String(sender._id)]: 0 }
    });
  }

  try {
    await conversation.save();
  } catch (err) {
    if (err.code === 11000) {
      throw conflict('A request already exists. Refresh and try again.', { code: 'DM_RACE' });
    }
    throw err;
  }

  await bumpReputation(sender._id, { coldRequests: 1 });

  // Requests never push. A filtered request does not raise the Requests badge;
  // the recipient finds it in the separate Filtered lane.
  return {
    conversation: toConversationView(conversation, sender._id, recipient),
    direct: false
  };
}

async function loadConversationForUser(conversationId, userId) {
  if (!isId(conversationId)) throw notFound('Conversation not found.');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !hasUser(conversation.participantIds, userId)) {
    // 404 rather than 403: a non-participant must not learn that a thread exists.
    throw notFound('Conversation not found.');
  }
  return conversation;
}

async function counterpartFor(conversation, userId) {
  const otherId = otherParticipant(conversation, userId);
  if (!otherId) return null;
  return User.findById(otherId).select(PARTICIPANT_FIELDS).lean();
}

async function getConversation({ conversationId, userId }) {
  const conversation = await loadConversationForUser(conversationId, userId);
  const counterpart = await counterpartFor(conversation, userId);

  let messages = [];
  if (conversation.state !== 'request') {
    messages = await DirectMessage.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
  }

  return {
    conversation: toConversationView(conversation, userId, counterpart),
    messages: messages.map((message) => toMessageView(message, userId))
  };
}

async function listConversations({ userId, folder = 'inbox', scope = 'all', unreadOnly = false, before = null, limit = 30 }) {
  const me = String(userId);
  const take = Math.min(Math.max(Number(limit) || 30, 1), 50);
  if (!['all', 'personal', 'business'].includes(scope)) throw badRequest('Unknown conversation scope.');
  const query = {};
  let sort = { lastMessageAt: -1, createdAt: -1 };
  let cursorField = 'lastMessageAt';

  if (folder === 'inbox') {
    query.participantIds = userId;
    query.state = 'active';
    query.archivedBy = { $ne: userId };
  } else if (folder === 'requests') {
    query.recipientId = userId;
    query.state = 'request';
    query.requestExpiresAt = { $gt: new Date() };
    query.filteredAt = null;
    sort = { createdAt: -1 };
    cursorField = 'createdAt';
  } else if (folder === 'filtered') {
    query.recipientId = userId;
    query.state = 'request';
    query.requestExpiresAt = { $gt: new Date() };
    query.filteredAt = { $type: 'date' };
    sort = { createdAt: -1 };
    cursorField = 'createdAt';
  } else if (folder === 'sent') {
    query.initiatorId = userId;
    query.state = 'request';
    sort = { createdAt: -1 };
    cursorField = 'createdAt';
  } else if (folder === 'archived') {
    query.participantIds = userId;
    query.state = 'active';
    query.archivedBy = userId;
  } else {
    throw badRequest('Unknown inbox folder.');
  }

  if (scope === 'business') query.businessThread = true;
  if (scope === 'personal') query.businessThread = { $ne: true };
  // Unread is an active-thread concept; pending requests never carry a count.
  if (unreadOnly && ['inbox', 'archived'].includes(folder)) {
    query[`unreadCounts.${me}`] = { $gt: 0 };
  }

  if (before) {
    const when = new Date(before);
    if (Number.isNaN(when.getTime())) throw badRequest('Invalid cursor.');
    query[cursorField] = { $lt: when };
  }

  const conversations = await Conversation.find(query).sort(sort).limit(take + 1).lean();
  const hasMore = conversations.length > take;
  const page = hasMore ? conversations.slice(0, take) : conversations;
  const counterparts = await findCounterparts(page, userId);

  const counts = await summary({ userId });

  return {
    items: page.map((conversation) =>
      toConversationView(conversation, me, counterparts.get(String(otherParticipant(conversation, me))))
    ),
    nextCursor:
      hasMore && page.length
        ? new Date(page[page.length - 1][cursorField]).toISOString()
        : null,
    counts,
    quickReplies: counts.quickReplies,
    savedFilters: counts.savedFilters,
    folder,
    scope,
    unreadOnly: Boolean(unreadOnly)
  };
}

async function teamSummary({ ownerId, role }) {
  const now = new Date();
  const [requests, filtered, active] = await Promise.all([
    Conversation.countDocuments({
      recipientId: ownerId,
      businessThread: true,
      state: 'request',
      requestExpiresAt: { $gt: now },
      filteredAt: null
    }),
    Conversation.countDocuments({
      recipientId: ownerId,
      businessThread: true,
      state: 'request',
      requestExpiresAt: { $gt: now },
      filteredAt: { $type: 'date' }
    }),
    Conversation.find({
      participantIds: ownerId,
      businessThread: true,
      state: 'active',
      archivedBy: { $ne: ownerId }
    })
      .select('unreadCounts')
      .lean()
  ]);

  return {
    requests,
    filtered,
    inbox: active.length,
    unread: active.reduce((total, conversation) => total + unreadFor(conversation, ownerId), 0),
    role
  };
}

/**
 * The shared inbox is a filtered view of the owner's business threads. It
 * never queries the member's own conversations, and it never includes a
 * conversation where `businessThread` is false.
 */
async function listTeamConversations({
  ownerId,
  memberId,
  role,
  folder = 'inbox',
  unreadOnly = false,
  before = null,
  limit = 30
}) {
  const take = Math.min(Math.max(Number(limit) || 30, 1), 50);
  if (!['inbox', 'requests', 'filtered', 'archived'].includes(folder)) {
    throw badRequest('Unknown shared inbox folder.');
  }

  const query = {
    participantIds: ownerId,
    businessThread: true
  };
  let sort = { lastMessageAt: -1, createdAt: -1 };
  let cursorField = 'lastMessageAt';

  if (folder === 'inbox') {
    query.state = 'active';
    query.archivedBy = { $ne: ownerId };
  } else if (folder === 'requests') {
    query.recipientId = ownerId;
    query.state = 'request';
    query.requestExpiresAt = { $gt: new Date() };
    query.filteredAt = null;
    sort = { createdAt: -1 };
    cursorField = 'createdAt';
  } else if (folder === 'filtered') {
    query.recipientId = ownerId;
    query.state = 'request';
    query.requestExpiresAt = { $gt: new Date() };
    query.filteredAt = { $type: 'date' };
    sort = { createdAt: -1 };
    cursorField = 'createdAt';
  } else {
    query.state = 'active';
    query.archivedBy = ownerId;
  }

  if (unreadOnly && ['inbox', 'archived'].includes(folder)) {
    query[`unreadCounts.${String(ownerId)}`] = { $gt: 0 };
  }

  if (before) {
    const when = new Date(before);
    if (Number.isNaN(when.getTime())) throw badRequest('Invalid cursor.');
    query[cursorField] = { $lt: when };
  }

  const conversations = await Conversation.find(query).sort(sort).limit(take + 1).lean();
  const hasMore = conversations.length > take;
  const page = hasMore ? conversations.slice(0, take) : conversations;
  const counterparts = await findCounterparts(page, ownerId);
  const counts = await teamSummary({ ownerId, role });

  return {
    items: page.map((conversation) =>
      toTeamConversationView(
        conversation,
        ownerId,
        role,
        counterparts.get(String(otherParticipant(conversation, ownerId)))
      )
    ),
    nextCursor:
      hasMore && page.length
        ? new Date(page[page.length - 1][cursorField]).toISOString()
        : null,
    counts,
    quickReplies: [],
    savedFilters: [],
    folder,
    scope: 'business',
    unreadOnly: Boolean(unreadOnly),
    team: { ownerId: String(ownerId), role }
  };
}

async function getTeamConversation({ conversationId, ownerId, memberId, role }) {
  const conversation = await loadConversationForUser(conversationId, ownerId);
  if (!conversation.businessThread) throw notFound('Conversation not found.');
  const counterpart = await counterpartFor(conversation, ownerId);

  let messages = [];
  if (conversation.state !== 'request') {
    messages = await DirectMessage.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
  }

  return {
    conversation: toTeamConversationView(conversation, ownerId, role, counterpart),
    messages: messages.map((message) => toMessageView(message, memberId))
  };
}

async function notifyTeamMessage({ conversation, owner, author, message }) {
  const other = otherParticipant(conversation, owner._id);
  if (!other || hasUser(conversation.mutedBy, other)) return;

  const recipient = await User.findById(other).select('dmSettings').lean();
  await notifyUser({
    userId: other,
    type: 'social',
    title: `New message from @${author.username} for @${owner.username}`,
    message: 'A team member replied in your business conversation.',
    actionUrl: `/messages?thread=${conversation._id}`,
    metadata: { conversationId: String(conversation._id), kind: 'dm_message' },
    dedupeKey: `dm:${conversation._id}:${message._id}`,
    silent: isQuietHours(recipient?.dmSettings)
  });
}

/**
 * An agent writes as themselves, but the mailbox side is the owner. This keeps
 * the owner's unread counter and the recipient's reply semantics intact while
 * still attributing the message to the teammate who actually sent it.
 */
async function postTeamMessage({ conversationId, ownerId, memberId, role, sender, text }) {
  const conversation = await loadConversationForUser(conversationId, ownerId);
  if (!conversation.businessThread) throw notFound('Conversation not found.');
  if (conversation.state !== 'active') {
    throw conflict('Accept this request before replying.', { code: 'DM_NOT_ACTIVE' });
  }
  if (role !== 'agent') throw forbidden('Viewer access is read-only.', { code: 'TEAM_READ_ONLY' });

  const normalized = normalizeDmMessage(text);
  if (!normalized.ok) throw badRequest(normalized.reason);

  const owner = await User.findById(ownerId).select('_id username').lean();
  if (!owner) throw notFound('Business not found.');

  const now = new Date();
  const message = await createMessage({
    conversation,
    authorId: memberId,
    text: normalized.text,
    createdAt: now
  });

  const otherId = otherParticipant(conversation, ownerId);
  const update = {
    $set: {
      lastMessageAt: now,
      lastMessagePreview: sanitizeLine(normalized.text, 120),
      [`unreadCounts.${String(ownerId)}`]: 0
    }
  };
  if (otherId) update.$inc = { [`unreadCounts.${String(otherId)}`]: 1 };
  await Conversation.updateOne({ _id: conversation._id, state: 'active' }, update);

  conversation.lastMessageAt = now;
  conversation.lastMessagePreview = sanitizeLine(normalized.text, 120);
  await notifyTeamMessage({ conversation, owner, author: sender, message });

  let autoReply = null;
  if (otherId) {
    const recipient = await User.findById(otherId).select('username dmSettings').lean();
    const settings = normalizeDmSettings(recipient?.dmSettings);
    const lastReply = conversation.autoReplyAt ? new Date(conversation.autoReplyAt).getTime() : 0;
    if (
      settings.availability === 'away' &&
      settings.awayMessage &&
      (!lastReply || now.getTime() - lastReply >= DAY_MS)
    ) {
      autoReply = await createMessage({
        conversation,
        authorId: otherId,
        text: settings.awayMessage,
        createdAt: now
      });
      await Conversation.updateOne(
        { _id: conversation._id, state: 'active' },
        {
          $set: {
            lastMessageAt: now,
            lastMessagePreview: sanitizeLine(settings.awayMessage, 120),
            autoReplyAt: now
          },
          $inc: { [`unreadCounts.${String(ownerId)}`]: 1 }
        }
      );
      conversation.autoReplyAt = now;
      conversation.lastMessagePreview = sanitizeLine(settings.awayMessage, 120);
      if (conversation.unreadCounts && typeof conversation.unreadCounts.set === 'function') {
        conversation.unreadCounts.set(String(ownerId), unreadFor(conversation, ownerId) + 1);
      }
    }
  }

  return {
    message: toMessageView(message, memberId),
    ...(autoReply ? { autoReply: toMessageView(autoReply, memberId) } : {}),
    conversation: toTeamConversationView(
      conversation,
      ownerId,
      role,
      await counterpartFor(conversation, ownerId)
    )
  };
}

async function acceptTeamRequest({ conversationId, ownerId, role }) {
  const conversation = await loadConversationForUser(conversationId, ownerId);
  if (!conversation.businessThread) throw notFound('Conversation not found.');
  const result = await acceptRequest({ conversationId, userId: ownerId });
  return {
    conversation: {
      ...result.conversation,
      labels: [],
      canReply: role === 'agent',
      team: { ownerId: String(ownerId), role }
    }
  };
}

async function declineTeamRequest({ conversationId, ownerId, role }) {
  const conversation = await loadConversationForUser(conversationId, ownerId);
  if (!conversation.businessThread) throw notFound('Conversation not found.');
  const result = await declineRequest({ conversationId, userId: ownerId });
  return {
    conversation: {
      ...result.conversation,
      labels: [],
      canReply: false,
      team: { ownerId: String(ownerId), role }
    }
  };
}

async function markTeamRead({ conversationId, ownerId }) {
  const conversation = await loadConversationForUser(conversationId, ownerId);
  if (!conversation.businessThread) throw notFound('Conversation not found.');
  return markRead({ conversationId, userId: ownerId });
}

async function summary({ userId }) {
  const me = String(userId);
  const now = new Date();
  const [requests, filtered, active, viewer] = await Promise.all([
    Conversation.countDocuments({
      recipientId: userId,
      state: 'request',
      requestExpiresAt: { $gt: now },
      filteredAt: null
    }),
    Conversation.countDocuments({
      recipientId: userId,
      state: 'request',
      requestExpiresAt: { $gt: now },
      filteredAt: { $type: 'date' }
    }),
    Conversation.find({
      participantIds: userId,
      state: 'active',
      archivedBy: { $ne: userId }
    })
      .select('unreadCounts')
      .lean(),
    User.findById(userId).select('dmSettings').lean()
  ]);

  return {
    requests,
    filtered,
    inbox: active.length,
    unread: active.reduce((total, conversation) => total + unreadFor(conversation, me), 0),
    quickReplies: normalizeDmSettings(viewer?.dmSettings).quickReplies,
    savedFilters: normalizeDmSettings(viewer?.dmSettings).savedFilters
  };
}

async function acceptRequest({ conversationId, userId }) {
  const conversation = await loadConversationForUser(conversationId, userId);
  if (String(conversation.recipientId) !== String(userId)) {
    throw forbidden('Only the recipient can accept this request.', { code: 'DM_NOT_RECIPIENT' });
  }
  if (conversation.state !== 'request') {
    throw conflict('That request is no longer pending.', { code: 'DM_NOT_PENDING' });
  }
  if (conversation.requestExpiresAt && new Date(conversation.requestExpiresAt) <= new Date()) {
    await markExpired(conversation);
    throw forbidden('That request has expired.', { code: 'DM_EXPIRED' });
  }

  const now = new Date();
  const requestText = conversation.requestText;
  conversation.state = 'active';
  conversation.acceptedAt = now;
  conversation.requestText = '';
  conversation.requestExpiresAt = null;
  conversation.retryAfter = null;
  conversation.declinedAt = null;
  conversation.unreadCounts = { [String(conversation.recipientId)]: 0, [String(conversation.initiatorId)]: 0 };

  if (requestText) {
    conversation.lastMessageAt = conversation.createdAt;
    conversation.lastMessagePreview = sanitizeLine(requestText, 120);
  }
  await conversation.save();

  let message = null;
  if (requestText) {
    message = await createMessage({
      conversation,
      authorId: conversation.initiatorId,
      text: requestText,
      createdAt: conversation.createdAt
    });
  }

  const initiator = await User.findById(conversation.initiatorId).select('_id username').lean();
  if (initiator) {
    await notifyUser({
      userId: initiator._id,
      type: 'social',
      title: 'Your message request was accepted',
      message: 'You can reply now.',
      actionUrl: `/messages?thread=${conversation._id}`,
      metadata: { conversationId: String(conversation._id), kind: 'dm_accepted' },
      dedupeKey: `dm-accepted:${conversation._id}`
    });
  }

  await bumpReputation(conversation.initiatorId, { accepted: 1 });

  const counterpart = await counterpartFor(conversation, userId);
  return {
    conversation: toConversationView(conversation, userId, counterpart),
    message: message ? toMessageView(message, userId) : null
  };
}

async function declineRequest({ conversationId, userId }) {
  const conversation = await loadConversationForUser(conversationId, userId);
  if (String(conversation.recipientId) !== String(userId)) {
    throw forbidden('Only the recipient can decline this request.', { code: 'DM_NOT_RECIPIENT' });
  }
  if (conversation.state !== 'request') {
    throw conflict('That request is no longer pending.', { code: 'DM_NOT_PENDING' });
  }

  conversation.state = 'declined';
  conversation.declinedAt = new Date();
  conversation.retryAfter = new Date(conversation.declinedAt.getTime() + COOLDOWN_MS);
  conversation.unreadCounts = { [String(conversation.recipientId)]: 0, [String(conversation.initiatorId)]: 0 };
  await conversation.save();

  await bumpReputation(conversation.initiatorId, { declined: 1 });

  return { conversation: toConversationView(conversation, userId, await counterpartFor(conversation, userId)) };
}

async function archiveConversation({ conversationId, userId }) {
  const conversation = await loadConversationForUser(conversationId, userId);
  if (conversation.state !== 'active') {
    throw conflict('Only an active conversation can be archived.', { code: 'DM_NOT_ACTIVE' });
  }
  await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { archivedBy: userId } });
  conversation.archivedBy = [...(conversation.archivedBy || []), userId];
  return { conversation: toConversationView(conversation, userId, await counterpartFor(conversation, userId)) };
}

async function setMuted({ conversationId, userId, muted }) {
  const conversation = await loadConversationForUser(conversationId, userId);
  if (conversation.state !== 'active') {
    throw conflict('Only an active conversation can be muted.', { code: 'DM_NOT_ACTIVE' });
  }
  const update = muted
    ? { $addToSet: { mutedBy: userId } }
    : { $pull: { mutedBy: userId } };
  await Conversation.updateOne({ _id: conversation._id }, update);
  conversation.mutedBy = muted
    ? [...(conversation.mutedBy || []), userId]
    : (conversation.mutedBy || []).filter((id) => String(id) !== String(userId));
  return { conversation: toConversationView(conversation, userId, await counterpartFor(conversation, userId)) };
}

async function setLabels({ conversationId, userId, labels }) {
  const parsed = sanitizeLabels(labels);
  if (!parsed.ok) throw badRequest(parsed.errors[0]);

  const conversation = await loadConversationForUser(conversationId, userId);
  if (conversation.state === 'erased') {
    throw conflict('That conversation is no longer available.', { code: 'DM_UNAVAILABLE' });
  }

  const next = (conversation.labels || [])
    .filter((entry) => String(entry.ownerId) !== String(userId))
    .concat(parsed.value.map((value) => ({ ownerId: userId, value })));

  await Conversation.updateOne({ _id: conversation._id }, { $set: { labels: next } });
  conversation.labels = next;

  return {
    labels: parsed.value,
    conversation: toConversationView(conversation, userId, await counterpartFor(conversation, userId))
  };
}

async function postMessage({ conversationId, sender, text }) {
  const conversation = await loadConversationForUser(conversationId, sender._id);
  if (conversation.state !== 'active') {
    throw conflict('Accept this request before replying.', { code: 'DM_NOT_ACTIVE' });
  }

  const normalized = normalizeDmMessage(text);
  if (!normalized.ok) throw badRequest(normalized.reason);

  const now = new Date();
  const message = await createMessage({
    conversation,
    authorId: sender._id,
    text: normalized.text,
    createdAt: now
  });

  const otherId = otherParticipant(conversation, sender._id);
  const update = {
    $set: {
      lastMessageAt: now,
      lastMessagePreview: sanitizeLine(normalized.text, 120),
      [`unreadCounts.${String(sender._id)}`]: 0
    }
  };
  if (otherId) update.$inc = { [`unreadCounts.${String(otherId)}`]: 1 };
  await Conversation.updateOne({ _id: conversation._id, state: 'active' }, update);

  conversation.lastMessageAt = now;
  conversation.lastMessagePreview = sanitizeLine(normalized.text, 120);
  await notifyMessage({ conversation, author: sender, message });

  // An away note is a courtesy, not a second conversation. It is one message
  // per thread per day and never triggers another auto-reply.
  let autoReply = null;
  if (otherId) {
    const recipient = await User.findById(otherId).select('username dmSettings').lean();
    const settings = normalizeDmSettings(recipient?.dmSettings);
    const lastReply = conversation.autoReplyAt ? new Date(conversation.autoReplyAt).getTime() : 0;
    if (
      settings.availability === 'away' &&
      settings.awayMessage &&
      (!lastReply || now.getTime() - lastReply >= DAY_MS)
    ) {
      autoReply = await createMessage({
        conversation,
        authorId: otherId,
        text: settings.awayMessage,
        createdAt: now
      });
      await Conversation.updateOne(
        { _id: conversation._id, state: 'active' },
        {
          $set: {
            lastMessageAt: now,
            lastMessagePreview: sanitizeLine(settings.awayMessage, 120),
            autoReplyAt: now
          },
          $inc: { [`unreadCounts.${String(sender._id)}`]: 1 }
        }
      );
      conversation.autoReplyAt = now;
      conversation.lastMessagePreview = sanitizeLine(settings.awayMessage, 120);
      if (conversation.unreadCounts && typeof conversation.unreadCounts.set === 'function') {
        conversation.unreadCounts.set(String(sender._id), unreadFor(conversation, sender._id) + 1);
      }
    }
  }

  return {
    message: toMessageView(message, sender._id),
    ...(autoReply ? { autoReply: toMessageView(autoReply, sender._id) } : {}),
    conversation: toConversationView(conversation, sender._id, await counterpartFor(conversation, sender._id))
  };
}

async function markRead({ conversationId, userId }) {
  const conversation = await loadConversationForUser(conversationId, userId);
  if (conversation.state !== 'active') {
    throw conflict('This conversation is not active.', { code: 'DM_NOT_ACTIVE' });
  }
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { [`unreadCounts.${String(userId)}`]: 0 } }
  );
  return { read: true };
}

async function reportConversation({ conversationId, reporterId, reason, note = '', messageIds = [], block = false }) {
  if (!DM_REPORT_REASONS.includes(reason)) throw badRequest('Choose a report reason.');
  const conversation = await loadConversationForUser(conversationId, reporterId);
  const reportedUserId = otherParticipant(conversation, reporterId);
  if (!reportedUserId) throw badRequest('There is no one to report in this conversation.');

  const cleanNote = sanitizeLine(String(note || ''), 500);
  const ids = Array.isArray(messageIds)
    ? messageIds.filter((id) => isId(id)).slice(0, 50)
    : [];

  const report = await DmReport.findOneAndUpdate(
    { reporterId, conversationId: conversation._id },
    {
      $set: {
        reportedUserId,
        reason,
        note: cleanNote,
        messageIds: ids,
        status: 'open'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (block) {
    const now = new Date();
    conversation.state = 'blocked';
    conversation.blockedBy = reporterId;
    conversation.blockedAt = now;
    conversation.retryAfter = new Date(now.getTime() + COOLDOWN_MS);
    conversation.requestText = '';
    await conversation.save();

    // Keep the account-level block list in sync so invitations, search and any
    // future surface enforce the same decision.
    await User.updateOne({ _id: reporterId }, { $addToSet: { blockedUsers: reportedUserId } });
    await User.updateOne(
      { _id: reportedUserId },
      { $pull: { followers: reporterId, following: reporterId } }
    );
    await User.updateOne(
      { _id: reporterId },
      { $pull: { followers: reportedUserId, following: reportedUserId } }
    );
    // Report-and-block must invalidate the same caches as the standalone block
    // endpoint, otherwise the blocked account can linger in feeds/search.
    invalidateVisibility();
  }

  await bumpReputation(reportedUserId, {
    reports: 1,
    ...(block ? { blocks: 1 } : {})
  });

  // A business's public profile does not expose its complaint signal, but three
  // open reports pause outreach until staff review the verification record.
  const business = await BusinessProfile.findOne({ userId: reportedUserId })
    .select('_id complaints')
    .lean();
  if (business) {
    const complaints = await DmReport.countDocuments({
      reportedUserId,
      status: 'open'
    });
    await BusinessProfile.updateOne(
      { _id: business._id },
      {
        $set: {
          complaints,
          ...(complaints >= 3 ? { outreachPaused: true } : {})
        }
      }
    );
  }

  return { report, blocked: Boolean(block) };
}

async function purgeExpiredDmRequests({ now = new Date() } = {}) {
  const result = await Conversation.updateMany(
    { state: 'request', requestExpiresAt: { $lte: now } },
    [
      {
        $set: {
          state: 'expired',
          requestText: '',
          retryAfter: { $add: ['$requestExpiresAt', COOLDOWN_MS] },
          unreadCounts: {}
        }
      }
    ]
  );

  // A declined request keeps its opener for 30 days for abuse review, then the
  // text is dropped while the moderation record (and ids) remain.
  const declinedCutoff = new Date(now.getTime() - 30 * DAY_MS);
  const declined = await Conversation.updateMany(
    { state: 'declined', declinedAt: { $lte: declinedCutoff }, requestText: { $ne: '' } },
    { $set: { requestText: '' } }
  );

  return {
    expired: result.modifiedCount || 0,
    clearedDeclined: declined.modifiedCount || 0
  };
}

async function tombstoneUserDm(userId) {
  const now = new Date();
  await Promise.all([
    DirectMessage.updateMany(
      { authorId: userId, deletedAt: null },
      { $set: { text: '[deleted]', deletedAt: now, deletedBy: userId } }
    ),
    Conversation.updateMany(
      { participantIds: userId },
      {
        $set: { state: 'erased', requestText: '', lastMessagePreview: '' },
        $pull: { mutedBy: userId, archivedBy: userId, labels: { ownerId: userId } }
      }
    ),
    DmReport.deleteMany({ $or: [{ reporterId: userId }, { reportedUserId: userId }] })
  ]);
}

module.exports = {
  createRequest,
  listConversations,
  getConversation,
  acceptRequest,
  declineRequest,
  archiveConversation,
  setMuted,
  setLabels,
  postMessage,
  markRead,
  reportConversation,
  summary,
  listTeamConversations,
  getTeamConversation,
  postTeamMessage,
  acceptTeamRequest,
  declineTeamRequest,
  markTeamRead,
  purgeExpiredDmRequests,
  tombstoneUserDm,
  loadConversationForUser,
  toConversationView,
  toMessageView
};
