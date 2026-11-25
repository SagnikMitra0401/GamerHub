const mongoose = require('mongoose');
const { getRedis, isConfigured, redisKey } = require('../config/redis');

const DEFAULT_TIMEOUT_MS = 1500;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function databaseCheck(timeoutMs) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return { ok: false, status: 'disconnected' };
  }

  try {
    await withTimeout(mongoose.connection.db.admin().ping(), timeoutMs, 'database ping');
    return { ok: true, status: 'connected' };
  } catch {
    // Public probe: report the state, never a driver message that could contain
    // an internal host or connection detail.
    return { ok: false, status: 'unreachable' };
  }
}

async function redisCheck(timeoutMs) {
  if (!isConfigured()) return { ok: true, configured: false, status: 'disabled' };

  const redis = getRedis();
  if (!redis) return { ok: false, configured: true, status: 'unavailable' };

  try {
    const ping =
      typeof redis.ping === 'function' ? redis.ping() : redis.get(redisKey('health:ready'));
    await withTimeout(ping, timeoutMs, 'redis ping');
    return { ok: true, configured: true, status: 'connected' };
  } catch {
    return { ok: false, configured: true, status: 'unreachable' };
  }
}

/**
 * Readiness differs from liveness: it actually asks the dependencies whether
 * they can answer. `/api/health` stays the cheap Render liveness probe.
 */
async function readinessSnapshot({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const [database, redis] = await Promise.all([databaseCheck(timeoutMs), redisCheck(timeoutMs)]);
  const ready = database.ok && redis.ok;

  return {
    status: ready ? 'ready' : 'not_ready',
    ready,
    uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
    checks: { database, redis },
  };
}

module.exports = { readinessSnapshot };
