# GamerHub — Security & Data-Protection Notes

Written after the hardening pass (5 November 2026). This is the document to read
before changing auth, permissions, rate limits or anything that shapes a user
document, and the one to update when a new surface is added.

The organising rule is simple: **the server decides, the client only renders.**
Anything the browser sends about identity, role, ownership, MIME type or channel
is a hint at best; every decision is re-derived from the database.

---

## 1. Credentials and configuration

| Concern | How it is handled |
|---|---|
| Secrets in source | Never. Server reads `process.env`; the browser bundle contains no key and no `VITE_*` secret (only the socket URL). |
| Secrets in git | Every real `.env` is ignored. `.env.example` holds placeholders only. `node scripts/scan-secrets.js` fails on a tracked `.env`, on a credential-shaped literal in source, **and** on one that ended up in `client/dist`. |
| Client bundle | `client/dist` is scanned because anything there is public. `npm test` includes the same scan over `client/src` + `client/dist`. |
| Rotation | Values live in Render (server) and Sites/Vercel env. Rotating `JWT_SECRET` invalidates every cookie; rotating `CLOUDINARY_*` or `YOUTUBE_API_KEY` only affects new work. |
| Admin credential file | `ADMIN_CREDENTIALS.txt` is gitignored. |

Run the gate:

```bash
npm run scan:secrets
```

It is also a CI step and part of `npm test` (`server/tests/hardening.test.js`).

**What it deliberately does not catch:** a secret that is valid but was pasted
into a commit message, an issue or a chat. Nothing in the repository can detect
that; treat any such paste as burned and rotate it.

---

## 2. Identity and sessions

- Passwords: bcrypt (10 rounds), never returned, never logged.
- Session: JWT in an `HttpOnly` cookie (`SameSite=None; Secure` in production,
  `Lax` locally). REST authenticates from the cookie only.
- Revocation: every JWT carries `sv`, compared with `User.sessionVersion`.
  `POST /auth/logout-all`, account deletion and erasure bump it, which kills
  every cookie already issued without a session table.
- Frozen/suspended/deleted accounts: the auth middleware rejects participation
  (writes, invites, reactions) while still allowing sign-in so a frozen account
  can unfreeze. `canParticipate()` is the single decision point.
- Google: the ID token is verified server-side (`google-auth-library`, audience =
  `GOOGLE_CLIENT_ID`). An existing local account is **never** merged on an
  unverified email match; linking requires the authenticated session *and* an
  email match.
- Email verification and recovery: 32-byte tokens are stored only as SHA-256
  digests, single-use, with a 24-hour verification / 30-minute reset lifetime.
  Forgot-password is enumeration-safe; reset bumps `sessionVersion`, clears the
  cookie and disconnects live sockets. Existing accounts were grandfathered as
  verified by the account-recovery migration; new local registrations start
  unverified. Password changes require a verified email.
- Socket handshake: cookie or `auth.token` only (never a query string, which
  lands in proxy logs). The user is re-read from the database on connect, so a
  revoked session cannot open a socket after revocation (the token is still
  checked; closed sockets are dropped with `disconnectUser`).

---

## 3. Authorization

- Community roles resolve server-side (`communityPermissions`) from
  `Community.members`; capabilities are deny-by-default. A missing member row
  returns `[]`, not a default role.
- Channel access is always `channelId → channel.communityId → membership`; the
  community in the URL or socket payload is never trusted.
- Socket rooms are not authorization: `join_squad_chat` and every message write
  re-check membership and expiry.
- Attachments: upload is bound to uploader + channel; a message can only claim
  attachments that user uploaded to that channel; downloads are signed,
  short-lived URLs issued after a membership check.
- Admin routes: `protect` + `requirePlatformAdmin`, plus the admin rate limit.
- Audit log: append-only; there is no write route.

---

## 4. Data-exposure audit — findings and fixes

Each item was found by reading the query paths, then fixed and covered by a check.

