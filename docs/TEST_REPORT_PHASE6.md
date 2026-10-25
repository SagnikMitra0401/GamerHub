# GamerHub — Phase 6 Test Report

**Date:** 25 October 2026
**Branch:** `main` (working tree, nothing committed)
**Node:** v24.16.0 · npm 11.13.0
**Redis:** intentionally **disabled** (`REDIS_ENABLED` unset; client returns `null`)
**Database:** MongoDB Atlas `gaming-hub`, throwaway databases for the e2e suites

---

## 1. Verdict

| Layer | Result |
|---|---|
| Unit suite (`npm test`) | **45/45 pass** |
| E2E — auth, communities, sockets (`scripts/e2e.js`) | **59/59 pass** |
| E2E — feed, presence, LFG, bot, admin (`scripts/e2e-phase4.js`) | **66/66 pass** |
| E2E — lifecycle, search, Redis-off (`scripts/e2e-phase6.js`) | **159/159 pass** |
| Client production build | **pass** (72.86 kB CSS / 428.23 kB JS, 163 modules) |
| Redis feature switch, both states | **pass** (3 Upstash commands used) |
| UI smoke test, 5 viewports × 6 pages | **pass**, no horizontal overflow |

Total automated checks executed this session: **329**.

---

## 2. What each suite covers

### Unit (`server/tests/`)
Permissions hierarchy, capability resolution, kick/assign rules, sanitizers,
HTML entity decoding, tag normalisation, regex escaping, SSRF IPv4/IPv6 range
blocking, CORS allow-list, LFG party rules and TTL expiry, feed ranking
determinism, TTL/LRU cache behaviour, YouTube-bot secret handling.

### `scripts/e2e.js` (59)
Registration, feed projection (no email/hash leakage), unsafe link-preview
rejection, loopback preview blocked, CORS, community creation, private-server
access, member management, role escalation attempts, kick, channel gating,
audit log, Socket.io delivery, cross-server injection, flood control, slowmode,
owner bypass, live membership eviction.

### `scripts/e2e-phase4.js` (66)
Preferences, personalised feed, presence, LFG board and join requests, request
acceptance, squad fill/close, notification badge, gaming bot (unconfigured
state), admin health/metrics, game catalog.

### `scripts/e2e-phase6.js` (159) — new
- **Auth lifecycle:** duplicate username/email, weak password, wrong password, login, `/me`, cookie-only REST auth, profile update, platform allow-list, logout cookie clearing.
- **Posts:** creation, tag normalisation, control-character stripping, 5-minute edit window (both sides), non-author edit/delete rejection.
- **Likes with Redis off:** direct write, `likeCount` durability, idempotent double-click, invalid/missing/anon cases, weighted feed exposure.
- **Gamification:** ten distinct likes award `viral_gamer` + 50 XP exactly once; first comment awards `gamer_critic`.
- **Feed modes:** following (empty → populated), channel filter, pagination, most-liked ordering.
- **Comments:** creation, `commentCount`, validation, listing, ownership on edit/delete.
- **Bookmarks & favourites:** toggle + saved list + normalisation.
- **Follow graph:** toggle, self-follow rejection, follower projection, privacy fields.
- **Gamer passport:** quote cap, trimmed IDs, platform fallback, single-primary rig, active-game cap, auto-primary.
- **Preferences/presence:** dedupe, invalid platform, empty payload, `in_game` validation, invisible projection to others vs. raw presence on the session.
- **Search:** 1-char rejection, authenticated text search, username prefix, no email leakage, tag autocomplete, regex-metacharacter safety.
- **Communities:** creation, list/member count, join/leave, duplicate join, channel create/update gates, slowmode bounds, cursor history, non-member history block, audit contents, audit has no write route, owner-only delete.
- **Notifications:** cursor shape, page continuity without overlap, invalid cursor, unread filter, single read, cross-user read denied, mark-all-read.
- **LFG:** creation, 6-hour expiry, slot accounting, validation, filters, request/duplicate/leader cases, request-queue visibility, leader-only respond, accept fills and delists, applicant notification, reject, leader-only close, `mine` exclusion.
- **Catalog:** normalised payload, detail, invalid id.
- **Admin:** 403 for users, health payload, DB connected, Redis truthfully reported off, secrets never returned, counts, metrics, cached health consistency.
- **Hardening:** JSON 404, NoSQL operator rejection, malformed JSON, 100 kB body limit, CORS, rate-limit headers, 9 protected routes reject anonymous callers.
- **Delete cascade:** comments removed, saved lists cleaned, community teardown removes channels/audit rows.
- **Cache without Redis:** L1 hit, concurrent miss collapsing, failed loads not cached.

---

## 3. Redis-disabled verification

| Check | Result |
|---|---|
| `getRedis() === null`, `isConfigured() === false` by default | pass |
| Flush worker not started | pass |
| `flushLikeBuffer()` returns `0` (no client) | pass |
| Like response has no `buffered` flag | pass |
| Like is visible in MongoDB immediately (no 5 s wait) | pass |
| `likeCount` == `likes.length` after 1, 2 and 10 likes | pass |
| Admin health reports `{configured:false, cache:'memory', likeBuffer:'off'}` | pass |
| Cache reads served from L1; concurrent misses load once | pass |

