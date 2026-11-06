# GamerHub — Private Messaging & Business Accounts

**Status:** Phase A (consent core) implemented 6 Nov 2026; business accounts and paid priority remain proposal · **Date:** 6 November 2026
**Scope:** 1:1 private threads, creator/stranger boundaries, business accounts
**Audience:** product owner + implementer

> **Implementation status (6 Nov 2026):** Phase A is live in the tree — the
> request/accept protocol, six-row consent matrix, quotas and cooldowns, reports
> and blocks, socket rooms, retention/erasure hooks, inbox UI and settings
> matrix. The filtered lane, business-account mode, verification and paid
> priority are still proposal work; do not read §6–§9 as shipped behaviour.

---

## 0. The recommendation in one page

Ship private messaging as a **consent protocol**, not an open inbox.

1. **Two inboxes, not one.** An *Inbox* for conversations both people accepted, and a
   *Requests* lane for first contact. A third *Filtered* lane catches hidden words and
   low-reputation senders. Requests never count toward the navbar badge and never push a
   notification — a creator's phone stays quiet until they say yes.
2. **First contact is cheap to send and expensive to abuse.** One plain-text message,
   300 characters, no links, no media, no voice notes, no read receipt, no typing
   indicator, no presence. It expires in 14 days. A sender gets 5/day and 20/week, one
   request per person per 30 days, and a 90-day cooldown after being ignored or declined.
3. **The recipient controls a policy matrix, not a single toggle.** Different rules apply
   to mutual follows, followers, members of the same server, verified businesses and
   strangers. A creator can open the door to their community while keeping the open
   internet outside.
4. **Business accounts are a disclosed mode of the same account, not a second login.**
   A visible "Business" label, a real business profile, structured first-contact intents
   (collab, sponsorship, support, press), triage tools (labels, quick replies, away mode)
   and a complaint-rate throttle. Verification is separate from the label and is never
   self-serve. Business status never bypasses recipient consent.
5. **Attention can be paid for, optionally.** A creator may set a price for priority
   first contact (Telegram Stars / X Premium model). Followers and people the creator has
   messaged first stay free. The price buys *delivery and triage priority*, never a reply,
   and is refunded if the recipient reports or blocks.
6. **Reuse the primitives that already exist.** The consent ledger (`Invitation`), the
   squad-chat service (membership, cursor pagination, request-time expiry), sliding-window
   limiters, notification deduplication, blocking/freeze/erasure and the socket auth model
   all already encode the right patterns.

The governing rule: **reach is a request, never a right.**

### One integrity issue to settle first

`User.privacySettings.allowDirectMessages` (`anyone | mutual_follows | none`) is already
exposed in the Settings UI and written to the database, but **no server code reads it for
delivery** because direct messages do not exist. Today it is a promise the product does not
keep. Phase A must make it enforceable; if Phase A slips, the control should be hidden
rather than left as decoration.

---

## 1. Why this is genuinely hard

A public feed and a Discord-style server create two different social graphs. The feed says
"anyone may watch me"; the server says "members may talk to each other". A DM button
silently merges them into "anyone may interrupt me", which is the exact thing many creators
leave platforms over.

The evidence is not anecdotal:

- In a CHI 2022 study of 135 creators, **95% reported experiencing hate and harassment at
  least once, and attacks were a regular occurrence for one in three**. Creators reported
  self-censoring content and leaving platforms; they rated reporting as the least effective
  tool and moderation as the most effective.
- ADL's 2024 creator research found YouTube creators overwhelmed by the labour of comment
  moderation, caught between under- and over-moderating.
- A 2022 LinkedIn poll of more than 5,000 responses found **unwanted messages were the
  single most annoying behaviour** on the platform.

The product consequence: the default cannot be "open inbox with a block button". The
default has to be "a request the recipient can afford to ignore".

---

## 2. What other platforms learned