| # | Finding | Severity | Fix |
|---|---|---|---|
| F1 | `GET /api/lfg` returned the populated leader/member documents, including raw `presence` (`invisible` leaked as `invisible`) and the account `status` (`frozen`, `deletion_pending`). | **High** (privacy promise broken) | `publicPlayer()` projects `_id, username, level, role, presence: publicPresence(...)` in `toPartyView`. Covered by `e2e-phase10` (*squad board projects an invisible leader as offline*, *no account status*). |
| F2 | Every signed-in search loaded **every frozen/suspended user id** into a `$nin` list before running the text query — a growing collection scan per keystroke. | Medium (load, scale) | Frozen authors are filtered from the populated page instead; the block lookup is cached 15 s (`utils/visibility.js`) and invalidated by freeze/block/unfreeze/erasure. Covered by `e2e-phase10`. |
| F3 | Tag autocomplete used an unanchored regex over `posts.tags` (collection scan). | Medium (load) | Anchored prefix `^query` so the multikey index is usable. |
| F4 | `User.find({ blockedUsers: me })` had no index. | Medium (load) | Migration `20261105090000-hardening-visibility-indexes.js` adds `users_blockedUsers` and `users_status_createdAt`. |
| F5 | Search, catalog and admin endpoints only had the coarse global limiter. | Medium (abuse) | Per-surface limits (`middleware/limiters.js`): search 45/min, catalog 90/min, admin 120/min, community browse 180/min, keyed per account (IP for anonymous, IPv6 grouped by /64). |
| F6 | A client could open unlimited sockets and emit unlimited `join_channel` events (two queries each). | Medium (resource exhaustion) | 8 live sockets per account (`SOCKET_MAX_PER_USER`), 60 joins/min (`SOCKET_JOIN_RATE_MAX`), existing 100 kB frame cap. Covered by `e2e-phase10`. |

Checked and found correct (no change needed):

- Public profile projection excludes `passwordHash`, `email`, `authIdentities`,
  `sessionVersion`, `blockedUsers`, `mutedUsers`, `deletionRequestedAt`; saved
  posts, favourite channels and preferences are removed for other viewers.
- Community member lists use `publicPresence`; listing endpoints never return
  the member array itself.
- Exports are scoped to the caller; admin metrics contain counts and service
  state, never secrets.
- Error responses are generic 500s; Mongoose internals and stacks never reach the
  client.
- CORS is an exact allow-list; link previews and the bot use the SSRF-hardened
  fetcher.
- JSON bodies are capped at 100 kB; multer caps uploads; `entity.too.large`
  returns 413.

### Activation telemetry and request logs

- `ProductEvent` stores only a user id, an allowlisted event name and a small,
  sanitised property object. Message text, email addresses, tokens, IP addresses
  and nested values are dropped before the write. Events are retained for 180
  days, included in the owner's data export and deleted by account erasure.
- The activation funnel is an admin-only aggregate of distinct user ids. It is
  cached for 60 seconds, contains no content and is rate limited with the other
  admin endpoints. Day 7 is explicitly labelled an approximation and ignores
  notification-open/click events.
- Every response carries an `x-request-id`; access logs record method, path,
  status and duration but deliberately omit the query string, so reset and
  verification tokens never enter log storage. Server errors log a redacted
  message/stack and return the request id to the client.
- Notification opens and clicks are recorded only for the caller's own
  notification row; the click endpoint checks ownership before writing. Both
  share a 60/min per-user budget so a script cannot inflate the counters without
  bound.
- Hosted error reporting is optional and server-side only. `SENTRY_DSN` enables
  release-tagged exception reports; request bodies, cookies, query strings and
  common credential/PII shapes are removed before the event leaves the process.
  No browser SDK or session replay is installed. Without a DSN the structured
  JSON log remains the only error record.

Known limits, deliberately not hidden:

- Notification engagement events are repeatable within the per-user budget. They
  remain directional counters, not unique-user engagement.
- Funnel steps use one first-signup cohort and nest connection under onboarding
  completion and contribution under connection. Day-7 is still an approximation
  based on event timestamps, not a warehouse-grade retention calculation.
- A caller-supplied `x-request-id` is accepted when it is short and
  character-safe, for client correlation. It is not an authorization signal.

---

## 5. Load-safety controls

The concern is not only malice: a retry loop or a script with a bug can exhaust
the connection pool and make authentication fail for everyone.

