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
  },

  // Discovery preferences — drive the personalized feed and the gaming bot.
  preferences: {
    favoriteGames:  {
      type: [String],
      default: [],
      set: (arr) => (Array.isArray(arr) ? arr.map((g) => String(g).trim()).filter(Boolean).slice(0, 20) : [])
    },
    favoriteGenres: {
      type: [String],
      default: [],
      set: (arr) => (Array.isArray(arr) ? arr.map((g) => String(g).trim()).filter(Boolean).slice(0, 20) : [])
    },
    platforms: {
      type: [String],
      enum: ['PC', 'PlayStation', 'Xbox', 'Switch'],
      default: []
    }
  },

  // ── Identity & account governance (phase 8) ────────────────────────────
  // 'creator_business' profiles get the contact-consent rules; the flag is
  // deliberately advisory — every enforcement point reads privacySettings,
  // never the profile type.
  profileType: {
    type: String,
    enum: ['personal', 'creator_business'],
    default: 'personal'
  },
  // 'restricted' is a staff-limited account; 'frozen' is a self-service
  // stealth mode (content hidden, participation paused, still able to sign in
  // and unfreeze); 'deletion_pending' keeps the account usable (the owner may
  // change their mind) until the grace period ends and the retention worker
  // anonymises it into 'deleted'.
  status: {
    type: String,
    enum: ['active', 'restricted', 'frozen', 'suspended', 'deletion_pending', 'deleted'],
    default: 'active',
    index: true
  },
  frozenAt: { type: Date, default: null },

  // Google-created accounts have a random, unknowable password hash. They still
  // need a way to confirm a destructive action, so the settings hub asks them
  // to type their username instead of a password they never set.
  hasLocalPassword: { type: Boolean, default: true },

  // Last time the owner reset their feed affinities (audit/UX only — the
  // ranking itself reads preferences and favourite channels).
  feedResetAt: { type: Date, default: null },
  // Bumped by "sign out everywhere" and by a deletion request. Tokens carry
  // the version they were minted with, so an old cookie stops working without
  // a server-side session table.
  sessionVersion: { type: Number, default: 0 },

  authIdentities: [{
    provider: { type: String, enum: ['google', 'local'], required: true },
    // The stable OIDC 'sub' claim — never the email, which can change.
    providerSubject: { type: String, required: true },
    emailVerified: { type: Boolean, default: false }
  }],

  privacySettings: {
    allowSquadInvites:  { type: String, enum: ['anyone', 'followers', 'none'], default: 'anyone' },
    allowServerInvites: { type: String, enum: ['anyone', 'followers', 'none'], default: 'anyone' },
    // Legacy switch, kept for one release so old clients and exports keep
    // working. New code reads dmSettings; the migration maps this value once.
    allowDirectMessages: { type: String, enum: ['anyone', 'mutual_follows', 'none'], default: 'mutual_follows' },
    discoverableInSearch: { type: Boolean, default: true },
    showActivityStatus:   { type: Boolean, default: true }
  },

  // Consent matrix for 1:1 messaging. A missing subdocument is treated as the
  // defaults by dmPolicy, so pre-migration users stay reachable via requests.
  dmSettings: {
    policy: {
      mutual:    { type: String, enum: ['inbox', 'request', 'verified', 'none'], default: 'inbox' },
      follower:  { type: String, enum: ['inbox', 'request', 'verified', 'none'], default: 'request' },
      following: { type: String, enum: ['inbox', 'request', 'verified', 'none'], default: 'request' },
      community: { type: String, enum: ['inbox', 'request', 'verified', 'none'], default: 'request' },
      squad:     { type: String, enum: ['inbox', 'request', 'verified', 'none'], default: 'request' },
      business:  { type: String, enum: ['inbox', 'request', 'verified', 'none'], default: 'request' },
      stranger:  { type: String, enum: ['inbox', 'request', 'verified', 'none'], default: 'request' }
    },
    digest: { type: String, enum: ['off', 'daily', 'weekly'], default: 'daily' },
    // No live notification is pushed during this local window. The message is
    // still persisted for the inbox and the next digest.
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String, default: '22:00' },
      end: { type: String, default: '07:00' },
      timezone: { type: String, default: 'UTC', maxlength: 60 }
    },
    readReceipts: { type: Boolean, default: false },
    hiddenWords: { type: [String], default: [] },
    // Creator-scale inbox controls. A paused inbox refuses *new* requests but
    // leaves every active thread and the account itself untouched.
    availability: { type: String, enum: ['open', 'away', 'paused'], default: 'open' },
    awayMessage: { type: String, default: '', trim: true, maxlength: 200 },
    quickReplies: {
      type: [String],
      default: [],
      set: (arr) => (Array.isArray(arr)
        ? arr.map((entry) => String(entry).trim().slice(0, 300)).filter(Boolean).slice(0, 5)
        : [])
    },
    savedFilters: [{
      _id: false,
      name: { type: String, trim: true, maxlength: 24 },
      folder: { type: String, enum: ['inbox', 'requests', 'filtered', 'sent', 'archived'] },
      scope: { type: String, enum: ['all', 'personal', 'business'], default: 'all' },
      unreadOnly: { type: Boolean, default: false }
    }]
  },

  // People this user never wants to hear from. Enforced server-side for
  // invitations and search; chat muting stays a separate client preference.
  blockedUsers: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  deletionRequestedAt: { type: Date, default: null },

  // Personal mutes: hides another user's content from YOUR client only.
  // Deliberately not a moderation tool — the server keeps delivering the
  // messages so a mute can never be mistaken for a ban.
  mutedUsers: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },

  // Live presence — mirrored to other clients over Socket.io.
  presence: {
    // 'invisible' is stored, but broadcast to others as offline.
    status:      { type: String, enum: ['online', 'in_game', 'offline', 'invisible'], default: 'offline' },
    activeGame:  { type: String, default: '', trim: true, maxlength: 60 },
    lastActive:  { type: Date, default: null }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
