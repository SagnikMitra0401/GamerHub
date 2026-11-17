# GamerHub — Phase 14: Activation, Recovery & Retention

**Status:** 14A–14D implemented (recovery, onboarding, notification loop, activation telemetry and launch instrumentation) · **Date:** 17 November 2026
**Scope:** account recovery, game-first onboarding, social notifications, launch instrumentation
**Audience:** product owner + implementer
**Builds on:** [ROADMAP.md](ROADMAP.md) phases 8, 11 and 12 · [TEST_LEDGER.md](TEST_LEDGER.md) pass 13

> **The next increment is not another surface.** GamerHub already has more
> features than most early products: feed, communities, forums, DMs, business
> inboxes, LFG, moderation, account erasure and an admin dashboard. What it does
> not yet have is a reliable front door. A new account can forget its password
> forever, and it lands in a feed with nobody to follow and no squad to join.
> This phase fixes those two problems and then closes the retention loop around
> them.

---

## 0. The recommendation in one page

Ship four workstreams, in this order:

1. **14A — Account recovery.** Password reset and email verification. No new
   account should be permanently lost because of a forgotten password, and no
   local account should be able to claim an email it has not proven.
2. **14B — Game-first onboarding.** After signup, ask what the player plays, then
   show open squads, communities and players for those games. Use the existing
   LFG board, catalog, Gamer Passport and preferences instead of inventing a new
   recommendation silo.
3. **14C — Social notification loop.** Comments, replies, follows and like
   milestones should reach the bell. Add history paging, a real notifications
   page and per-category preferences.
4. **14D — Activation telemetry and launch readiness.** Measure signup →
   onboarding → first join/follow → first post/message → day-7 return. Add
   request IDs, structured logs and error reporting before a public push.

The governing product rule:

> **A new account should reach a relevant squad, server or player before it sees
> an empty feed. A forgotten password must never be a permanent loss.**

If only one fix ships, ship 14A. If only one build ships, ship 14B.

**Effort:** 7–9 focused days. **Risk:** medium, concentrated in email
deliverability and recommendation cold-start, not in the data model.

---

## 1. Baseline and why this is next

| Area | Today | Consequence |
|---|---|---|
| Password recovery | No reset route. `User.authIdentities[].emailVerified` exists, but only Google identities ever set it; local accounts have no identity row at all. | A forgotten password is permanent churn, and a local account can claim an email it does not own. |
| Email verification | Not built. `docs/SECURITY.md` lists it as deliberately out of scope. | "Verified-only" DM and business policies only work for Google users. |
| Onboarding | No `/welcome` flow, no suggested communities, no suggested players and no trending path. `preferences.favoriteGames` and `preferredPlatforms` exist but are optional profile fields. | A new account sees an empty or generic feed. The strongest features (LFG, Passport, communities) are invisible at the moment they matter. |
| Notifications | The API already returns an opaque `nextCursor`, but the bell only shows the newest page. Only LFG, bot, invitation and DM events create pings; comments, replies, follows and likes are silent. | The first social interaction does not bring anyone back. |
| Measurement | Admin metrics cover request count, latency, errors and collection counts. There is no activation funnel or retention cohort. | It is impossible to tell whether onboarding or notifications actually improved anything. |
| Maturity | 1,013 automated checks (258 server, 44 client, 711 e2e), 63 responsive checks, a secret gate, CI and eleven e2e suites. | The foundation is strong enough that this work can be tested properly from day one. |

The existing roadmap already puts the inbox first. This phase moves account
recovery ahead of it and pairs the inbox with activation, because notifications
are only useful once a new account has something worth being notified about.

---

## 2. Goals, non-goals and success metrics

### Goals

- A player can recover a forgotten password without staff help.
- A local email address can be verified, and verification is visible in the
  account surface.
- A new account can choose games and reach a relevant squad, community or player
  in the first session.
- Comments, replies, follows and meaningful like milestones create exactly one
  notification each, with no self-pings and no spam.
- The bell can page through history, and a player can mute a category.
- The activation funnel is measurable without collecting message content or
  third-party tracking identifiers.

### Non-goals

- Atlas Search, fuzzy search or a trending algorithm. Those wait until there is
  enough content for ranking to matter (roadmap phase 10).
- Multi-instance correctness, the Redis socket adapter or shared rate-limit
  counters (roadmap phase 9).
