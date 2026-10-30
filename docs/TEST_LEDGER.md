# GamerHub — Testing Ledger

Living record of what has been verified, by what method, and when to re-run each
tier. The point is to stop re-testing things that cannot have changed: read the
"Re-run only if" column before spending a pass on a tier.

**Last updated:** 31 October 2026 · **Branch:** `main` · **Head:** `be3baa8` + the community-interaction milestone (uncommitted)
**Node:** v24.16.0 · **Redis:** intentionally off (`REDIS_ENABLED` unset)
**Companion docs:** [phase 6 detail](TEST_REPORT_PHASE6.md) · [next phases](ROADMAP.md)

---

## 1. Current status

| Tier | Command | Result | Last run |
|---|---|---|---|
| Unit / contract — server | `npm test` | **92 / 92 pass** | 31 Oct |
| Unit — client components | `npm test --prefix client` | **28 / 28 pass** | 31 Oct |
| E2E — auth, communities, sockets | `npm run test:e2e` → `scripts/e2e.js` | **59 / 59 pass** | 31 Oct |
| E2E — feed, presence, LFG, bot, admin | `scripts/e2e-phase4.js` | **66 / 66 pass** | 31 Oct |
| E2E — lifecycle, search, Redis-off | `scripts/e2e-phase6.js` | **159 / 159 pass** | 31 Oct |
| E2E — reactions, forums, moderation | `scripts/e2e-phase7.js` | **80 / 80 pass** | 31 Oct |
| Client production build | `npm run build --prefix client` | **pass** — 171 modules, 88.24 kB CSS / 464.44 kB JS | 31 Oct |
| UI smoke — pass 2 | browser, 8 pages × 3–5 viewports | **pass** | 25 Oct (that pass) |
| Design-system gate | `node scripts/scan-emoji.js` | **0 hits** (+8 allowlisted reaction glyphs) | 31 Oct |
| CI — `quality` job | push to `main` | **pass** — 5 steps really executed, 17 s | 26 Oct, run 2 (`f69a2e7`) |
| CI — `e2e` job | push to `main` | **pass** — 284 checks + `migrate:status`, 3 m 13 s | 26 Oct, run 2 (`f69a2e7`) |

**484 automated checks green** (92 server + 28 client + 364 e2e across four suites).
CI has not been re-run since this milestone; no workflow edit is needed, because
the `quality` job calls `npm test` (which now includes the three new suites) and
the `e2e` job calls `npm run test:e2e` (which now chains all four scripts). The
next push therefore exercises every check above.

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
| Client build | any file under `client/src/` changes |
| The CI suite | never by hand — a push to `main` runs it; read the run instead |
| UI smoke | a `*.jsx` or `*.css` file under `client/src/` changes **and** the change touches layout, a nav element, a modal, or the design tokens |
| `scripts/lib/e2e-harness.js` | **always** re-run all four e2e suites — every check goes through it |

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
| CI | both suites, the client build and the emoji gate on every push/PR; e2e + `migrate:status` whenever `MONGO_URI`/`JWT_SECRET` resolve, and a failing check step (not a quiet skip) when they do not, except on fork PRs | `.github/workflows/ci.yml` |
| Migrations | both migrations applied; weighted text index, `posts_userId_createdAt`, `posts_likeCount_hot`, `notif_userId_read_createdAt` present | `npm run migrate:status` |
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

---

## 5. Open findings

| Severity | Finding | Notes |
|---|---|---|
| Low | Reported create-post overflow not reproducible at the measured widths | Hardened anyway (§3); ask for page + viewport if it recurs |
| Low | Notification cursor is server-side only; the bell requests 20 newest with no "load older" | Phase 8 |
| Low | Public profile masks presence for the owner too (`invisible` → `offline`) | Session doc carries the raw value |
| Low | Channel rename is not supported by `PATCH /channels/:id` | UI does not offer it |
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
| 1 | **8 — Inbox** | Notifications are the cheapest retention win and the data exists; add comment/follow/like pings, `nextCursor` paging, per-category mute. | 1.5 d |
| 2 | **12 — Operability** | Readiness probe, request IDs, structured logs, error reporting before any public push. | 1.5 d |
| 3 | **11 — Account lifecycle** | Email verification, password reset, session list, report queue with audit trail. | 3–4 d |
| 4 | **10 — Discovery** | Atlas Search, tag pages, trending; only once content volume justifies it. | 2–3 d |
| 5 | **9 — Multi-instance** | Only when a second instance is actually required; costs Upstash quota. | 2–3 d |

---

## 7. Reproduce a pass

```bash
# 1. servers
npm run dev            # API :5000
npm run dev --prefix client   # Vite :3000

# 2. automated tiers (see §1 for when to skip)
npm test                      # server units, 92 checks, no database
npm test --prefix client      # client components, 28 checks, jsdom
npm run test:e2e              # four suites, 364 checks, throwaway DB
npm run build --prefix client
npm run migrate:status

# 3. design-system gate
node scripts/scan-emoji.js     # must print "0 line(s)" (reaction glyphs are listed separately)
```
