#!/usr/bin/env node
/**
 * Hardcoded-origin gate.
 *
 * `server/utils/origins.js` used to append two hosting-provider hostnames to the
 * CORS allow-list, so anyone who claimed such a subdomain inherited credentialed
 * CORS. Removing the list is not enough: the next deployment fix could add it
 * back. This gate fails when server code names a shared hosting domain, or
 * declares a literal origin allow-list constant instead of reading one from the
 * environment.
 *
 * Scope is deliberately narrow. Third-party API endpoints (YouTube, IGDB,
 * Cloudinary) are legitimate literals and are not origin policy, so a blanket
 * "no hostname" rule would only produce noise. The array rule matches names that
 * are about origins or are an allow-list (`ALLOWED_ORIGINS`, `EXTRA_ORIGIN`,
 * `ALLOWLIST`, `ALLOWED_HOSTS`) and leaves unrelated constants such as
 * `ALLOWED_METHODS` alone. Tests are excluded: they use fixture origins to
 * prove a spoofed host is refused.
 *
 * Run: `node scripts/scan-hosts.js` -- exits 1 on any hit.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test']);

// Shared hosting domains: a subdomain is claimable by anyone, so a literal of
// this shape in an allow-list is an account takeover primitive.
const PLATFORM_HOST =
  /(?:[a-z0-9-]+\.)*(?:vercel\.app|onrender\.com|netlify\.app|herokuapp\.com|railway\.app|fly\.dev|pages\.dev)\b/i;

// `const ALLOWED_ORIGINS = [` and `const ALLOWLIST = ['https://...']` are a
// built-in allow-list by another name. Production origins belong in the
// environment.
const LITERAL_ARRAY = /^\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*\[/;
const ORIGIN_OR_ALLOW_LIST =
  /(?:^|_)(?:ORIGINS?|ALLOWLIST|ALLOW_LIST|ALLOWED_HOSTS?|TRUSTED_HOSTS?)(?:_|$)/;

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Scan JS source text for hardcoded origins.
 *
 * @param {string} source
 * @param {string} file name used in the finding, for reporting only
 * @returns {{ file: string, line: number, reason: string, text: string }[]}
 */
function scanSource(source, file = '<source>') {
  const findings = [];
  source.split('\n').forEach((line, index) => {
    if (PLATFORM_HOST.test(line)) {
      findings.push({ file, line: index + 1, reason: 'shared hosting domain', text: line.trim() });
    }
    const assignment = LITERAL_ARRAY.exec(line);
    if (assignment && ORIGIN_OR_ALLOW_LIST.test(assignment[1])) {
      findings.push({
        file,
        line: index + 1,
        reason: 'literal origin allow-list',
        text: line.trim(),
      });
    }
  });
  return findings;
}

function scanFile(file) {
  return scanSource(fs.readFileSync(file, 'utf8'), file);
}

function main() {
  const files = walk(SERVER_DIR);
  const findings = files.flatMap(scanFile);

  if (findings.length) {
    console.error(`Found ${findings.length} hardcoded origin(s):`);
    for (const finding of findings) {
      console.error(
        `  ${path.relative(ROOT, finding.file)}:${finding.line}  ${finding.reason}  ${finding.text}`,
      );
    }
    console.error('\nRead production origins from CLIENT_URL and EXTRA_ALLOWED_ORIGINS instead.');
    process.exit(1);
  }

  console.log(`${files.length} server file(s) scanned, 0 hardcoded origin.`);
}

if (require.main === module) main();

module.exports = { main, walk, scanFile, scanSource };