- Paid business priority, payments or subscriptions.
- A native mobile app, microservices, Prisma or a framework migration.
- End-to-end encrypted messaging.
- Email marketing, digests for social notifications or push notifications.

### Success metrics

Establish a two-week baseline before changing copy or ranking, then hold these
targets for four weeks:

| Metric | Definition | Target |
|---|---|---|
| Onboarding completion | New accounts that select at least one game ÷ new accounts | ≥ 60% |
| First connection | Onboarded accounts that join a community or follow a player in the first session | ≥ 40% |
| First contribution | New accounts that post, comment or send a message within 7 days | ≥ 25% |
| Day-7 return | New accounts active on day 7 ÷ cohort size | +20% relative to baseline |
| Reset completion | Completed resets ÷ reset links requested | ≥ 70% |
| Notification engagement | Notification clicks ÷ notification opens | ≥ 10% |
| Verification | Local accounts verified within 7 days | ≥ 50% |

Targets are deliberately modest. The point is direction, not a growth-hacking
claim; adjust them after the first cohort.

---

## 3. Workstream 14A — Account recovery and email verification

### 3.1 Data model

Add to `User`:

| Field | Type | Notes |
|---|---|---|
| `emailVerifiedAt` | `Date`, default `null` | Top-level, because local accounts have no `authIdentities` row. The auth migration grandfathers existing accounts as verified; new local registrations start `null`. |
| `emailVerified` | Virtual or serialized boolean | `Boolean(emailVerifiedAt)` in `/auth/me`; never expose the raw date on a public profile. |

Add a dedicated collection rather than six token fields on `User`:

```
AccountToken
  userId       ObjectId, required, indexed
  purpose      'verify_email' | 'reset_password'
  tokenHash    String, required, unique
  expiresAt    Date, required, TTL index (expires: 0)
  usedAt       Date, default null
  createdAt    Date
```

Rules:

- Generate `crypto.randomBytes(32)`; send the base64url token; store only
  `sha256(token)`. A database leak must not yield working links.
- One live token per user and purpose. Creating a new one invalidates the old.
- Verification links expire in **24 hours**; reset links in **30 minutes**.
- Consume atomically with `findOneAndUpdate({ tokenHash, purpose, usedAt: null,
  expiresAt: { $gt: now } }, { $set: { usedAt: now } })`.
- Google sign-in sets `emailVerifiedAt` when the provider says the email is
  verified. Linking Google to an unverified local account sets it too.
- An email change is out of scope for this phase. If added later, it must clear
  `emailVerifiedAt` and issue a new token.

### 3.2 API surface

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `POST` | `/api/auth/verify-email` | — | `{ token }` → 200, sets `emailVerifiedAt`, consumes token. Invalid/expired/reused → generic 400. |
| `POST` | `/api/auth/verify-email/resend` | Required | Rate limited; issues one new token and sends one email. Generic response. |
| `POST` | `/api/auth/forgot-password` | — | `{ email }` → **always 202** with the same body, whether or not the account exists. Creates a token only for an active local account. |
| `POST` | `/api/auth/reset-password` | — | `{ token, password }` → validates policy, hashes, consumes token, bumps `sessionVersion`, clears the cookie, disconnects live sockets, returns 200. |
| `PATCH` | `/api/auth/password` | Required | `{ currentPassword?, password }` → requires a verified email; local accounts prove the current password, Google-only accounts may set one. Bumps `sessionVersion` and clears the cookie. |
| `GET` | `/api/auth/me` | Required | Adds `emailVerified`; `hasLocalPassword` is already in the payload. |

Do not add a public "does this email exist" endpoint. Do not return the token in
any response, log or error.

### 3.3 Email delivery

Add `server/utils/email.js` with one interface:

```js
sendEmail({ to, subject, text, html }) // resolves or throws
```

- Keep the transport behind this module so the controller does not import a
  vendor SDK. Supported transports: `apps-script` (free Gmail bridge),
  `console` and `memory`.
- Environment: `GMAIL_BRIDGE_URL` + `GMAIL_BRIDGE_SECRET`. Never a `VITE_*`
  variable; nothing in the client bundle. Setup for the free Gmail bridge is in
  [`GMAIL_BRIDGE.md`](GMAIL_BRIDGE.md).
- Use `publicBaseUrl(req)` from `server/utils/appUrl.js` for links, so preview
  and deployed origins behave correctly.