The switch was also exercised in the **on** direction with a live Upstash round-trip
(`set` → `get` → `del`) and then returned to off.

---

## 4. Migrations

`npm run migrate:status` reports both migrations **applied**:

| Migration | State |
|---|---|
| `20261025090000-add-compound-indexes` | applied |
| `20261025091000-denormalize-post-like-count` | applied |

Weighted text index (`title×10 / tags×5 / content×1`), `posts_userId_createdAt`,
`posts_likeCount_hot` and `notif_userId_read_createdAt` are present.

---

## 5. UI smoke test

Served by Vite (`:3000`) against the API (`:5000`). A temporary admin account was
used and removed afterwards.

**Viewports:** 390×844, 768×1024, 1280×900, 1440×900, 1920×1080.

| Page | Result |
|---|---|
| Login | form renders, submits, redirects, session established |
| Feed | tabs, layout switch, like/unlike round-trip, bookmark round-trip, inline composer publishes |
| Notifications | desktop dropdown inside viewport; mobile centred sheet inside viewport (no clipping) |
| Nav | desktop full header; mobile bottom dock (5×48 px) + slide-out drawer; tablet compact header + dock |
| Communities | list, join, chat, mobile drawer overlay, composer above dock (16 px gap) |
| Channels | cursor history, socket message sent from mobile UI appeared in the room |
| LFG | create-squad modal → board card with mic/rank/slot state, 5 h remaining |
| Games | 419-title catalog, detail dialog, filters |
| Profile | passport card, tabs, passport edit modal scrolls and keeps save reachable |
| Admin | monitor loads, API-key security block, collection counts, Refresh updates (no "Could not load system health") |
| Search | live results (channels/posts/users), tabs |

Horizontal overflow: `scrollWidth − innerWidth ≤ 0` on every page and viewport.

Console: only the expected pre-login `401 /api/auth/me` probes and React Router v7
future-flag warnings. No runtime exceptions.

> Note: this preview environment freezes CSS transitions (a headless quirk).
> Layout was therefore measured with transitions disabled; the CSS rules
> themselves were verified in the stylesheet.

---

## 6. Defects found and fixed during this pass

| # | Finding | Fix |
|---|---|---|
| 1 | `README.md` claimed "restore `server/config/redis.js` from git history", but that file was untracked — following the docs would lose the client | Real client moved to `server/config/redisClient.js`; `redis.js` is now an env switch (`REDIS_ENABLED=1`). Docs updated. |
| 2 | Admin health hardcoded `redis.configured: false` — it would keep saying "off" even with Redis live | Now derived from `isConfigured()` and the worker state |
| 3 | `@upstash/redis` was declared in `package.json` but absent from the lockfile and `node_modules`; adding the client crashed every require path | Installed it and made the import lazy, so a missing SDK degrades instead of taking the API down |
| 4 | README security section: "bcrypt 12 rounds", "tokens never returned", "`SameSite=Strict`" | Corrected to 10 rounds, cookie + socket-body token, `None; Secure` in prod / `Lax` in dev |
| 5 | README setup referenced `.env.example`, which did not exist | Added `.env.example` with placeholders only |
| 6 | README cache table listed "admin metrics 60 s"; the actual cached resource is the health bundle/count scan | Corrected |
| 7 | `ADMIN_CREDENTIALS.txt` sat untracked in the repo root, not ignored | Added to `.gitignore` |
| 8 | README test section omitted the new suite | Added it and the total counts |

---

## 7. Findings left open (by design or out of scope)

| Severity | Finding | Notes |
|---|---|---|
| Low | Notification cursor is server-side only; the bell requests `limit=20` and has no "load more" | Older pings are reachable via the API but not the UI |
| Low | Public profile masks presence for the owner too (`invisible` → `offline`) | The session document carries the raw value, which the presence control uses |
| Low | Channel rename is not supported by `PATCH /channels/:id` (topic/slowmode/gates only) | The settings UI does not offer rename either |
| Info | Anonymous boot logs two `401 /api/auth/me` console entries | Expected session probe |
| Info | `npm audit` reports 9 advisories in transitive deps | Pre-existing; not touched in this pass |
| Info | Search modal relies on click-away; Escape works when the event reaches the page | Verified by dispatching `keydown` |

---

## 8. Cleanup

- Throwaway e2e databases are dropped by their scripts.
- The temporary UI admin, its posts, squad, chat message and membership were deleted.
- Community member counts and post totals match the pre-test values.

---

## 9. Reproduce

```bash
npm test                 # 45 unit checks
npm run test:e2e         # 59 + 66 + 159 checks (throwaway DBs)
npm run build --prefix client
REDIS_ENABLED=1 node -e "..."   # optional switch probe
```
