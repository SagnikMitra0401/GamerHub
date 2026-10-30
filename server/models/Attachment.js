const mongoose = require('mongoose');

/**
 * A file uploaded for a channel message.
 *
 * Rows start as `pending` and only become `ready` once the upload pipeline has
 * validated the bytes and Cloudinary accepted the file. A message may only
 * reference `ready` attachments that its own sender uploaded into its own
 * channel — never an id supplied by someone else.
 */
const AttachmentSchema = new mongoose.Schema({
  channelId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
  communityId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true },
  uploaderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  cloudinaryId: { type: String, required: true },
  url:          { type: String, required: true },
  mimeType:     { type: String, required: true },
  sizeBytes:    { type: Number, required: true },
  width:        { type: Number, default: null },
  height:       { type: Number, default: null },

  // Set once a message references it, so orphan cleanup can find unused rows.
  messageId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

  status: { type: String, enum: ['pending', 'ready', 'rejected'], default: 'pending' }
}, { timestamps: true });

AttachmentSchema.index({ channelId: 1, createdAt: -1 });
AttachmentSchema.index({ uploaderId: 1, status: 1 });

module.exports = mongoose.model('Attachment', AttachmentSchema);
