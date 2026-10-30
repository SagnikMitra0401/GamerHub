/**
 * Phase 7 indexes: forum channels, message search/pinning, attachments, reports.
 *
 * Only the queries the controllers actually run are indexed here. Chat history
 * `{ channelId, createdAt }` already exists from the first migration and is not
 * duplicated. Mongo allows one text index per collection, so messages and
 * forumposts each get exactly one.
 */

const TEXT_INDEX = 'message_text_search';
const FORUM_TEXT_INDEX = 'forumpost_text_weighted';

async function dropIndexIfPresent(collection, name) {
  try {
    await collection.dropIndex(name);
  } catch (err) {
    // 27 = IndexNotFound. Anything else is a real failure.
    if (err.code !== 27 && !/index not found/i.test(err.message)) throw err;
  }
}

async function safeCreateIndex(collection, keys, options = {}) {
  try {
    const indexes = await collection.indexes();
    const keysJson = JSON.stringify(keys);
    for (const idx of indexes) {
      if (idx.name === options.name) return;
      if (JSON.stringify(idx.key) === keysJson) {
        await collection.dropIndex(idx.name);
        break;
      }
    }
  } catch (err) {
    // Collection might not exist yet; safe to proceed to createIndex
  }
  await collection.createIndex(keys, options);
}

module.exports = {
  async up(db) {
    // ── Messages ────────────────────────────────────────────────────────────
    await safeCreateIndex(
      db.collection('messages'),
      { channelId: 1, pinned: 1, createdAt: -1 },
      { name: 'messages_channel_pinned' }
    );
    await safeCreateIndex(
      db.collection('messages'),
      { text: 'text' },
      { name: TEXT_INDEX, default_language: 'english' }
    );

    // ── Forum posts ─────────────────────────────────────────────────────────
    await safeCreateIndex(
      db.collection('forumposts'),
      { channelId: 1, pinned: -1, lastReplyAt: -1, createdAt: -1 },
      { name: 'forumpost_channel_feed' }
    );
    await safeCreateIndex(
      db.collection('forumposts'),
      { channelId: 1, status: 1, createdAt: -1 },
      { name: 'forumpost_channel_status' }
    );
    await safeCreateIndex(
      db.collection('forumposts'),
      { channelId: 1, tags: 1 },
      { name: 'forumpost_tags' }
    );
    await safeCreateIndex(
      db.collection('forumposts'),
      { title: 'text', body: 'text' },
      { weights: { title: 10, body: 1 }, name: FORUM_TEXT_INDEX }
    );

    // ── Forum replies ───────────────────────────────────────────────────────
    await safeCreateIndex(
      db.collection('forumreplies'),
      { postId: 1, createdAt: 1 },
      { name: 'forumreply_post_created' }
    );

    // ── Attachments ─────────────────────────────────────────────────────────
    await safeCreateIndex(
      db.collection('attachments'),
      { channelId: 1, createdAt: -1 },
      { name: 'attachment_channel_created' }
    );
    await safeCreateIndex(
      db.collection('attachments'),
      { uploaderId: 1, status: 1 },
      { name: 'attachment_uploader_status' }
    );

    // ── Reports ─────────────────────────────────────────────────────────────
    await safeCreateIndex(
      db.collection('reports'),
      { communityId: 1, status: 1, createdAt: -1 },
      { name: 'report_community_status' }
    );
    // Duplicate reports are a no-op at the controller level; this index is the
    // reason the controller can rely on err.code 11000.
    await safeCreateIndex(
      db.collection('reports'),
      { reporterId: 1, targetId: 1 },
      { name: 'report_reporter_target', unique: true }
    );

    // ── Communities ─────────────────────────────────────────────────────────
    await safeCreateIndex(
      db.collection('communities'),
      { 'bannedUsers.userId': 1 },
      { name: 'community_banned_user' }
    );
  },

  async down(db) {
    const drops = [
      ['messages', ['messages_channel_pinned', TEXT_INDEX]],
      ['forumposts', ['forumpost_channel_feed', 'forumpost_channel_status', 'forumpost_tags', FORUM_TEXT_INDEX]],
      ['forumreplies', ['forumreply_post_created']],
      ['attachments', ['attachment_channel_created', 'attachment_uploader_status']],
      ['reports', ['report_community_status', 'report_reporter_target']],
      ['communities', ['community_banned_user']]
    ];

    for (const [name, indexes] of drops) {
      for (const index of indexes) {
        await dropIndexIfPresent(db.collection(name), index);
      }
    }
  }
};
