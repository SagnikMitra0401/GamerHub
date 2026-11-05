# GamerHub — Testing Ledger

Living record of what has been verified, by what method, and when to re-run each
tier. The point is to stop re-testing things that cannot have changed: read the
"Re-run only if" column before spending a pass on a tier.

**Last updated:** 5 November 2026 · **Branch:** `main` · **Head:** hardening & resilience pass
**Node:** v24.16.0 · **Redis:** intentionally off (`REDIS_ENABLED` unset)
**Companion docs:** [phase 6 detail](TEST_REPORT_PHASE6.md) · [next phases](ROADMAP.md)

---

## 1. Current status

| Tier | Command | Result | Last run |
|---|---|---|---|
| Unit / contract — server | `npm test` | **148 / 148 pass** | 5 Nov |
| Unit — client components | `npm test --prefix client` | **31 / 31 pass** | 5 Nov |
| E2E — auth, communities, sockets | `npm run test:e2e` → `scripts/e2e.js` | **59 / 59 pass** | 5 Nov |
| E2E — feed, presence, LFG, bot, admin | `scripts/e2e-phase4.js` | **66 / 66 pass** | 5 Nov |
| E2E — lifecycle, search, Redis-off | `scripts/e2e-phase6.js` | **159 / 159 pass** | 5 Nov |
| E2E — reactions, forums, moderation | `scripts/e2e-phase7.js` | **80 / 80 pass** | 5 Nov |
| E2E — identity, consent, squad chat, data rights | `scripts/e2e-phase8.js` | **70 / 70 pass** | 5 Nov |
| E2E — settings hub, freeze, succession, erasure | `scripts/e2e-phase9.js` | **62 / 62 pass** | 5 Nov |
| E2E — search budget, presence privacy, socket caps | `scripts/e2e-phase10.js` | **13 / 13 pass** | 5 Nov |
| Client production build | `npm run build --prefix client` | **pass** — 116 kB CSS / 533 kB JS (uncompressed) | 5 Nov |
| Secret-leak gate | `npm run scan:secrets` | **0 hits** | 5 Nov |
| UI smoke — pass 4 | browser, 404 + settings skeleton | **pass** — 404 renders the requested path, no console errors | 5 Nov |
| UI smoke — pass 3 | browser, `/settings` × 5 tabs | **pass** — every panel renders, `?tab=` addressable, no console errors | 5 Nov |
| UI smoke — pass 2 | browser, 8 pages × 3–5 viewports | **pass** (pre-phase-8 pages only) | 25 Oct (that pass) |
| Design-system gate | `node scripts/scan-emoji.js` | **0 hits** (+8 allowlisted reaction glyphs) | 5 Nov |
| Migration tracks | `npm run migrate:status`, `npm run migrate:domains:status` | **pass** — 4 main applied (incl. hardening indexes); auth 1, squads 1; feed/communities still empty | 5 Nov |
| CI — `quality` job | push to `main` | **pass** — 5 steps really executed, 17 s | 26 Oct, run 2 (`f69a2e7`) |
| CI — `e2e` job | push to `main` | **pass** — 284 checks + `migrate:status`, 3 m 13 s | 26 Oct, run 2 (`f69a2e7`) |

**688 automated checks green** (148 server + 31 client + 509 e2e across seven suites), plus the secret gate.
CI has not been re-run since the community milestone; no workflow step had to be
added, because the `quality` job calls `npm test` and the `e2e` job calls
`npm run test:e2e`, both of which now include the new suites. The one workflow
edit (adding `migrate:domains:status` next to `migrate:status`) only extends the
last step. The next push therefore exercises every check above.

### Pass 7 (5 Nov) — loading states, 404, hardening

Three surfaces that were still rough: every data page showed the same centred
spinner, an unknown URL silently redirected to the feed (so a broken link looked
like a working one), and the cheap-query paths had no per-surface budget. The
pass adds layout-shaped skeletons (feed, clips, post detail, profile, server
rail, chat, squad board, catalog, admin, settings), a real `/404` page, and the
hardening in `docs/SECURITY.md`.

Four defects were found by reading the query paths, all fixed and covered:

1. **LFG board leaked privacy** — the populated leader/member documents included
   raw `presence` (so `invisible` was visible) and the account `status`. Now
   projected through `publicPlayer`.
2. **Search loaded every frozen account per request** into a `$nin` list — a
   growing collection scan. Frozen authors are now filtered after the populate,
   and the block list is cached for 15 s with invalidation on freeze/block.
3. **Tag autocomplete scanned the collection** with an unanchored regex; now an
   anchored prefix.
4. **`users.blockedUsers` had no index**, and search/catalog/admin had no
   per-surface rate limit; both added (migration applied on Atlas).

Socket abuse is bounded too: 8 live sockets per account, 60 room joins/min, on
top of the existing 100 kB frame cap and per-user message flood window.

A credential gate (`npm run scan:secrets`) now runs in `npm test` and CI: it
fails on a tracked `.env`, on a credential-shaped literal in source, and on one
that ended up in `client/dist`.

All seven e2e suites were re-run because `controllers/userController.js`,
`lfgController.js`, `config/socket.js` and the rate-limit wiring change every
path they cover. The six existing suites kept their exact tallies
(59 / 66 / 159 / 80 / 70 / 62); the new `e2e-phase10.js` adds 13. `npm test`
went from 133 to 148 with `hardening.test.js`.

