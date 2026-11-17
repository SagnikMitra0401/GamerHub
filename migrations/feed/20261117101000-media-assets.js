/**
 * Feed domain: the shared media ledger.
 *
 * Expand + backfill only. Nothing is renamed in Cloudinary, because those
 * public_ids are live in delivered URLs; the migration copies the existing
 * public_id, URL and owner into a MediaAsset row so cleanup and byte
 * accounting finally have one source of truth. New uploads use the new
 * environment/surface folder scheme (utils/mediaPaths).
 *
 * Idempotent: the unique publicId index plus upsert means re-running it after
 * a partial failure simply fills the remaining rows.
 */
const INDEXES = [
  { keys: { publicId: 1 }, options: { unique: true, name: 'media_public_id_unique' } },
  { keys: { surface: 1, createdAt: -1 }, options: { name: 'media_surface_created' } },
  { keys: { status: 1, createdAt: -1 }, options: { name: 'media_status_created' } },
  { keys: { refType: 1, refId: 1 }, options: { name: 'media_ref' } },
  { keys: { ownerId: 1, createdAt: -1 }, options: { name: 'media_owner_created' } }
];

/** Recover the public_id from a Cloudinary delivery URL. */
function publicIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const marker = '/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return null;

  let rest = url.slice(at + marker.length);
  rest = rest.split('?')[0];
  rest = rest.replace(/^v\d+\//, '');
  // Drop any transformation segment before the version-less path.
  if (/^[a-z]{1,3}_[^/]+\//.test(rest)) {
    rest = rest.slice(rest.indexOf('/') + 1);
    rest = rest.replace(/^v\d+\//, '');
  }
  return rest.replace(/\.[a-z0-9]+$/i, '') || null;
}

module.exports = {
  async up(db) {
    const existing = await db.listCollections({ name: 'mediaassets' }).toArray();
    if (!existing.length) await db.createCollection('mediaassets');

    for (const index of INDEXES) {
      await db.collection('mediaassets').createIndex(index.keys, { background: true, ...index.options })
        .catch((err) => {
          if (err?.code !== 85 && err?.code !== 86) throw err;
        });
    }

    // Posts first: the embedded fields are the only record for pre-ledger media.
    const posts = db.collection('posts').find({
      $or: [
        { mediaPublicId: { $type: 'string', $ne: null } },
        { mediaUrl: { $type: 'string', $ne: null } }
      ]
    }).project({
      _id: 1, userId: 1, mediaPublicId: 1, mediaUrl: 1, mediaType: 1, createdAt: 1, mediaAssetId: 1
    });

    for await (const post of posts) {
      const publicId = post.mediaPublicId || publicIdFromUrl(post.mediaUrl);
      if (!publicId) continue;

      const asset = await db.collection('mediaassets').findOneAndUpdate(
        { publicId },
        {
          $setOnInsert: {
            surface: 'post',
            ownerId: post.userId || null,
            provider: 'cloudinary',
            publicId,
            resourceType: post.mediaType === 'video' ? 'video' : 'image',
            format: null,
            mimeType: null,
            bytes: 0,
            width: null,
            height: null,
            url: post.mediaUrl || null,
            derivatives: { thumb: null, card: null, feed: null, full: null },
            status: 'ready',
            refType: 'Post',
            refId: post._id,
            legacy: true,
            schemaVersion: 1,
            createdAt: post.createdAt || new Date(),
            updatedAt: new Date()
          }
        },
        { upsert: true, returnDocument: 'after' }
      );

      const assetId = asset?.value?._id;
      if (assetId && !post.mediaAssetId) {
        await db.collection('posts').updateOne({ _id: post._id }, { $set: { mediaAssetId: assetId } });
      }
    }

    // Chat attachments already carry a public_id; link them to the same ledger.
    const attachments = db.collection('attachments').find({
      cloudinaryId: { $type: 'string', $ne: 'pending' }
    }).project({ _id: 1, uploaderId: 1, cloudinaryId: 1, url: 1, sizeBytes: 1, width: 1, height: 1, createdAt: 1 });

    for await (const attachment of attachments) {
      const asset = await db.collection('mediaassets').findOneAndUpdate(
        { publicId: attachment.cloudinaryId },
        {
          $setOnInsert: {
            surface: 'chat',
            ownerId: attachment.uploaderId || null,
            provider: 'cloudinary',
            publicId: attachment.cloudinaryId,
            resourceType: 'image',
            format: null,
            mimeType: null,
            bytes: attachment.sizeBytes || 0,
            width: attachment.width || null,
            height: attachment.height || null,
            url: attachment.url || null,
            derivatives: { thumb: null, card: null, feed: null, full: null },
            status: 'ready',
            refType: 'Message',
            refId: null,
            legacy: true,
            schemaVersion: 1,
            createdAt: attachment.createdAt || new Date(),
            updatedAt: new Date()
          }
        },
        { upsert: true, returnDocument: 'after' }
      );

      const assetId = asset?.value?._id;
      if (assetId) {
        await db.collection('attachments').updateOne(
          { _id: attachment._id, assetId: { $exists: false } },
          { $set: { assetId } }
        );
      }
    }
  },

  async down(db) {
    // Only the rows this migration created are legacy; new uploads must stay.
    await db.collection('mediaassets').deleteMany({ legacy: true });
    await db.collection('posts').updateMany({}, { $unset: { mediaAssetId: '' } });
    await db.collection('attachments').updateMany({}, { $unset: { assetId: '' } });
    for (const index of INDEXES) {
      await db.collection('mediaassets').dropIndex(index.options.name).catch(() => {});
    }
  }
};
