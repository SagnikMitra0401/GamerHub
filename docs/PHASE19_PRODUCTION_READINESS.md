# Phase 19 — production readiness

> **Status:** step 1 implemented and verified on 25 November 2026. Steps 2 to 11
> are still plan.
> **Scope owner:** engineering.
> **Source of the work:** the critical review of 24 November 2026, which scored
> the project 6/10 and named the faults behind each score.
> **Rule for the whole phase:** one step lands, is verified, and is committed
> before the next step starts. A step that cannot pass its own gate does not get
> merged.

## 0. Executive summary

The feature surface is not the problem. Twelve engineering faults keep the
project below production standard, and they fall into four groups: configuration
that fails at runtime instead of at boot, a data model that stores relationships
as arrays inside one document, tooling that cannot catch a mistake (no linter,
no types, no coverage, no error boundary), and a client whose 10,521 CSS lines
and single 792 kB bundle fight every layout fix.

This plan turns each fault into one shippable step with a measurable gate. Steps
1 to 4 remove correctness risks. Steps 5 and 6 change structure without changing
behaviour. Steps 7 to 9 raise delivery quality. Steps 10 and 11 make the project
operable and reviewable.

Estimated effort: 27 to 34 working days, plus review time.

| Step | Name | Removes | Effort | Depends on |
|---|---|---|---|---|
| 0 | Freeze and verify the current tree | Unknown state of 59 uncommitted paths | 0.5 d | none |
| 1 | Boot configuration and origin policy | Runtime-only config failures, hardcoded hosts | 1.5 d | 0 |
| 2 | Lint, format and type baseline | No mechanical check on 60k lines | 2 d | 0 |
| 3 | Follow, save, block and mute edges | 16 MB document ceiling, fat session reads | 4 d | 2 |
| 4 | Transaction boundaries | Half-applied writes | 3 d | 3 |
| 5 | Session lifetime and CSRF depth | 7-day cookie with one defense layer | 3 d | 2 |
| 6 | Backend structure and pagination | God files, three pagination styles | 4 d | 2, 3 |
| 7 | Client delivery and failure boundaries | One 792 kB chunk, no error boundary | 2.5 d | 2 |
| 8 | Stylesheet consolidation | 11 cascade layers, 406 inline styles | 4 d | 2, 7 |
| 9 | Test depth and reporting | Untested pages, unmeasured coverage | 4 d | 2, 6 |
| 10 | Operations and container | No deploy artifact under test | 2 d | 1 |
| 11 | History and documentation accuracy | Unreviewable history, unverified claims | 1.5 d | all |

## 1. Definition of production ready

Every step is judged against the same eight criteria. A step is done only when
all eight hold.

1. A test exists that fails without the change and passes with it.
2. `npm test`, `npm test --prefix client`, `npm run build --prefix client`,
   `npm run test:unslop`, `npm run scan:prose`, `npm run scan:secrets` and
   `node scripts/scan-emoji.js` all exit 0.
3. Any database change has a migration that runs forward and backward on a
   clone, and `npm run migration:lint` passes.
4. No user-visible regression at 360, 768 and 1440 px on the surfaces the step
   touches.
5. The rollback path is written down before merge, either as a flag, a reverse
   migration, or a revert commit that does not take unrelated work with it.
6. `docs/TEST_LEDGER.md` gains one row: command, result, date.
7. A new failure mode emits a structured log line carrying the request id.
8. A deploy of the step passes the smoke list in §3 on a staging instance.

## 2. Current tree gate (step 0)

The review found 50 modified and 9 untracked paths, all of them coherent work
spanning Phase 18, the prose standard and the settings frame. Before step 1
starts, that work has to be committed in pieces and re-checked.

Evidence collected on 24 November against the working tree:

| Check | Command | Result |
|---|---|---|
| Server units, migration lint, prose rules, prose gate | `npm test` | exit 0, 14 prose notices at P2 only |
| Client components | `npm test --prefix client` | 51 of 51 pass, exit 0 |
| Client build | `npm run build --prefix client` | pass, 179.13 kB CSS and 792.29 kB JS (211.60 kB gzip) |
| Prose rules | `npm run test:unslop` | 36 checks, 0 failed |
| Prose gate | `npm run scan:prose --strict` | exit 0, 0 P0 or P1 |
| Settings frame and login links | browser measurement at 360, 498, 1000 px | one padding owner, links separated, no horizontal overflow |
| Secret-leak gate | `npm run scan:secrets` | 0 hits |
| Design-system gate | `node scripts/scan-emoji.js` | 0 lines |
| Responsive smoke | `npm run test:responsive` | 63 of 63 pass |

