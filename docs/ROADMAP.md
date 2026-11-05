# GamerHub — Next Phases

Written after the Phase 6 test pass, updated after the community and foundation
milestones. Each phase is sized to ship independently; nothing here is required
for the app to keep working as it does today.

Current state: MERN monolith (Express + Mongoose + Socket.io, React 18 + Vite),
688 automated checks passing (148 server unit, 31 client component, 509 e2e
across seven suites) plus a secret-leak gate, CI on every push, Redis implemented
but switched off, single Render instance, all migration tracks applied on Atlas.

---

## Phase 7 — Quality gate and CI — ✅ delivered

**Delivered 26 October 2026.** `npm test` is 74 checks (the 45 that existed plus
16 for the like buffer and 13 for the two-tier cache, both against an in-memory
fake Redis so they need no account and no network); `npm test --prefix client`
is 28 component checks on Vitest + Testing Library; the three e2e scripts share
`scripts/lib/e2e-harness.js` and were re-run to the same 59 / 66 / 159 tally;
`.github/workflows/ci.yml` runs both suites, the build and the emoji gate on
every push, with the e2e job gated on the presence of cluster secrets. The
original scope is kept below as the record of what was asked for.

**Why:** the new write path (like buffer, two-tier cache, cursor pagination) is
covered by scripts, not tests. Anything that only runs by hand will rot. There is
also no CI: a broken build or a red migration is discovered by hand.

**Scope**
- Unit tests for `likeBuffer` with a fake Redis: last-write-wins on the hash,
  `readPendingLike` reconciliation, pipeline idempotence, viral medal awarded
  once, flush failure keeps events queued.
- Unit tests for `redisCache`: Redis error → degrade for 30 s, L1 fallback,
  concurrent miss collapse, loader failure not cached. (A small in-memory fake
  client makes this offline and deterministic.)
- Client component tests (Vitest + Testing Library) for `SegmentedTabs`
  (keyboard, aria-pressed), `PostActions` (optimistic like, revert on error) and
  `NotificationBell` (sheet vs dropdown at the breakpoint).
- GitHub Actions: `npm ci`, `npm test`, `npm run build --prefix client`,
  `migrate:status` against a test database. Optional third job running the e2e
  suites against a dedicated throwaway cluster.
- One shared helper module for the three e2e scripts (they duplicate `api`,
  `check`, `register`).

**Done when:** a pull request that breaks a controller, the buffer or the build
fails CI without a human running anything.

**Effort:** 1–1.5 days. **Risk:** low.

---

## Phase 8F — Foundation, consent & squads — ✅ delivered

**Delivered 31 October 2026.** Domain-partitioned connections (the temporary
squad-chat domain runs on its own pool) and per-domain migration tracks; account
governance (session versions, `logout-all`, account states, Google Sign-In
verification); the consent-driven invitation ledger with a squad → server
migration; squad lifecycle with the 15-day temporary chat (request-time expiry,
owner refresh, live eviction, retention purge); privacy settings, two-way
blocking, JSON data export and a 30-day cancellable deletion flow with erasure.
117 server checks and 434 e2e checks pass. Detail and what is *not* verified:
[TEST_LEDGER.md](TEST_LEDGER.md) pass 5.

Known follow-ups from this milestone: squad chat is text-only (no attachments),
and a squad's chat is not deleted when the Party TTL removes the squad (it
expires on its own).

---

## Phase 8G — Account & settings hub — ✅ delivered

**Delivered 5 November 2026.** One `/settings` page (profile & identity, feed
algorithm, privacy & safety, security & auth, danger zone) sitting on the backend
that makes each panel honest: handle changes with reserved-name and
case-insensitive uniqueness rules, an Instagram-style feed reset that really
clears tag/channel/genre affinities, a password-confirmed freeze enforced on REST
*and* sockets and filtered out of feed/search/profile reads, `logout-all` session
revocation, Google link/unlink verified server-side, and a succession engine that
hands a server to its admin → moderator → veteran member (or dissolves a
memberless one) when the owner erases the account. 133 server checks and 496 e2e
checks pass. Detail and what is *not* verified: [TEST_LEDGER.md](TEST_LEDGER.md)
pass 6.

Known follow-ups from this milestone: the Google path is only proven for its
fail-closed branches (no live credential in CI), erasure of a *scheduled*
deletion is exercised through the same shared path as immediate deletion but has
not been waited out in real time, and settings actions are proven through the API
suite rather than a clicked-through browser flow.

---

## Phase 8H — Hardening & resilience — ✅ delivered

**Delivered 5 November 2026.** Layout-shaped skeletons on every data surface, a
real 404 page instead of a silent redirect, and a hardening pass documented in
[SECURITY.md](SECURITY.md): per-surface rate limits (search, catalog, admin,
browse), bounds on sockets per account and room joins, a cheaper search path
(cached visibility lookups, anchored tag prefix, frozen authors filtered after
populate), the LFG board no longer leaking `invisible` presence or account
status, a multikey index for the symmetric block lookup, and a secret-leak gate
that runs in `npm test` and CI. 148 server, 31 client and 509 e2e checks pass.

Known follow-ups from this milestone: rate-limit counters are per process (a
shared store is part of phase 9), and the skeletons have not been measured at
phone widths.

---

## Phase 8 — Inbox: make notifications a real feature

**Why:** notifications are the cheapest retention lever and the data already
exists. Today the bell shows the newest 20 with no way to see older ones, and
only LFG/bot events generate pings — comments, follows and likes are silent.