- Plain-text and HTML bodies. No tracking pixels, no open tracking, no link
  shorteners.
- In tests, use an in-memory transport. In development, allow
  `EMAIL_TRANSPORT=console` to print a link **only when `NODE_ENV !==
  'production'`**.
- A send failure must not fail registration. Record the failure, leave the
  account usable and let the user resend. Never log the token or the full link.

Suggested copy:

- Verification: "Confirm your GamerHub email" with a 24-hour link.
- Reset: "Reset your GamerHub password" with a 30-minute link and a line telling
  the recipient to ignore it if they did not ask.

### 3.4 UI

- `/forgot-password` — email field, generic success state.
- `/reset-password?token=…` — new password + confirmation, expiry message,
  successful reset routes to `/login` with a clear notice.
- Verification banner in the app shell for signed-in unverified accounts, with
  "Resend email" and dismiss. Do not block browsing.
- A "Email verification" row in **Settings → Security & auth**, showing verified
  or unverified and a resend action.
- `Referrer-Policy: no-referrer` on the reset page; never render the token in
  page copy.

### 3.5 Security rules

- Forgot-password is enumeration-safe: identical status, body and timing
  envelope for existing and missing accounts.
- Rate limit forgot/resend per IP and per normalized email hash: 3 per hour,
  with the shared limiter telemetry updated.
- Reset token is single-use, short-lived and invalidated by any newer request for
  the same purpose.
- Reset bumps `sessionVersion`, clears the current cookie and calls the existing
  socket-disconnect helper. A stolen cookie must die with the password.
- Password policy and bcrypt rounds reuse the registration constants.
- Do not reveal whether a token was expired, used or simply wrong; one generic
  "invalid or expired" response.
- Suspended/deleted accounts do not receive reset mail. Frozen accounts may
  reset; they still need to sign in to unfreeze.
- Add the provider key to `docs/SECURITY.md` rotation notes; it is server-only.

### 3.6 Tests and acceptance

- Unit: token hashing, one-live-token rule, expiry boundary, atomic consume,
  purpose isolation, email normalization, enumeration-safe response.
- E2E: register → capture test email → verify → `/auth/me` reports verified;
  request reset → reset → old cookie rejected → new password works; reused and
  expired tokens rejected; unknown email returns the same 202.
- Component: forgot form, reset form, verification banner.
- Acceptance: a player who forgot their password can recover without staff; a
  local account can prove its email; no response or log contains a raw token.

---

## 4. Workstream 14B — Game-first onboarding — ✅ implemented 15 November 2026

### 4.1 Data model

| Model | Field | Notes |
|---|---|---|
| `User` | `onboardingCompletedAt` | `Date`, default `null`. New accounts are routed to `/welcome`; existing accounts are never forced. |
| `Community` | `games` | `[String]`, max 5, trimmed, display-cased, indexed. Optional at creation; existing communities fall back to name/description matching. |

Add indexes:

- `users.preferences.favoriteGames` (multikey) for player suggestions.
- `users.gamerPassport.activeGames.gameName` (multikey) for the same query.
- `communities.games` (multikey) for community suggestions.

Use the existing `User.preferences.favoriteGames`, `favoriteGenres` and
`platforms`. Do not create a second preference store.

### 4.2 Suggestion endpoint

```
GET /api/discover/onboarding?games=Valorant,Apex%20Legends&platforms=PC
```

Requires auth. Returns one round trip:

```json
{
  "games": ["Valorant", "Apex Legends"],
  "squads": [
    {
      "id": "…",
      "gameTitle": "Valorant",
      "activity": "Ranked",
      "openSlots": 2,
      "maxSlots": 5,
      "micRequired": true,
      "leader": { "id": "…", "username": "…", "level": 12, "presence": "online" }
    }
  ],
  "communities": [
    {
      "id": "…",
      "name": "Valorant Elite",
      "slug": "valorant-elite",
      "description": "…",
      "icon": "…",
      "memberCount": 128,
      "games": ["Valorant"]
    }
  ],
  "players": [
    {
      "id": "…",
      "username": "…",
      "level": 18,
      "sharedGames": ["Valorant"],
      "presence": "in_game"
    }
  ],
  "tags": [{ "tag": "valorant", "postCount": 42 }]
}
```

Selection rules:

- **Squads:** `status: open`, not expired, leader active and not frozen, game
  title exact or prefix match (case-insensitive, regex-escaped), exclude squads
  the caller already belongs to. Limit 3 per selected game, 9 total.
