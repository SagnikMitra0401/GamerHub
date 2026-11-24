#!/usr/bin/env node
/**
 * Prose scanner for the text this repository shows a reader.
 *
 * Scope is copy, not code: JSX text nodes, copy string props, the legal drafts
 * and the email templates. Identifiers, expressions, log lines and fixtures are
 * skipped, so a hit means a person would read the line.
 *
 *   node scripts/unslop-scan.js           report, exit 0
 *   node scripts/unslop-scan.js --strict  exit 1 on any P0 or P1 hit
 *
 * A hit is a reason to look, not a verdict. Word-list judgement in context stays
 * with docs/skills/unslop.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.vite']);
const SKIP_FILE = /(\.test\.|\.spec\.|e2e|unslop-scan|unslop-eval)/;

/** Files outside the client whose prose ships: email bodies and legal drafts. */
const COPY_FILES = new Set(['server/utils/email.js']);

/** Deliberate keeps, matched as exact substrings. */
const ALLOWED = ['Never back down, never what? GLHF!'];

const RULES = [
  {
    id: 'negative-parallelism',
    severity: 'P1',
    pattern: /\bnot (just|merely|only)\b[^.!?]{0,80}\bbut\b/i,
    hint: 'negative parallelism'
  },
  {
    id: 'hedge-stack',
    severity: 'P1',
    pattern: /\b(it'?s important to note|it should be noted|needless to say|arguably|it'?s worth noting)\b/i,
    hint: 'hedge stack'
  },
  {
    id: 'stock-opener',
    severity: 'P1',
    pattern: /\b(in today'?s|let'?s dive|when it comes to|at the end of the day|in the world of|in the realm of)\b/i,
    hint: 'stock opener or transition'
  },
  {
    id: 'colon-reveal',
    severity: 'P1',
    pattern: /\b(the best part|here'?s the thing|the catch|the kicker)\s*:/i,
    hint: 'colon reveal'
  },
  {
    id: 'false-agency',
    severity: 'P1',
    pattern: /\b(the (data|numbers|code|algorithm|market) (tells|says|wants|decides|knows))\b/i,
    hint: 'false agency'
  },
  {
    id: 'vague-authority',
    severity: 'P1',
    pattern: /\b(experts|studies|research|scientists|many) (say|says|show|shows|agree|suggest)\b/i,
    hint: 'vague authority'
  },
  {
    id: 'stock-metaphor',
    severity: 'P1',
    pattern: /\b(north star|game changer|double-edged sword|beacon of|rich tapestry|delve into|treasure trove)\b/i,
    hint: 'stock metaphor'
  },
  {
    id: 'triad',
    severity: 'P2',
    pattern: /\b[\w'’-]+, [\w'’-]+, and [\w'’-]+\b/,
    hint: 'possible decorative triad'
  }
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_FILE.test(rel)) continue;
      walk(full, out);
    } else if (/\.(jsx|js|md)$/.test(entry.name) && !SKIP_FILE.test(rel)) {
      out.push(full);
    }
  }
  return out;
}

