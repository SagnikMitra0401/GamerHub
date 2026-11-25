const path = require('path');
const fs = require('fs/promises');
const mongoose = require('mongoose');

const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Community = require('../models/Community');
const Message = require('../models/Message');
const Party = require('../models/Party');
const Notification = require('../models/Notification');
const ProductEvent = require('../models/ProductEvent');

const { snapshot } = require('../utils/metrics');
const {
  DAY_MS,
  DAY7_IGNORED_EVENTS,
  buildFunnel,
  summarizeFunnelRows,
} = require('../utils/funnel');
const { observabilityStatus } = require('../utils/observability');
const { errorReportingStatus } = require('../utils/errorReporting');
const { rateLimitStoreStatus } = require('../utils/rateLimitStore');
const { cacheWrap } = require('../utils/redisCache');
const youtubeBot = require('../utils/youtubeBot');
const { CACHE_TTL_MS: GAME_CACHE_TTL_MS } = require('../utils/gameProviders/freetogame');
const { isConfigured: redisConfigured } = require('../config/redis');
const { isLikeWorkerRunning } = require('../utils/likeBuffer');

const BUILD_ASSETS_DIR = path.join(__dirname, '..', '..', 'client', 'dist', 'assets');
const MAX_SCAN_BYTES = 15 * 1024 * 1024;

/**
 * Secrets the backend must own. `minLength` is the expected strength for that
 * particular value — an identifier such as a Cloudinary cloud name is short by
 * design and must not be flagged as weak.
 */
const SECRETS = [
  {
    name: 'JWT_SECRET',
    required: true,
    minLength: 32,
    usedBy: 'Session cookies & socket handshakes',
  },
  { name: 'MONGO_URI', required: true, minLength: 20, usedBy: 'MongoDB Atlas connection' },
  { name: 'CLOUDINARY_CLOUD_NAME', required: false, minLength: 1, usedBy: 'Media CDN' },
  { name: 'CLOUDINARY_API_KEY', required: false, minLength: 1, usedBy: 'Media uploads' },
  { name: 'CLOUDINARY_API_SECRET', required: false, minLength: 16, usedBy: 'Media uploads' },
  { name: 'YOUTUBE_API_KEY', required: false, minLength: 16, usedBy: 'Gaming bot video search' },
  {
    name: 'GMAIL_BRIDGE_SECRET',
    required: false,
    minLength: 16,
    usedBy: 'Transactional email bridge',
  },
  { name: 'SENTRY_DSN', required: false, minLength: 20, usedBy: 'Hosted error reporting' },
];

const present = (value) => typeof value === 'string' && value.trim().length > 0;

function auditedSecret({ name, minLength = 1 }) {
  const value = process.env[name];
  const configured = present(value);
  return {
    name,
    configured,
    // Bucket only — never the value, never the exact length.
    strength: configured ? (value.trim().length >= minLength ? 'strong' : 'short') : 'unset',
  };
}

/**
 * Scan the production client bundle for any secret value.
 * Reads files but returns only the names that leaked — never the values.
 */
async function scanClientBundle() {
  let files;
  try {
    files = await fs.readdir(BUILD_ASSETS_DIR);
  } catch {
    return {
      scanned: false,
      reason: 'No production build (client/dist) found',
      files: 0,
      leakedKeys: [],
    };
  }

  const secrets = Object.entries(process.env)
    .filter(
      ([name, value]) =>
        present(value) && value.length >= 8 && /KEY|SECRET|TOKEN|URI|DSN|PASSWORD/i.test(name),
    )
    .map(([name, value]) => [name, value]);

  const leakedKeys = new Set();
  let scannedFiles = 0;
  let bytes = 0;

  for (const file of files.filter((f) => f.endsWith('.js')).slice(0, 60)) {
    try {
      const full = path.join(BUILD_ASSETS_DIR, file);
      const stat = await fs.stat(full);
      if (bytes + stat.size > MAX_SCAN_BYTES) break;
      const text = await fs.readFile(full, 'utf8');
      bytes += stat.size;
      scannedFiles += 1;
      for (const [name, value] of secrets) {
        if (text.includes(value)) leakedKeys.add(name);
      }
    } catch {
      // A single unreadable asset must not fail the audit.
    }
  }

  return { scanned: true, files: scannedFiles, scannedBytes: bytes, leakedKeys: [...leakedKeys] };
}

