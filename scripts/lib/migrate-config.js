/**
 * Shared migrate-mongo configuration factory.
 *
 * Each workload domain owns an independent migration track: its own folder, its
 * own `changelog_<domain>` collection and its own lock. A squads migration that
 * fails (or is mid-flight) therefore cannot block an identity migration, which
 * is the whole point of splitting them.
 *
 * `migrations/` (the original track) is intentionally left in place so the
 * already-applied history in the `changelog` collection stays valid.
 */
require('dotenv').config();
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

function databaseNameFrom(uri) {
  const withoutScheme = String(uri || '').replace(/^mongodb(\+srv)?:\/\//, '');
  const slash = withoutScheme.indexOf('/');
  if (slash === -1) return null;
  const name = withoutScheme.slice(slash + 1).split('?')[0].trim();
  return name || null;
}

const DOMAINS = ['auth', 'feed', 'communities', 'squads'];

function domainMigrateConfig(domain) {
  if (!DOMAINS.includes(domain)) {
    throw new Error(`Unknown migration domain "${domain}". Expected one of: ${DOMAINS.join(', ')}`);
  }

  const uri = process.env.MONGO_URI || '';

  return {
    mongodb: {
      url: uri,
      databaseName: databaseNameFrom(uri) || 'gaming-hub',
      options: { serverSelectionTimeoutMS: 10000 }
    },
    migrationsDir: `migrations/${domain}`,
    changelogCollectionName: `changelog_${domain}`,
    lockCollectionName: `changelog_${domain}_lock`,
    lockTtl: 0,
    migrationFileExtension: '.js',
    useFileHash: false,
    // This project is CommonJS; the runner itself ships as ESM.
    moduleSystem: 'commonjs'
  };
}

module.exports = domainMigrateConfig;
module.exports.DOMAINS = DOMAINS;