| Platform | Mechanic | Copy this | Do not copy this |
|---|---|---|---|
| **Instagram** | Message requests are separate from the inbox. A non-follower can send **one text-only message** until accepted. Hidden Words filters offensive requests into spam. Creators can **sort and filter requests** by verified, business, creator and follower count. Restricted accounts' DMs go to a pending inbox. Teen accounts can only be messaged by people they follow or are connected to. | The one-message rule, the separate requests folder, request filters by trust signals, teen defaults | The creator inbox is still widely described as overwhelming; filters help triage but do not reduce volume |
| **X** | Requests stay separate until accepted. A **quality filter is on by default**. Recipients can accept requests only from **verified users and people they follow**. The documented cap is 500 DMs/day. | Verified-only gate, quality filter, hard daily cap | Verification becoming the price of reaching people turns privacy into a paywall |
| **Signal** | Message requests show context before acceptance. Reporting spam sends only the sender's identifier and a one-time anonymous message ID. Suspicious senders get **proof-of-humanity checks** rather than content scanning. | Behaviour-based anti-spam that never reads accepted conversations | Nothing significant; this is the privacy-respecting model |
| **Bluesky** | A **Chat Requests** banner surfaces messages from unknown users for accept/reject. | Low-friction, one-tap triage | A banner alone does not give creators bulk tools |
| **VSCO** | Creators can start unlimited conversations with followers, but only **3 conversations per day with non-followers**. Recipients can accept, mute, report or leave silently. | Asymmetric quota: relationship buys access | The cap is global, not per-context |
| **WhatsApp Business** | Business accounts are **labelled** in the chat, with an optional verified badge, a profile (category, hours, address, website, join date), a catalog, labels/lists, quick replies, greeting and away messages. Template messaging is limited and consent-based. | Disclosure, business profile, labels, quick replies, away messages | Cold template outreach without opt-in; it is the most-reported messaging pattern on the platform |
| **Telegram** | **Paid messages** (Stars): contacts and people you messaged first are free; everyone else pays a creator-set price; the recipient receives 85%; payments are refundable. | Optional paid priority with refunds, free for existing relationships | Framing payment as a guarantee of a reply |
| **Patreon** | DMs require a **payment relationship or active membership**. Bulk creator messages create a separate thread per member. Member-to-member DMs do not exist. | Relationship-gated messaging, per-recipient threads for any bulk send | Making payment the only path to contact |
| **Discord** (analogy, not researched here) | Server membership is the social context; friend requests gate the closest relationships. | Context ("you share a server") is a better trust signal than follower count | Server raids turn member lists into DM scraping lists |

The recurring patterns across all of them:

1. **Separate the request from the inbox.** Every mature platform does this.
2. **Make first contact cost something** — one message, a quota, a relationship, a CAPTCHA
   or money.
3. **Give the recipient context** before they decide (source, mutuals, account age, badge).
4. **Give the recipient triage tools**, not just a block button (filters, labels, quick
   replies, away mode).
5. **Disclose commercial identity.** People forgive a business for being a business; they
   do not forgive a business pretending to be a fan.
6. **Default the vulnerable to safety.** Instagram's teen defaults are the clearest example.
7. **Do not read accepted private conversations to fight spam.** Signal's behaviour-based
   enforcement is the defensible line.

---

## 3. Product design

### 3.1 The four lanes

| Lane | Contents | Badge | Notification |
|---|---|---|---|
| **Inbox** | Threads that were accepted, or started by the recipient | Unread count | Yes, normal |
| **Requests** | First contact from outside the accepted graph | Separate, quiet count | **No push**; daily digest only |
| **Filtered** | Hidden words, low-reputation senders, suspected campaigns | Hidden by default | None |
| **Archived** | Accepted threads the recipient closed | None | None |

Requests expire after **14 days** and are hard-deleted by the retention worker. A declined
request keeps only the metadata needed for the cooldown and abuse evidence; its text is
purged after 30 days unless it is attached to an open report.

### 3.2 The first-contact protocol

A request is allowed only if the sender passes the recipient's policy for that context and
the sender's own budget.

**Content rules for the first message**

- Plain text only, 300 characters.
- No links, no media, no voice notes, no mentions, no formatting tricks.
- No phone/email extraction prompts are blocked (people legitimately share contact details);
  links are the vector that is blocked, and the UI says why.

**Delivery rules**

- Lands in Requests. No push notification. No read receipt. No typing indicator. No
  "last active". The sender sees "Request sent", never "Seen".
- The recipient sees a context card before the text: where the request came from (a post,
  the profile, a shared server, a squad), mutual connections, account age band, and any
  badge. Exact follower counts are not shown to strangers.
- Accept moves the thread to the Inbox and unlocks normal chat. Delete archives it silently
  and starts a **90-day cooldown**. Block hides both directions permanently. Report
  preserves the reported messages for moderation and penalises the sender's reputation.

**Sender budget**

