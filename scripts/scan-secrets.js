#!/usr/bin/env node
/**
 * Secret-leak gate.
 *
 * Two failure modes are checked:
 *   1. A credential-shaped literal is committed in source or ends up in the
 *      client bundle (the browser can read anything in `client/dist`).
 *   2. A real `.env` file is tracked by git. The template `.env.example` is
 *      fine; every other `.env*` is a leak waiting to happen.
 *
 * Run: `node scripts/scan-secrets.js` — exits 1 on any hit.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { SCANNED_EXTENSIONS, scanText } = require('./lib/secretPatterns');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOTS = ['client/src', 'client/dist', 'server', 'scripts', 'migrations'];
// Test fixtures are fabricated values that must look real to exercise the
// detector; they are not shipped and are excluded from the gate.
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist-cache', 'tests', 'test']);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (SCANNED_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/** Real env files must never be tracked. */
function trackedEnvFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((file) => {
        const base = path.basename(file);
        return base.startsWith('.env') && base !== '.env.example';
      });
  } catch {
    return []; // not a git checkout (e.g. a tarball) — nothing to assert
  }
}

function main() {
  const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;
  const findings = [];

  for (const root of roots) {
    for (const file of walk(path.join(ROOT, root))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const hit of scanText(text)) {
        findings.push({
          file: path.relative(ROOT, file),
          line: hit.line,
          name: hit.name,
          excerpt: hit.excerpt
        });
      }
    }
  }

  for (const file of trackedEnvFiles()) {
    findings.push({ file, line: 0, name: 'tracked env file', excerpt: '(whole file)' });
  }

  if (findings.length) {
    console.error(`Found ${findings.length} potential secret leak(s):`);
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  ${finding.name}  ${finding.excerpt}`);
    }
    console.error('\nRemove the value, rotate it, and keep it in the environment only.');
    process.exit(1);
  }

  console.log('0 hit(s) — no credential-shaped literal in source or build output.');
}

if (require.main === module) main();

module.exports = { main, walk, trackedEnvFiles };
