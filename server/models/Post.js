const mongoose = require('mongoose');
const { Schema } = mongoose;

const PostSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
  },
  content: {
    type: String,
    default: '',
    maxlength: 10000
  },
  tags: {
    type: [String],
    default: [],
    set: arr => arr.map(t => t.trim().toLowerCase()).slice(0, 10)
  },
  likes: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Denormalised size of `likes`, maintained atomically by every like write
  // (see utils/likeBuffer.likePipeline). Stored so feeds can sort on it without
  // materialising every liker id.
  likeCount: {
    type: Number,
    default: 0,
    min: 0
  },
  commentCount: {
    type: Number,
    default: 0
  },
  mediaUrl: {
    type: String,
    default: null
  },
  mediaType: {
    type: String,
    enum: ['image', 'video', 'none'],
    default: 'none'
  },
  mediaPublicId: {
    type: String,
    default: null
  },
  linkPreview: {
    url:         { type: String, default: null },
    title:       { type: String, default: null },
    description: { type: String, default: null },
    image:       { type: String, default: null },
    siteName:    { type: String, default: null }
  }
}, { timestamps: true });

PostSchema.index({ tags: 1 });
PostSchema.index({ createdAt: -1 });
// Weighted full-text search. The name matches the index created by the
// add-compound-indexes migration so both describe the same index.
PostSchema.index(
  { title: 'text', content: 'text', tags: 'text' },
  { weights: { title: 10, tags: 5, content: 1 }, name: 'posts_text_weighted' }
);

module.exports = mongoose.model('Post', PostSchema);