What is **not** verified here: the skeletons and 404 in a browser at phone widths
(the 404 was opened once; the skeletons were verified by build + render path
only), a real multi-instance deployment (limits are per process), and the
existing cloud/auth gaps listed in §5.

### Pass 6 (5 Nov) — account & settings hub

The five surfaces the foundation milestone left without a home now live on one
page: profile and handle, feed algorithm, privacy and safety, security and auth,
and the danger zone. Backend work is what makes the page honest — a handle
change that keeps the account, a feed reset that really clears the affinities, a
freeze the server enforces on REST *and* sockets, a session revocation that
invalidates the presented cookie, and a succession engine that hands a server to
its next owner (or dissolves it) when the owner is erased.

All six e2e suites were re-run because `middleware/auth.js`, `config/socket.js`,
the `User` model, the retention worker and every controller that projects a user
changed. The five older suites kept their exact tallies (59 / 66 / 159 / 80 / 70)
— that is the no-regression proof for this pass. `npm test` went from 117 to 133
with the new `settings.test.js` (handle rules, participation matrix, succession
ordering). The new `scripts/e2e-phase9.js` adds 62 checks.

Beyond the suites, this pass ran the full local gate: client build, the emoji
gate (0 hits), `migrate:status` and `migrate:domains:status` against Atlas — which
finally settles the open question from pass 5: the domain tracks **are** applied
(auth 1, squads 1; feed and communities have no migrations yet).

What is **not** verified here: Google sign-in and account linking against a live
Google credential (the fail-closed branches only), any Cloudinary path (still no
credentials), the settings actions clicked through in a browser — freeze, rename
and deletion are proven at the API level and the panels are proven to render,
but no browser flow submitted those forms — and email verification or password
reset, which are still unbuilt (roadmap phase 11).

### Pass 5 (31 Oct) — foundation, consent & squad system

Domain-isolated connections and migration tracks, account governance (session
versions, Google sign-in surface, account states), the consent-driven invitation
engine, squad lifecycle with the 15-day temporary chat, privacy settings,
blocking, data export and account deletion are now implemented.

All five e2e suites were re-run because the auth middleware, `User`, party
controller, socket engine and retention worker all changed. The four older
suites kept their exact tallies (59 / 66 / 159 / 80) — that is the no-regression
proof for this pass, not a repeat of their detail. `npm test` went from 92 to
117 with three new pure-function suites (`privacy`, `squadLifecycle`,
`connections`).

Two real defects were found by the new suite and fixed:

1. `purgeExpiredSquadChats` only scanned `state: 'active'`, so a chat that had
   already been flipped to `expired` by a request-time check kept its messages
   forever. The sweep now also reclaims messages for already-expired chats and
   records `purgedAt` so settled chats leave the scan.
2. The LFG accept/decline responses returned the squad without its chat summary,
   so a client that patched its list from the response lost the chat id. Both
   responses now go through `attachChatMeta`, and every party view declares
   `chat: null` explicitly.

What is **not** verified here: Google sign-in itself (no client id/credential in
this environment — only the provider surface and the fail-closed branches are
exercised), the new UI in a browser (build + DOM-free component checks only), and
any Cloudinary path (unchanged from pass 4). The domain migration tracks are
written but not yet applied to Atlas.

### Pass 4 (31 Oct) — community interaction milestone

Reactions, replies, mentions, pinned messages, permission-scoped search, forum
channels, image attachments, reports, timeouts, bans and personal mutes are now
implemented and covered. Every suite was re-run because permissions, the socket
engine and the community controller changed; the three older suites kept their
exact tallies (59 / 66 / 159), which is the no-regression proof, and `npm test`
went from 74 to 92 with the three new pure-function suites.

What is **not** verified here: the Cloudinary upload path (no credentials in the
local environment — the route is exercised only for its auth and validation
branches), real EXIF stripping (sharp runs, but no GPS-bearing fixture is in the
repo), and the new UI in a browser (no UI smoke this pass; the client build and
the existing 28 component checks pass).

**Pass 3 (26 Oct) — Phase 7 quality gate.** Added the server suites for the
buffered like path and the two-tier cache, the client component suite, a shared
e2e harness and the GitHub Actions workflow. The e2e suites were re-run because
their scaffolding changed, not because the server did; the refactor produced the
same 59 / 66 / 159 tallies, which is the equivalence proof. Nothing is
outstanding — the remaining work is product work, in [ROADMAP.md](ROADMAP.md).

### CI run 2 — `f69a2e7`, the real pass

Both jobs green with nothing skipped: `Check for a test cluster` → success,
`E2E suites` → success (3 m 13 s, which is the three scripts chained with `&&`
— the step only exits 0 after `e2e.js`, `e2e-phase4.js` and `e2e-phase6.js` all
report their full tallies), `Migration status` → success in 3 s. That last one
also settles the two questions a local run could not: GitHub's runners reach
Atlas, and both migrations are recorded as applied on the live cluster.

Job logs are not readable without an authenticated API token, so the counts here
come from step conclusions plus the suites' `process.exit(1)`-on-failure
contract rather than from a parsed log line. Re-read the job page if a number
ever needs quoting exactly.

### CI run 1 — `8654301`, green, e2e skipped (superseded by run 2)

The first Actions run reported **success in 22 s**, but `E2E suites` and
`Migration status` are listed as `skipped`, not passed: the cluster check found
`MONGO_URI` / `JWT_SECRET` empty. The secrets existed, yet were stored as
**environment** secrets, and a job only receives those after declaring
`environment:` — so the 284 e2e checks never ran in CI. Change either side:
store the two secrets as **repository** secrets (no `environment:` needed, no
approval gate per run), or name the environment in the workflow.