- **Communities:** public only, caller not already a member and not banned,
  `games` overlap first; fall back to escaped name/description match. Order by
  member count, then recency. Limit 5.
- **Players:** active, `discoverableInSearch`, not blocked, not self, shared game
  in preferences or passport. Return only the shared games, never the full
  preference or passport payload. Limit 5.
- **Tags:** top tags on recent posts that match the selected games; limit 5.
- **Fallback:** no matching signals → popular public communities and open squads,
  labelled "Popular now". Never return an empty screen.
- **Privacy:** private communities are never suggested. Frozen, suspended and
  deleted accounts are never suggested. Blocking is symmetric in suggestions.
  No email, saved posts, followers or full profile payloads.

### 4.3 UI flow

- `/welcome` — three steps, skippable at any point:
  1. Pick up to three games (searchable; free text allowed if the catalog has no
     match).
  2. Pick platforms (reuse the existing passport platform values).
  3. Review suggestions and join/follow in place.
- On finish, save preferences, set `onboardingCompletedAt`, refetch the feed and
  show "Your feed is tuned" with a link to `/discover`.
- `/discover` — the same recommendation component, reachable later from the
  navbar and empty states. It accepts a game filter and never marks onboarding
  complete.
- Every join/follow is an explicit click. No auto-follow and no silent
  membership. Server rules still enforce public join and consent.
- New accounts with `onboardingCompletedAt === null` are redirected to
  `/welcome`; existing accounts are not. A "Finish setting up" card in Settings
  lets anyone rerun it.

### 4.4 Tests and acceptance

- Unit: game normalization and dedupe, ranking/fallback, private/frozen/blocked
  exclusion, no email or preference leakage.
- E2E: register → save preferences → suggestions include the matching squad,
  community and player; a private community and a blocked player are absent;
  join and follow from suggestions work; completing onboarding sets the
  timestamp.
- Component: step navigation, skip, selection cap, optimistic join/follow.
- Responsive smoke: `/welcome` and `/discover` at 360, 768 and 1280 px.
- Acceptance: a brand-new account can go from registration to a joined community
  or followed player without visiting an empty feed.

---

## 5. Workstream 14C — Social notification loop

**Implemented 15 Nov:** the full `/notifications` page, cursor history, unread
divider, mark-read on open, bell hand-off, `notificationSettings`, the settings
panel and server-side preference enforcement. Comment, follow and like
milestones now create one deduped ping through `notifyUser`; self-pings,
blocked pairs and frozen/suspended/deleted recipients are excluded. Comment
replies are not possible yet because `Comment` is a flat model with no parent
link; the `comments` preference and trigger helper are ready for a reply field
when threaded comments are introduced.

### 5.1 Triggers

| Trigger | Recipient | Type | Dedupe key |
|---|---|---|---|
| Comment on a post | Post author | `comment` | `comment:<commentId>` |
| Reply to a comment | Parent comment author | `comment` | `reply:<commentId>` *(deferred: no parent link yet)* |
| New follower | Followed player | `follow` | `follow:<targetId>:<actorId>` |
| Like milestone on a post | Post author | `like` | `like:<postId>:<milestone>` |

Like milestones: **1, 5, 10, 25, 50, 100**. Do not create one ping per like; a
post with 100 likes must not send 100 notifications. The existing mention path
keeps its current behaviour and must not be duplicated.

Rules:

- Never notify yourself.
- Never notify a blocked, frozen, suspended or deleted account. `notifyUser`
  checks both block directions when an `actorId` is supplied.
- Respect the recipient's category preference at write time, not only in the UI.
- Reuse `utils/notify.js`, the existing partial unique `dedupeKey` index and the
  socket `notification` event.
- `actionUrl` stays an internal route, e.g. `/posts/:id`, `/u/:username`.
- Links must survive deletion: a notification for a deleted post should render a
  neutral "This post is no longer available" state, not a 404 crash.

### 5.2 Preferences

Add to `User`:

```
notificationSettings: {
  comments: Boolean (default true),
  follows:  Boolean (default true),
  likes:    Boolean (default true),
  lfg:      Boolean (default true),
  bot:      Boolean (default true)
}
```

Expose `PATCH /api/account/notification-settings`. Partial patches only; unknown
keys rejected. DM digest and quiet hours stay under `dmSettings`.

### 5.3 API and UI

