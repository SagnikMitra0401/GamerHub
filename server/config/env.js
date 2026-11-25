/**
 * Boot-time environment validation.
 *
 * The server previously read `JWT_SECRET` only when a request needed it, so a
 * deployment missing the key started cleanly and failed every sign-in with a
 * generic 401. This module turns that class of mistake into a loud failure
 * before the port opens, and it names every offending key in one pass.
 *
 * Rules:
 *   - Required keys are checked in every environment, with a shape and a
 *     minimum strength where the value has one.
 *   - Production extra requirements are checked only when NODE_ENV is exactly
 *     `production`. A misspelled value is itself an error, because `prod` would
 *     silently keep the development cookie policy.
 *   - Optional integrations warn when they are half configured. A warning never
 *     stops the boot.
 *   - No message ever contains a value. Missing means "not set"; weak means a
 *     length or a rule, never the string.
 */

const MIN_JWT_SECRET_LENGTH = 32;
const MIN_PEPPER_LENGTH = 16;

const MONGO_SCHEMES = ['mongodb://', 'mongodb+srv://'];
const NODE_ENVS = ['development', 'production', 'test'];

// Values shipped in .env.example. Leaving one in place is worse than leaving the
// key empty: the key looks configured to every health check while the secret is
// public. Comparison is exact and case-insensitive.
const PLACEHOLDERS = new Set([
  'replace-with-64-random-characters',
  'your-key-here',
  'changeme'
]);

/**
 * Optional integrations and the keys each one needs. A group with some keys set
 * and others missing turns the feature off silently at runtime, which reads as
 * a bug rather than as configuration.
 */
const OPTIONAL_GROUPS = [
  {
    label: 'Cloudinary',
    keys: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    effect: 'media uploads',
    when: () => true
  },
  {
    label: 'the Gmail bridge',
    keys: ['GMAIL_BRIDGE_URL', 'GMAIL_BRIDGE_SECRET'],
    effect: 'verification and reset mail',
    when: () => true
  },
  {
    label: 'IGDB',
    keys: ['IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET'],
    effect: 'catalog enrichment',
    when: () => true
  },
  {
    label: 'Upstash Redis',
    keys: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    effect: 'the shared cache',
    when: (env) => String(env.REDIS_ENABLED || '').trim() === '1'
  }
];

const present = (value) => typeof value === 'string' && value.trim().length > 0;

const isPlaceholder = (value) => PLACEHOLDERS.has(String(value).trim().toLowerCase());

/** Split a comma-separated list, trimming entries and dropping empties. */
const splitList = (value) =>
  String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Validate one comma-separated origin list.
 *
 * A browser sends `scheme://host[:port]` in the Origin header, so a wildcard, a
 * path, a query or a missing scheme can never match. Each of those is reported
 * instead of being accepted as a rule that silently rejects real requests.
 *
 * Production origins must be https. The session cookie is credentialed, so an
 * http origin in production would send it in cleartext on every mutation.
 *
 * @param {string} key environment key, used in the message
 * @param {string|undefined} value
 * @param {{ production?: boolean }} [options]
 * @returns {string[]}
 */
function originProblems(key, value, { production = false } = {}) {
  return splitList(value).flatMap((entry, index) => {
    const label = `${key}[${index + 1}]`;
    if (entry.includes('*')) {
      return [`${label} contains a wildcard; list exact origins.`];
    }
    let url;
    try {
      url = new URL(entry);
    } catch {
      return [`${label} is not an absolute URL.`];
    }
    if (!/^https?:$/.test(url.protocol)) {
      return [`${label} must use http or https.`];
    }
    if (production && url.protocol !== 'https:') {
      return [`${label} must use https in production; http is for local development only.`];
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      return [`${label} includes a path, query or fragment; an origin is scheme, host and port only.`];
    }
    return [];
  });
}

/**
 * Validate an environment object without side effects.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  const nodeEnv = present(env.NODE_ENV) ? env.NODE_ENV.trim() : 'development';
  if (!NODE_ENVS.includes(nodeEnv)) {
    errors.push(`NODE_ENV is "${nodeEnv}"; it must be one of ${NODE_ENVS.join(', ')}.`);
  }
  const production = nodeEnv === 'production';

  if (!present(env.MONGO_URI)) {
    errors.push('MONGO_URI is not set.');
  } else if (!MONGO_SCHEMES.some((scheme) => env.MONGO_URI.trim().startsWith(scheme))) {
    errors.push('MONGO_URI must start with mongodb:// or mongodb+srv://.');
  }

  if (!present(env.JWT_SECRET)) {
    errors.push('JWT_SECRET is not set.');
  } else if (isPlaceholder(env.JWT_SECRET)) {
    errors.push('JWT_SECRET is still the .env.example placeholder; generate a random value.');
  } else if (env.JWT_SECRET.trim().length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET is ${env.JWT_SECRET.trim().length} characters; at least ${MIN_JWT_SECRET_LENGTH} are required.`
    );
  }

  if (!present(env.CLIENT_URL)) {
    if (production) {
      errors.push('CLIENT_URL is not set; production needs the web origin for CORS and share links.');
    }
  } else {
    errors.push(...originProblems('CLIENT_URL', env.CLIENT_URL, { production }));
  }

  if (present(env.EXTRA_ALLOWED_ORIGINS)) {
    errors.push(...originProblems('EXTRA_ALLOWED_ORIGINS', env.EXTRA_ALLOWED_ORIGINS, { production }));
  }

  if (production) {
    if (!present(env.EMAIL_CODE_PEPPER)) {
      errors.push('EMAIL_CODE_PEPPER is not set; production refuses to derive a pepper from another key.');
    } else if (env.EMAIL_CODE_PEPPER.trim().length < MIN_PEPPER_LENGTH) {
      warnings.push(
        `EMAIL_CODE_PEPPER is ${env.EMAIL_CODE_PEPPER.trim().length} characters; ${MIN_PEPPER_LENGTH} or more is recommended.`
      );
    }
  }

  if (present(env.TRUST_PROXY) && !/^\d+$/.test(env.TRUST_PROXY.trim())) {
    errors.push('TRUST_PROXY must be a whole number of proxy hops, for example 1.');
  }

  for (const group of OPTIONAL_GROUPS) {
    if (!group.when(env)) continue;
    const missing = group.keys.filter((key) => !present(env[key]));
    if (missing.length === 0 || missing.length === group.keys.length) continue;
    warnings.push(
      `${group.label} is partly configured (${missing.join(', ')} missing); ${group.effect} stay off until every key is set.`
    );
  }

  return { errors, warnings };
}

/**
 * Validate the process environment and refuse to continue on any error.
 *
 * Call as the first statement after `dotenv.config()`. Every problem is printed
 * before the exit, so one restart reports the whole list rather than the first
 * key alphabetically.
 */
function loadEnv(env = process.env) {
  const { errors, warnings } = validateEnv(env);

  for (const warning of warnings) console.warn(`[config] ${warning}`);

  if (errors.length === 0) return { ok: true };

  for (const error of errors) console.error(`[config] ${error}`);
  console.error('[config] Refusing to start. See .env.example for the required keys.');
  process.exit(1);
}

module.exports = {
  MIN_JWT_SECRET_LENGTH,
  MIN_PEPPER_LENGTH,
  validateEnv,
  loadEnv,
  originProblems
};
