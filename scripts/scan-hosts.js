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
 * "no hostname" rule would only produce noise. Tests are excluded: they use
 * fixture origins to prove a spoofed host is refused.
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

// A `const SOMETHING_ORIGINS = [` (or ALLOW / ALLOWED) array is a built-in
// allow-list by another name. Production origins belong in the environment.
const LITERAL_ORIGIN_ARRAY = /^\s*(?:const|let|var)\s+[A-Z0-9_]*(?:ORIGIN|ORIGINS|ALLOW)[A-Z0-9_]*\s*=\s*\[\s*$/;

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

function scanFile(file) {
  const findings = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (PLATFORM_HOST.test(line)) {
      findings.push({ file, line: index + 1, reason: 'shared hosting domain', text: line.trim() });
    }
    if (LITERAL_ORIGIN_ARRAY.test(line)) {
      findings.push({ file, line: index + 1, reason: 'literal origin allow-list', text: line.trim() });
    }
  });
  return findings;
}

function main() {
  const files = walk(SERVER_DIR);
  const findings = files.flatMap(scanFile);

  if (findings.length) {
    console.error(`Found ${findings.length} hardcoded origin(s):`);
    for (const finding of findings) {
      console.error(
        `  ${path.relative(ROOT, finding.file)}:${finding.line}  ${finding.reason}  ${finding.text}`
      );
    }
    console.error('\nRead production origins from CLIENT_URL and EXTRA_ALLOWED_ORIGINS instead.');
    process.exit(1);
  }

  console.log(`${files.length} server file(s) scanned, 0 hardcoded origin.`);
}

if (require.main === module) main();

module.exports = { main, walk, scanFile };
