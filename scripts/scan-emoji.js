// One-off audit helper: list lines in client/src that contain emoji glyphs.
const fs = require('fs');
const path = require('path');

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
for (const file of walk(path.resolve('client/src'), [])) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (EMOJI.test(line)) {
      hits.push(
        `${path.relative(process.cwd(), file).replace(/\\/g, '/')}:${i + 1}: ${line.trim().slice(0, 160)}`
      );
    }
  });
}
console.log(hits.join('\n'));
console.log(`\n${hits.length} line(s)`);
