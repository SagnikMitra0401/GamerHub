/**
 * In-process traffic metrics for the admin dashboard.
 *
 * Deliberately small: counters and a bounded latency ring buffer. This is
 * per-process state — a multi-instance deployment needs a shared store, and
 * nothing here is used for authorization decisions.
 */

const MAX_LATENCY_SAMPLES = 500;
const MAX_ROUTES = 60;

const startedAt = Date.now();
const routes = new Map();
const latencies = [];
let totalRequests = 0;
let serverErrors = 0;

/** `/api/posts/64f.../likes` -> `/api/posts/:id/likes` so buckets stay bounded. */
function normalizePath(originalUrl = '') {
  const path = originalUrl.split('?')[0] || '/';
  return path
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, '/:id')
    .slice(0, 120);
}

function record(method, path, statusCode, durationMs) {
  totalRequests += 1;
  if (statusCode >= 500) serverErrors += 1;

  const key = `${method} ${path}`;
  const bucket = routes.get(key) || { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
  bucket.count += 1;
  bucket.totalMs += durationMs;
  bucket.maxMs = Math.max(bucket.maxMs, durationMs);
  if (statusCode >= 500) bucket.errors += 1;

  if (routes.size >= MAX_ROUTES && !routes.has(key)) {
    routes.delete(routes.keys().next().value);
  }
  routes.set(key, bucket);

  latencies.push(durationMs);
  if (latencies.length > MAX_LATENCY_SAMPLES) latencies.shift();
}

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    record(req.method, normalizePath(req.originalUrl), res.statusCode, ms);
  });
  next();
}

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

function snapshot() {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);

  const topRoutes = [...routes.entries()]
    .map(([route, m]) => ({
      route,
      count: m.count,
      errors: m.errors,
      avgMs: Math.round((m.totalMs / m.count) * 100) / 100,
      maxMs: Math.round(m.maxMs * 100) / 100
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
    totalRequests,
    serverErrors,
    avgLatencyMs: sorted.length ? Math.round((sum / sorted.length) * 100) / 100 : 0,
    p95LatencyMs: Math.round(percentile(sorted, 95) * 100) / 100,
    samples: sorted.length,
    topRoutes
  };
}

/** Test helper. */
function resetMetrics() {
  routes.clear();
  latencies.length = 0;
  totalRequests = 0;
  serverErrors = 0;
}

module.exports = { metricsMiddleware, snapshot, resetMetrics, normalizePath };