Because of that, the check step now **fails** when the secrets are invisible,
with a message naming the fix; only a fork pull request (which cannot be given
secrets) still skips quietly. A green `e2e` job therefore means the suites ran.

Still true regardless: the 284 e2e checks passed locally on this commit, and the
`quality` job genuinely executed all five steps (install, 74 units, 28 client
checks, build, emoji gate).

### Do not re-run a tier unless

| Tier | Re-run when |
|---|---|
| `npm test` | any file in `server/` or `client/src/utils/` changes |
| `npm test --prefix client` | any `.jsx` under `client/src/` changes, or a design token the components read |
| `scripts/e2e.js` | auth, communities, permissions, sockets, sanitizers or CORS change |
| `scripts/e2e-phase4.js` | feed ranking, presence, LFG, bot, admin or catalog change |
| `scripts/e2e-phase6.js` | posts, comments, likes, bookmarks, follows, passport, notifications, search, migrations, cache or rate limits change |
| `scripts/e2e-phase7.js` | `server/utils/permissions.js`, `config/socket.js`, the community/forum/attachment/moderation controllers, or any model those touch change |
| `scripts/e2e-phase8.js` | `middleware/auth.js`, `utils/generateToken.js`, `controllers/{auth,account,invitation,squadChat,lfg}Controller.js`, `utils/{privacy,squadLifecycle,squadChatService}.js`, `config/{connections,socket}.js`, `jobs/retention.js`, or the `User`/`Party`/`Invitation`/`SquadChat*` models change |
| `scripts/e2e-phase9.js` | `controllers/{account,auth,user,post,comment,lfg,community}Controller.js`, `utils/{username,succession,accountErasure,privacy}.js`, `middleware/auth.js`, `config/socket.js`, `jobs/retention.js`, or the `User`/`Community`/`Party`/`SquadChat` models change |
| `scripts/e2e-phase10.js` | `middleware/limiters.js`, `utils/visibility.js`, `controllers/{user,lfg}Controller.js`, `config/socket.js`, or anything that changes how a user document is projected |
| `npm run scan:secrets` | any new source file, dependency, or build output — it is cheap, run it every pass |
| `migrate:domains:status` | a file under `migrations/{auth,feed,communities,squads}/` is added, or after any schema change to the models those tracks index |
| Client build | any file under `client/src/` changes |
| The CI suite | never by hand — a push to `main` runs it; read the run instead |
| UI smoke | a `*.jsx` or `*.css` file under `client/src/` changes **and** the change touches layout, a nav element, a modal, or the design tokens |
| `scripts/lib/e2e-harness.js` | **always** re-run all seven e2e suites — every check goes through it |

A doc-only, test-only or server-logic-only change does not need a UI pass. A
CSS token change does.

---

## 2. Coverage ledger

Everything below is verified by an automated check (unless marked *manual*).
Locate the check with `grep -n "<keyword>" scripts/e2e*.js server/tests/*.js`.

