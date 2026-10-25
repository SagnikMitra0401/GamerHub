# GamerHub — Next Phases

Written after the Phase 6 test pass. Each phase is sized to ship independently;
nothing here is required for the app to keep working as it does today.

Current state: MERN monolith (Express + Mongoose + Socket.io, React 18 + Vite),
386 automated checks passing (74 server unit, 28 client component, 284 e2e),
CI on every push, migrations applied, Redis implemented but switched off, single
Render instance.

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
- Active sessions list with revoke, plus "log out everywhere".
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
| 3 | **11 — Account lifecycle** | When onboarding real users |
| 4 | **10 — Discovery** | Once there are thousands of posts |
| 5 | **9 — Multi-instance** | Only when a second instance is actually needed |

Phase 7 is done: 386 checks and a CI gate stand between a regression and `main`.

## Deliberately deferred

- **Re-enabling Redis now.** Free-tier quota is the constraint and single-instance
  memory is sufficient; the switch is ready when it is not (`REDIS_ENABLED=1`).
- **Microservices / Prisma.** Neither solves a problem this codebase has.
- **Native mobile app.** The responsive shell is already there; revisit only with
  a concrete feature that needs native APIs.
