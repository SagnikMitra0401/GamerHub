const mongoose = require('mongoose');

/**
 * A canonical game.
 *
 * Games arrive from three directions: the free FreeToGame catalog, optional
 * IGDB enrichment, and the free-text titles players already type into
 * onboarding, LFG and their passport. This collection is the single place
 * those names resolve to, so "Apex" and "Apex Legends" can be one page instead
 * of two unrelated strings.
 *
 * `key` is the canonical, accent- and punctuation-insensitive identity and is
 * unique. `aliasKeys` lets an admin merge a duplicate without deleting its
 * key: the merged row points at the survivor and the survivor answers to the
 * old name too.
 */
const GameSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, maxlength: 90 },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    key: { type: String, required: true, unique: true, trim: true, maxlength: 160 },
    aliases: { type: [String], default: [] },
    aliasKeys: { type: [String], default: [] },

    summary: { type: String, default: '', maxlength: 4000 },
    cover: {
      url: { type: String, default: null },
      imageId: { type: String, default: null }
    },
    screenshots: { type: [String], default: [] },
    genres: { type: [String], default: [] },
    platforms: { type: [String], default: [] },
    releaseYear: { type: Number, default: null },
    requirements: {
      os: { type: String, default: '' },
      processor: { type: String, default: '' },
      memory: { type: String, default: '' },
      graphics: { type: String, default: '' },
      storage: { type: String, default: '' }
    },

    externalIds: {
      igdb: { type: Number, default: null },
      rawg: { type: Number, default: null },
      freetogame: { type: Number, default: null },
      steam: { type: Number, default: null }
    },

    // Counters are maintained by the write path (follow, sync) rather than
    // recomputed for every rail. Detail pages still read live counts.
    stats: {
      favoriteCount: { type: Number, default: 0, min: 0 },
      squadCount: { type: Number, default: 0, min: 0 },
      serverCount: { type: Number, default: 0, min: 0 },
      postCount: { type: Number, default: 0, min: 0 },
      playerCount: { type: Number, default: 0, min: 0 }
    },

    source: {
      type: String,
      enum: ['freetogame', 'igdb', 'user', 'seed'],
      default: 'user'
    },
    // `provisional` rows come from a player typing a title the providers do not
    // know yet. They are browsable and linkable; an admin can hide or merge them.
    status: {
      type: String,
      enum: ['provisional', 'published', 'hidden', 'merged'],
      default: 'provisional',
      index: true
    },
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', default: null },

    lastSyncedAt: { type: Date, default: null },
    // Set after the one-time provider detail import (description, screenshots,
    // requirements), so a page view never repeats the upstream call.
    detailFetchedAt: { type: Date, default: null },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

GameSchema.index(
  { title: 'text', aliases: 'text', summary: 'text' },
  { weights: { title: 10, aliases: 6, summary: 1 }, name: 'game_text_search' }
);
GameSchema.index({ genres: 1, 'stats.favoriteCount': -1 });
GameSchema.index({ status: 1, 'stats.favoriteCount': -1 });
GameSchema.index({ releaseYear: -1 });
GameSchema.index({ aliasKeys: 1 });

module.exports = mongoose.model('Game', GameSchema);
