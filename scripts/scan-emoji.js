// Design-system gate: list emoji glyphs in client/src.
//
// Chrome must be SVG, never emoji — that is the rule this script enforces. The
// one sanctioned exception is the reaction catalogue: a reaction glyph is the
// content the user is sending, not decoration, and the server stores short
// codes rather than these glyphs. Keeping it to a single file means the rest of
// the app still has to pass.
const fs = require('fs');
const path = require('path');

const ALLOWED = new Set(['client/src/utils/reactions.js']);

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2713}\u{2714}\u{2716}\u{2718}\u{FE0F}]/u;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (/node_modules|dist|\.git/.test(p)) continue;
      walk(p, out);
    } else if (/\.(jsx?|css)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

const hits = [];
let allowedHits = 0;

for (const file of walk(path.resolve('client/src'), [])) {
  const relative = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    if (!EMOJI.test(line)) return;

    if (ALLOWED.has(relative)) {
      allowedHits += 1;
      return;
    }
    hits.push(`${relative}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
}

console.log(hits.join('\n'));
if (allowedHits) {
  console.log(`\n${allowedHits} reaction glyph line(s) in the allowlisted reaction catalogue (content, not chrome).`);
}
console.log(`\n${hits.length} line(s)`);