- Keep `GET /api/notifications` as the single list endpoint; it already supports
  `before`, `unread=1` and `nextCursor`.
- Add `/notifications` — a full page with cursor pagination, an unread divider,
  mark-read on open, and a "Load older" control. The bell keeps its newest-page
  preview and links to the full page.
- Optimistic badge updates on read; reconcile with the server's `unreadCount`.
- Add a Notifications panel in Settings (or a section in Privacy & safety) with
  the five switches.

### 5.4 Tests and acceptance

- Unit: trigger eligibility, self/block/frozen exclusion, preference opt-out,
  dedupe idempotence, milestone calculation.
- E2E: comment → exactly one ping; self-comment silent; follow → one ping and a
  follow/unfollow/re-follow cannot duplicate it; like → one milestone ping and
  unlike/re-like cannot duplicate it; category opt-out suppresses new pings;
  paging returns no overlap; another user cannot read or mark the ping.
- Component: bell preview, full-page paging, unread divider, optimistic read.
- Acceptance: a first comment or follow produces one notification, the recipient
  can mute that category, and history is reachable beyond the newest 20.

### 5.5 Retention

Ordinary notifications expire after **15 days**. The policy is encoded once in
`server/utils/notificationRetention.js`:

- `retentionAt = createdAt + 15 days` for ordinary social, LFG, DM and bot pings.
- `retentionAt = null` for invitations (including business-team invites), follow
  requests, account/security notices, community join decisions, and any notice
  explicitly marked `metadata.important: true` or `metadata.retention: 'important'`.
- A TTL index on `retentionAt` (`expireAfterSeconds: 0`) reclaims ordinary rows;
  Mongo ignores `null`/missing values. `purgeExpiredNotifications()` repeats the
  filtered delete at startup and every six hours as a deterministic fallback.
- New writes are stamped by model hooks (`save` and `insertMany`) in addition to
  `notifyUser`, so seed/test writers cannot accidentally create immortal pings.

---

## 6. Workstream 14D — Activation telemetry and launch readiness — ✅ implemented 16 November 2026

Implemented with a first-party `ProductEvent` collection, an admin-only activation
funnel, request IDs on every response, structured JSON access/error logs and an
admin launch-instrumentation panel. Notification opens and clicks are recorded
through authenticated endpoints; no message content, email, token or IP address
is stored. The funnel is cached for 60 seconds, uses distinct-user counts and
labels day-7 as a cohort approximation.

### 6.1 Product events

Add a small first-party collection rather than a third-party tracker:

```
ProductEvent
  userId     ObjectId | null
  name       String, enum
  props      Object, max ~10 keys, no message text or email
  createdAt  Date
```

Indexes: `{ name: 1, createdAt: -1 }`, `{ userId: 1, createdAt: -1 }`, TTL 180
days. Hook the existing account-erasure path so events are deleted with the
account, and include them in the owner's data export.

Events:

- `signup`
- `onboarding_started`, `onboarding_completed`, `onboarding_skipped`
- `first_join`, `first_follow`, `first_post`, `first_comment`, `first_message`
- `password_reset_requested`, `password_reset_completed`
- `email_verified`
- `notification_opened`, `notification_clicked`

`recordEvent()` is fire-and-forget: it must never fail or slow the user request.
Never store message bodies, email addresses, tokens or IP addresses.

### 6.2 Admin funnel

```
GET /api/admin/funnel?days=28
```

Admin-only, cached for 60 seconds. Returns distinct-user counts per step and
conversion rates:

```
signup → onboarding_completed → first_join_or_follow → first_contribution → day_7_return
```

Use one first-signup cohort for every step: connection is nested under onboarding
completion and contribution under connection, while skipped onboarding is shown
separately. Document that day-7 is a cohort approximation from event timestamps,
not a warehouse-grade retention calculation.

### 6.3 Operability — ✅ implemented 17 November 2026

- Request ID middleware; include it in JSON logs and error responses.
- Structured JSON logs with cookie/token/email redaction.
- Error reporting (Sentry or equivalent) with release tagging. Server-side only;
  no session replay. `SENTRY_DSN` is optional; without it the structured JSON
  log remains the error record and health reports `structured-json`.
- `/api/health` remains liveness; `/api/health/ready` pings MongoDB and Redis
  when enabled and returns `503` on a failed dependency.