| Area | What is guaranteed | Where |
|---|---|---|
| Auth | register/login/logout, duplicate username & email, weak password, wrong password, `/me`, cookie-only REST auth, prod cookie flags | `e2e.js`, `e2e-phase6.js` |
| Sessions | socket body token, cross-account isolation, expired token rejected | `e2e.js` |
| Feed | global/following/latest/most-liked/for-you ordering, channel filter, pagination, projection leaks (no email/hash) | `e2e.js`, `e2e-phase4.js`, `e2e-phase6.js` |
| Posts | create, tag normalisation, control-char stripping, 5-minute edit window both sides, non-author edit/delete rejected | `e2e-phase6.js` |
| Likes | Redis-on buffer path, Redis-off direct write, `likeCount` == `likes.length`, double-click idempotence, invalid/anon cases | `e2e-phase6.js` |
| Gamification | ten distinct likes → `viral_gamer` + 50 XP exactly once, first comment → `gamer_critic` | `e2e-phase6.js` |
| Comments | create, `commentCount`, validation, listing, ownership on edit/delete | `e2e-phase6.js` |
| Bookmarks / favourites | toggle, saved list, normalisation | `e2e-phase6.js` |
| Follow graph | toggle, self-follow rejected, follower projection, privacy fields | `e2e-phase6.js` |
| Gamer passport | quote cap, trimmed IDs, platform fallback, single primary rig, active-game cap, auto-primary | `e2e-phase6.js` |
| Preferences / presence | dedupe, invalid platform, `in_game` validation, invisible vs raw projection | `e2e-phase4.js`, `e2e-phase6.js` |
| Search | 1-char rejection, weighted text search, username prefix, tag autocomplete, regex-metachar safety, no email leakage | `e2e-phase6.js` |
| Communities | create/list/join/leave, duplicate join, channel create/update gates, slowmode bounds, cursor history, non-member block, audit contents with no write route, owner-only delete | `e2e.js`, `e2e-phase6.js` |
| Chat / sockets | delivery, cross-server injection blocked, flood control, slowmode, owner bypass, live membership eviction | `e2e.js` |
| Reactions | allowlist rejects unknown codes/markup, case-insensitive toggle on and off, shared counts, per-viewer `mine`, non-member 403, message scoped to its URL channel, no reactor ids in history | `e2e-phase7.js`, `reactions.test.js` |
| Replies & mentions | reply preview captured at send time, cross-channel quote dropped, mentions resolved to real members only, email addresses never ping, 20-char name boundary, exactly one ping per mentioned member, non-members never pinged | `e2e-phase7.js`, `mentions.test.js` |
| Pins & search | member cannot pin, moderator pins/unpins, pin tray for members, search never returns an unreadable channel, channel-scoped search refuses a gate the caller fails, 2-character minimum | `e2e-phase7.js` |
| Forum channels | non-member 403, create/list/detail with reply count, member cannot lock, moderator locks, locked thread rejects replies, live socket send refused, moderator delete, deleted threads leave the list, required tag enforced, tags normalised | `e2e-phase7.js` |
| Attachments | no-file 400, another user's upload dropped, accepted upload claimed by the message, non-member cannot fetch a signed URL, magic-byte/type mismatch/SVG/oversize rejected at 8 MB | `e2e-phase7.js`, `fileValidator.test.js` |
| Timeouts / bans / mutes | member cannot time out a peer, duration allowlist, timed-out socket send refused, lift restores sending, admin-only ban with live eviction and rejoin refused, unban restores, personal mute toggle, self-mute refused, audit row per action | `e2e-phase7.js` |
| Reports | member report accepted, duplicate is a silent no-op, non-member 403, member cannot read the queue, moderator sees preview + reporter, resolution audited | `e2e-phase7.js` |
| Channel config | `forumConfig` normalised, `requireTag` enforced, `attachmentsEnabled` persisted, forum type present in the sidebar payload | `e2e-phase7.js` |
| Moderation | role hierarchy, kick/assign rules, capability resolution, escalation attempts rejected | `server/tests/*`, `e2e.js` |
| Notifications | cursor shape, page continuity without overlap, invalid cursor, unread filter, single read, cross-user read denied, mark-all-read | `e2e-phase6.js` |
| LFG | creation, 6-hour expiry, slot accounting, filters, join requests, leader-only respond/close, accept fills and delists | `e2e-phase4.js`, `e2e-phase6.js` |
| Game catalog | normalised payload, detail, invalid id, 1-hour cache | `e2e-phase4.js`, `e2e-phase6.js` |
| Admin | 403 for users, health payload, DB state, Redis truthfully reported off, secrets never returned, counts, metrics | `e2e-phase4.js`, `e2e-phase6.js` |
| Hardening | JSON 404, NoSQL operator rejection, malformed JSON, 100 kB body cap, CORS allow-list, rate-limit headers, 9 protected routes reject anon | `server/tests/*`, `e2e-phase6.js` |
| Link previews | SSRF: loopback/private v4+v6 blocked, unsafe schemes rejected, 512 kB cap | `server/tests/*` |
| Cache | L1 hit, concurrent miss collapse, failed load not cached, Redis error degrades for 30 s | `server/tests/cache.test.js`, `e2e-phase6.js` |
| Two-tier cache (offline) | L2 hit on a cold L1, EX TTL from the caller, default TTL, degrade window stops calling Redis and recovers after 30 s, one warning not one per request, write failure still served from L1, delete clears both tiers, null treated as a miss | `redisCache.test.js` (13) |
| Like buffer (offline) | Off-switch signals direct write, unknown action refused, last-write-wins collapsing, pipeline recomputes `likeCount` instead of `$inc`, one bulkWrite per batch, failed write keeps events queued and the retry is idempotent, malformed fields skipped and cleared, batch cap leaves a remainder, viral medal once across ticks, medal failure never fails the flush, worker start/stop/disable | `likeBuffer.test.js` (16) |
| Client — tabs | one button per option, `aria-pressed` on the active tab only, click key, keyboard activation, `is-ready` after the first frame, unknown value renders nothing active, ResizeObserver attached and disconnected | `SegmentedTabs.test.jsx` (7) |
| Client — reactions | like/unlike label + pressed state, one call per click, six-spark burst on fine pointer, no burst on touch/reduced-motion or when unliking, sparks unmount on `animationend`, comment label pluralisation, bookmark shown only with a handler and toggles state, busy disables, clicks do not reach the card | `PostActions.test.jsx` (9) |
| Client — post card | like uses the server's count/state, failed like leaves the count untouched and does not fire the callback, signed-out click redirects to `/login` without a request, bookmark hits `/users/saved/:id` and syncs the session | `PostCard.test.jsx` (4) |
| Client — notification bell | null for a signed-out visitor, badge + accessible name from `unreadCount`, dropdown inside the wrapper on desktop, portalled modal sheet with scrim + close control below 640 px, Escape closes, mark-all-read is optimistic, single read patches and decrements, socket payload appends and bumps the badge | `NotificationBell.test.jsx` (8) |
| Identity & sessions | `sv` claim pinned to `User.sessionVersion`, logout-all revokes the old cookie, deletion request revokes it too, deleted/suspended accounts blocked at the middleware, public profile never exposes identities/email/blocks | `privacy.test.js`, `e2e-phase8.js` |
| Google provider | provider surface always answerable, sign-in fails closed with no credential/configuration, no merge on unverified email (code path; no live Google token in CI) | `e2e-phase8.js` |
| Consent matrix | anyone / followers-only / nobody per target type, blocked pairs refused with a generic reason, deleted or suspended recipients unavailable, self-invite refused, duplicate pending refused | `privacy.test.js`, `e2e-phase8.js` |
| Invitations | leader-only squad invites, admin-only server invites, recipient-only accept (404 for anyone else), idempotent re-accept, decline, revoke, inbox contents, 7-day expiry sweep | `e2e-phase8.js` |
| Squad lifecycle | recruiting → locked on lock or when the last seat fills, unlock restores recruiting without destroying the chat, leader cannot leave, member leave evicts the socket and revokes access | `e2e-phase8.js` |
| Temporary chat | 15-day expiry, boundary instant already expired, owner-only refresh with `refreshCount`, member read/write, outsider socket join refused, non-member REST 403, empty message 400, history ordered, retention sweep purges messages, socket and REST share one expiry rule | `squadLifecycle.test.js`, `e2e-phase8.js` |
| Privacy & data rights | privacy patch validation, blocking hides both directions in search, unblock restores, export is an attachment with the caller's own data and no hashes/secrets, export rate limit, deletion request + cancel + grace period, erasure anonymises and blocks sign-in | `privacy.test.js`, `e2e-phase8.js` |
| Domain connections | squads is the only pooled domain, domain URI precedence, `NODE_ENV=test` pins the base URI, per-domain pool ceilings, readiness reports every domain | `connections.test.js`, `e2e-phase8.js` |
| Settings — handle | trimmed and kept as typed, short/long/malformed/non-text refused, platform names reserved, case-insensitive uniqueness (self excluded), the session reflects the new handle at once, the old profile URL stops resolving, re-submitting the current handle is refused | `settings.test.js`, `e2e-phase9.js` |
| Settings — feed reset | affinities and favourite channel are stored and counted on `/account`, a reset clears all three and records the reset time, the baseline is empty afterwards | `e2e-phase9.js` |
| Settings — freeze | wrong password refused, posts leave the feed, search and by-id reads for everyone else, the owner still sees their own profile and posts (presence offline), content creation refused, a live socket is refused immediately, unfreeze restores all of it | `settings.test.js`, `e2e-phase9.js` |
| Settings — succession | admin outranks moderator outranks veteran member, earliest join wins among equals, stable id tie-break, the departing owner is never chosen, a memberless server is dissolved, squad leadership and the chat refresh right move together, the preview writes nothing | `settings.test.js`, `e2e-phase9.js` |
| Settings — erasure | exact handle plus password required, session revoked, account anonymised in place, posts gone, servers transferred or dissolved, squad chat ownership moved, the email is released for a genuinely fresh registration | `e2e-phase9.js` |
| Settings — sessions & Google | `logout-all` revokes the presented cookie immediately; linking refuses a missing or unverifiable credential; unlinking an unlinked account is a no-op | `e2e-phase9.js` |
| Settings — UI | five rails each render their panel, the active tab is URL-addressable (`?tab=`), `/api/account` answers 200, no console error on any tab | manual DOM pass (5 Nov), `SettingsPage` |
| Load safety — budgets | search refused at 429 after its per-account budget while another account keeps working, socket joins refused with `RATE_LIMITED`, a third live socket refused with `TOO_MANY_CONNECTIONS` | `e2e-phase10.js`, `hardening.test.js` |
| Visibility privacy | LFG board projects an invisible leader as offline and never exposes account status; a freeze removes the author from search on the very next request (cache invalidation) and unfreezing restores it | `e2e-phase10.js` |
| Secret gate | detects Mongo/AWS/Google/Stripe/private-key/quoted-secret/bearer shapes, ignores placeholders and `process.env` references, redacts its own output, and scans `client/src` + `client/dist` for real | `hardening.test.js`, `scripts/scan-secrets.js` |
| Loading & 404 | skeleton compositions render one labelled status region, the right card count and no readable placeholder text; unknown routes render NotFound with the requested path | `Skeleton.test.jsx` (3), build + DOM pass (5 Nov), `NotFound.jsx` |
| CI | both suites, the client build and the emoji gate on every push/PR; e2e + `migrate:status` + `migrate:domains:status` whenever `MONGO_URI`/`JWT_SECRET` resolve, and a failing check step (not a quiet skip) when they do not, except on fork PRs | `.github/workflows/ci.yml` |
| Migrations | main track applied (4 files, incl. `users_blockedUsers` + `users_status_createdAt`); weighted text index, `posts_userId_createdAt`, `posts_likeCount_hot`, `notif_userId_read_createdAt` present. Domain tracks applied: auth 1, squads 1; feed and communities have no files yet | `npm run migrate:status`, `npm run migrate:domains:status` |
| Design system | no emoji or typographic glyph in any `client/src` JSX/CSS outside the single reaction catalogue, which holds the 8 sanctioned reaction glyphs | `node scripts/scan-emoji.js` (manual gate) |

