#!/usr/bin/env node
/**
 * Prose regression harness for the unslop skill.
 *
 * The eval cases in docs/skills/unslop/evals/cases.md are the fixture. Each case
 * names the rules that have to fire on its sample, and carries a repaired
 * version that has to come back clean. Case 12 is the anti-overflagging guard:
 * a clean text stays clean.
 *
 * These rules are lookups for the forms the skill names, not an authorship
 * detector and not a general prose score. A rule that fires outside a fixture
 * sample is a reason to read the sentence, nothing more.
 *
 * Run with `npm run test:unslop`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CASES_FILE = path.join(__dirname, '..', 'docs', 'skills', 'unslop', 'evals', 'cases.md');

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// Split on sentence end punctuation only, and never after a digit, so "31. Dezember"
// and "6:12 Uhr" stay inside their sentence.
const sentences = (text) =>
  text.split(/(?<![0-9])(?<=[.!?])\s+(?=[A-ZÄÖÜ„])/).map((s) => s.trim()).filter(Boolean);

const lastSentence = (text) => sentences(text).slice(-1)[0] || '';

const RULES = [
  {
    id: 'formula-opener',
    level: 'P1',
    what: 'wide-angle opener from the word list',
    test: (t) =>
      /In der heutigen (?:digitalen|schnelllebigen)|Im Zeitalter von|Lass uns einen Blick|Tauche(?:n)? wir ein|Im Folgenden erfährst/i.test(t) ||
      /In today['’]s (?:fast-paced|ever-evolving)|Let['’]s dive in|In the ever-evolving/i.test(t)
  },
  {
    id: 'negative-parallelism',
    level: 'P1',
    what: 'contrast pair that excludes an option nobody proposed',
    test: (t) =>
      /nicht nur\b[^.;:!?]*\bsondern\b/i.test(t) ||
      /nicht\b[^.;:!?]{1,60}\bsondern\b/i.test(t) ||
      /\b[A-ZÄÖÜ][a-zäöüß]{2,}\s+statt\s+[A-ZÄÖÜ]/.test(t) ||
      /not only\b[^.;]*\bbut also\b/i.test(t) ||
      /it['’]s not\b[^.;]*\bit['’]s\b/i.test(t)
  },
  {
    id: 'empty-intensifier',
    level: 'P2',
    what: 'two empty intensifiers in one sentence',
    test: (t) => sentences(t).some((s) => /\bwichtig/i.test(s) && /\bentscheidend/i.test(s))
  },
  {
    id: 'hedge-stack',
    level: 'P1',
    what: 'two hedges on one claim',
    test: (t) =>
      /könnte(?:n)? (?:unter Umständen|möglicherweise)|could potentially|may potentially|might possibly|may eventually/i.test(t)
  },
  {
    id: 'triad',
    level: 'P1',
    what: 'three adjectives pressed into a series',
    test: (t) => /[\p{L}]+(?:er|en),\s+[\p{L}]+(?:er|en)\s+und\s+[\p{L}]+(?:er|en)\b/u.test(t)
  },
  {
    id: 'parataxis-chain',
    level: 'P1',
    what: 'three or more short main clauses in a row',
    test: (t) => {
      let run = 0;
      for (const s of sentences(t)) {
        if (wordCount(s) <= 6) {
          run += 1;
          if (run >= 3) return true;
        } else {
          run = 0;
        }
      }
      return false;
    }
  },
  {
    id: 'load-bearing-metaphor',
    level: 'P1',
    what: 'metaphor used as the verdict of a sentence',
    test: (t) =>
      /(?:trägt|tragen)\b[^.;]*(?:durch|über|weiter|in die|in den)\b/i.test(t) ||
      /\b(?:greift|zahlt sich aus|steht und fällt|Rückgrat|Fundament|Herzstück)\b/i.test(t) ||
      /\b(?:backbone|cornerstone|underpins|pays off|holds up)\b/i.test(t)
  },
  {
    id: 'colon-reveal',
    level: 'P1',
    what: 'noun phrase, colon, staged lowercase payoff',
    test: (t) => /\b\p{L}+:\s+[a-zäöüß]/u.test(t)
  },
  {
    id: 'faux-insight',
    level: 'P1',
    what: 'flattering setup that announces hidden knowledge',
    test: (t) => /was die meisten übersehen|was dir niemand sagt|what nobody tells you|the part everyone misses|what most people miss/i.test(t)
  },
  {
    id: 'aphoristic-kicker',
    level: 'P1',
    what: 'maxim in the closing line',
    test: (t) => /^(?:Am Ende|Letztlich|Im Kern|Ultimately|At the end of the day)\b/i.test(lastSentence(t)) || /zählt nicht\b/i.test(lastSentence(t))
  },
  {
    id: 'phantom-objection',
    level: 'P1',
    what: 'defence against a claim nobody made',
    test: (t) => /Damit will ich nicht sagen|Versteh mich nicht falsch|Um es klar zu sagen|I['’]m not saying|To be clear/i.test(t)
  },
  {
    id: 'command-tone',
    level: 'P1',
    what: 'barked instruction instead of a recommendation',
    test: (t) => /!/.test(t) && /\b(?:immer|checken|prüfen|achten|denken)\b/i.test(t)
  },
  {
    id: 'em-dash-on-slide',
    level: 'P1',
    what: 'em dash inside slide text',
    test: (t) => /—/.test(t)
  },
  {
    id: 'moderator-note',
    level: 'P0',
    what: 'internal note left on the audience-facing surface',
    test: (t) => /hier kurz erklären|hier erklären|Moderationshinweis|speaker notes|in den Notizen/i.test(t)
  },
  {
    id: 'realization-coda',
    level: 'P1',
    what: 'story explained after it already ended',
    test: (t) => /(?:und )?da wurde mir klar|da wusste ich|that['’]s when I realized|and that['’]s when/i.test(t)
  },
  {
    id: 'reply-rebuilds-context',
    level: 'P1',
    what: 'decision behind a retraced history in a reply',
    test: (t) => {
      const list = sentences(t);
      if (list.length < 2) return false;
      const history = /Wie besprochen|Nach Rücksprache|wie zuvor besprochen|As discussed|Following our conversation/i.test(t);
      const decision = /\b(?:tauschen wir|austauschen|entschieden|entscheiden wir|kommen wir zu dem Ergebnis|we will|we have decided)\b/i.test(list[list.length - 1]);
      return history && decision;
    }
  },
  {
    id: 'word-list-cluster',
    level: 'P1',
    what: 'two or more inflated vocabulary hits in one passage',
    test: (t) =>
      (t.match(/\b(?:seamless|leverage|robust|streamline|holistic|comprehensive|cutting-edge|state-of-the-art|empower|foster|harness|delve|myriad|plethora|tapestry|utilize)\b/gi) || []).length >= 2
  }
];

const RULE_IDS = new Set(RULES.map((r) => r.id));
const QUOTED = /„([^“]+)“/g;

const matchRules = (text) => RULES.filter((r) => r.test(text)).map((r) => r.id);
const quoted = (line) => [...line.matchAll(QUOTED)].map((m) => m[1].trim());

function parseCases(markdown) {
  const blocks = markdown.split(/^## Case (\d+):.*$/m).slice(1);
  const cases = [];
  for (let i = 0; i < blocks.length; i += 2) {
    const number = Number(blocks[i]);
    const body = blocks[i + 1];
    const line = (label) => {
      const hit = body.split('\n').find((l) => l.trim().startsWith(`**${label}:**`));
      return hit ? hit.trim().slice(label.length + 6).trim() : '';
    };
    const sample = quoted(line('Sample')).join(' ');
    const fixed = quoted(line('Fixed')).join(' ');
    const expected = [...line('Expected').matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
    cases.push({ number, sample, fixed, expected });
  }
  return cases;
}

function main() {
  if (!fs.existsSync(CASES_FILE)) {
    console.error(`✖ cases file missing: ${CASES_FILE}`);
    process.exit(1);
  }

  const cases = parseCases(fs.readFileSync(CASES_FILE, 'utf8'));
  const failures = [];
  let checks = 0;

  if (cases.length !== 12) {
    failures.push(`expected 12 cases, parsed ${cases.length}`);
  }

  for (const testCase of cases) {
    const label = `Case ${testCase.number}`;

    if (!testCase.sample) {
      failures.push(`${label}: no sample text parsed`);
      continue;
    }

    const unknown = testCase.expected.filter((id) => !RULE_IDS.has(id));
    if (unknown.length) {
      failures.push(`${label}: unknown rule id in Expected: ${unknown.join(', ')}`);
    }

    const found = matchRules(testCase.sample);
    checks += 1;

    const missing = testCase.expected.filter((id) => !found.includes(id));
    if (missing.length) {
      checks += missing.length;
      failures.push(`${label}: expected ${missing.join(', ')} on the sample, rule did not fire`);
    }

    const extra = found.filter((id) => !testCase.expected.includes(id));
    checks += 1;
    if (extra.length) {
      failures.push(`${label}: sample trips unlisted rules: ${extra.join(', ')}`);
    }

    let fixedState = 'no repair';
    if (testCase.fixed) {
      const fixedFound = matchRules(testCase.fixed);
      checks += 1;
      fixedState = fixedFound.length ? `repair still trips ${fixedFound.join(', ')}` : 'repair clean';
      if (fixedFound.length) {
        failures.push(`${label}: ${fixedState}`);
      }
    }

    const expectedState = testCase.expected.length ? testCase.expected.join(', ') : 'none';
    console.log(`  ${failures.some((f) => f.startsWith(`${label}:`)) ? '✖' : '✔'} ${label}: sample [${found.join(', ') || 'clean'}] expected [${expectedState}] ${fixedState}`);
  }

  checks += 1;
  const cleanCase = cases.find((c) => c.number === 12);
  if (!cleanCase) {
    failures.push('Case 12 missing; the anti-overflagging guard is not running');
  } else if (matchRules(cleanCase.sample).length) {
    failures.push(`Case 12 must stay clean, it trips ${matchRules(cleanCase.sample).join(', ')}`);
  }

  const flagged = cases.filter((c) => c.expected.length).length;
  const repaired = cases.filter((c) => c.fixed).length;

  if (failures.length) {
    console.log('');
    for (const failure of failures) console.error(`✖ ${failure}`);
    console.error(`\n${checks} checks, ${failures.length} failed.`);
    process.exit(1);
  }

  console.log(`\n${checks} checks, 0 failed. ${cases.length} cases, ${flagged} samples flagged as expected, ${repaired} repairs clean, case 12 clean.`);
}

main();