async function countCollections() {
  const [
    users,
    posts,
    comments,
    communities,
    messages,
    auditEvents,
    parties,
    notifications,
    productEvents,
  ] = await Promise.all([
    User.countDocuments(),
    Post.countDocuments(),
    Comment.countDocuments(),
    Community.countDocuments(),
    Message.countDocuments(),
    AuditLog.countDocuments(),
    Party.countDocuments({ status: { $ne: 'closed' } }),
    Notification.countDocuments(),
    ProductEvent.countDocuments(),
  ]);

  return {
    users,
    posts,
    comments,
    communities,
    messages,
    auditEvents,
    activeParties: parties,
    notifications,
    productEvents,
  };
}

// GET /api/admin/system-health
const getSystemHealth = async (req, res, next) => {
  try {
    // Both are expensive (a filesystem scan and nine counts). They are cached
    // briefly: 60s keeps the numbers meaningful while making repeated dashboard
    // refreshes free. A deploy produces a new process, so the bundle scan TTL is
    // deliberately short enough that a fresh build is picked up quickly.
    const [bundle, counts, audit] = await Promise.all([
      cacheWrap('admin:client-bundle', scanClientBundle, 60),
      cacheWrap('admin:collection-counts', countCollections, 60),
      AuditLog.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('actorId', 'username role')
        .populate('communityId', 'name slug')
        .lean(),
    ]);

    const keys = SECRETS.map((secret) => ({
      ...auditedSecret(secret),
      required: secret.required,
      usedBy: secret.usedBy,
    }));

    const missingRequired = keys.filter((k) => k.required && !k.configured).map((k) => k.name);
    const shortSecrets = keys.filter((k) => k.strength === 'short').map((k) => k.name);
    const leaked = bundle.leakedKeys || [];
    const errorReporting = errorReportingStatus();

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      security: {
        secretIsolation: {
          ok: missingRequired.length === 0 && leaked.length === 0,
          missingRequired,
          weakSecrets: shortSecrets,
          keys,
        },
        clientBundle: {
          scanned: bundle.scanned,
          reason: bundle.reason || null,
          files: bundle.files || 0,
          leakedKeys: leaked,
        },
      },
      health: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        database: {
          connected: mongoose.connection.readyState === 1,
          state:
            ['disconnected', 'connected', 'connecting', 'disconnecting'][
              mongoose.connection.readyState
            ] || 'unknown',
        },
        traffic: snapshot(),
        services: {
          youtube: youtubeBot.getStatus(),
          cloudinary: {
            configured:
              present(process.env.CLOUDINARY_CLOUD_NAME) &&
              present(process.env.CLOUDINARY_API_KEY) &&
              present(process.env.CLOUDINARY_API_SECRET),
          },
          gameCatalog: {
            provider: 'FreeToGame',
            cacheMinutes: Math.round(GAME_CACHE_TTL_MS / 60_000),
          },
          // Reported from the live switch rather than hardcoded, so the
          // dashboard cannot claim Redis is off while it is serving traffic.
          redis: {
            configured: redisConfigured(),
            cache: redisConfigured() ? 'redis' : 'memory',
            likeBuffer: isLikeWorkerRunning() ? 'redis' : 'off',
          },
        },
      },
      database: { counts },
      observability: {
        ...observabilityStatus(),
        errorReporting: errorReporting.provider,
        errorReportingConfigured: errorReporting.configured,
      },
      rateLimits: rateLimitStoreStatus(),
      audit: audit.map((entry) => ({
        _id: String(entry._id),
        actionType: entry.actionType,
        actor: entry.actorId?.username || 'deleted user',
        actorRole: entry.actorId?.role || null,
        community: entry.communityId?.name || null,
        targetModel: entry.targetModel,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/metrics — light, pollable
const getMetrics = async (req, res, next) => {
  try {
    res.status(200).json({
      ...snapshot(),
      database: { connected: mongoose.connection.readyState === 1 },
    });
  } catch (err) {
    next(err);
  }
};

const FUNNEL_CACHE_SECONDS = 60;

const FUNNEL_EVENT_NAMES = [
  'signup',
  'onboarding_completed',
  'onboarding_skipped',
  'first_join',
  'first_follow',
  'first_post',
  'first_comment',
  'first_message',
];

/**
 * One row per account, with the first signup in the window and the distinct
 * event names seen. This avoids passing every cohort user id back to Mongo in
 * a growing `$in` array: the database does the grouping in one pass.
 */
async function funnelRows(since, now) {
  return ProductEvent.aggregate([
    {
      $match: {
        userId: { $ne: null },
        name: { $in: FUNNEL_EVENT_NAMES },
        createdAt: { $gte: since, $lte: now },
      },
    },
    {
      $group: {
        _id: '$userId',
        signupAt: {
          $min: {
            $cond: [{ $eq: ['$name', 'signup'] }, '$createdAt', null],
          },
        },
        names: { $addToSet: '$name' },
      },
    },
    { $match: { signupAt: { $gte: since, $lte: now } } },
    { $project: { _id: 1, names: 1 } },
  ]);
}

/**
 * Day-7 is a cohort approximation from the first signup timestamp. A signup
 * counts as returned when a meaningful event lands in [signup + 7d, signup +
 * 8d). Notification opens and clicks are excluded: they measure the bell, not
 * a return to the product. It is not a warehouse-grade retention number.
 */
async function day7Counts(since, now) {
  const eligibleBefore = new Date(now.getTime() - 7 * DAY_MS);
  const [result] = await ProductEvent.aggregate([
    {
      $match: {
        name: 'signup',
        userId: { $ne: null },
        createdAt: { $gte: since, $lte: eligibleBefore },
      },
    },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$userId', signedAt: { $first: '$createdAt' } } },
    {
      $facet: {
        cohort: [{ $count: 'count' }],
        returned: [
          {
            $lookup: {
              from: ProductEvent.collection.name,
              // localField/foreignField lets Mongo use the userId index before
              // evaluating the date window; the old `$in` list did not scale.
              localField: '_id',
              foreignField: 'userId',
              let: { signedAt: '$signedAt' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $ne: ['$name', 'signup'] },
                        { $eq: [{ $in: ['$name', DAY7_IGNORED_EVENTS] }, false] },
                        { $gte: ['$createdAt', { $add: ['$$signedAt', 7 * DAY_MS] }] },
                        { $lt: ['$createdAt', { $add: ['$$signedAt', 8 * DAY_MS] }] },
                      ],
                    },
                  },
                },
                { $limit: 1 },
              ],
              as: 'day7Activity',
            },
          },
          { $match: { 'day7Activity.0': { $exists: true } } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  return {
    cohort: result?.cohort[0]?.count || 0,
    returned: result?.returned[0]?.count || 0,
  };
}

async function loadFunnel(days) {
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  const [rows, day7] = await Promise.all([funnelRows(since, now), day7Counts(since, now)]);
  const counts = summarizeFunnelRows(rows);

  return {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    windowDays: days,
    cachedForSeconds: FUNNEL_CACHE_SECONDS,
    ...buildFunnel({
      signups: counts.signups,
      onboardingCompleted: counts.onboardingCompleted,
      onboardingSkipped: counts.onboardingSkipped,
      firstConnection: counts.firstConnection,
      firstContribution: counts.firstContribution,
      day7Returned: day7.returned,
      day7Cohort: day7.cohort,
    }),
  };
}

// GET /api/admin/funnel?days=28 — admin-only, distinct users per step.
const getFunnel = async (req, res, next) => {
  try {
    const requested = Number(req.query.days);
    const days = Number.isInteger(requested) && requested >= 1 && requested <= 180 ? requested : 28;
    const payload = await cacheWrap(
      `admin:activation-funnel:${days}`,
      () => loadFunnel(days),
      FUNNEL_CACHE_SECONDS,
    );
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSystemHealth,
  getMetrics,
  getFunnel,
  scanClientBundle,
  auditedSecret,
};