---

## 3. UI smoke — pass 2 (this session)

Method: live Vite dev server (`:3000`) against the API (`:5000`), driven through
the browser panel. Layout is measured with
`getBoundingClientRect()` / `scrollWidth` vs `clientWidth`, plus a scan for
`scrollWidth > clientWidth` on every `button`/`.btn`/`a` (clipped labels) and for
elements crossing the viewport edge (horizontal overflow). Screenshots were not
available in this session (window not drawn), so all results are DOM
measurements.

| Page | Viewports measured | Horizontal overflow | Clipped labels | Emoji |
|---|---|---|---|---|
| Feed | 320, 360, 700, 768, 1280 | none (`scrollWidth ≤ clientWidth` at all) | none | none |
| Channel (`/c/:tag`) | 360, 768 | none | none | none |
| Communities list | 1280 | none | none | none |
| Community room | 360 | none | none | none |
| LFG | 360 | none | none | none |
| Games catalog | 360 | none | none | none |
| Post detail | 1280 | none | none | none |
| Profile | 360 | none | none | none |

Functional checks re-confirmed in the same pass:

- Create-community modal: sigil preview follows the typed name, close control is
  an SVG button, submit creates the server, new card appears, deletion works.
  The temporary server was deleted afterwards.
- Notification bell: mobile sheet opens with an icon close control, inside the
  viewport.
