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
    image:       { type: String, default: null }
  }
}, { timestamps: true });

PostSchema.index({ tags: 1 });
PostSchema.index({ createdAt: -1 });
PostSchema.index({ title: 'text', content: 'text', tags: 'text' }); // full-text search

PostSchema.virtual('likeCount').get(function () {
  return this.likes.length;
});
PostSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Post', PostSchema);