const COPY_PROP = /(placeholder|title|label|message|confirmText|aria-label|alt|text|content)=\s*(["'`])([^"'`\n]{12,})\2/g;
const LITERAL = /(["'`])([^"'`\n]{12,})\1/g;
const CODEISH = /[=;(){}[\]]|=>|::|\.jsx?|https?:/;

/** Reader-visible text from one line, with expressions and markup stripped. */
function proseFromLine(line, rel) {
  if (rel.endsWith('.md')) {
    return line.replace(/^\s*(#{1,6}|[-*]|\d+\.)\s*/, '').replace(/[*_`]/g, '').trim();
  }

  if (COPY_FILES.has(rel)) {
    // Email bodies are template literals and HTML strings; the whole line is copy.
    return line.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Comments are notes to developers, not copy.
  if (/^\s*(\/\/|\/\*|\*)/.test(line)) return '';
  if (/^\s*(import|export|const|let|var|function|return|if|for|while|switch|case|try|catch)/.test(line)) {
    return '';
  }

  const props = [...line.matchAll(COPY_PROP)]
    .map((match) => match[3])
    .filter((value) => /[A-Za-z]{3}/.test(value));

  // Drop {expressions} first: a condition or a handler is not copy.
  const text = line
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const extra = props.filter((value) => !CODEISH.test(value));
  return [text, ...extra].join(' ').trim();
}

function collect(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const entries = [];
  let inFence = false;

  lines.forEach((line, index) => {
    if (rel.endsWith('.md') && /^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const prose = proseFromLine(line, rel).replace(/\s+/g, ' ').trim();
    if (!prose || !/[A-Za-z]/.test(prose) || prose.length < 12) return;
    if (!prose.includes(' ') && !prose.endsWith('.')) return;
    // A JSX text node with no sentence is usually a label; keep labels.
    entries.push({ line: index + 1, prose });
  });

  return entries;
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function scan() {
  const roots = [
    path.join(ROOT, 'client', 'src'),
    path.join(ROOT, 'docs', 'legal'),
    path.join(ROOT, 'server', 'utils')
  ];
  const files = roots.flatMap((root) => walk(root)).filter((file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel.startsWith('client/src/')) return true;
    if (rel.startsWith('docs/legal/')) return true;
    return COPY_FILES.has(rel);
  });

  const findings = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const entries = collect(file);
    if (!entries.length) continue;

    const prose = entries.map((entry) => entry.prose).join(' ');
    const totalWords = wordCount(prose);
    const emDashes = (prose.match(/[\s"'“”‘’(]—|—[\s"'“”‘’).,;:!?]/g) || []).length;
    // Only an exclamation that ends a word is editorial. `!loading` and `!==` are code.
    const bangs = (prose.match(/[a-z0-9]!(?=["'”’)\s,.;:?]|$)/gi) || []).length;

    if (totalWords >= 120) {
      const emBudget = Math.max(1, Math.floor(totalWords / 500));
      if (emDashes > emBudget) {
        findings.push({
          file: rel,
          line: 1,
          rule: 'em-dash-budget',
          severity: 'P1',
          excerpt: `${emDashes} em dashes in ${totalWords} words of copy`,
          hint: 'punctuation budget'
        });
      }
      const bangBudget = Math.max(1, Math.floor(totalWords / 1000));
      if (bangs > bangBudget) {
        findings.push({
          file: rel,
          line: 1,
          rule: 'exclamation-budget',
          severity: 'P1',
          excerpt: `${bangs} exclamation marks in ${totalWords} words of copy`,
          hint: 'punctuation budget'
        });
      }
    }

    for (const entry of entries) {
      if (ALLOWED.some((allowed) => entry.prose.includes(allowed))) continue;
      for (const rule of RULES) {
        const match = entry.prose.match(rule.pattern);
        if (!match) continue;
        findings.push({
          file: rel,
          line: entry.line,
          rule: rule.id,
          severity: rule.severity,
          excerpt: entry.prose.slice(0, 150),
          hint: rule.hint
        });
      }
    }
  }

  return findings;
}

const findings = scan();
const failing = findings.filter((item) => item.severity !== 'P2');

if (!findings.length) {
  console.log('prose scan: clean');
} else {
  const byFile = new Map();
  for (const item of findings) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item);
  }
  for (const [file, items] of byFile) {
    console.log(`\n${file}`);
    for (const item of items) {
      console.log(`  ${item.severity} ${item.rule} line ${item.line}: ${item.excerpt}`);
    }
  }
  console.log(
    `\nprose scan: ${findings.length} finding${findings.length === 1 ? '' : 's'}` +
      ` (${failing.length} P0/P1)`
  );
}

if (STRICT && failing.length) process.exit(1);
process.exit(0);
