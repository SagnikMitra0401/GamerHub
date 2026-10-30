/**
 * Domain-partitioned database access.
 *
 * The platform is split into four workload domains:
 *
 *   auth        identity, sessions, privacy   — low write, no downtime allowed
 *   feed        posts, comments, notifications — high read, heavy text indexes
 *   communities servers, channels, messages    — append-only, moderation heavy
 *   squads      temporary squad chats          — highest write velocity, TTL'd
 *
 * Why only `squads` gets a second driver connection:
 * Mongoose `populate()` only resolves models registered on the SAME connection.
 * Splitting identity from the feed would turn every `Post.populate('userId')`
 * into a MissingSchemaError, and community members / party leaders / post
 * authors are populated everywhere. Rather than sprinkle manual joins through
 * the whole codebase (a large, silent regression risk), the three stable
 * domains intentionally share one pool, and the temporary squad-chat domain —
 * the one whose burst writes could actually starve auth and feed queries — is
 * isolated on its own pool with its own ceiling.
 *
 * That keeps the operational goal (a chat burst can never exhaust the
 * connections auth needs) without inventing cross-connection populate
 * machinery. `MONGO_URI_SQUADS` may point at a different cluster entirely; it
 * falls back to `MONGO_URI`, so single-cluster deployments cost nothing extra.
 */

const mongoose = require('mongoose');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const DOMAIN_LIMITS = Object.freeze({
  auth: 10,
  feed: 15,
  communities: 20,
  squads: 20
});

/** Squads are the only domain with its own driver connection. */
const POOLED_DOMAINS = Object.freeze(['squads']);

let squadConnection = null;

const isTest = () => process.env.NODE_ENV === 'test';

/**
 * Resolve the URI for one domain.
 * Under NODE_ENV=test the base URI always wins: a test run must never be able
 * to touch a cluster named in a domain-specific variable.
 */
function domainUri(domain) {
  const base = process.env.MONGO_URI;
  if (!base) return '';
  if (isTest()) return base;
  const key = `MONGO_URI_${domain.toUpperCase()}`;
  return process.env[key] || base;
}

const connectionOptions = (domain) => ({
  maxPoolSize: Number(process.env[`MONGO_MAX_POOL_SIZE_${domain.toUpperCase()}`]) || DOMAIN_LIMITS[domain],
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
});

/**
 * The connection that owns a domain.
 * Stable domains return the default connection (already opened by connectDB);
 * the squads domain opens its own pool on first use and degrades to the default
 * connection when no URI is configured (unit tests, offline scripts).
 */
function getDomainConnection(domain) {
  if (!POOLED_DOMAINS.includes(domain)) return mongoose.connection;

  if (!squadConnection) {
    const uri = domainUri('squads');
    if (!uri) return mongoose.connection;
    squadConnection = mongoose.createConnection(uri, connectionOptions('squads'));
    // A failed pool must not crash the process; callers handle the retry.
    squadConnection.on('error', (err) => {
      console.error('[DB] squad domain connection error:', err.message);
    });
  }
  return squadConnection;
}

/** Register a model on the connection that owns `domain`. */
function domainModel(domain, name, schema) {
  const connection = getDomainConnection(domain);
  return connection.models[name] || connection.model(name, schema);
}

/** Squad-domain model helper (temporary chat collections). */
const squadModel = (name, schema) => domainModel('squads', name, schema);

/** Ready states per domain, for /api/health and start-up logs. */
function domainStatus() {
  const read = (connection) => {
    const state = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    return state[connection?.readyState] ?? 'unknown';
  };
  return {
    auth: read(mongoose.connection),
    feed: read(mongoose.connection),
    communities: read(mongoose.connection),
    squads: read(getDomainConnection('squads')),
    squadsIsolated: getDomainConnection('squads') !== mongoose.connection
  };
}

/** Close the extra pool on shutdown / test teardown. */
async function closeDomainConnections() {
  if (!squadConnection) return;
  const connection = squadConnection;
  squadConnection = null;
  await connection.close().catch(() => {});
}

module.exports = {
  DOMAIN_LIMITS,
  POOLED_DOMAINS,
  domainUri,
  getDomainConnection,
  domainModel,
  squadModel,
  domainStatus,
  closeDomainConnections,
  connectionOptions
};