| Surface | Control | Where |
|---|---|---|
| All REST | 1000 req / 5 min per address | `app.js` |
| Search (posts, people, tags; channel search) | 45 / min per account | `middleware/limiters.js` |
| Game catalog | 90 / min | `middleware/limiters.js` |
| Admin dashboards | 120 / min | `middleware/limiters.js` |
| Community browse | 180 / min | `middleware/limiters.js` |
| Notification open/click telemetry | 60 / min per account | `middleware/limiters.js` |
| Auth attempts | 20 / 15 min | `routes/authRoutes.js` |
| Account email (verify/reset) | 3 / hour per IP or account | `routes/authRoutes.js` |
| Password change | 10 / 15 min per account | `routes/authRoutes.js` |
| Data export | 5 / hour | `routes/accountRoutes.js` |
| Handle change | 5 / hour | `routes/accountRoutes.js` |
| Password-confirmed actions | 12 / 15 min | `routes/accountRoutes.js` |
| Feed reset | 10 / hour | `routes/accountRoutes.js` |
| Invitations | 30 / hour | `routes/invitationRoutes.js` |
| Squad-chat writes | 120 / min | `routes/squadChatRoutes.js` |
| Pagination | every list clamps `limit` (`parsePagination`, 30–100 per surface) | `utils/pagination.js` |
| Socket messages | sliding window per user, plus per-channel slowmode | `config/socket.js` |
| Socket rooms | 60 joins / min per account | `config/socket.js` |
| Socket count | 8 live sockets per account | `config/socket.js` |
| Socket frame | 100 kB | `config/socket.js` |
| Search cost | anchored prefix, cached block/frozen lists, author-status filtering after populate | `controllers/userController.js`, `utils/visibility.js` |
| Admin aggregates | cached; no unbounded collection walk per refresh | `controllers/adminController.js` |

**Shared quotas:** with `REDIS_ENABLED=1`, per-surface, auth and account quotas
use an Upstash-backed counter store, so multiple API instances enforce one
budget. The store degrades to a per-process window for 30 seconds if Redis is
unreachable. The coarse global limiter and socket-engine counters remain
per-process; the global limiter is a process-protection guard, not an account
quota.

---

## 6. Data subject rights

- Export: `GET /account/data-export` returns the caller's own profile, posts,
  comments, memberships, squads, chat messages, invitations, notifications and
  product events as a JSON attachment. Rate limited; never includes other users'
  private fields.
- Deletion: scheduled (`/account/deletion-request`, 30-day grace, cancellable) or
  immediate (`/account/delete-now`, handle + password). Both use the same erasure
  path. Succession runs **before** anonymisation; a server is never left pointing
  at a deleted owner, and a released email can register a fresh account.
- Freeze: reversible stealth mode; content is hidden from feed, search and
  public profile, presence reads offline, participation is refused on REST and
  sockets.
- Blocking: symmetric in delivery. The blocked party is never told who blocked
  them or why.

---

## 7. Deliberately out of scope

| Not implemented | Why / consequence |
|---|---|
| End-to-end encryption of messages | Breaks search and moderation; TLS + encryption at rest is the correct level for v1. Do not claim E2EE anywhere. |
| Malware scanning of uploads | Allowlist + magic-byte check + EXIF strip only. ClamAV is the free upgrade path. |
| Per-device session list | Requires a session table; `logout-all` covers the urgent case. |
| Per-role channel overwrites | `minRoleToRead` / `minRoleToWrite` only. |
| Shared socket-engine counters | REST quotas are shared when Redis is enabled; socket flood/join counters remain per process until the Redis socket adapter is added. |
| Secret scanning of commit messages / issues | Impossible from inside the repo. |

---

## 8. If a leak is suspected

1. Rotate the affected value in Render (and Sites/Vercel for the frontend).
2. Rotate `JWT_SECRET` if a session token may have leaked — this signs everyone
   out everywhere.
3. Remove the value from the working tree, then from history if the commit was
   pushed (`git filter-repo`), and force-push with the owner's approval.
4. Re-run `npm run scan:secrets`; it must print `0 hit(s)`.
5. Record it in this file's findings table with the date and the rotation.

---

## 9. Verification

| Tier | What proves this document |
|---|---|
| `npm test` | 258 checks, including `hardening.test.js` (limit keying, secret patterns, the live client-source gate), `accountRecovery.test.js`, `productEvents.test.js` (allowlist, prop redaction, funnel arithmetic, log redaction), `rateLimitStore.test.js` and `errorReporting.test.js` |
| `npm run test:e2e` | thirteen suites; `e2e-phase14.js` covers verification/reset, onboarding, notification preferences, activation telemetry, cohort/day-7 funnel, engagement budgets, readiness and data export, and `e2e-phase10.js` covers the four behaviours in §4 that need a database and a socket |
| `npm run scan:secrets` | credential-shaped literals and tracked env files |
| `node scripts/scan-emoji.js` | design-system gate (unrelated, but it runs in CI on every push) |
