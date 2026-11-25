const mongoose = require('mongoose');
const { Schema } = mongoose;

const CommentSchema = new Schema(
  {
    postId: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    // Platform moderation hide; the thread structure is preserved.
    hiddenAt: {
      type: Date,
      default: null,
    },
    hiddenById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

CommentSchema.index({ hiddenAt: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', CommentSchema);
