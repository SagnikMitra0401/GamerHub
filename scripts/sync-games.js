#!/usr/bin/env node
/**
 * Sync game reference data.
 *
 *   npm run games:sync                 # FreeToGame base catalog
 *   npm run games:sync -- --igdb "Hades"  # optional IGDB enrichment
 *
 * This is a job, not a migration: the catalog is reference data and must be
 * refreshable without deploying or changing schema.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../server/config/db');
const gameService = require('../server/services/gameService');
const igdb = require('../server/utils/gameProviders/igdb');

async function run() {
  await connectDB();
  const args = process.argv.slice(2);
  const igdbFlag = args.indexOf('--igdb');
  const query = igdbFlag !== -1 ? args[igdbFlag + 1] : '';

  const result = query
    ? await gameService.syncIgdbSearch(query, { limit: 20 })
    : await gameService.syncFreeToPlay({ limit: 240 });

  console.log('Game sync complete:', result);
  if (query && !igdb.configured()) {
    console.log('IGDB is not configured; set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use it.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Game sync failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