Run on 25 November against the committed tree: the fifteen e2e suites, all
passing, 852 checks in total, each suite on its own throwaway database. Still not
run, and therefore not claimed: `npm run backup:drill`, which needs a restore
target.

**Acceptance for step 0**

- One commit, `201f815`, holds the whole tree. The four-commit split this plan
  asked for was dropped: all 59 paths were already written when the phase
  started, so a split would not have been reviewed commit by commit either.
- `git status` clean.
- Every command in §1 criterion 2 executed on the committed tree, with the
  output pasted into the ledger.
- The e2e suites run once against a throwaway database and their tallies
  recorded, so the next phase has a real baseline instead of a documented one.

**Rollback:** none needed. The commits are local until pushed, and nothing is
pushed without a decision.

## 3. Smoke list for a staging deploy

Run after every step's deploy, in this order. Each line is a pass or a fail.

1. `GET /api/health` returns 200 with every domain `connected`.
2. `GET /api/health/ready` returns 200.
3. Register, receive the code, confirm, reach `/welcome`, finish onboarding.
4. Sign out, sign in with the same credentials.
5. Create a post with an image, then load the feed anonymously.
6. Open settings, switch all seven tabs, change the handle.
7. Send a DM from a second account and read it on the first.
8. Trigger a password reset and complete it.
9. Sign out everywhere, confirm the old session is refused.
10. Check the browser console on the feed, settings and profile for errors.

## 4. Steps

### Step 1 — Boot configuration and origin policy

**Fault being removed.** `JWT_SECRET` is read at request time in
`server/middleware/auth.js` and `server/utils/generateToken.js`, so a deployment
missing it starts and fails every sign-in. `server/utils/origins.js` hardcodes
two Vercel hostnames next to the env list, and anyone who claims one of those
subdomains inherits credentialed CORS.

**Scope**

- New `server/config/env.js` exporting `loadEnv()`: required keys per
  environment, a minimum length for `JWT_SECRET`, a URL shape check for
  `CLIENT_URL`, and an explicit list of optional keys. Called as the first
  statement of `server/server.js` and at the top of the test harnesses.
- Failure mode: print every missing or malformed key by name, exit with code 1,
  and never echo a value.
- `origins.js`: drop `DEFAULT_PRODUCTION_ORIGINS`. Production origins come from
  `CLIENT_URL` and `EXTRA_ALLOWED_ORIGINS` only. Keep the loopback allowance for
  non-production.
- Add a gate script `scripts/scan-hosts.js` that fails on a literal hostname in
  `server/` outside tests and the env example.

**Acceptance**

- Booting with `JWT_SECRET` unset exits 1 and names the key.
- Booting with a 12-character secret exits 1 and names the length rule.
- `npm run test:origins` covers an allowed origin, a rejected origin and an
  empty origin for both REST and socket.
- `grep -rn "vercel.app" server/ --exclude-dir=tests` returns nothing.

**Verification**

```
node -e "process.env.JWT_SECRET=''; require('./server/config/env').loadEnv()"   # must exit non-zero
npm test
node scripts/scan-hosts.js
```

**Result (25 November 2026).** Implemented with three corrections, each recorded
because the plan was wrong on the point:

- `npm run test:origins` did not exist. It does now, next to `npm run test:env`
  and `npm run scan:hosts`, and `server/tests/env.test.js` joined the `npm test`
  file list.
- The host gate as written ("fails on a literal hostname in `server/`") would
  fail on legitimate third-party API URLs such as YouTube, IGDB and Cloudinary.
  It now fails on two narrow things: a shared-hosting domain, and a literal
  allow-list array named like `*ORIGIN*` or `*ALLOW*`.
- `grep -rn "vercel.app" server/` cannot return nothing, because the origin test
  keeps spoofed fixtures. The acceptance is the same grep with
  `--exclude-dir=tests`.

Added beyond the plan: a 32-character `JWT_SECRET` floor (the admin panel already
reported that strength), refusal of the `.env.example` placeholder, a production
requirement for `EMAIL_CODE_PEPPER` (it used to throw on the first registration
instead of at boot), `NODE_ENV` and `TRUST_PROXY` shape checks, warnings for
half-configured optional integrations, and the same check in the e2e harness.

