/**
 * Channel attachments.
 *
 * Upload is a separate step from sending: the file is validated, normalised and
 * stored first, and only then can a message reference it. That ordering means a
 * message never points at a file that failed validation.
 *
 * Delivery is authorised on every read: Cloudinary URLs are signed per request
 * with a short expiry, so a URL copied out of a private server stops working.
 */
const mongoose = require('mongoose');

const Attachment = require('../models/Attachment');
const { cloudinary } = require('../config/cloudinary');
const { CAP } = require('../utils/permissions');
const { loadChannelAccess } = require('../utils/channelAccess');
const { validateImageUpload, MAX_ATTACHMENT_BYTES } = require('../utils/fileValidator');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { emitToChannel } = require('../config/socket');

const SIGNED_URL_TTL_SECONDS = 15 * 60;

/** sharp is optional: uploads still work (bytes are validated) without it. */
function loadSharp() {
  try {
    // eslint-disable-next-line global-require
    return require('sharp');
  } catch {
    return null;
  }
}

const uploadsConfigured = () =>
  Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

/** Strip EXIF (GPS!) and cap the pixel dimensions before anything is stored. */
async function normaliseImage(buffer, mimeType) {
  // GIFs are passed through untouched: re-encoding drops animation and GIF
  // carries no EXIF block to leak.
  if (mimeType === 'image/gif') {
    return { buffer, width: null, height: null };
  }

  const sharp = loadSharp();
  if (!sharp) return { buffer, width: null, height: null };

  try {
    const pipeline = sharp(buffer, { failOn: 'error' })
      .rotate() // honour, then drop, the EXIF orientation tag
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    // A corrupt image is rejected rather than stored: sharp could not decode it,
    // so neither could a browser, and it may be a polyglot file.
    throw badRequest('That image could not be processed.');
  }
}

function uploadBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'gaming-hub/chat',
        resource_type: 'image',
        // Cloudinary keeps no metadata block for chat images.
        image_metadata: false
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

// ─── POST /api/communities/channels/:channelId/attachments ──────────────────
const uploadAttachment = async (req, res, next) => {
  let attachment = null;
  try {
    if (!uploadsConfigured()) {
      throw badRequest('Image uploads are not configured on this server.');
    }

    const { channel, community } = await loadChannelAccess({
      channelId: req.params.channelId,
      userId: req.user._id,
      capability: CAP.ATTACH_FILES
    });

    if (channel.type === 'forum') {
      throw badRequest('Attach images to forum replies from the forum composer.');
    }
    if (channel.attachmentsEnabled === false) {
      throw forbidden('Attachments are disabled in this channel.');
    }
    if (!req.file) throw badRequest('Choose an image to upload.');
    if (req.file.size > MAX_ATTACHMENT_BYTES) throw badRequest('Images must be 8 MB or smaller.');

    const validated = validateImageUpload({
      buffer: req.file.buffer,
      claimedMime: req.file.mimetype,
      sizeBytes: req.file.size
    });
    if (!validated.ok) throw badRequest(validated.reason);

    const normalised = await normaliseImage(req.file.buffer, validated.mimeType);

    attachment = await Attachment.create({
      channelId: channel._id,
      communityId: community._id,
      uploaderId: req.user._id,
      cloudinaryId: 'pending',
      url: 'pending',
      mimeType: validated.mimeType,
      sizeBytes: normalised.buffer.length,
      width: normalised.width,
      height: normalised.height,
      status: 'pending'
    });

    const result = await uploadBuffer(normalised.buffer);

    attachment.cloudinaryId = result.public_id;
    attachment.url = result.secure_url;
    attachment.status = 'ready';
    await attachment.save();

    res.status(201).json({
      attachment: {
        _id: attachment._id,
        url: attachment.url,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height
      }
    });
  } catch (err) {
    // Never leave a half-registered row behind.
    if (attachment && attachment.status !== 'ready') {
      attachment.status = 'rejected';
      await attachment.save().catch(() => {});
    }
    next(err);
  }
};

// ─── GET .../attachments/:attachmentId (authorised signed URL) ──────────────
const getAttachmentUrl = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.attachmentId))) {
      throw badRequest('Invalid attachment id');
    }

    const { channel, community } = await loadChannelAccess({
      channelId: req.params.channelId,
      userId: req.user._id
    });

    const attachment = await Attachment.findOne({
      _id: req.params.attachmentId,
      channelId: channel._id,
      communityId: community._id,
      status: 'ready'
    }).lean();

    if (!attachment) throw notFound('Attachment not found.');

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const url = cloudinary.url(attachment.cloudinaryId, {
      sign_url: true,
      secure: true,
      expires_at: expiresAt,
      resource_type: 'image'
    });

    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({ url, expiresAt });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE .../attachments/:attachmentId ───────────────────────────────────
const deleteAttachment = async (req, res, next) => {
  try {
    const { channel, community, permissions } = await loadChannelAccess({
      channelId: req.params.channelId,
      userId: req.user._id
    });

    const attachment = await Attachment.findOne({
      _id: req.params.attachmentId,
      channelId: channel._id,
      communityId: community._id
    });

    if (!attachment) throw notFound('Attachment not found.');

    const isUploader = String(attachment.uploaderId) === String(req.user._id);
    if (!isUploader && !permissions.includes(CAP.MANAGE_MESSAGES)) {
      throw forbidden('Only the uploader or a moderator can delete this attachment.');
    }

    await cloudinary.uploader.destroy(attachment.cloudinaryId, { resource_type: 'image' })
      .catch(() => {}); // a missing remote file must not block the local delete

    await attachment.deleteOne();

    emitToChannel(channel._id, 'attachment_deleted', {
      channelId: String(channel._id),
      attachmentId: String(attachment._id)
    });

    res.status(200).json({ message: 'Attachment deleted.', attachmentId: String(attachment._id) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadAttachment,
  getAttachmentUrl,
  deleteAttachment,
  SIGNED_URL_TTL_SECONDS
};
