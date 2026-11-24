# Project instructions

## Writing standard

Every piece of prose this repository produces follows the unslop skill in `docs/skills/unslop/SKILL.md`: UI copy, error and empty-state text, notification and email copy, legal drafts, plans, reports, PR descriptions, release notes and commit messages. Read the skill before writing, then apply it silently. Do not mention the skill, its rules or its rule numbers in the deliverable.

Reference files: `docs/skills/unslop/references/word-lists.md` (German and English, tiers, protected uses, microformats) and `docs/skills/unslop/references/pattern-catalog.md` (numbered patterns with a catch example and a look-alike for each).

## Scope

The standard covers text a reader sees: product copy, notices, emails, documentation, analyses, slide decks. It does not cover code, identifiers, log lines, JSON, commit trailers or table data.

Load-bearing language is content. In legal, security and account-status text, hedges, negations and absolutes stay exactly as written: „darf nicht“, „kann … verursachen“, „vorbehaltlich“, "shall", "may". This repository ships privacy and terms drafts, account-status notices and retention emails, so this applies often.

## Modes

- **Write** (default for new text): apply the rules while drafting, then run the self-check once. The reader sees only the corrected version.
- **Check**: flag only, grouped by severity, quoting the offending span. No edits.
- **Rewrite**: findings, cleaned version, short change log, second pass. Use when an existing text is handed over.
- **Edit file**: touch only the flagged spans in the named file and re-read afterwards.

When the register is genuinely unclear and the verdict depends on it, ask one short question: who reads this, and where does it appear.

## Ten checks

1. Replace a vague claim with a sourced fact. Keep a relative measure at its original strength. Flag a missing figure instead of inventing one.
2. Pick the register first. The same sentence can be right in one register and wrong in another.
3. State the core point once, except in a summary the register requires.
4. Vary sentence construction without staccato. Avoid parataxis chains and decorative triads.
5. At most one rhetorical negative parallelism per piece, usually none.
6. Check word-list hits in context, with the tiers and the protected uses.
7. Punctuation budget: em dash at most 1 per 500 words, none on a slide face. Exclamation marks at most 1 per 1,000 words.
8. Prose gets actor and verb early and the everyday word. Slides get the sober nominal style.
9. Headings and slide titles name the content, usually as noun labels.
10. Name sources, tools, dates and feelings. Never add facts, persona or staccato the source did not have.

Precedence when rules collide: guardrails, then the register profile, then P0 before P1 before P2.

## Severity

- **P0, trust breakers:** chat artifacts, knowledge-cutoff disclaimers, leaked citation tokens, unfilled placeholders, unsourced vague attributions, invented facts, reasoning or prompt echoes, speculation dressed as background, moderator notes on a slide face.
- **P1, clear AI tells:** qualifying word-list hits, negative parallelisms and triads outside their permitted uses, stock transitions and openers, bold overuse, em-dash frequency, hedge stacks, significance inflation, colon reveals, faux-insight setups, aphoristic kickers, phantom objections, staged emphasis, prestige lists, false agency, template balance, slogan cadence at three or more per document, teaser or colloquial slide titles, colloquial register and command tone on slides, unrequested status stamps, load-bearing metaphors used as verdicts, mixed German and English number formats, realization codas and epilogues.
- **P2, polish:** paragraph uniformity, interpretive metadiscourse, repeated sentence openings, text about itself, replies that rebuild context, vague association, parenthetical hedging, decorative counts, preview and recap symmetry, unsupported absolutes in persuasive prose, headings over two-sentence sections, copula avoidance, generic endings, title case in subheadings, nominalizations in prose, microformat slips.

A hit is a reason to look, not a verdict. Weak signals count only in a cluster, and a clean text gets reported as clean.

## Guardrails

These failures matter more than any tell they remove:

- No invented first person, anecdotes, numbers, names or dates. A missing detail is a gap to report, not to fill.
- No staccato conversion: build sentences differently instead of chopping them up.
- No performed candor, no manufactured contrarianism.
- No silent loss. Every claim, number, name, date, quote, ranking, list item and simultaneous fact survives the edit. A cause stays a cause, a range keeps both ends, an approximation stays approximate, a negation is neither softened nor inverted.
- No polishing away what makes human text human. Typos, quirks and rough tone stay.

The test for every edit: does the information in the new version come from the source? Cutting and sharpening yes, adding no, losing no.

This skill serves good writing. It does not evade disclosure duties, and where AI use must be declared, it changes nothing about that.

## Maintenance

When a review correction generalizes into a rule, fold it into `SKILL.md` or the pattern catalog, add one catch example and one look-alike, bump the version in `CHANGELOG.md`, and run `npm run test:unslop`. Case 12 stays clean, and overflagging counts as a regression.

Examples in the skill and the catalog are invented, from unrelated domains. Never quote project content, customer text or legal drafts into the skill, including in git history.