- Post detail: back link renders its arrow icon; like/comment counters render SVG
  actions with counts only (no emoji).
- Community room on a phone: channel drawer toggle present, sidebar sigil renders
  at 34 px.
- Console: no runtime errors; only the expected React Router v7 future-flag
  warnings and anonymous `/api/auth/me` probes.

### What the reported "create-post overflow" turned out to be

A hard viewport overflow could not be reproduced on the feed at 320/360/700/768/
1280, with or without the composer open: the action cluster and the composer
footer both stay inside the container. What *was* wrong, and is now fixed:

1. **Channel page, ≤640 px** — the create-post button wrapped alone onto a second
   line, left-aligned under a right-aligned favourite button. The header now uses
   the same `feed-tabs-rail` + `feed-actions` structure as the feed, so the
   cluster wraps as a unit and stays right-aligned.
2. **Action cluster could shrink** — `.feed-actions .btn` had no
   `white-space: nowrap` above 640 px, so a tight header could squeeze the label
   out of its pill. Buttons are now `flex: 0 0 auto`, nowrap, `max-width: 100%`.
3. **Tab rail vs actions, 641–1100 px** — the rail could grow to its intrinsic
   width and crowd the actions. In that band the rail now scrolls
   (`overflow-x: auto`, hidden scrollbar) and never pushes the buttons.

If the overflow was seen somewhere else (a page or width not listed above),
that combination is the one to reproduce next; the ledger row can then be
replaced with a real assertion.

## 3b. UI smoke — pass 3 (settings hub, 5 Nov)

Method: Vite dev server (`:3000`) proxying the API (`:5000`), driven through the
browser panel as the signed-in demo account. Each tab was loaded by URL and by
rail click; the panel's own text was read back from the DOM.

| Tab | Panel rendered | Requests | Console |
|---|---|---|---|
| Profile & identity | identity card, handle form, bio form, passport, account facts | `/account` 200 | clean |
| Feed algorithm | affinity counts + reset control (baseline state shown honestly) | `/account` 200 | clean |
| Privacy & safety | Invitations, Blocked players, Your data | `/account` 200 | clean |
| Security & auth | Sign-in methods, Sessions, Recent activity, Google button | `/account` 200 | clean |
| Danger zone | Freeze account, Delete account, succession summary | `/account` 200 | clean |

Tab state is held in the query string, so a reload or a shared link lands on the
same panel (`/settings?tab=danger`). The only console output was the pre-existing
React Router v7 future-flag warnings, the socket connect line and the Vite client
banner. Cold-load cost: the page pulls the five panels in one chunk; the bundle
is 516 kB uncompressed, which is the same warning the build has carried since
phase 6.

---

## 4. Changes made in pass 2

| Change | Files |
|---|---|
| Emoji and text glyphs removed from all chrome; every dismiss/back control is now an SVG from the shared icon set | `icons.jsx` (+`ArrowLeftIcon`, `ArrowRightIcon`), `NotificationBell`, `SearchModal`, `PostForm`, `LinkPreviewCard`, `ProfilePage`, `PostDetail`, `GameCatalog`, `PreferencesModal`, `EditPassportModal`, `GamerPassportCard`, `AuditLogModal`, `ChannelSettingsModal`, `CommunitySettingsModal`, `CreateChannelModal`, `CreateCommunityModal`, `RoleManagerModal`, `CreatePartyModal` |
| Server avatars: emoji picker and emoji rendering replaced by the monogram **sigil** (initials + name-derived hue, metallic frame; image URLs still honoured) | new `components/communities/CommunitySigil.jsx`, `CommunitiesHome`, `CommunityPage`, `ProfilePage` server chips, both community modals, `theme.css` |
| Audit log role change renders `from → to` with an icon arrow instead of a text arrow | `AuditLogModal` |
| Create-post action cluster hardened; channel header rebuilt on the shared segmented tabs | `Feed` (CSS), `ChannelPage`, `index.css`, `theme.css` |
| Dead styles removed (`community-card-icon`, `icon-picker`, `icon-pick`) | `index.css` |
| Emoji audit script kept as a repeatable gate | `scripts/scan-emoji.js` |

Verification of the above: `npm run build --prefix client` → pass, `npm test` →
45/45 pass, `node scripts/scan-emoji.js` → 0 hits, UI measurements in §3.

## 4b. Changes made in pass 3 (Phase 7)

| Change | Files |
|---|---|
| Fake Redis harness that installs in front of `@upstash/redis`, so the cache and buffer suites drive the real feature switch, key prefix and client factory offline | new `server/tests/helpers/fakeRedis.js` |
| 16 like-buffer checks and 13 cache checks, wired into `npm test` | new `server/tests/likeBuffer.test.js`, `server/tests/redisCache.test.js`, `package.json` |
| Vitest + Testing Library on their own config, so `npm run build` is untouched; 28 checks over the four components the redesign changed most | new `client/vitest.config.js`, `client/src/test/{setup,media}.js`, 4 `*.test.jsx` files, `client/package.json` |
| One e2e harness replacing three drifting copies of `api`/`check`/`register`/sockets; `registerUser` keeps phase 4's `/auth/me` probe behind a flag | new `scripts/lib/e2e-harness.js`, all three scripts |
| CI workflow: quality job always, e2e + `migrate:status` only when the cluster secrets exist | new `.github/workflows/ci.yml` |

