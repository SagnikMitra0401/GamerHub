/**
 * migrate-mongo configuration.
 *
 * Prisma is not used: its MongoDB connector has no migration DDL, so it cannot
 * add indexes or backfill fields. migrate-mongo stores applied migrations in the
 * `changelog` collection and runs only the files that have not been recorded.
 *
 * The database name is normally part of MONGO_URI (Atlas includes it). It is
 * parsed from the URI so this file never hardcodes a database that differs from
 * the one the app actually writes to.
 */
require('dotenv').config();
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const MONGO_URI = process.env.MONGO_URI || '';

function databaseNameFrom(uri) {
  const withoutScheme = String(uri).replace(/^mongodb(\+srv)?:\/\//, '');
  const slash = withoutScheme.indexOf('/');
  if (slash === -1) return null;
  const name = withoutScheme.slice(slash + 1).split('?')[0].trim();
  return name || null;
}

const config = {
  mongodb: {
    url: MONGO_URI,
    databaseName: databaseNameFrom(MONGO_URI) || 'gaming-hub',
    options: {
      // Driver 4+ no longer needs useNewUrlParser / useUnifiedTopology.
      serverSelectionTimeoutMS: 10000
    }
  },

  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  lockCollectionName: 'changelog_lock',
  lockTtl: 0,
  migrationFileExtension: '.js',
  useFileHash: false,

  // This project is CommonJS; the runner itself ships as ESM.
  moduleSystem: 'commonjs'
};

module.exports = config;