**Scope**
- Client: use `nextCursor` for "Load older", show an unread divider, mark-read on
  open with optimistic badge update, deep-link to the target.
- Server: emit `social` notifications for comment-on-post, follow and milestone
  likes, reusing the existing `dedupeKey` unique index so retries cannot double
  ping. Batch author lookups; never notify yourself.
- Preference switches (follows / comments / LFG) stored in `User.preferences`,
  respected at write time.
- Tests: notification creation, dedupe, cursor continuation, preference opt-out.

**Done when:** commenting on someone's post produces exactly one notification,
the bell pages through the full history, and a user can mute a category.

**Effort:** 1.5 days. **Risk:** low.

---

## Phase 9 — Multi-instance correctness (only when traffic needs it)

**Why:** the buffer, rate-limit counters, presence map and Socket.io rooms are
per-process. A second Render instance would double-flush, split rooms and report
inconsistent presence.

**Scope**
- `@socket.io/redis-adapter` bound to the existing Upstash client (requires Redis
  enabled; document the quota cost first).
- Move REST rate limiting to a shared store or accept per-instance budgets
  explicitly and document it.
- Make the like flush worker single-owner (Redis `SET NX` lock with TTL) so two
  instances cannot flush the same batch concurrently.
- Presence heartbeat with TTL keys instead of process-local state.
- Load test with `autocannon`: feed + like burst, two instances, verify counts.

**Done when:** two instances behind a load balancer show the same room membership
and a like burst lands exactly once.

**Effort:** 2–3 days. **Risk:** medium — touches realtime and the write path.

> Do not start this while the deployment is a single instance. It adds Upstash
> command volume, which is exactly what the free tier cannot absorb today.

---

## Phase 10 — Discovery and search quality

**Why:** `$text` search is adequate but has no fuzzy matching, ranking signals or
autocomplete beyond tag prefixes. Discovery is what turns a feed into a product.

**Scope**
- Atlas Search index on `posts` (title/tags/body) with fuzzy + autocomplete;
  swap the aggregation stage, keep the route contract.
- Tag pages: `GET /api/posts?channel=x` already exists — give it a real page,
  related tags and a follow-tag action.
- Trending: a 15-minute cached aggregation (likes + comments in a rolling window),
  TTL in the existing cache layer.
- Client: Explore tab, recent searches, empty-state suggestions.
- Instrument search queries (no PII) to see what people actually look for.

**Done when:** searching a misspelled game still finds it, and p95 search latency
is under 150 ms against a seeded 10k-post dataset.

**Effort:** 2–3 days. **Risk:** medium (needs an Atlas Search index and a backfill).

---

## Phase 11 — Account lifecycle and trust & safety

**Why:** password reset and email verification are table stakes for real users,
and moderation currently starts and ends at message deletion.

**Scope**
- Email verification and password reset with single-use, hashed, expiring tokens
  (needs a transactional email provider — pick one at implementation time).
- Active sessions list with revoke. ("Log out everywhere" ships in the
  foundation milestone via `sessionVersion`; a per-device list needs a session
  table, which is the remaining piece.)
- Report flow for posts/messages/users → moderation queue in the admin dashboard,
  with resolution notes written to `AuditLog`.
- Soft-delete/retention policy for posts to match the existing message tombstone.
- Rate-limit keyed by user as well as IP for authenticated writes.

**Done when:** a user can reset a forgotten password end-to-end, and a reported
post reaches the admin queue and can be actioned with an audit trail.

**Effort:** 3–4 days. **Risk:** medium (email deliverability, token security).

---

## Phase 12 — Operability

**Why:** the admin dashboard is a good start but there is no readiness probe,
structured logging, alerting or backup drill.

**Scope**
- `/api/health/ready` that pings Mongo (and Redis when enabled); keep `/health`
  as the liveness probe Render uses.
- Request IDs + JSON logs; redact cookies/tokens at the logger.
- Error reporting (Sentry or equivalent) with release tagging.
- Admin panel row for Redis/buffer state (the API already returns it).
- A documented backup/restore drill for Atlas before the next risky migration.
- Cost guardrail: Upstash command budget documented next to the switch.

**Done when:** a failing dependency shows up as a readiness failure and an alert,
not as a user report.

**Effort:** 1.5 days. **Risk:** low.

---

## Suggested order

| Order | Phase | Trigger |
|---|---|---|
| 1 | **8 — Inbox** | Next product increment, low risk |
| 2 | **12 — Operability** | Before any public push |
| 3 | **11 — Account lifecycle** | When onboarding real users (session revocation and deletion already ship) |
| 4 | **10 — Discovery** | Once there are thousands of posts |
| 5 | **9 — Multi-instance** | Only when a second instance is actually needed |

Phases 7, 8F, 8G and 8H are done: 688 checks and a CI gate stand between a
regression and `main`, identity/consent is no longer the weak spot, every
account-level promise (rename, reset, freeze, erase, succeed) has a server rule
behind it, and the cheap-query surfaces now have a budget of their own.

## Deliberately deferred

- **Re-enabling Redis now.** Free-tier quota is the constraint and single-instance
  memory is sufficient; the switch is ready when it is not (`REDIS_ENABLED=1`).
- **Microservices / Prisma.** Neither solves a problem this codebase has.
- **Native mobile app.** The responsive shell is already there; revisit only with
  a concrete feature that needs native APIs.