Measured: 15/15 env checks, 3/3 origin checks, `npm test` 356/356 with the host
gate in the chain, `npm run scan:secrets` 0 hits, 167 server files and 0
hardcoded origins. An empty `JWT_SECRET` and a 5-character one each exit 1 and
name the key without printing it.

**Risk:** a missing key in the developer's own `.env` turns into a loud boot
failure. That is the point, but the message has to name the key and the file.

**Effort:** 1.5 days.

### Step 2 — Lint, format and type baseline

**Fault being removed.** There is no ESLint, no Prettier and no type checking in
a 60,000-line codebase. `server/middleware/errorHandler.js:11` disables a rule
from a linter that is not installed.

**Scope**

- ESLint flat config at the root covering `server/` and `client/src/`, with the
  React plugin for the client.
- Prettier with a single config at the root, and `format:check` in CI. Run
  `format` once in its own commit so logic diffs stay readable.
- `tsconfig.json` with `allowJs` and `checkJs`, applied to `server/` first.
  `client/src` joins in step 7 once the route split has landed.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, wired into the
  `quality` CI job.

**Acceptance**

- Lint exits 0 at the committed configuration. Rules that would fire hundreds of
  times start as warnings with a tracked count in the ledger, and the count only
  goes down.
- Adding `const unused = 1;` to any server file fails `npm run lint`.
- `npm run typecheck` reports 0 errors on `server/`, with `checkJs` on.
- Prettier reformat lands in a commit that touches no logic.

**Verification**

```
npm run lint
npm run format:check
npm run typecheck
npm test
```

**Risk:** the reformat commit makes `git blame` noisy. Land it alone, and add the
hash to `.git-blame-ignore-revs`.

**Effort:** 2 days.

### Step 3 — Follow, save, block and mute edges

**Fault being removed.** `server/models/User.js:50` stores `followers`,
`following`, `savedPosts`, `blockedUsers` and `mutedUsers` as arrays inside the
user document. The document has a 16 MB ceiling, every write rewrites the array,
and `server/middleware/auth.js:7` pulls all five on every authenticated request.

**Scope**

- New collections with compound unique indexes: `Follow { follower, following,
  createdAt }`, `SavedPost { user, post, createdAt }`, `UserBlock`, `UserMute`.
- Migration per domain: backfill from the arrays, verify counts per user, then
  leave the arrays in place for one release.
- Read switch behind `RELATION_EDGES`, default off until the migration has run on
  staging. Every read site moves in one commit per area: feed ranking, profile,
  saved list, block and mute filters, DM policy.
- Denormalised counters on `User`: `followerCount`, `followingCount`,
  `savedCount`, written in the same operation as the edge.
- `SESSION_FIELDS` in `server/middleware/auth.js` drops all five arrays.

**Acceptance**

- Migration reports zero mismatches between array length and edge count on a
  clone of production data.
- The feed ranking test suite produces the same ordering before and after.
- `GET /api/users/:username/followers` paginates with a cursor and a 50-item cap.
- A user with 200,000 follow edges can be read and written in a test fixture.
- `npm run db:indexes` shows no missing or extra index.

**Verification**

```
npm run migrate:domains:status
npm run migration:lint
npm run db:indexes
npm test
npm run test:e2e
```

**Risk:** the highest of the phase. Dual read with a flag, run the backfill
twice to prove idempotence, and keep the arrays until step 9 has shipped.

**Rollback:** flip `RELATION_EDGES` off. The arrays are still authoritative
during this step.

**Effort:** 4 days.

### Step 4 — Transaction boundaries

**Fault being removed.** `startSession` and `withTransaction` appear zero times
outside tests, while several flows write more than one document.

**Scope**

- `server/utils/transaction.js` exporting `withTransaction(fn)`, using a session
  when the deployment is a replica set and falling back to sequential writes with
  a warning when it is not.
- Wrap, one commit each: account deletion, recovery completion, DM conversation
  creation with its first message, business review decision with its retention
  record, invitation acceptance with membership and notification.
- Test helper that throws between writes and asserts the first write rolled back.

**Acceptance**

- Each wrapped flow has a test that injects a failure after the first write and
  finds no partial state.
- The fallback path is documented in the ledger with the standalone deployment it
  applies to.
- No endpoint gains latency above 15 ms at p95 in a local benchmark of 100 calls.

**Verification**

```
npm test
npm run test:e2e
node scripts/backup-drill.js    # after the flows change
```

