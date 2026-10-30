/**
 * Attachment reference resolution.
 *
 * Kept in utils (not the controller) so the socket engine can use it without
 * requiring a controller that itself requires the socket.
 */
const mongoose = require('mongoose');

const Attachment = require('../models/Attachment');
const { MAX_ATTACHMENTS_PER_MESSAGE } = require('./fileValidator');

/**
 * The attachment ids a message may reference: this uploader's, in this channel,
 * in this community, already validated. Anything else is dropped silently — a
 * hijacked id must never attach someone else's file.
 *
 * @returns {Promise<Array<import('mongoose').Types.ObjectId>>}
 */
async function resolveAttachments({ attachmentIds, channelId, communityId, uploaderId }) {
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) return [];

  const ids = attachmentIds
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
  if (!ids.length) return [];

  const found = await Attachment.find({
    _id: { $in: ids },
    channelId,
    communityId,
    uploaderId,
    status: 'ready'
  }).select('_id').lean();

  return found.map((row) => row._id);
}

module.exports = { resolveAttachments };