---

## 4c. Changes made in pass 4 (community interaction)

| Change | Files |
|---|---|
| New capabilities and role distribution: reactions, attachments, forum post/reply, mention-everyone, timeout, pin, forum manage, report viewing; plus `canModerateMember` for the peer-hierarchy rule | `server/utils/permissions.js`, `client/src/utils/permissions.js` |
| Message model gained reactions, reply context, mentions and attachment refs + a text index; Channel gained the `forum` type, `forumConfig` and `attachmentsEnabled`; Community gained `timeoutUntil` and `bannedUsers`; User gained `mutedUsers` | `server/models/{Message,Channel,Community,User}.js` |
| New models: forum posts, forum replies, attachments, reports | `server/models/{ForumPost,ForumReply,Attachment,Report}.js` |
| New controllers: reactions/pins/search, forums, attachments, moderation | `server/controllers/{message,forum,attachment,moderation}Controller.js` |
| New utils: reaction allowlist, mention parser, magic-byte validator, shared channel-access resolver, attachment refs | `server/utils/{reactions,mentions,fileValidator,channelAccess,attachmentRefs}.js` |
| Socket: forum-channel guard, timeout enforcement, reply/mention/attachment handling, mention pings | `server/config/socket.js` |
| Routes: 30 new endpoints, ordered so channel-scoped paths never fall into `/:slug` | `server/routes/{community,user}Routes.js`, `server/middleware/attachmentUpload.js` |
| Migration for the new indexes (message text + pin, forum feed/status/tags/text, replies, attachments, reports, ban lookup) | `migrations/20261031090000-phase7-community-interaction-indexes.js` |
| Client: message row with reactions/replies/attachments/report, forum surface, search + pins modal, report queue, report dialog, dictation hook, composer tools, member timeout/ban controls, forum channel type | `MessageItem`, `ForumChannel`, `ChannelSearchModal`, `ReportsModal`, `ReportModal`, `useSpeechCompose`, `MessageInput`, `CommunityPage`, `RoleManagerModal`, `CreateChannelModal`, `ChannelSettingsModal`, `utils/reactions` |
| Styles for all of the above, with reduced-motion and ≤720 px variants | `client/src/index.css` |
| 18 new unit checks + 80 new e2e checks | `server/tests/{reactions,mentions,fileValidator}.test.js`, `scripts/e2e-phase7.js`, `package.json` |

## 4d. Changes made in pass 6 (account & settings hub)

| Change | Files |
|---|---|
| One settings page with five URL-addressable panels; the old profile privacy modal is retired in favour of it | new `pages/SettingsPage.jsx`, `components/settings/{Profile,Feed,Privacy,Security,Danger}Panel.jsx`, `GoogleLinkButton.jsx`, `phase9.css`; deleted `components/profile/PrivacySettingsModal.jsx`; `App.jsx`, `Navbar.jsx`, `ProfilePage.jsx` |
| Handle rules as a pure unit: charset, length, reserved platform names, case-insensitive lookup | new `server/utils/username.js` |
| Succession engine: authority → seniority → id ordering, conditional owner claim, server dissolution, squad leadership + chat refresh rights, read-only preview | new `server/utils/succession.js` |
| Shared erasure path used by both the immediate-delete route and the retention worker, so a scheduled deletion and a right-now deletion erase identically | new `server/utils/accountErasure.js`, `controllers/accountController.js`, `jobs/retention.js` |
| Account endpoints: `GET /account`, handle change, feed reset, freeze, succession preview, `delete-now`, blocks, export, deletion request/cancel — each with its own limiter | `server/routes/accountRoutes.js`, `controllers/accountController.js` |
| Freeze enforced where it matters: participation denied at the auth middleware, refused in the socket engine, filtered out of feed/search/profile reads | `server/middleware/auth.js`, `config/socket.js`, `controllers/{auth,user,post,comment,lfg,community,invitation}Controller.js`, `utils/privacy.js` |
| Google account link/unlink routes with fail-closed verification; `sessionVersion` bump on `logout-all` | `controllers/authController.js`, `routes/authRoutes.js` |
| 16 new unit checks and 62 new e2e checks | new `server/tests/settings.test.js`, `scripts/e2e-phase9.js`, `package.json` |

## 4e. Changes made in pass 7 (hardening & resilience)

| Change | Files |
|---|---|
| Layout-shaped skeletons for every data surface, with one screen-reader label per region and a transform-only shimmer that stops under reduced motion | new `components/common/Skeleton.jsx`, `phase10.css`; `Feed`, `ChannelPage`, `PostDetail`, `ProfilePage`, `CommunitiesHome`, `CommunityPage`, `LfgPage`, `GameCatalog`, `AdminDashboard`, `SettingsPage` |
| A real 404 page and a catch-all route that renders it instead of redirecting to the feed | new `pages/NotFound.jsx`; `App.jsx` |
| Per-surface REST limits (search 45/min, catalog 90/min, admin 120/min, browse 180/min), keyed per account, IP for anonymous, IPv6 grouped by /64 | new `middleware/limiters.js`; `routes/{user,community,game,admin}Routes.js` |
| Socket resource caps: 8 live sockets per account, 60 room joins/min, on top of the 100 kB frame cap | `config/socket.js`, `package.json` |
| Search cost: cached visibility lookups with explicit invalidation, frozen-author filtering after populate, anchored tag prefix | new `utils/visibility.js`; `controllers/userController.js`, `controllers/accountController.js`, `utils/accountErasure.js` |
| LFG board projects leader/member through `publicPresence` and drops account status | `controllers/lfgController.js` |
| Secret gate plus index migration for the symmetric block lookup | new `scripts/scan-secrets.js`, `scripts/lib/secretPatterns.js`, `migrations/20261105090000-hardening-visibility-indexes.js`; CI step |
| 15 new unit checks, 13 new e2e checks | new `server/tests/hardening.test.js`, `scripts/e2e-phase10.js`, `package.json` |