- The Atlas backup and restore drill is documented in
  [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md), with a bounded `npm run backup:drill`
  that verifies collections, documents and indexes in a throwaway database.
- Admin system health now reports the error-reporting provider state and the
  rate-limit store mode, alongside the existing Redis/buffer state.

### 6.4 Tests and acceptance

- Unit: event-name allowlist, prop size cap, redaction, erasure hook.
- E2E: signup and onboarding produce events; funnel is admin-only; a normal user
  gets 403; counts are distinct-user counts.
- Acceptance: the team can answer "where do new accounts drop off?" without
  reading message content, and a server error has a request ID in its log line.

---

## 7. Delivery sequence

| Milestone | Scope | Effort | Depends on |
|---|---|---|---|
| 0 | Migrations, `AccountToken`, `ProductEvent`, email transport shell | 0.5–1 d | — |
| 1 | **14A** account recovery + verification | 2–3 d | 0 |
| 2 | **14B** onboarding + discovery endpoint + UI | 2–3 d | 0, 14D events for measurement |
| 3 | **14C** social notifications + preferences + full page | 1.5 d | 0 |
| 4 | **14D** funnel, logs, error reporting, launch checklist | 1–1.5 d | 1–3 |

Instrumentation starts with milestone 0 and is filled in as each workstream
lands; do not wait until the end to add events, or the first cohort is
unmeasurable.

Run workstreams sequentially if there is one implementer. 14A and 14B touch
almost disjoint files and can run in parallel if there are two.

---

## 8. Data, migrations and files

### New files

- `server/models/AccountToken.js`
- `server/models/ProductEvent.js`
- `server/utils/email.js` (transport abstraction)
- `server/utils/onboarding.js` (pure ranking/selection helpers)
- `server/utils/notificationRetention.js` (TTL policy)
- `server/utils/socialNotifications.js` (comment/follow/like-milestone triggers)
- `server/utils/notificationPreferences.js` (defaults, validation, category map)
- `server/utils/productEvents.js` (`recordEvent`, 14D)
- `server/controllers/discoverController.js`
- `server/routes/discoverRoutes.js`
- `client/src/pages/Welcome.jsx`
- `client/src/pages/Discover.jsx`
- `client/src/pages/Notifications.jsx`
- `client/src/components/discover/DiscoveryBoard.jsx`
- `client/src/components/settings/NotificationPanel.jsx`
- `client/src/utils/notificationEvents.js`
- `client/src/pages/ForgotPassword.jsx`, `ResetPassword.jsx`

### Migrations

- **auth track:** `AccountToken` indexes, `User.emailVerifiedAt` backfill
  (`null`), `User.onboardingCompletedAt`, `User.notificationSettings` defaults,
  `users.preferences.favoriteGames` and passport game-name indexes.
- **communities track:** `Community.games` default `[]` and multikey index.
- **feed track:** `20261115100000-notification-retention.js` backfills
  `Notification.retentionAt` and creates the `notification_retention_ttl` index;
  `20261116090000-product-events.js` creates the funnel indexes, the one-time
  milestone unique index and the 180-day TTL index.

Use the existing per-domain migration commands; do not add a fifth track.

### Dependencies

- One transactional email provider SDK **or** a plain `fetch` call if the chosen
  provider has an HTTP API. Prefer no new dependency when `fetch` is enough.
- No new client dependency.
- Error reporting only if 14D chooses a hosted provider.

---

## 9. Test and CI plan

- Add `server/tests/accountTokens.test.js`, `onboarding.test.js`,
  `notificationTriggers.test.js`, `productEvents.test.js`.
- Add `scripts/e2e-phase14.js` and append it to `npm run test:e2e`. CI already
  runs that script, so no workflow change should be needed.
- Email is never sent in CI. Use the in-memory transport; assert the captured
  message and token without printing them.
- Client component tests for the onboarding steps, forgot/reset forms and the
  notifications page.
- Extend the responsive smoke matrix with `/welcome`, `/discover` and
  `/notifications` at 360, 768 and 1280 px.
- Re-run `npm run scan:secrets`; the email key must not reach `client/src` or
  `client/dist`.
- Update `docs/TEST_LEDGER.md` with a pass entry and the new tallies only after
  the suites actually run.

---

## 10. Launch checklist

- [ ] 14A: verify, resend, forgot and reset flows pass end-to-end with a real
      inbox on the deployed origin.