**Effort:** 3 days.

### Step 5 — Session lifetime and CSRF depth

**Fault being removed.** One 7-day cookie, no rotation, no idle timeout, and in
production `sameSite: 'none'` leaves the origin allow-list as the only CSRF
defense.

**Scope**

- Access token 30 minutes, refresh token 30 days, both httpOnly. Refresh rotates
  on every use and stores a hash of the current refresh token on the session
  record so replay fails.
- Idle expiry: a refresh that arrives after 14 days of inactivity is refused.
- CSRF: double-submit token for every cookie-authenticated mutation, checked in
  one middleware, with the header name documented in the client.
- Decide the cookie policy per deployment topology and write it in the ledger:
  same-site deployments use `lax`, split deployments keep `none` plus the token.

**Acceptance**

- An expired access token returns 401 with code `TOKEN_EXPIRED`, and the client
  refreshes once without a visible reload.
- A replayed refresh token is refused and revokes the session.
- A mutation without the CSRF header returns 403.
- Sign out everywhere invalidates the refresh record as well as the access token.

**Verification**

```
npm test
npm test --prefix client
npm run test:e2e
```

**Risk:** refresh loops. Cap the client at one refresh attempt per request and
log a loop counter.

**Effort:** 3 days.

### Step 6 — Backend structure and pagination

**Fault being removed.** Eleven thousand lines of controllers, four files above
850 lines, and three different pagination implementations.

**Scope**

- `server/services/` boundaries for DM, auth and admin. Controllers keep HTTP
  concerns only: parse, authorise, call, respond.
- `server/utils/pagination.js` with one `parseLimit(query, { fallback, max })`
  used by every list endpoint, plus a test that scans controllers for inline
  `Math.min(Math.max(`.
- Route snapshot test: the 223 route paths and methods as a checked fixture, so a
  refactor cannot silently drop an endpoint.

**Acceptance**

- No hand-written file above 500 lines outside generated data.
- The route snapshot matches before and after each extraction commit.
- All pagination clamps come from `parseLimit`.
- No behaviour change: the e2e suites pass without test edits.

**Verification**

```
npm test
npm run test:e2e
```

**Effort:** 4 days across several commits, one module per commit.

### Step 7 — Client delivery and failure boundaries

**Fault being removed.** A single 792 kB bundle for 109 components, and no error
boundary anywhere.

**Scope**

- `React.lazy` per route with one `Suspense` fallback that matches the existing
  skeleton styles.
- One error boundary around the shell and one per route, reporting to the same
  client error path as the API.
- Bundle budget check in CI: initial route under 150 kB gzip, no single chunk
  above 250 kB gzip.
- Turn on `checkJs` for `client/src` once the split has landed.

**Acceptance**

- The build emits at least eight chunks and the budget check passes.
- A component that throws renders the boundary fallback, with a test.
- Deep links to each lazy route work on a hard reload.

**Verification**

```
npm run build --prefix client
npm run test:responsive
npm test --prefix client
```

**Effort:** 2.5 days.

### Step 8 — Stylesheet consolidation

**Fault being removed.** 10,521 lines across 11 files, `.navbar-link` declared 11
times, `.floating-toolbar-btn` 10 times, and 406 inline style objects.

**Scope**

- One directory `client/src/styles/` with layers: tokens, base, layout,
  components, pages, and one file per page that needs its own rules.
- Remove duplicate selectors and the phase files once their rules are merged.
- Replace inline styles with component classes, page by page.
- Stylelint with duplicate-selector and specificity rules, plus a CSS byte
  budget in CI.

**Acceptance**

- No selector is declared twice at the top level.
- Total CSS under 7,000 lines.
- Inline style objects under 50.
- Settings, login, feed and profile render identically at 360, 768 and 1440 px,
  checked by screenshot diff against the pre-step build.

**Verification**

```
npm run build --prefix client
npm run test:responsive
npx stylelint "client/src/styles/**/*.css"
```

**Risk:** the cascade is the product's memory. Move one page at a time and keep
the screenshot diff as the gate.

**Effort:** 4 days.

### Step 9 — Test depth and reporting

**Fault being removed.** No coverage measurement, 51 client tests for 109
components, and 790 e2e assertions in 15 scripts with no runner, isolation or
report.

**Scope**

- `c8` for the server and `vitest --coverage` for the client, with thresholds per
  folder and the current numbers recorded as the floor.