| Rule | Value | Why |
|---|---|---|
| New requests per day | 5 | Enough for a real person, ruinous for a script |
| New requests per week | 20 | Stops slow-drip campaigns |
| Same recipient | 1 per 30 days | Stops repeated cold approaches |
| Account younger than 7 days | 1/day, no links | New-account spam is the dominant pattern |
| After ignore/decline | 90-day cooldown | The recipient's silence is an answer |
| After block | Permanent | No workaround |
| Verified identity | Required for cold requests once email verification exists; Google identity counts today | Costs a spammer something |

Every counter is enforced server-side, keyed by user id (not IP), with IP and device
corroboration for anonymous or young accounts. The existing `rateLimiter` and
`middleware/limiters.js` are the right homes.

**Paid priority (optional, later phase)**

The recipient sets a price. Contacts, mutuals, followers (if the creator chooses) and anyone
the creator has messaged first are exempt. A paid request still obeys every content rule,
still lands in Requests, and buys only priority ordering and a longer message (1,000
characters). It is refunded automatically if the recipient reports or blocks within 7 days.
It never promises or implies a reply, and it is capped at 3/day per sender.

### 3.3 The policy matrix

The existing single enum is replaced by a matrix. Rows are the relationship context; the
recipient chooses the rule for each row.

| Context | Default | Options |
|---|---|---|
| Mutual follow | **Inbox** | Inbox, Request, Nobody |
| They follow me | **Request** | Inbox, Request, Nobody |
| I follow them | Request | Request, Nobody |
| Member of a server I am in | **Request** | Inbox, Request, Verified only, Nobody |
| Squad mate (current or past) | **Request** | Inbox, Request, Nobody |
| Verified business | **Request** | Request, Verified only, Paid only, Nobody |
| Stranger | **Request** | Request, Verified only, Paid only, Nobody |

Hard rules that are not user-editable:

- Blocked pairs are refused in both directions with a generic reason.
- Frozen accounts cannot send or receive new requests; existing accepted threads are
  readable but not writable until unfrozen.
- Deleted/deletion-pending accounts are unreachable and their threads are tombstoned.
- If the platform records age brackets, minors are **connected-only**: no cold requests,
  no paid messages, no business outreach.