- [ ] 14A: no account enumeration in status, body or timing.
- [ ] 14A: reset revokes old cookies and live sockets.
- [ ] 14B: a fresh account reaches `/welcome`, selects games, and joins or
      follows something in one session.
- [ ] 14B: private, frozen and blocked entities never appear in suggestions.
- [x] 14C: comment/follow/like pings are deduped and mutable.
- [x] 14C: history pages without overlap and deep links work.
- [x] 14C: ordinary notifications expire after 15 days; durable notices are
      exempt and the TTL index/sweep were verified against the working database.
- [x] 14D: the funnel is visible to admins only and contains no message text.
- [x] 14D: request IDs appear in logs and 500 responses.
- [x] 14D: `/api/health/ready` pings MongoDB and reports Redis when enabled.
- [x] 14D: the bounded Atlas restore drill passes and the full procedure is
      documented in [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).
- [ ] 14D: set `SENTRY_DSN` on the deployment and verify one captured exception
      arrives with the release tag (code and redaction tests are complete).
- [ ] 14A: send one live verification and one reset email through the deployed
      Gmail bridge; local env has no bridge URL/secret.
- [x] `npm test`, `npm run test:e2e`, `npm run build --prefix client`,
      `npm run scan:secrets` and the migration status commands pass.
- [x] README and SECURITY.md updated: recovery is no longer "not implemented";
      the new env vars and retention rules are documented.
- [ ] A rollback plan exists for the email provider and the new migrations.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reset emails land in spam | Use a dedicated sending domain with SPF, DKIM and DMARC; start with low volume; test Gmail, Outlook and a corporate inbox before launch. |
| Account enumeration through timing | Identical response and a small constant delay on both branches; rate limit by IP and email hash; never reveal whether a token existed. |
| Token leakage through referrers or logs | `Referrer-Policy: no-referrer` on the reset page; never log tokens; short TTL; single use; hash at rest. |
| Email provider outage blocks registration | Registration succeeds even if the send fails; resend is available; queue/retry is a later improvement. |
| Onboarding suggests nobody | Popular fallback, seeded demo communities, and a "browse all" link. Never block completion. |
| `Community.games` is empty for existing servers | Optional field with name/description fallback; seed the demo data; do not make it required at creation. |
| Notification spam | Milestones for likes, dedupe keys, category preferences, no per-like pings. |
| Analytics becomes surveillance | First-party only, no message text, no email, 180-day TTL, erased with the account, admin-only aggregates. |
| Scope creep into search/trending | Explicit non-goal. Discovery waits for content volume. |

---

## 12. Open decisions

1. **Email provider.** Resolved: the Gmail Apps Script bridge (`apps-script`),
   which uses HTTPS and therefore works where SMTP ports are blocked. The
   implementation stays behind `server/utils/email.js`; setup is in
   [`GMAIL_BRIDGE.md`](GMAIL_BRIDGE.md).
2. **Verification enforcement.** Recommendation: verify softly in this phase
   (banner, verified badge, verified-only DM policy) and do not block basic
   browsing or posting. A hard gate needs a grandfathering plan for existing
   accounts.
3. **Analytics storage.** Recommendation: the first-party `ProductEvent`
   collection described above. Do not add a third-party product analytics SDK
   until the funnel questions outgrow it.
4. **Community games field.** Recommendation: optional at creation, editable in
   server settings, seeded for demo communities. Do not require it, or existing
   communities become second-class in onboarding.

---

## 13. Deliberately deferred

- Atlas Search, fuzzy search and trending (phase 10).
- Multi-instance Redis adapter and distributed socket-engine counters (REST
  per-surface/auth/account quotas are shared when Redis is enabled; see
  [`SECURITY.md`](SECURITY.md) §5).
- Per-device session list (needs a session table; `logout-all` already covers
  the urgent case).
- Social email digests and web push.
- Paid business priority and payments.
- Native mobile app.

---

## 14. Definition of done

Phase 14 is done when:

1. A local account can verify its email and recover a forgotten password
   end-to-end, with no enumeration and no reusable token.
2. A new account can pick games and reach a relevant squad, community or player
   in its first session, without an empty feed.
3. Comments, replies, follows and like milestones create exactly one
   notification each, with paging, deep links and category preferences.
4. The activation funnel and day-7 cohort are visible to admins without storing
   message content.
5. Every new surface is covered by the unit, e2e, component and responsive
    checks, and all 1,013 automated checks pass.
