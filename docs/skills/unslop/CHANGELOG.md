# Changelog

## 1.1.0, 24 November 2026

Eval cases made runnable. Each case now names the rule ids it has to trip, carries a repaired version and a change log, and case 12 is untouched so the anti-overflagging guard keeps its meaning.

- `scripts/unslop-eval.js` reads the cases file and runs 36 checks in both directions: the expected rules fire on every sample, and every repair comes back clean. It fails on an unlisted finding too, so a case that starts tripping a second rule cannot pass quietly.
- Registered as `npm run test:unslop` and appended to `npm test`.
- `SKILL.md`: the regression-check step names the command.

## 1.0.0, 24 November 2026

Imported the skill into the repository as the prose standard for all project writing, binding through `AGENTS.md`.

- `SKILL.md`: full specification, three levels, register profiles, severity, guardrails, self-check.
- `references/word-lists.md`: German and English lists in three tiers with thresholds, protected uses and the German and English microformats.
- `references/pattern-catalog.md`: 27 numbered patterns, each with one catch example and one look-alike that stays. Section numbers match the citations in `SKILL.md`.
- `evals/cases.md`: 12 regression cases. Case 12 is clean and has to stay clean.

Open gap: the word lists and the catalog are authored for this repository, not copied from a published source. Patterns that turn up in review get folded in as the maintenance section describes.
