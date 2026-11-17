#!/usr/bin/env node
/**
 * Migration lint.
 *
 * Runs in `npm test` and CI, and fails on the mistakes that make a migration
 * dangerous rather than merely ugly:
 *   - a file that does not declare both `up` and `down`
 *   - a filename outside the timestamp-slug convention
 *   - an unfiltered `deleteMany({})`, `dropDatabase` or `collection.drop()`
 *   - a migration placed in a domain folder it does not belong to (warning)
 *
 * Source-level checks are exported so they can be unit-tested without touching
 * the filesystem. Run the CLI with `node scripts/migration-lint.js`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const DOMAINS = ['auth', 'feed', 'communities', 'squads', 'catalog'];
// The pre-domain root track is immutable applied history, not a new domain.
const LINT_DOMAINS = [...DOMAINS, 'root'];
const FILENAME = /^\d{14}-[a-z0-9][a-z0-9-]*\.js$/;

const FORBIDDEN = [
  { pattern: /deleteMany\s*\(\s*\{\s*\}\s*\)/, message: 'unfiltered deleteMany({})' },
  { pattern: /\.dropDatabase\s*\(/, message: 'dropDatabase()' },
  { pattern: /\.drop\s*\(\s*\)/, message: 'collection.drop()' }
];

/**
 * @returns {{errors: string[], warnings: string[]}}
 */
function lintSource(source, { file = 'migration.js', domain = null } = {}) {
  const errors = [];
  const warnings = [];
  const text = String(source || '');

  if (!FILENAME.test(file)) {
    errors.push(`${file}: filename must look like 20260101090000-add-something.js`);
  }
  if (!/exports\.up\s*=|module\.exports\s*=\s*\{[\s\S]*\bup\b/.test(text)) {
    errors.push(`${file}: no exported up() function`);
  }
  if (!/exports\.down\s*=|module\.exports\s*=\s*\{[\s\S]*\bdown\b/.test(text)) {
    errors.push(`${file}: no exported down() function`);
  }

  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(text)) errors.push(`${file}: ${rule.message}`);
  }

  if (domain && !LINT_DOMAINS.includes(domain)) {
    errors.push(`${file}: unknown domain "${domain}"`);
  }
  if (domain && /db\.collection\(\s*'(users|posts|communities|messages)'\s*\)/.test(text)
      && domain !== 'auth' && domain !== 'feed' && domain !== 'communities') {
    warnings.push(`${file}: writes another domain's collection`);
  }

  return { errors, warnings };
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  const files = [];
  // The original root track is still valid history and is linted as `root`.
  for (const entry of fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push({ domain: 'root', file: entry.name, full: path.join(MIGRATIONS_DIR, entry.name) });
    }
  }
  for (const domain of DOMAINS) {
    const dir = path.join(MIGRATIONS_DIR, domain);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.js')) files.push({ domain, file: name, full: path.join(dir, name) });
    }
  }
  return files;
}

function run() {
  const files = listMigrationFiles();
  const errors = [];
  const warnings = [];

  for (const entry of files) {
    const result = lintSource(fs.readFileSync(entry.full, 'utf8'), {
      file: entry.file,
      domain: entry.domain
    });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  for (const warning of warnings) console.log(`WARN  ${warning}`);
  for (const error of errors) console.error(`FAIL  ${error}`);

  console.log(`\nMigration lint: ${files.length} file(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length) process.exit(1);
}

if (require.main === module) run();

module.exports = { lintSource, listMigrationFiles, DOMAINS, FILENAME };