---

## 5. Open findings

| Severity | Finding | Notes |
|---|---|---|
| Low | Reported create-post overflow not reproducible at the measured widths | Hardened anyway (§3); ask for page + viewport if it recurs |
| Low | Notification cursor is server-side only; the bell requests 20 newest with no "load older" | Phase 8 |
| Low | Public profile masks presence for the owner too (`invisible` → `offline`) | Session doc carries the raw value |
| Low | Channel rename is not supported by `PATCH /channels/:id` | UI does not offer it |
| Med | Google Sign-In is verified only for its fail-closed branches; no live ID token exists in CI | Set `GOOGLE_CLIENT_ID`, sign in once, then delete the account |
| Low | Settings actions are proven at the API level only; no browser flow submitted the freeze, rename or deletion forms | Panels render clean (§3b); a click-through is a nice-to-have, not a gap in the rules |
| Low | Squad chat has no file attachments (text only) | Phase 3 attachment model exists; wiring it to squad chat is a follow-up |
| Low | A squad's temporary chat is not deleted when the Party TTL removes the squad | Chat expires on its own within 15 days; the sweeper then purges it |
| Medium | Rate-limit counters (REST and sockets) are per process | Fine for one Render instance; a shared store is required before scaling out (roadmap 9) |
| Low | Skeleton layouts were verified by build and by opening a page, not measured at phone widths | Optional visual pass before the next public push |
| Low | Phase-8 UI other than `/settings` (squad chat drawer, invitation inbox) has had no browser pass | Build + component checks only; ask for a screenshot pass |
| Low | Segmented tab rail clips its last tray at ≤360 px (scrollable, mask-faded) | Intentional; revisit if a tray is added |
| Medium | Cloudinary upload is only verified for its auth/validation branches — there are no credentials in the local environment | Run `scripts/e2e-phase7.js` with Cloudinary env set before relying on uploads in production |
| Low | EXIF stripping depends on `sharp`; if it fails to install the upload still works but metadata is kept | `require('sharp')` is lazy and non-fatal by design |
| Low | Deferred from the Discord blueprint: full per-role channel overwrites, message threads, malware scanning | Documented as out of scope for this milestone |
| Info | `npm audit` reports 9 advisories in transitive deps | Pre-existing |
| Info | Screenshots unavailable in this session; visual review still owed on the sigil and the new icon controls | Ask for a screenshot pass when the window is visible |

---

## 6. Next phases

Full detail in [ROADMAP.md](ROADMAP.md); the order and trigger are what matter:

| Order | Phase | Why it is next | Effort |
|---|---|---|---|
| — | ~~**7 — Quality gate & CI**~~ | **Delivered in pass 3.** 74 server + 28 client checks, shared e2e harness, GitHub Actions. Nothing in this list depends on it any more. | done |
| — | ~~**8F — Foundation pack**~~ | **Delivered in pass 5.** Domain connections + migration tracks, identity governance, consent/invitations, squad lifecycle, 15-day chat, privacy/data rights. 117 server + 434 e2e checks. | done |
| — | ~~**8G — Account & settings hub**~~ | **Delivered in pass 6.** One `/settings` page and the backend that backs it: handle change, feed reset, freeze, session revocation, Google link surface, succession preview and immediate erasure. 133 server + 496 e2e checks. | done |
| — | ~~**8H — Hardening & resilience**~~ | **Delivered in pass 7.** Skeletons, a real 404, per-surface rate limits, socket caps, search-cost fixes, the LFG presence leak and the secret gate. 148 server + 509 e2e checks. | done |
| 1 | **8 — Inbox** | Notifications are the cheapest retention win and the data exists; add comment/follow/like pings, `nextCursor` paging, per-category mute, and surface squad invitations in the bell. | 1.5 d |
| 2 | **12 — Operability** | `/api/health/ready` already splits per domain; add request IDs, structured logs and error reporting before a public push. | 1.5 d |
| 3 | **11 — Account lifecycle** | Verification and password reset are the remaining account gaps; the session/revocation and deletion halves are done. | 2–3 d |
| 4 | **10 — Discovery** | Atlas Search, tag pages, trending; only once content volume justifies it. | 2–3 d |
| 5 | **9 — Multi-instance** | Only when a second instance is actually required; costs Upstash quota. | 2–3 d |

---

## 7. Reproduce a pass

```bash
# 1. servers
npm run dev            # API :5000
npm run dev --prefix client   # Vite :3000

# 2. automated tiers (see §1 for when to skip)
npm test                      # server units, 148 checks, no database
npm test --prefix client      # client components, 28 checks, jsdom
npm run test:e2e              # seven suites, 509 checks, throwaway DB
npm run scan:secrets           # must print "0 hit(s)"
npm run build --prefix client
npm run migrate:status
npm run migrate:domains:status

# 3. design-system gate
node scripts/scan-emoji.js     # must print "0 line(s)" (reaction glyphs are listed separately)
```
