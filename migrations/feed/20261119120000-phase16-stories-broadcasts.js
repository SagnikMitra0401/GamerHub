/**
 * Feed domain: Phase 16 — video metadata, 24-hour stories, broadcast channels.
 *
 * Expand + backfill only:
 *   - `posts` gains `videoSource`, `youtubeId`, `durationSeconds` and an index
 *     for the `mediaType=video` clips query.
 *   - `stories` / `storyviews` get their TTL, author and uniqueness indexes.
 *   - `broadcastchannels` / `broadcastmessages` / `broadcastsubscriptions` get
 *     the discovery, paging and unique-subscription indexes.
 *
 * Idempotent: every index is created with `createIndex` (codes 85/86 mean it is
 * already there) and the backfill only touches rows that are still missing the
 * field, so a partial run can simply be repeated.
 */

const INDEXES = [
  ['posts', [
    { keys: { mediaType: 1, createdAt: -1 }, options: { name: 'post_media_created' } }
  ]],
  ['stories', [
    { keys: { authorId: 1, createdAt: -1 }, options: { name: 'story_author_created' } },
    { keys: { visibility: 1, createdAt: -1 }, options: { name: 'story_visibility_created' } },
    { keys: { expiresAt: 1 }, options: { name: 'story_expiry_ttl', expireAfterSeconds: 0 } }
  ]],
  ['storyviews', [
    { keys: { storyId: 1, viewerId: 1 }, options: { name: 'story_view_unique', unique: true } },
    { keys: { storyId: 1, createdAt: -1 }, options: { name: 'story_view_recent' } },
    { keys: { createdAt: 1 }, options: { name: 'story_view_ttl', expireAfterSeconds: 30 * 24 * 60 * 60 } }
  ]],
  ['broadcastchannels', [
    { keys: { ownerId: 1, createdAt: -1 }, options: { name: 'broadcast_owner_created' } },
    { keys: { isPublic: 1, subscriberCount: -1, createdAt: -1 }, options: { name: 'broadcast_discover' } },
    { keys: { category: 1, isPublic: 1 }, options: { name: 'broadcast_category_public' } }
  ]],
  ['broadcastmessages', [
    { keys: { channelId: 1, publishedAt: -1 }, options: { name: 'broadcast_message_recent' } },
    { keys: { channelId: 1, _id: -1 }, options: { name: 'broadcast_message_cursor' } }
  ]],
  ['broadcastsubscriptions', [
    { keys: { channelId: 1, userId: 1 }, options: { name: 'broadcast_subscription_unique', unique: true } },
    { keys: { userId: 1, updatedAt: -1 }, options: { name: 'broadcast_subscription_user' } }
  ]]
];

/** Same rules as server/utils/videoSource.js, inlined so history stays frozen. */
function parseYouTubeId(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const hosts = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
  if (!hosts.has(host)) return null;

  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || null;
  else if (url.searchParams.get('v')) id = url.searchParams.get('v');
  else {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function parseYouTubeFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const candidate of text.match(/https?:\/\/[^\s<>"']+/gi) || []) {
    const id = parseYouTubeId(candidate);
    if (id) return id;
  }
  return null;
}

async function ensureCollection(db, name) {
  const existing = await db.listCollections({ name }).toArray();
  if (!existing.length) await db.createCollection(name);
}

module.exports = {
  async up(db) {
    for (const [name, indexes] of INDEXES) {
      await ensureCollection(db, name);
      for (const index of indexes) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection(name).createIndex(index.keys, { background: true, ...index.options })
          .catch((err) => {
            if (err?.code !== 85 && err?.code !== 86) throw err;
          });
      }
    }

    // Uploaded videos predate the field; mark them so the client can pick a player.
    await db.collection('posts').updateMany(
      {
        mediaType: 'video',
        $or: [{ videoSource: null }, { videoSource: { $exists: false } }]
      },
      { $set: { videoSource: 'upload' } }
    );

    // Link-only posts may already point at YouTube; derive the id without a
    // network call, exactly as the create path now does.
    const linked = db.collection('posts')
      .find({ mediaType: { $ne: 'video' }, 'linkPreview.url': { $type: 'string', $ne: '' } })
      .project({ title: 1, content: 1, linkPreview: 1, youtubeId: 1, videoSource: 1 });

    for await (const post of linked) {
      if (post.youtubeId) continue;
      const id = parseYouTubeId(post.linkPreview?.url)
        || parseYouTubeFromText(`${post.title || ''} ${post.content || ''}`);
      if (!id) continue;

      await db.collection('posts').updateOne(
        { _id: post._id },
        { $set: { youtubeId: id, videoSource: 'youtube' } }
      );
    }
  },

  async down(db) {
    await db.collection('posts').updateMany(
      {},
      { $unset: { videoSource: '', youtubeId: '', durationSeconds: '' } }
    );

    for (const [name, indexes] of INDEXES) {
      for (const index of indexes) {
        // eslint-disable-next-line no-await-in-loop
        if (name === 'posts') {
          await db.collection(name).dropIndex(index.options.name).catch(() => {});
          continue;
        }
        await db.collection(name).dropIndex(index.options.name).catch(() => {});
      }
    }

    // These collections were introduced by this migration, so rolling it back
    // removes their rows. The collections themselves stay (nothing is dropped).
    for (const name of ['storyviews', 'stories', 'broadcastsubscriptions', 'broadcastmessages', 'broadcastchannels']) {
      await db.collection(name).deleteMany({ _id: { $exists: true } }).catch(() => {});
    }
  }
};
