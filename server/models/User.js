const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    match: /^[a-zA-Z0-9_]+$/
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^\S+@\S+\.\S+$/
  },
  passwordHash: {
    type: String,
    required: true
  },
  bio: {
    type: String,
    default: '',
    trim: true,
    maxlength: 300
  },
  preferredPlatforms: {
    type: [String],
    enum: ['PC', 'PlayStation', 'Xbox', 'Switch'],
    default: []
  },
  followers:        { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  following:        { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  savedPosts:       { type: [mongoose.Schema.Types.ObjectId], ref: 'Post', default: [] },
  favoriteChannels: { type: [String], default: [] },

  // Gamification (SRS §4.6)
  xp:    { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  medals: [{
    id:          { type: String },
    name:        { type: String },
    icon:        { type: String },
    description: { type: String },
    earnedAt:    { type: Date, default: Date.now }
  }],

  // Role-Based Access Control (SRS §2.3)
  role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },

  // Gamer Passport & Multi-Rig Showcase (Phase 3B)
  gamerPassport: {
    customQuote: { type: String, default: '', trim: true, maxlength: 120 },
    gameIds: {
      riotId:     { type: String, default: '', trim: true, maxlength: 40 },
      steamId:    { type: String, default: '', trim: true, maxlength: 40 },
      psnTag:     { type: String, default: '', trim: true, maxlength: 40 },
      xboxTag:    { type: String, default: '', trim: true, maxlength: 40 },
      discordTag: { type: String, default: '', trim: true, maxlength: 40 }
    },
    activeGames: [{
      gameName:    { type: String, required: true, trim: true, maxlength: 40 },
      platform:    { type: String, enum: ['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile', 'Other'], default: 'PC' },
      rankOrLevel: { type: String, default: '', trim: true, maxlength: 40 }
    }],
    hardwareRigs: [{
      rigName:     { type: String, required: true, trim: true, maxlength: 40 },
      deviceType:  { type: String, enum: ['PC', 'Laptop', 'Mobile', 'Console', 'Handheld'], default: 'PC' },
      isPrimary:   { type: Boolean, default: false },
      specs: {
        cpu:         { type: String, default: '', trim: true, maxlength: 60 },
        gpu:         { type: String, default: '', trim: true, maxlength: 60 },
        ram:         { type: String, default: '', trim: true, maxlength: 40 },
        monitor:     { type: String, default: '', trim: true, maxlength: 60 },
        peripherals: { type: String, default: '', trim: true, maxlength: 120 }
      }
    }]
  }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