- Client tests for login, register, verify email, settings security, settings
  business, and feed, each covering the unhappy path.
- One e2e runner: unique database per run, suite isolation, JSON and Markdown
  reports, and a nonzero exit when a suite is skipped outside a fork.
- Three consecutive runs recorded to measure flakiness.

**Acceptance**

- Coverage thresholds enforced in CI.
- The six surfaces have behaviour tests, not snapshot tests.
- The e2e report lists each suite, its checks and its duration.
- Flake rate under 1 percent across three runs.

**Verification**

```
npm test
npm run test:e2e
npm test --prefix client
```

**Effort:** 4 days.

### Step 10 — Operations and container

**Fault being removed.** No deploy artifact in the repository, while the docs
describe a Render and Vercel deployment.

**Scope**

- `Dockerfile` on `node:22-slim`, non-root user, `npm ci --omit=dev`, health
  check on `/api/health/ready`.
- `render.yaml` or the platform config committed, with every env key named and no
  values.
- `.nvmrc` matching `engines`.
- Document the single-instance constraints: in-process retention and flush
  workers, in-memory metrics, rate-limit store when Redis is off.
- Shutdown test: a request in flight when `SIGTERM` arrives completes before exit.

**Acceptance**

- `docker build` and `docker run` serve `/api/health` 200 locally.
- The container starts with only the documented env keys.
- The shutdown test passes.
- The constraints section exists in the deploy doc.

**Verification**

```
docker build -t gamerhub .
docker run --env-file .env.docker -p 5000:5000 gamerhub
curl -s localhost:5000/api/health
```

**Effort:** 2 days.

### Step 11 — History and documentation accuracy

**Fault being removed.** 38 commits from one author with names like `update
patch-02`, and a ledger that asserts totals no reader can regenerate.

**Scope**

- Commit convention documented in `AGENTS.md`: one theme per commit, an
  imperative subject, a body that says why.
- `scripts/ledger-counts.js` that regenerates the check counts in
  `docs/TEST_LEDGER.md` from the actual runs, so the headline number cannot drift.
- Remove personal addresses from tracked documents where they are not required
  by the legal drafts.
- Keep `ADMIN_CREDENTIALS.txt` untracked and out of any share archive, and note
  that in the README.

**Acceptance**

- `npm run ledger:counts` rewrites the table and the diff is empty on a clean run.
- No tracked file contains a personal email outside the legal drafts and the
  commit identities.
- `git log --oneline -20` reads as a sequence of changes.

**Verification**

```
npm run ledger:counts
npm run scan:secrets
git log --oneline -20
```

**Effort:** 1.5 days.

## 5. Verification matrix

| Gate | Command | Green condition |
|---|---|---|
| Server units and gates | `npm test` | exit 0 |
| Client units | `npm test --prefix client` | exit 0 |
| Build | `npm run build --prefix client` | exit 0 and budget met |
| E2E | `npm run test:e2e` | every suite recorded, none skipped |
| Responsive | `npm run test:responsive` | 63 of 63 |
| Prose rules | `npm run test:unslop` | 36 of 36 |
| Prose gate | `npm run scan:prose --strict` | exit 0, no P0 or P1 |
| Secrets | `npm run scan:secrets` | 0 hits |
| Design system | `node scripts/scan-emoji.js` | 0 lines |
| Migrations | `npm run migration:lint` | exit 0 |
| Indexes | `npm run db:indexes` | no drift |
| Backups | `npm run backup:drill` | restore verified |
| Lint (from step 2) | `npm run lint` | exit 0 |
| Types (from step 2) | `npm run typecheck` | 0 errors |
| Coverage (from step 9) | `npm run coverage` | thresholds met |
| Container (from step 10) | `docker build` | health returns 200 |

## 6. Sequencing rationale

Steps 1 and 2 come first because they catch the mistakes the later steps would
otherwise introduce. The data model in step 3 is the largest correctness risk,
so it lands before the structural refactor in step 6, which would otherwise have
to be done twice. Transactions follow the model change because the flows they
wrap are the same flows that read the arrays today. The client work in steps 7
and 8 waits for the type baseline so the split can be checked mechanically.
Testing depth in step 9 comes after the structure settles, so coverage is not
chased across files that are about to move. Operations and history close the
phase.

## 7. Non-goals

New product features, Atlas Search, multi-instance deployment, a native mobile
client, and any change to the legal drafts' substance. Those belong to the
product roadmap, not this phase.
