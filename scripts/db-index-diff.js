#!/usr/bin/env node
/**
 * Read-only index audit.
 *
 * Indexes are declared twice (in the Mongoose model and in a migration). This
 * prints the difference between the live collection and the schema declaration
 * so a missing or stray index is visible before it becomes a slow query.
 *
 *   npm run db:indexes
 *
 * It connects read-only in spirit: no index is created or dropped here.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const path = require('path');

const MODELS = [
  'User',
  'Post',
  'Comment',
  'Community',
  'Channel',
  'Message',
  'Party',
  'Notification',
  'AuditLog',
  'Report',
  'Game',
  'MediaAsset',
  'Attachment',
  'Follow',
  'SavedPost',
  'UserBlock',
  'UserMute',
];

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`Index audit against ${mongoose.connection.name}\n`);

  let differences = 0;
  for (const name of MODELS) {
    const modelPath = path.join(__dirname, '..', 'server', 'models', `${name}.js`);
    let Model;
    try {
      Model = require(modelPath);
    } catch {
      continue;
    }

    let live = [];
    try {
      live = await Model.collection.indexes();
    } catch (err) {
      if (err?.codeName === 'NamespaceNotFound') {
        console.log(`${name.padEnd(14)} collection does not exist yet`);
        continue;
      }
      throw err;
    }

    const declared = (Model.schema.indexes() || []).map(([keys, options = {}]) => ({
      name:
        options.name ||
        Object.keys(keys)
          .map((key) => `${key}_1`)
          .join('_'),
      keys,
    }));
    const liveNames = new Set(live.map((index) => index.name));
    const declaredNames = new Set(declared.map((index) => index.name));

    const missing = declared.filter((index) => !liveNames.has(index.name));
    const extra = live.filter((index) => index.name !== '_id_' && !declaredNames.has(index.name));

    if (!missing.length && !extra.length) {
      console.log(
        `${name.padEnd(14)} in sync (${live.length} index${live.length === 1 ? '' : 'es'})`,
      );
      continue;
    }

    differences += missing.length + extra.length;
    console.log(`${name.padEnd(14)} ${missing.length} missing, ${extra.length} not in schema`);
    for (const index of missing) console.log(`  missing: ${index.name}`);
    for (const index of extra) console.log(`  extra:   ${index.name}`);
  }

  console.log(`\n${differences} difference(s).`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