The sender always sees the applicable rule on the profile ("Accepts requests from verified
businesses only") so they are never surprised. The recipient's reasons for a block are never
disclosed.

### 3.4 The creator inbox

Accepting requests is only half the problem; the other half is surviving the ones you
accept. The inbox needs to feel like a triage desk, not a firehose.

- **Filters:** verified, business, creator, follower band, shared server, intent, has link,
  new/returning.
- **Labels:** collab, sponsorship, support, fan, press, spam, plus custom labels. One label
  per thread, colour-coded.
- **Quick replies:** 3–5 saved responses with `{username}` placeholders, inserted in one
  click.
- **Away mode:** an auto-greeting, an expected response time, and a pause switch that tells
  senders when the inbox reopens and points them at a better channel (a server, an FAQ, a
  business email). Auto-replies are sent at most once per thread per 24 hours.
- **Digest:** one notification per day ("4 new requests") instead of one per message. This
  is the single most important peace feature.
- **No read receipts by default.** A creator can turn them on per thread; the default is
  off, because "seen" is a social pressure lever.
- **Close thread** moves an accepted conversation to Archived without blocking the person.

### 3.5 Business accounts

The schema already has `profileType: 'personal' | 'creator_business'` and the model comment
says it is deliberately advisory. This plan makes it real — but keeps every enforcement
decision in the consent engine, so a badge can never grant access.

**Identity**

- One login, one handle, one follower graph. Upgrading does not create a second account and
  does not lose posts, followers or server memberships.
- The account is labelled **Business** beside the handle everywhere (feed, profile,
  requests, threads). The label is disclosure, not endorsement.
- **Verification is separate.** A business can be self-declared (label only) or verified
  (domain email or DNS TXT plus review, with a manual path for known brands). The verified
  badge is never self-serve.
- **Privacy separation:** personal threads live in a *Personal* folder that a future team
  inbox cannot see. Business threads live in the business inbox. The two datasets are never
  merged in an export, an analytics view or a team member's screen.
- A linked second profile (Instagram-style multi-account) is deliberately deferred; it
  doubles the auth, block and erasure surface for a benefit that a badge plus a display name
  already delivers.

**Business profile**

Display name, category, description, website, support email, location/timezone, expected
response time, and portfolio links. No storefront or payments in v1.

**Structured first contact**

Instead of free text, a business request is a brief:

| Field | Required | Example |
|---|---|---|
| Intent | Yes | Collab, sponsorship, support, press, partnership, other |
| Company / brand | Yes | Verified from the business profile |
| Website | No | Must match the verified domain |
| Budget band | No | "Under 500", "500–2,000", "2,000+" |
| Timeline | No | "This month", "Q1" |
| Message | Yes | 600 characters |

The recipient sees a card, not a wall of text. This is better for the creator (triage in
seconds) and better for the business (higher acceptance because the intent is legible).

**Triage tools:** labels, quick replies, away mode, analytics (requests, acceptance rate,
median response time), and later a team inbox with roles.

**Guardrails**

- Cold business outreach is allowed only from **verified** businesses.
- 3 cold requests/day; the general 5/day budget still applies.
- Links are carried only by the verified profile field, not by the first message.
- A complaint rate above 2% pauses outreach pending review.
- Business status never overrides a recipient's policy, block list or freeze.
- Impersonation reports are prioritised; a suspended business loses outreach and its badge
  pending review.

### 3.6 The fan side

A fan should never hit a dead end. The profile's Message button states the rule before the
composer opens:

- "Accepts requests" → a one-message composer with the context attached.
- "Verified businesses only" → explains how to become verified, or offers the public
  channel/email.
- "Paid priority" → shows the price and what it does and does not buy.
- "Not accepting messages" → points at the creator's server, fan channel or support page.

The composer shows why the recipient will see the request ("You are a member of Neon
Rift"), so the sender understands the gate instead of assuming a bug.

---

## 4. Architecture fit

The codebase already contains most of the primitives. The plan is deliberately additive.

| Existing piece | Reuse |
|---|---|
| `models/Invitation.js` — state machine (`pending → accepted/declined/expired/revoked`) and a partial unique index for one live invitation | The request lifecycle and the "one pending request per pair" invariant |
| `models/SquadChat.js`, `SquadChatMessage.js`, `utils/squadChatService.js` — membership-first loading, cursor pagination, request-time expiry, tombstone deletes | The conversation service, page contract and expiry enforcement |
| `utils/rateLimiter.js` — sliding window keyed by user | Sender budget (5/day, 20/week), per-thread flood, paid-request cap |
| `middleware/limiters.js` — per-surface REST limits keyed per account | Inbox listing, request creation, business outreach |
| `utils/privacy.js` — `isBlockedBetween`, `canParticipate`, `accountGate`, `sanitizePrivacyPatch` | The DM gate; extend with the policy matrix |
| `utils/visibility.js`, `publicPlayer` — projection helpers | Request cards and participant summaries with no presence/status leak |
| `models/Notification.js` — types and `dedupeKey` | One notification per thread, digest-friendly |
| `models/Report.js` — reasons, statuses, unique reporter+target | Model for a new `DmReport` (kept separate so community invariants are untouched) |
| `utils/accountErasure.js`, `jobs/retention.js` | Tombstone authored messages, remove membership, sweep expired requests |
| `utils/audit.js` | Business verification, badge changes, admin report resolutions |
| `config/socket.js` — JWT handshake, per-user rooms, flood control | `dm:<conversationId>` rooms for accepted threads only |

### 4.1 New collections

**Conversation** — one document per pair (v1 is strictly 1:1)

```
pairKey            string, unique          // sorted "a:b", the duplicate guard
participantIds     [ObjectId] (2)
initiatorId        ObjectId
state              request | active | declined | expired | blocked | archived | erased
context            { type: profile|post|community|squad|business, id, label }
requestText        string (max 300)        // cleared after acceptance/decline
requestExpiresAt   Date
acceptedAt, declinedAt, blockedBy, blockedAt
lastMessageAt, lastMessagePreview
unread             { [userId]: number }   // accepted messages only
labels             [{ ownerId, key, value }]  // owner-only triage
mutedBy            [ObjectId]
archivedBy         [ObjectId]
retryAfter         Date                    // decline/ignore cooldown
```

**DirectMessage**

```
conversationId, authorId, text (max 2000), kind (text|system),
mediaUrl (null in v1), createdAt, deletedAt, deletedBy, reportedAt
```

**BusinessProfile**

```
userId (unique), displayName, category, description, website, supportEmail,
timezone, responseExpectation, links[], verificationStatus (none|pending|verified|rejected),
verificationMethod (domain_email|dns|manual), verifiedAt, labels[], quickReplies[],
greeting, awayMessage, availability (open|away|paused), outreachPaused, complaintRate
```

**DmReport**

```
reporterId, conversationId, messageIds[], reason, note, status,
reviewedBy, reviewedAt, reviewNote
```

**SenderReputation** (internal, never exposed)

```
userId, coldRequests, accepted, declined, ignored, reports, blocks,
tier (standard|limited|restricted), updatedAt
```

**User additions**

```
dmSettings: {
  policy: { mutual, follower, following, communityMember, squadMate, business, stranger },
  hiddenWords: [<=50], minAccountAgeDays, digest: 'off'|'daily'|'weekly',
  digestHour, readReceipts: boolean, allowPaidMessages: boolean, paidPrice: number
}
```

The legacy `allowDirectMessages` is migrated into `dmSettings.policy` by a migration and
kept readable for one release; the UI stops writing it once the matrix ships.

### 4.2 State machine

```
(no doc) --request--> request --accept--> active --archive--> archived
                         |  |                  |
                         |  +--decline-------> declined --cooldown--> (re-request allowed)
                         |  +--expire--------> expired
                         +-----block---------> blocked (permanent until unblock)
active --block--> blocked
request/active --erasure--> erased (messages tombstoned)
```

Only the recipient can accept or decline. Only active participants can send in `active`.
A `request` allows exactly one message: the request body. Read receipts and typing events
exist only in `active`.

### 4.3 API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/messages/conversations?folder=inbox\|requests\|filtered\|archived&before=&limit=` | Cursor-paged list |
| POST | `/api/messages/requests` | First contact: `{ recipientId, text, context?, intent? }` |
| GET | `/api/messages/conversations/:id` | Thread metadata + page of messages (member only) |
| POST | `/api/messages/conversations/:id/accept` | Recipient only |
| POST | `/api/messages/conversations/:id/decline` | Recipient only; silent to sender |
| POST | `/api/messages/conversations/:id/archive` | Either participant |
| POST | `/api/messages/conversations/:id/mute` | Either participant |
| POST | `/api/messages/conversations/:id/messages` | Active only; idempotency key |
| POST | `/api/messages/conversations/:id/read` | Accepted threads only |
| POST | `/api/messages/conversations/:id/report` | Reason + optional message ids; auto-block option |
| PATCH | `/api/account/dm-settings` | Matrix, filters, digest, hidden words |
| POST | `/api/account/business-profile` | Upgrade or update |
| POST | `/api/account/business-verification` | Domain email or DNS token |
| GET | `/api/business/:handle` | Public business profile |
| GET | `/api/admin/dm-reports` | Moderation queue |
| POST | `/api/admin/dm-reports/:id/resolve` | Audited resolution |

Socket events (accepted threads only): `join_conversation`, `dm_message`, `dm_typing`,
`dm_read`, `dm_thread_closed`. Requests are delivered by a quiet notification and fetched
over REST; the socket never pushes a stranger's message payload.

### 4.4 Indexes and migrations

- `conversations`: `{ pairKey: 1 }` unique; `{ participantIds: 1, state: 1, lastMessageAt: -1 }`;
  `{ state: 1, requestExpiresAt: 1 }` for the expiry sweep.
- `directmessages`: `{ conversationId: 1, createdAt: -1 }`; `{ authorId: 1, createdAt: -1 }`.
- `businessprofiles`: `{ userId: 1 }` unique; `{ verificationStatus: 1 }`.
- `dmreports`: `{ status: 1, createdAt: -1 }`; `{ reporterId: 1, conversationId: 1 }` unique.
- `senderreputations`: `{ tier: 1, updatedAt: 1 }`.
- A migration on the existing auth track backfills `dmSettings.policy` from
  `allowDirectMessages` and leaves the old field in place for one release.

No text index on `DirectMessage` in v1. Search inside accepted threads is a client-side
filter over the loaded page; server-side content search is a privacy decision for later.

---

## 5. Abuse, privacy and safety

| Threat | Control |
|---|---|
| Cold spam | One text-only message, 5/day, 20/week, new-account limits, links blocked |
| Harassment | Requests separate, no read receipts, no presence, hidden words, silent decline, block |
| Stalking | Block is permanent and symmetric; no "seen", no "last active", no exact follower counts |
| Impersonation | Business verification, unique handles, report path, badge audit |
| Business scam | Verified domain, structured intent, no free-text links, complaint-rate pause |
| Minor grooming | Age bracket policy (decision below); connected-only defaults if minors exist |
| Report abuse | Evidence-scoped review, no auto-ban on one report, audit trail |
| Enumeration | Generic refusal reason, no email/phone lookup, request budget per account |
| IDOR | Membership is always re-derived server-side (`conversationId → participantIds`); socket joins re-check state |
| Load | Quotas, per-surface limiters, cursor pagination, one room per thread, no fan-out to all sockets |
| Campaign detection | Hash normalised first messages; if N senders send identical text in a window, route to Filtered without reading accepted threads |

**What the platform will not do**

- It will not scan accepted private conversations for advertising or generic moderation.
  Review happens when a message is reported, and only the reported messages are visible to
  the reviewer, under an access log.
- It will not claim end-to-end encryption. Transport and at-rest encryption are the honest
  promise, consistent with `docs/SECURITY.md`.
- It will not publish a "trust score" or tell a sender they were filtered. Reputation is
  internal and appealable through support.

**Data rights**

- An export includes the caller's own thread metadata and messages, never the other
  participant's private fields.
- Erasure tombstones the caller's messages (`[deleted]`), removes them from the pair's
  thread, and leaves the other participant a tombstone rather than silently rewriting their
  history.
- Reports retain the reported messages until resolution plus 30 days, then purge.
- Expired and declined requests are hard-deleted by the existing retention worker.

**Minors — a decision that needs the owner**

The platform currently collects no age data. Two defensible options:

- **A. Declare 18+ in the terms.** Least code, weakest enforcement, common for small
  platforms.
- **B. Ask for an age bracket at registration** and apply the Instagram-style rule: minors
  can only be messaged by accounts they follow or are connected to; no cold requests, no
  business outreach, no paid messages. This requires a `ageBracket` field, a policy gate and
  a legal review.

Recommendation: **B** if the platform will be public and open to teens; **A** only if the
terms genuinely restrict the audience. This is a product/legal call, not an engineering one.

**Paid messages — a later, separate decision**

Payments add a provider, refunds, tax, store rules (if mobile) and a new abuse surface
("I paid, why didn't you reply?"). They are deliberately Phase D, behind a product decision.
The design above keeps the consent rules identical whether or not money changes hands.

---

## 6. UX surfaces

1. **Navbar:** a single Inbox icon with the unread count for accepted threads only. No red
   dot for requests; the digest is the notification.
2. **Inbox:** three-pane on desktop (list, thread, context), one column on mobile with a
   back control; tabs for Inbox, Requests, Filtered, Archived; skeletons already exist.
3. **Request card:** context, account age band, badges, the message, and four actions
   (Accept, Delete, Block, Report). No "Seen" indicator.
4. **Thread:** normal chat once accepted; request state has no composer. Safety banner on
   every request.
5. **Profile:** Message button states the policy and the context; business badge and profile
   card; "Business" label is visible in search and on posts.
6. **Settings:** a "Who can message you" matrix with plain-language rows, request filters
   (hidden words, account age, links are always off), digest frequency, read receipts,
   paid-request toggle and price.
7. **Business settings:** business profile fields, verification status, labels, quick
   replies, away mode, availability, analytics.

Accessibility: reuse the existing focus-trap/modal patterns, label every icon button, keep
reduced-motion and the emoji gate.

---

## 7. Rollout

Each phase ships independently and leaves the app working.

### Phase A — Consent core (5–7 days)

- `Conversation` / `DirectMessage` models, service, state machine, indexes.
- Policy matrix (with `allowDirectMessages` migration), blocking/freeze/erasure integration.
- Request creation with quotas, content rules and context capture.
- Inbox / Requests / Archived API + one-to-one chat over REST + socket for accepted threads.
- Inbox UI, request card, thread view, basic settings matrix.
- Report + block from a request and a thread; admin queue read-only.
- Tests: policy matrix, quota, state machine, expiry, IDOR, block/freeze/erasure, e2e
  stranger → request → accept → message, decline/cooldown, expiry sweep.

**Exit criteria:** a stranger can send exactly one text-only request; the recipient's phone
does not buzz; accepting unlocks chat; declining blocks a retry for 90 days; blocking hides
both sides; an erased account leaves tombstones.

### Phase B — Creator scale (3–4 days)

- Filters (verified, business, creator, follower band, shared server, has link).
- Labels, quick replies, away mode, digest, quiet hours.
- Sender reputation v1 and the identical-text campaign detector.
- Hidden words and a real Filtered lane.
- Admin report resolution with audit and rate-limit telemetry.

**Exit criteria:** a creator can clear 50 requests in a few minutes with labels and quick
replies, and can pause the inbox without losing the account.

### Phase C — Business accounts (4–5 days)

- Business profile, disclosure label, upgrade/downgrade flow.
- Verification (domain email/DNS + manual review), badge, audit.
- Structured intent form, business inbox tools, analytics, complaint-rate throttle.
- Personal vs business folder separation.

**Exit criteria:** a business cannot cold-contact anyone without verification; a recipient
sees the label, the intent and the verified domain before accepting; personal threads are not
visible to a business team view.

### Phase D — Paid priority (3–5 days, optional)

- Provider selection (requires a service choice and compliance review), price setting,
  refunds on report/block, caps and disclosure.
- Attribution: "priority request" label, never "guaranteed reply".

### Phase E — Later

Group DMs (3–8 people), media in accepted threads, per-thread search, message export,
linked second profile. E2EE remains explicitly out.

---

## 8. Test plan

**Unit (pure functions, no database)**

- Policy matrix: every context × every policy × block/freeze/deleted/minor.
- Quota accounting: day/week/recipient/cooldown, timezone boundaries, clock injection.
- Request state machine: only recipient accepts, only active sends, idempotent accept.
- Content rules: length, links, media, control characters, normalisation.
- Business gates: unverified cannot cold-contact, badge never bypasses policy.
- Projection: no email, presence, status, follower ids or block reasons in a request card.

**E2E (throwaway database, real sockets)**

- Stranger request → recipient sees it in Requests, no notification push; accept → both send,
  socket delivers, unread increments.
- Decline → sender cannot retry; cooldown expires → retry allowed.
- Ignore → expiry sweep deletes; sender sees "expired", not "read".
- Block either side → both directions gone; unblock restores only search, not the thread.
- Freeze → cannot send/receive requests; unfreeze restores.
- Erasure → messages tombstoned, thread removed from the other side, export excludes the
  other party's data.
- Report → admin sees only the reported messages; resolution audited.
- Quota exhaustion → 429/403 with a generic code; a second account keeps working.
- IDOR → a non-participant gets 403 on every thread route and socket join.
- Business: unverified refused, verified accepted, structured intent rendered, complaint
  throttle pauses outreach.
- Minor (if implemented): no cold requests in either direction.
- Load: 40 concurrent request creations produce no duplicates (pairKey unique), inbox p95
  stays within budget, socket fan-out is per thread.

**UI**

- Browser pass at 360/768/1280 for inbox, requests, thread, business profile, settings.
- Keyboard-only accept/decline/report; focus trap in the report dialog; screen-reader labels
  on the unread count and the request card.
- No horizontal overflow; no emoji outside the reaction catalogue.

**Security review**

- Every route re-derives membership; no participant ids from the client.
- Request endpoint refuses with generic reasons and never confirms a block.
- No read receipts or presence before acceptance.
- Rate limits on REST and sockets; no content scanning of accepted threads.
- Export and erasure honour the other participant's privacy.

---

## 9. Metrics and guardrails

**Peace (the primary success metric)**

- Median and p95 inbound requests per creator per day.
- Push notifications per creator per day (target ≤ 3; digest counts as one).
- Report rate per 1,000 requests (target < 2; alert > 5).
- Block rate per 1,000 requests (target < 5).
- Share of creators who changed a policy from the default (a signal that defaults are wrong
  for a cohort, not necessarily a failure).

**Access**

- Request acceptance rate (target > 30% for context-rich requests).
- Median time to first response.
- Share of accepted threads with a reply within 48 hours.
- Business: acceptance rate, complaint rate (target < 2), verified response time.

**Product health**

- DM DAU/MAU, 7-day thread retention, unread backlog, "inbox abandoned" rate.
- Support tickets about unwanted contact.

**Guardrails**

- If the report rate for a cohort exceeds 5%, tighten that cohort's defaults (young
  accounts, unverified businesses) rather than waiting for a policy change.
- If acceptance falls below 15%, the gate is too strict or the context is too thin; fix the
  context before loosening the gate.
- If creators disable requests entirely, the public path (server, fan channel, business
  email) is failing; invest there instead of forcing DMs.

---

## 10. Risks and open decisions

| Risk | Mitigation |
|---|---|
| Over-restriction kills the social graph | Default to Request, not Nobody; community context; one-tap accept; clear "why" |
| The creator inbox becomes unpaid labour | Digest, labels, quick replies, away mode, paid priority, public alternatives |
| Business badge becomes a spam shield | Verification, structured intent, complaint-rate pause, consent unchanged |
| Paid messaging feels exploitative | Price set by the recipient, refund on report/block, no reply promise, capped |
| Moderation burden explodes | Report-only review, no proactive scanning, queue SLAs, campaign detection |
| Data-model sprawl | One Conversation per pair, one service, reuse the squad-chat patterns |
| Multi-instance sockets | Same limitation as existing chat; document it, revisit with the Redis adapter |
| Legal/privacy mistakes | No E2EE claim, export/erasure, disclosure, minors decision, access-logged review |

**Decisions needed before Phase A**

1. **Age policy:** 18+ declaration (fast) or age bracket + minor restrictions (safer).
2. **Community default:** should a member of a shared server land in Requests (recommended)
   or directly in the Inbox?
3. **Paid priority:** include it in the first release, or defer to Phase D?
4. **Business identity:** same handle + badge (recommended) or a separate handle/second
   profile?
5. **Media in accepted DMs:** v1 text-only (recommended) or images from day one?

**Deliberately out of scope**

- End-to-end encryption (do not claim it anywhere).
- Group DMs in v1.
- Media, voice notes and file attachments in v1.
- Bulk/broadcast DMs from creators (a spam vector; Patreon ties it to a paid relationship).
- Server-side content search or scanning of accepted conversations.
- Self-serve "verified" badges.
- A public trust score.
- An open inbox with no request gate.

---

## 11. Sources

- Instagram Teen Accounts (defaults, messaging restrictions):
  https://help.instagram.com/995996839195964 · https://about.instagram.com/blog/announcements/instagram-teen-accounts
- Instagram one-text-only-message limit and teen DM defaults:
  https://about.instagram.com/blog/announcements/new-parental-controls-and-teen-privacy-defaults
- Instagram Hidden Words and message-request filtering:
  https://help.instagram.com/700284123459336 · https://about.instagram.com/blog/announcements/introducing-new-tools-to-protect-our-community-from-abuse
- Instagram creator request sorting/filtering (Nov 2024):
  https://techcrunch.com/2024/11/01/instagram-upgrades-dms-with-focus-on-creators
- Instagram business protection tools (restrict, DM settings):
  https://help.instagram.com/320320152895514
- X Direct Messages (requests, quality filter, verified-only):
  https://help.twitter.com/en/using-x/direct-messages · https://help.x.com/en/using-twitter/direct-messages
- X DM FAQ (500/day, settings):
  https://help.x.com/en/using-x/direct-message-faqs
- X encrypted Chat and request limits:
  https://help.twitter.com/en/using-x/encrypted-direct-messages
- Signal spam handling (message requests, proof-of-humanity, anonymous report):
  https://signal.org/blog/keeping-spam-off-signal
- Bluesky Chat Requests:
  https://www.theverge.com/news/627296/bluesky-three-minute-videos-dm-filter
- VSCO messaging limits and controls:
  https://support.vsco.co/en/articles/12698602-staying-safe-with-messages
- WhatsApp business accounts and labels:
  https://faq.whatsapp.com/643460927283235
- WhatsApp business profile:
  https://faq.whatsapp.com/577829787429875
- WhatsApp Business app features (catalog, labels, quick replies, away, greeting):
  https://business.whatsapp.com/products/business-app-features
- WhatsApp messaging/template limits:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/whatsapp-business-accounts
- Telegram paid messages:
  https://core.telegram.org/api/paid-messages · https://telegram.org/tos/stars
- Patreon creator DMs require a payment relationship:
  https://support.patreon.com/hc/en-us/articles/115002832026
- Patreon bulk member messaging (per-member threads):
  https://support.patreon.com/hc/en-us/articles/203913429
- CHI 2022, creators and harassment:
  https://dl.acm.org/doi/fullHtml/10.1145/3491102.3501879
- ADL 2024, creator moderation burden:
  https://www.adl.org/resources/report/tools-against-harassment-empowering-content-creators
- LinkedIn unsolicited-message survey:
  https://www.socialmediatoday.com/news/new-survey-shows-that-linkedin-users-strongly-dislike-unsolicited-dms/619180
