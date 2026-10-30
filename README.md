# GamerHub

[![Live Demo](https://img.shields.io/badge/Demo-Live-black?style=flat-square&logo=vercel)](https://gamer-hub-alpha.vercel.app)
[![API](https://img.shields.io/badge/API-Render-46E3B7?style=flat-square&logo=render)](https://gamerhub-backend-3108.onrender.com/api/health)
[![Tests](https://img.shields.io/badge/Tests-45%2F45%20passing-brightgreen?style=flat-square)]()
[![License](https://img.shields.io/badge/License-MIT-silver?style=flat-square)](LICENSE)

GamerHub is a full-stack gaming social platform built on the MERN stack. It combines a social feed, Discord-style community channels, a looking-for-group board, a game catalog, gamification, and an admin observability dashboard — all served from a single Express API with real-time Socket.io transport.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Feature Set](#2-feature-set)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [Data Models](#5-data-models)
6. [API Reference](#6-api-reference)
7. [Real-Time Layer](#7-real-time-layer)
8. [Redis Architecture](#8-redis-architecture)
9. [Database Indexing & Migration Strategy](#9-database-indexing--migration-strategy)
10. [Security Model](#10-security-model)
11. [Caching Strategy](#11-caching-strategy)
12. [Local Development](#12-local-development)
13. [Deployment](#13-deployment)
14. [Environment Variables](#14-environment-variables)
15. [Testing](#15-testing)

---

## 1. System Architecture

```
                          ┌─────────────────────────────┐
                          │        Browser Client        │
                          │   React 18 + Vite + SPA     │
                          └────────────┬────────────────┘
                                       │
              ┌────────────────────────┼──────────────────────┐
              │ REST (HTTPS via        │                       │ WebSocket (WSS)
              │ Vercel Proxy)          │                       │ direct to Render
              ▼                        │                       ▼
┌─────────────────────────┐           │          ┌────────────────────────────┐
│     Express API (v4)    │           │          │     Socket.io Engine       │
│  Helmet · CORS · Mongo  │           │          │  JWT auth handshake        │
│  Sanitize · RateLimit   │           │          │  Room multiplex            │
│  Metrics middleware     │           │          │  Sliding-window flood cap  │
└────────────┬────────────┘           │          └────────────┬───────────────┘
             │                        │                       │
             │           Mongoose ORM │                       │
             └────────────────────────┴───────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────┐
                    │         MongoDB Atlas Cluster        │
                    │   gaming-hub database (9 collections)│
                    │   Compound indexes · TTL indexes     │
                    │   Weighted text search               │
                    └────────────────────────────────────┘
```

### Workload domains

Database access is split into four workload domains, each with its own
migration track and pool ceiling: identity/auth (pool 10), social/feed (15),
communities (20) and squads/temporary chat (20).

The squad-chat domain runs on a **separate driver connection**
(`server/config/connections.js`, optional `MONGO_URI_SQUADS`), so a burst of
temporary-chat writes can never exhaust the connections auth and feed queries
need. The other three share the default connection on purpose: Mongoose
`populate()` only resolves models registered on the same connection, and
identity is populated from posts, members and party leaders everywhere —
splitting those pools would trade a real outage risk for a theoretical one.
`GET /api/health` reports each domain's readiness.

### Request Flow (REST)

```
Browser
  │
  │  HTTPS POST /api/posts/:id/like
  ▼
Vercel Edge (proxy rewrites /api → Render backend)
  │
  ▼
Express app.js
  ├── Helmet (security headers)
  ├── CORS (exact origin allow-list)
  ├── mongoSanitize (NoSQL injection strip)
  ├── express-rate-limit (1 000 req / 5 min global; stricter on auth routes)
  ├── metricsMiddleware (p50/p95 latency counters, no PII)
  └── postRoutes → toggleLike controller
        ├── verifyToken middleware (HttpOnly cookie JWT)
        ├── likeBuffer.bufferLikeEvent() → memory hash (Redis when enabled)
        └── res.json({ likeCount, liked })
```

---

## 2. Feature Set

### Social Feed
- Create posts with title, rich text body, hashtag channels, and optional image/video (Cloudinary)
- Four feed modes: Latest, Most Liked, Following, and For You (personalized ranking)
- Weighted tag-boosting: posts matching a user's favourite channels surface higher
- Like toggle, bookmark/save, comment threads with nested rendering
- Automatic link-preview scraping on post creation (SSRF-hardened)
- 5-minute edit window after posting; hard delete cascades to Cloudinary and comments

### Community Channels
- Discord-style communities: create, join, leave, invite
- Per-community role hierarchy: owner → admin → moderator → member
- Text, announcement and forum channels with real-time Socket.io messaging
- Forum channels: titled threads with tags, replies and open / answered / locked / archived status
- Message reactions from a server-side allowlist (short codes, never client markup)
- Reply quoting with a preview captured at send time, scoped to the same channel
- `@username` mentions resolved against real members, capped at five per message;
  `@everyone` requires the moderator capability and is otherwise not broadcast
- Image attachments: 8 MB cap, magic-byte validation, EXIF stripped, signed short-lived read URLs
- Pinned messages plus permission-scoped search that can never return a channel you cannot read
- Slowmode per channel (configurable message interval), role gates, retention windows
- Moderation: report queue, timed send suspension, bans that survive leaving and re-invites,
  and personal mutes that only hide content from the muting user
- Content protection flags (restrict copy, restrict media)
- GDPR tombstone deletes: message body replaced with `[deleted]`, metadata kept
- Full audit log: every moderation action recorded with actor, timestamp, and target

### Gamer Passport
- Per-user identity card: platform game IDs (Riot, Steam, PSN, Xbox, Discord)
- Active games list with platform and rank/level
- Multi-rig hardware showcase (CPU, GPU, RAM, monitor, peripherals)
- Export to `.txt`; duplicate rig detection; WebGL DPI auto-detection

### Looking for Group (LFG)
- Create a squad: game title, activity, mic requirement, slot count (2–6)
- Auto-TTL: squads expire and are hard-deleted from the database after 6 hours
- Board filtered by game, mic requirement, and open slots
- Join request → notification to squad leader → accept/decline flow
- Squad lifecycle: recruiting → locked → active → completed / cancelled; the last
  accepted request locks the squad automatically
- **Temporary squad chat**: locking opens a private, 15-day thread. Expiry is
  enforced on every read and write (not only by the sweep), the leader can roll
  it forward by another 15 days, and leaving or closing the squad evicts the
  member's live socket immediately
- Members can leave a squad; the leader must close it instead
- Squad → server migration issues one invitation per member — nobody is ever
  enrolled silently

### Identity & Consent
- Email/password accounts plus optional Google Sign-In (OpenID Connect via
  `google-auth-library`; the ID token's signature, issuer and audience are
  verified server-side, and an existing local account is never merged by email)
- Session version on every JWT: "sign out everywhere" and account deletion
  revoke every cookie already in the wild, with no session table
- Account states: active, restricted, suspended, deletion_pending, deleted
- Privacy settings per user: who may invite to squads, who may invite to
  servers, who may message, search discoverability, activity visibility
- Formal invitation ledger (`pending → accepted | declined | expired | revoked`)
  with a 7-day TTL, duplicate-pending protection and per-inviter rate limiting
- Two-way blocking: hidden from each other's search, invitations and follow
  graph; the reason is never disclosed to the blocked party

### Privacy & Data Rights
- Self-service JSON export of the caller's own profile, posts, comments,
  communities, squads, chat messages, invitations and notifications
- Account deletion with a 30-day grace period, cancellable by signing back in;
  the retention worker then anonymises the account and removes its content
- Personal mutes (client-side hiding) remain separate from moderation bans

### Gamification
- XP awarded for: posting, media posts, receiving likes, milestones
- Level calculated from cumulative XP with a visible progress bar
- Medal badges for achievements (viral_gamer, highlight_poster, etc.)
- Viral milestone: 10 likes on a single post awards XP to the author once

### Game Catalog
- Backed by FreeToGame public API (500 k+ free-to-play titles, no key required)
- Server-side search, genre filtering, platform filtering
- Cached in-process for 10 minutes; cache survives concurrent request bursts

### YouTube Gaming Bot
- Queries YouTube Data API v3 for new videos matching a user's favourite games
- Converts results into notifications (deduplication via idempotency key)
- API key is backend-only; never returned by any endpoint or bundled into the client
- Results cached 30 minutes per query to stay inside the daily quota

### Notifications
- Four types: `social`, `lfg_request`, `lfg_accepted`, `gaming_bot`
- Unread badge count driven by a compound index on `(userId, read, createdAt)`
- Action URL validation: only internal routes or `https://` links accepted

### Admin Dashboard
- Live metrics: request count, p50/p95 latency, error rate, uptime
- Collection document counts across all nine collections
- Recent audit log entries
- Service status panel: Cloudinary, YouTube, cache backend, Redis state

### UI Design System
- Obsidian base canvas with Cyber Silver typography
- Smoked glass card surfaces (backdrop-filter blur)
- Page-specific atmospheric accents via `data-atmosphere` on `<body>` (frost, amber, emerald, ruby)
- Cursor spotlight effect (RAF-based, no React re-renders, disabled on touch devices)
- Segmented sliding pill tabs replacing static button groups
- All animations use only `transform` and `opacity` (GPU compositor path)
- `@media (prefers-reduced-motion)` respected throughout

---

## 3. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend runtime | React 18 | Concurrent mode, SPA |
| Frontend build | Vite 5 | HMR, ES module output |
| Routing | React Router v6 | Client-side SPA routing |
| HTTP client | Axios | Interceptors, cookie jar |
| WebSocket client | socket.io-client 4 | Auto-reconnect |
| Backend runtime | Node.js / Express 4 | CommonJS modules |
| WebSocket server | Socket.io 4 | Room multiplexing |
| Database | MongoDB Atlas | M0 free cluster |
| ODM | Mongoose 8 | Schema + indexes |
| Authentication | JWT + HttpOnly cookies | bcrypt password hashing, session-version revocation |
| Federated sign-in | google-auth-library | OpenID Connect ID-token verification |
| Temporary chat store | Dedicated Mongo connection | Isolated pool for the squads domain |
| Media storage | Cloudinary | Images and videos |
| Security headers | Helmet 7 | Full CSP suite |
| Input sanitization | express-mongo-sanitize | NoSQL injection strip |
| Rate limiting | express-rate-limit 7 | REST; custom sliding window for sockets |
| Schema migrations | migrate-mongo 14 | Tracks applied scripts in `changelog` collection |
| Cache (in-process) | Custom LRU/TTL (cache.js) | Miss collapsing, O(1) eviction |
| Cache (external) | Redis / Upstash | Implemented, currently set to memory-only mode |
| Media CDN | Cloudinary CDN | Automatic format negotiation |
| Frontend hosting | Vercel | Edge CDN, `/api` proxy rewrite |
| Backend hosting | Render | Always-on web service |

---

## 4. Repository Structure

```
MERN_INTERNSHIP_Proj/
│
├── client/                         # Vite React application
│   ├── src/
│   │   ├── api/
│   │   │   ├── axiosInstance.js    # Base URL, credential flag, error interceptor
│   │   │   └── socket.js           # socket.io-client singleton
│   │   ├── components/
│   │   │   ├── auth/               # LoginForm, RegisterForm
│   │   │   ├── comments/           # CommentForm, CommentThread
│   │   │   ├── common/             # Navbar, NotificationBell, PresencePill,
│   │   │   │                       # FloatingToolbar, SegmentedTabs, icons
│   │   │   ├── communities/        # CreateChannelModal, RoleManagerModal,
│   │   │   │                       # ChannelSettingsModal, CommunitySettingsModal,
│   │   │   │                       # AuditLogModal, MessageInput, CreateCommunityModal
│   │   │   ├── lfg/                # CreatePartyModal
│   │   │   ├── posts/              # PostCard, PostForm, PostList, PostActions,
│   │   │   │                       # ClipCard, LinkPreviewCard
│   │   │   ├── profile/            # GamerPassportCard, EditPassportModal,
│   │   │   │                       # PreferencesModal
│   │   │   └── search/             # SearchModal
│   │   ├── context/
│   │   │   └── AuthContext.jsx     # Global auth state, login/logout helpers
│   │   ├── hooks/
│   │   │   └── useCursorGlow.js    # RAF-based cursor spotlight, pointer:coarse guard
│   │   ├── pages/
│   │   │   ├── Feed.jsx            # Main social feed with sort tabs
│   │   │   ├── PostDetail.jsx      # Single post + comment thread
│   │   │   ├── ProfilePage.jsx     # User profile, Gamer Passport, posts
│   │   │   ├── CommunitiesHome.jsx # Community browser/search
│   │   │   ├── CommunityPage.jsx   # Community with channel sidebar
│   │   │   ├── ChannelPage.jsx     # Real-time text channel
│   │   │   ├── LfgPage.jsx         # Looking-for-group board
│   │   │   ├── GameCatalog.jsx     # FreeToGame-backed game browser
│   │   │   ├── AdminDashboard.jsx  # Metrics + audit log + service status
│   │   │   ├── Login.jsx
│   │   │   └── Register.jsx
│   │   ├── utils/
│   │   │   ├── deviceDetector.js   # WebGL DPI detection for Gamer Passport
│   │   │   └── permissions.js      # Client-side capability checks (mirrors server)
│   │   ├── App.jsx                 # Router, route guards, atmosphere data-attr
│   │   ├── index.css               # CSS custom properties, color tokens
│   │   ├── theme.css               # Full Obsidian/Cyber Silver design system
│   │   └── phase4.css              # Phase 4 component overrides
│   ├── vercel.json                 # /api proxy rewrite to Render backend
│   └── vite.config.js
│
├── server/
│   ├── app.js                      # Express app: middleware chain, all routes
│   ├── server.js                   # HTTP server bootstrap, graceful shutdown
│   ├── config/
│   │   ├── db.js                   # Mongoose connection, pool settings
│   │   ├── redis.js                # Redis client stub (disabled; see §8)
│   │   ├── socket.js               # Socket.io init, JWT handshake, room logic
│   │   └── chatPolicy.js           # Message length, slowmode constants
│   ├── models/
│   │   ├── User.js                 # Auth, profile, passport, gamification, presence
│   │   ├── Post.js                 # Feed posts, text index, like array
│   │   ├── Comment.js              # Threaded comments keyed to posts
│   │   ├── Community.js            # Community metadata, member sub-docs, roles
│   │   ├── Channel.js              # Text channels belonging to a community
│   │   ├── Message.js              # Community channel messages (cursor-paginated)
│   │   ├── AuditLog.js             # Immutable moderation audit records
│   │   ├── Notification.js         # User notifications with dedup key
│   │   └── Party.js                # LFG squads with TTL auto-expiry
│   ├── controllers/
│   │   ├── authController.js       # Register, login, logout, /me
│   │   ├── postController.js       # CRUD, toggleLike (buffered), feed aggregation
│   │   ├── commentController.js    # Comment CRUD with ownership check
│   │   ├── userController.js       # Profile, follow, search, passport, presence
│   │   ├── communityController.js  # Community CRUD, membership, role management
│   │   ├── lfgController.js        # Party CRUD, join/leave, board query
│   │   ├── notificationController.js # Fetch, mark read, clear
│   │   ├── gameController.js       # FreeToGame catalog proxy, search, detail
│   │   ├── adminController.js      # Metrics snapshot, audit feed, user management
│   │   └── botController.js        # YouTube sync trigger, status
│   ├── routes/                     # One file per controller; thin route + middleware wiring
│   ├── middleware/
│   │   ├── verifyToken.js          # JWT from HttpOnly cookie
│   │   ├── optionalAuth.js         # Same but does not reject unauthenticated
│   │   ├── requireRole.js          # Global RBAC guard (user / moderator / admin)
│   │   ├── checkOwnership.js       # Resource-level ownership middleware
│   │   └── errorHandler.js         # Central error → JSON response
│   ├── utils/
│   │   ├── cache.js                # In-process LRU/TTL cache with miss collapsing
│   │   ├── redisCache.js           # Two-tier cache: memory L1 + Redis L2
│   │   ├── likeBuffer.js           # Redis hash buffer for like writes + flush worker
│   │   ├── feedRanking.js          # Personalized feed scorer (engagement + recency)
│   │   ├── gamification.js         # XP award, level calculation, medal grant
│   │   ├── gameCatalog.js          # FreeToGame fetch, normalise, cache, search
│   │   ├── youtubeBot.js           # YouTube Data API fetch, notify, dedup
│   │   ├── safeFetch.js            # SSRF-hardened outbound HTTP (DNS + IP checks)
│   │   ├── sanitize.js             # Input sanitizers: line, text, tags, regex escape
│   │   ├── permissions.js          # Community role hierarchy + capability map
│   │   ├── rateLimiter.js          # Sliding-window + event-tracker for sockets
│   │   ├── pagination.js           # Cursor and skip/limit helpers
│   │   ├── metrics.js              # p50/p95 latency ring-buffer, error counter
│   │   ├── notify.js               # Notification creation with dedup guard
│   │   ├── audit.js                # Audit log write helper
│   │   ├── presence.js             # Presence broadcast helpers
│   │   ├── outbound.js             # Hardened JSON fetch (used by bot and catalog)
│   │   ├── httpError.js            # badRequest / forbidden / notFound factories
│   │   ├── origins.js              # Exact CORS allow-list (no wildcards)
│   │   ├── partyRules.js           # LFG join/leave/board business rules
│   │   ├── scrapePreview.js        # Open Graph scraper for link previews
│   │   └── generateToken.js        # JWT sign + set HttpOnly cookie
│   ├── jobs/
│   │   └── retention.js            # Periodic cleanup worker (stale data)
│   └── tests/                      # 45 unit tests (Node native test runner)
│       ├── permissions.test.js
│       ├── sanitize.test.js
│       ├── ssrf.test.js
│       ├── origins.test.js
│       ├── lfg.test.js
│       ├── feedRanking.test.js
│       ├── cache.test.js
│       └── botSecurity.test.js
│
├── migrations/                     # migrate-mongo scripts (tracked in `changelog` collection)
│   ├── 20261025090000-add-compound-indexes.js
│   └── 20261025091000-denormalize-post-like-count.js
│
├── scripts/
│   ├── e2e.js                      # Phase 1–3 end-to-end smoke tests
│   ├── e2e-phase4.js               # Phase 4 full feature smoke tests (66 checks)
│   └── seed-demo-data.js           # Demo data: community, LFG squads, notifications
│
├── migrate-mongo-config.js         # Migration runner config; parses DB name from URI
├── package.json                    # Server dependencies + npm scripts
└── .env                            # Local secrets (never committed)
```

---

## 5. Data Models

### Relationships

```
User ──────────────────────────────────────────────────────────────┐
 │                                                                  │
 ├── follows ──────────────────────────────────────── User         │
 ├── savedPosts ────────────────────────────────────── Post        │
 │                                                                  │
Post ──────────── likes[] ──── User                                │
 └──────────────── Comment[] ──── User                             │
                                                                    │
Community ──── Channel[] ──── Message[] ──── User                  │
    │                                                               │
    └── AuditLog[] ──── User (actor)                               │
                                                                    │
Party (LFG) ──── members[] ──── User                               │
                                                                    │
Notification ──── User (recipient) ─────────────────────────────── ┘
```

### User

| Field | Type | Notes |
|---|---|---|
| `username` | String | Unique, 3–20 chars, alphanumeric + underscore |
| `email` | String | Unique, lowercase |
| `passwordHash` | String | bcrypt, never returned by any endpoint |
| `role` | Enum | `user` / `moderator` / `admin` |
| `xp` / `level` | Number | Gamification; level derived from cumulative XP |
| `medals[]` | Array | Achievement badges with earned timestamp |
| `followers` / `following` | ObjectId[] | Mutual follow graph |
| `savedPosts` | ObjectId[] | Bookmarked post references |
| `favoriteChannels` | String[] | Hashtag channels boosted in feed ranking |
| `gamerPassport` | Object | Game IDs, active games, hardware rigs |
| `preferences` | Object | Favorite games, genres, platforms (drives bot + feed) |
| `presence` | Object | `status`, `activeGame`, `lastActive` |
| `profileType` | Enum | `personal` / `creator_business` |
| `status` | Enum | `active` / `restricted` / `suspended` / `deletion_pending` / `deleted` |
| `sessionVersion` | Number | Bumped to revoke every issued cookie |
| `authIdentities[]` | Array | `{ provider, providerSubject, emailVerified }` — never exposed publicly |
| `privacySettings` | Object | Invite/DM policies, search discoverability, activity visibility |
| `blockedUsers` | ObjectId[] | Two-way enforcement in search and invitations |
| `deletionRequestedAt` | Date | Start of the 30-day erasure grace period |

### Post

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | Author reference |
| `title` / `content` | String | 150 / 10 000 char limits |
| `tags[]` | String[] | Hashtag channels; normalised to lowercase |
| `likes[]` | ObjectId[] | Like array; `likeCount` denormalised field |
| `commentCount` | Number | Maintained on comment create/delete |
| `mediaUrl` / `mediaType` | String | Cloudinary URL; `image` / `video` / `none` |
| `linkPreview` | Object | Open Graph metadata scraped server-side |

**Indexes:**
- `{ userId: 1, createdAt: -1 }` — profile feed
- `{ createdAt: -1 }` — global latest feed
- `{ tags: 1 }` — hashtag channel filter
- `{ title: text, content: text, tags: text }` — weighted text search (title×10, tags×5, content×1)
- `{ likeCount: -1, createdAt: -1 }` — hot posts sort

### Community / Channel / Message

```
Community
  name, slug, description, icon, banner
  ownerId ──► User
  members[]
    └── { userId, role: owner|admin|moderator|member, joinedAt }
  contentProtection: { restrictCopy, restrictMedia }
  isPrivate

  └── Channel[]
        name, topic, type, slowmodeSeconds
        permissions: { readRoles[], writeRoles[] }

        └── Message[]
              authorId ──► User
              content (tombstoned on GDPR delete)
              communityId, channelId
              INDEX: { channelId, createdAt } ← cursor pagination
```

### Party (LFG)

| Field | Notes |
|---|---|
| `gameTitle`, `gameThumbnail`, `activity` | Squad description |
| `leaderId` | Squad creator |
| `members[]` | Joined users with join timestamp |
| `maxSlots` | 2–6 |
| `status` | `open` / `full` / `closed` (board visibility) |
| `state` | `recruiting` / `locked` / `active` / `completed` / `cancelled` (lifecycle) |
| `chatId` | The temporary `SquadChat` created when the squad locks |
| `lockedAt`, `completedAt` | Lifecycle timestamps |
| `expiresAt` | TTL index; MongoDB hard-deletes the document at this time |
| `requirements.micRequired` | Filter on LFG board |

### SquadChat / SquadChatMessage (temporary)

| Field | Notes |
|---|---|
| `squadId` | Unique — exactly one chat per squad |
| `ownerUserId`, `ownerUsername` | Leader; only the owner may refresh |
| `memberIds[]` | Participants; eviction removes the id and the live socket |
| `state` | `active` / `expired` / `closed` |
| `expiresAt` | 15 days from creation or the last refresh |
| `refreshCount`, `lifecycleVersion` | Rolling-extension bookkeeping |
| `purgedAt` | Set when the retention sweep reclaimed the messages |

Messages store `authorUserId` **and** a username/level snapshot, because the
collection lives on its own connection and must not depend on a cross-connection
populate.

### Invitation

| Field | Notes |
|---|---|
| `inviterUserId`, `inviterUsername` | Who asked |
| `recipientUserId` | Who must answer |
| `targetType`, `targetId`, `targetName` | `squad` or `community_server` |
| `status` | `pending` / `accepted` / `declined` / `expired` / `revoked` |
| `expiresAt` | 7-day TTL, checked on every read |

One live invitation per recipient + target (partial unique index on `pending`).

### Notification

| Field | Notes |
|---|---|
| `userId` | Recipient |
| `type` | `social` / `lfg_request` / `lfg_accepted` / `gaming_bot` |
| `title`, `message`, `thumbnail` | Display content |
| `actionUrl` | Validated: internal route or `https://` only |
| `dedupeKey` | Partial unique index prevents bot duplicate pings |
| `read` | Boolean; compound index `{ userId, read, createdAt }` |

---

## 6. API Reference

All routes are prefixed with `/api`. Authentication is via HttpOnly JWT cookie.

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create account |
| POST | `/auth/login` | — | Login, set cookie |
| GET | `/auth/providers` | — | Public sign-in config (Google enabled + client id) |
| POST | `/auth/google` | — | Exchange a Google ID token for a session |
| POST | `/auth/logout` | Required | Clear cookie |
| POST | `/auth/logout-all` | Required | Bump session version; revoke every device |
| GET | `/auth/me` | Required | Current user profile |

### Posts

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/posts` | Optional | Feed (supports `?sort=`, `?feed=`, `?channel=`) |
| POST | `/posts` | Required | Create post (multipart/form-data) |
| GET | `/posts/:id` | Optional | Single post |
| PUT | `/posts/:id` | Owner | Update post (5-min window) |
| DELETE | `/posts/:id` | Owner/Moderator | Delete post |
| POST | `/posts/:id/like` | Required | Toggle like |
| GET | `/posts/tags/suggest?q=` | Optional | Tag autocomplete |
| GET | `/posts/preview?url=` | Required | Link preview fetch |

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/users/:username` | Public profile |
| PUT | `/users/profile` | Update bio, platforms |
| POST | `/users/:id/follow` | Follow / unfollow toggle |
| GET | `/users/search?q=` | Username prefix search |
| PUT | `/users/passport` | Update Gamer Passport |
| PUT | `/users/preferences` | Update game/genre preferences |
| PUT | `/users/presence` | Set online status |
| POST | `/users/:id/mute` | Toggle a personal mute (hides their content from you) |
| GET | `/users/me/muted` | Your muted users |
| PATCH | `/users/privacy-settings` | Invite/DM/visibility consent settings |

### Communities

| Method | Path | Description |
|---|---|---|
| GET | `/communities` | Browse communities |
| POST | `/communities` | Create community |
| GET | `/communities/:slug` | Community detail + channels |
| POST | `/communities/:id/join` | Join community |
| POST | `/communities/:id/leave` | Leave community |
| GET | `/communities/:id/members` | Member list (members only) |
| POST | `/communities/:id/members` | Add a member by username (admin+) |
| PATCH | `/communities/:id/members/:userId/role` | Set member role (admin+) |
| DELETE | `/communities/:id/members/:userId` | Kick member (admin+) |
| GET | `/communities/:id/audit` | Audit log (admin+) |
| POST | `/communities/:id/channels` | Create channel — `text`, `announcement` or `forum` (admin+) |
| PATCH | `/communities/:id/channels/:channelId` | Channel gates, slowmode, retention, forum config |
| DELETE | `/communities/:id/channels/:channelId` | Delete channel + its content (admin+) |
| GET | `/communities/channels/:channelId/messages` | Paginated message history (cursor) |
| POST | `/communities/channels/:channelId/messages/:messageId/react` | Toggle a reaction |
| POST | `/communities/channels/:channelId/messages/:messageId/pin` | Pin a message (moderator+) |
| DELETE | `/communities/channels/:channelId/messages/:messageId/pin` | Unpin a message (moderator+) |
| GET | `/communities/channels/:channelId/pins` | Pinned message tray |
| POST | `/communities/channels/:channelId/attachments` | Upload an image (multipart `file`) |
| GET | `/communities/channels/:channelId/attachments/:attachmentId` | Signed, expiring read URL |
| DELETE | `/communities/channels/:channelId/attachments/:attachmentId` | Delete an upload (uploader or moderator) |
| GET | `/communities/:id/search` | Search messages + forum threads in readable channels |
| GET | `/communities/:id/channels/:channelId/forum` | List forum threads |
| POST | `/communities/:id/channels/:channelId/forum` | Create a thread |
| GET | `/communities/:id/channels/:channelId/forum/:postId` | Thread + paginated replies |
| PUT | `/communities/:id/channels/:channelId/forum/:postId` | Edit a thread (author, 30 min) |
| DELETE | `/communities/:id/channels/:channelId/forum/:postId` | Delete a thread (author or moderator) |
| PATCH | `/communities/:id/channels/:channelId/forum/:postId/status` | Lock / archive / reopen (moderator+) |
| POST | `/communities/:id/channels/:channelId/forum/:postId/replies` | Reply to a thread |
| PUT | `/communities/:id/channels/:channelId/forum/:postId/replies/:replyId` | Edit a reply (author, 30 min) |
| DELETE | `/communities/:id/channels/:channelId/forum/:postId/replies/:replyId` | Delete a reply |
| POST | `/communities/:id/reports` | Report a message, thread or member |
| GET | `/communities/:id/reports` | Report queue (moderator+) |
| PATCH | `/communities/:id/reports/:reportId` | Mark reviewed / dismissed (moderator+) |
| POST | `/communities/:id/members/:userId/timeout` | Timed send suspension (moderator+) |
| DELETE | `/communities/:id/members/:userId/timeout` | Lift a timeout (moderator+) |
| GET | `/communities/:id/bans` | Ban list (admin+) |
| POST | `/communities/:id/bans/:userId` | Ban a member (admin+) |
| DELETE | `/communities/:id/bans/:userId` | Lift a ban (admin+) |

### LFG

| Method | Path | Description |
|---|---|---|
| GET | `/lfg` | Squad board (filterable) |
| GET | `/lfg/mine` | Squads you lead or play in, with chat summary |
| POST | `/lfg` | Create squad |
| GET | `/lfg/:id` | One squad |
| POST | `/lfg/:id/request` | Request to join |
| PATCH | `/lfg/:id/respond` | Leader accepts or declines a request |
| POST | `/lfg/:id/lock` | Stop recruiting and open the temporary chat |
| POST | `/lfg/:id/unlock` | Resume recruiting (chat stays) |
| POST | `/lfg/:id/leave` | Leave a squad (members) |
| POST | `/lfg/:id/server-migration` | Invite every member to a server (leader) |
| DELETE | `/lfg/:id` | Close squad (leader); closes the chat |

### Invitations

| Method | Path | Description |
|---|---|---|
| POST | `/invitations` | Invite a player to a squad or server (consent-checked) |
| GET | `/invitations/inbox` | Your pending invitations |
| GET | `/invitations/sent` | Invitations you sent, any state |
| POST | `/invitations/:id/accept` | Accept (the only way membership is granted) |
| POST | `/invitations/:id/decline` | Decline |
| POST | `/invitations/:id/revoke` | Inviter withdraws a pending invitation |

### Squad Chats (temporary)

| Method | Path | Description |
|---|---|---|
| GET | `/squad-chats/:chatId` | Chat metadata, expiry countdown, refresh rights |
| GET | `/squad-chats/:chatId/messages` | Cursor-paginated history (`?before=`) |
| POST | `/squad-chats/:chatId/messages` | Send a message (expiry enforced) |
| POST | `/squad-chats/:chatId/refresh` | Leader: roll expiry forward 15 days |
| DELETE | `/squad-chats/:chatId/messages/:messageId` | Author or leader deletes |

### Account & Data Rights

| Method | Path | Description |
|---|---|---|
| GET | `/account` | Account state, privacy settings, blocked list |
| GET | `/account/blocked` | Players you have blocked |
| POST | `/account/block/:userId` | Block (also drops follow edges both ways) |
| DELETE | `/account/block/:userId` | Unblock |
| GET | `/account/data-export` | Download your data as JSON (rate limited) |
| POST | `/account/deletion-request` | Schedule erasure, revoke sessions and sockets |
| POST | `/account/deletion-cancel` | Cancel inside the 30-day grace period |

### Games, Notifications, Bot, Admin

| Method | Path | Description |
|---|---|---|
| GET | `/games` | Game catalog (search, genre, platform) |
| GET | `/games/:id` | Game detail |
| GET | `/notifications` | User notification list |
| POST | `/notifications/read/:id` | Mark read |
| POST | `/notifications/read-all` | Mark all read |
| POST | `/bot/sync` | Trigger YouTube sync (admin) |
| GET | `/bot/status` | Bot health and last sync |
| GET | `/admin/metrics` | Dashboard metrics snapshot (admin) |
| GET | `/admin/users` | User list with roles (admin) |
| PUT | `/admin/users/:id/role` | Change global role (admin) |
| GET | `/api/health` | Readiness: uptime + per-domain connection state (200 / 503) |

---

## 7. Real-Time Layer

```
Client                              Socket.io Server
  │                                        │
  │── connect (send JWT cookie) ──────────►│
  │                                        │ verify JWT
  │                                        │ attach user to socket
  │◄─────────────────── connected ─────────│
  │                                        │
  │── join_community { communityId } ─────►│
  │                                        │ verify membership
  │                                        │ socket.join("community:X")
  │                                        │ for each channel: socket.join("channel:Y")
  │◄───────────────── joined_community ────│
  │                                        │
  │── send_message { channelId, content }─►│
  │                                        │ sliding-window rate limit (userId key)
  │                                        │ slowmode check (per channel, per user)
  │                                        │ sanitize + persist Message doc
  │                                        │ recordAudit (if applicable)
  │                                        │ io.to("channel:Y").emit("new_message", ...)
  │◄───────────── new_message (broadcast) ─│
  │                                        │
  │── leave_community { communityId } ─────►│
  │                                        │ socket.leave all rooms for this community
  │◄─────────────────── left_community ────│
```

Socket events:

| Event (client → server) | Description |
|---|---|
| `join_community` | Authenticates and subscribes to all channels |
| `leave_community` | Unsubscribes from all community rooms |
| `send_message` | Rate-checked, slowmode-checked, persisted and broadcast |
| `join_squad_chat` | Membership + expiry checked, then joins the `squad:<id>` room |
| `send_squad_message` | Separate flood budget; expiry re-checked on every send |
| `leave_squad_chat` | Leaves the squad room |
| `typing_start` / `typing_stop` | Typing indicator relay |
| `update_presence` | Status change broadcast to followers |

| Event (server → client) | Description |
|---|---|
| `new_message` | Message broadcast to channel room |
| `message_deleted` | Tombstone notification |
| `member_joined` / `member_left` | Community membership changes |
| `role_updated` | Member role change |
| `presence_update` | User status change for followers |
| `squad_message` / `squad_message_deleted` | Temporary squad chat traffic |
| `squad_chat_refreshed` | Leader extended the 15-day window |
| `squad_chat_expired` / `squad_chat_closed` | Chat ended; the drawer closes |
| `squad_chat_evicted` | You are no longer a participant |

---

## 8. Redis Architecture

Redis is **fully implemented** in the codebase but switched **off by default**: the Upstash free tier has a daily command quota, and an idle instance should not spend it. The client is always present; `server/config/redis.js` is a feature switch over `server/config/redisClient.js`, so enabling Redis is an environment change — no code edits, no file restores.

With the switch off, every caller degrades to its in-process path: likes write straight to MongoDB, and the cache is memory-only (lost on restart). Nothing is lost except cross-restart durability.

### Design

```
                          ┌──────────────────────────────────────┐
                          │          Redis (Upstash)             │
                          │   HTTP REST — no persistent TCP      │
                          │                                      │
                          │  Hash: gamerhub:likebuf              │
                          │    "<postId>:<userId>" → like|unlike │
                          │                                      │
                          │  Set:  gamerhub:viral:10             │
                          │    postIds already awarded XP medal  │
                          │                                      │
                          │  String keys (cache):                │
                          │    gamerhub:<cacheKey> → JSON        │
                          └───────────┬──────────────────────────┘
                                      │ HTTP REST (Upstash SDK)
              ┌───────────────────────┼───────────────────────────┐
              │                       │                           │
              ▼                       ▼                           ▼
   likeBuffer.js              redisCache.js                 (future)
   Like event queue           Two-tier cache                Socket.io
   Flush worker               L1: in-process LRU            Redis adapter
   Batch bulkWrite            L2: Redis                     (multi-instance)
```

### Like Write Buffer

Every like toggle under a viral post previously cost two MongoDB round-trips (`exists + findByIdAndUpdate`). The Redis layer collapses concurrent toggles:

```
Client clicks Like
      │
      ▼
toggleLike controller
      │
      ├── POST.exists({ _id, likes: userId })   ← 1 indexed read
      │
      ├── bufferLikeEvent(postId, userId, action)
      │     └── HSET gamerhub:likebuf  "<postId>:<userId>" "like"
      │         (last-write-wins: like → unlike → like collapses to "like")
      │
      └── res.json({ likeCount: optimistic, liked: true })

Flush Worker (every 5s active / 60s idle)
      │
      ├── HGETALL gamerhub:likebuf        ← one Redis round-trip
      ├── Group by postId
      ├── Post.bulkWrite([ updateOne... ]) ← one MongoDB round-trip per batch
      │     pipeline stages:
      │       $set likes = $setUnion / $setDifference
      │       $set likeCount = $size likes
      └── HDEL processed fields
```

Adaptive backoff: the flush interval expands from 5 s to 60 s when the buffer is empty (idle cost drops from ~17 k to ~1.4 k Redis commands per day).

### Two-Tier Cache

```
Request for cached resource (game catalog, YouTube results, admin metrics)
      │
      ▼
redisCache.cacheWrap(key, loader, ttlSeconds)
      │
      ├── Check L1 (in-process Map, zero network cost)
      │     hit ──► return immediately
      │
      ├── Check L2 (Redis GET)
      │     hit ──► populate L1, return
      │     error ──► degrade to memory-only for 30 s
      │
      └── Miss: call loader()
            ├── cacheSet (L1 + L2 in parallel)
            └── return value

Miss collapsing: concurrent requests for the same key share one in-flight Promise.
```

### Enabling Redis

```bash
# 1. Create a free database at console.upstash.com (HTTP REST type)
# 2. In .env and the Render dashboard, set:
REDIS_ENABLED=1
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
# 3. Restart the server (npm install already includes @upstash/redis)
```

No code changes anywhere else — all callers check `getRedis() === null` and fall through to memory automatically. `DISABLE_LIKE_BUFFER=1` keeps buffering off even when Redis is on (useful for debugging a single write path).

---

## 9. Database Indexing & Migration Strategy

### Migration Runner

`migrate-mongo` (not Prisma) is used because MongoDB is schemaless — Prisma has no migration DDL for it. `migrate-mongo` tracks applied scripts in a `changelog` collection and supports rollback.

```bash
npm run migrate:status     # show applied / pending migrations (original track)
npm run migrate:up         # apply all pending migrations (original track)
npm run migrate:down       # roll back the last migration
npm run migrate:create     # scaffold a new migration file
```

### Domain-isolated tracks

Each workload domain migrates independently — its own folder, `changelog_<domain>`
collection and lock — so a failure or lock in one track cannot block another.
See [migrations/README.md](migrations/README.md).

| Track | Folder | Command |
|---|---|---|
| Identity & auth | `migrations/auth/` | `npm run migrate:auth` |
| Social & feed | `migrations/feed/` | `npm run migrate:feed` |
| Communities | `migrations/communities/` | `npm run migrate:communities` |
| Squads & chat | `migrations/squads/` | `npm run migrate:squads` |

`npm run migrate:domains` runs all four in order; `npm run migrate:domains:status`
reports each. The original `migrations/` track is left untouched so its applied
history stays valid.

### Applied Migrations

| Migration | What it does |
|---|---|
| `add-compound-indexes` | Adds `posts_userId_createdAt`, replaces unweighted text index with weighted (title×10 tags×5 content×1), adds `notif_userId_read_createdAt` |
| `denormalize-post-like-count` | Backfills `likeCount` field on all posts from `likes.length`; adds `posts_likeCount_hot` index |
| `phase7-community-interaction-indexes` | Message/forum weighted text search, attachment, report and forum indexes |
| `identity-governance-indexes` (auth track) | Backfills status/profileType/privacySettings/sessionVersion; `user_status`, `user_auth_identity`, `user_blocked` |
| `squad-chat-invitation-indexes` (squads track) | Unique chat per squad, expiry sweep index, one-pending-invitation partial unique index |

### Index Map

| Collection | Index | Purpose |
|---|---|---|
| `posts` | `{ userId: 1, createdAt: -1 }` | Profile page post feed |
| `posts` | `{ createdAt: -1 }` | Global latest feed |
| `posts` | `{ tags: 1 }` | Hashtag channel filter |
| `posts` | weighted text | Search: `$text { $search }` with score sort |
| `posts` | `{ likeCount: -1, createdAt: -1 }` | Hot posts sort |
| `messages` | `{ channelId: 1, createdAt: -1 }` | Cursor-paginated channel history |
| `notifications` | `{ userId: 1, read: 1, createdAt: -1 }` | Unread badge count + list |
| `notifications` | `{ userId: 1, dedupeKey: 1 }` (partial unique) | Bot dedup |
| `communities` | `{ members.userId: 1 }` | "Which servers am I in" lookup |
| `communities` | `{ slug: 1 }` (unique) | Community lookup by URL slug |
| `parties` | `{ status: 1, createdAt: -1 }` | Open LFG board |
| `parties` | `{ expiresAt: 1 }` (TTL, expires: 0) | Auto-delete expired squads |
| `auditlogs` | `{ communityId: 1, createdAt: -1 }` | Chronological audit feed |
| `users` | `{ username: 1 }` (unique) | Username lookup + search prefix |
| `users` | `{ status: 1 }` | Account-state sweeps (deletion grace period) |
| `users` | `{ 'authIdentities.provider': 1, 'authIdentities.providerSubject': 1 }` | Federated identity lookup |
| `users` | `{ blockedUsers: 1 }` | Reverse block lookup (symmetric filtering) |
| `squadchats` | `{ squadId: 1 }` (unique) | Exactly one chat per squad |
| `squadchats` | `{ state: 1, expiresAt: 1 }` | Expiry sweep |
| `squadchatmessages` | `{ chatId: 1, createdAt: -1 }` | Cursor-paginated squad history |
| `invitations` | `{ recipientUserId: 1, status: 1, createdAt: -1 }` | Inbox |
| `invitations` | `{ recipientUserId: 1, targetType: 1, targetId: 1 }` partial unique on `pending` | No duplicate live invitations |

---

## 10. Security Model

### Authentication

- Passwords hashed with `bcrypt` (10 salt rounds)
- JWTs signed with `JWT_SECRET` and delivered as an `HttpOnly` cookie (`SameSite=None; Secure` in production, needed because the Vercel frontend calls Render cross-site; `SameSite=Lax` in development)
- The same JWT is mirrored in the auth response body **only** so the Socket.io client can authenticate its WebSocket handshake, which cannot send cookies cross-site. It is never placed in a URL, log, or HTML. REST endpoints authenticate from the cookie alone — a `Bearer` header on `/api/*` is ignored

### Authorization Layers

```
Global roles (User.role):
  user ──► moderator ──► admin

Community roles (Community.members[].role):
  member ──► moderator ──► admin ──► owner

Middleware chain for a protected route:
  verifyToken → requireRole('moderator') → checkOwnership → controller
```

### Transport & Input Security

| Control | Implementation |
|---|---|
| Security headers | Helmet 7 (full CSP, HSTS, X-Frame-Options) |
| CORS | Exact origin allow-list via `utils/origins.js`; no wildcards |
| NoSQL injection | `express-mongo-sanitize` strips `$` and `.` from all body/query inputs |
| SSRF | `safeFetch.js`: DNS resolution + private IP range check on every outbound URL; max 3 redirects |
| Stored XSS | `sanitize.js` strips control characters; HTML entity decode is one-pass only |
| Rate limiting | 1000 req/5 min global (REST); stricter on `/auth/*`; sliding window on Socket.io per userId |
| Projection discipline | `passwordHash` and `__v` never appear in any API response |
| Audit immutability | `AuditLog` documents have no update route; records are append-only |

---

## 11. Caching Strategy

```
                     Request
                        │
              ┌─────────▼──────────┐
              │ In-process TTL/LRU │  L1: zero network cost
              │ (cache.js)         │      miss collapsing via inflight Map
              └─────────┬──────────┘
                   miss │
              ┌─────────▼──────────┐
              │ Redis (Upstash)    │  L2: survives Render restarts (when enabled)
              │ (redisCache.js)    │      degrades gracefully on error (30 s skip)
              └─────────┬──────────┘
                   miss │
              ┌─────────▼──────────┐
              │ Upstream API /     │
              │ MongoDB            │
              └────────────────────┘
```

| Resource | TTL | Backend |
|---|---|---|
| Game catalog (full list) | 10 min | L1 |
| Game detail page | 60 min | L1 + L2 |
| YouTube search results | 30 min | L1 + L2 |
| Admin system-health (bundle scan + collection counts) | 60 s | L1 + L2 |
| Like buffer | — | Redis hash (write path) |

---

## 12. Local Development

### Prerequisites

- Node.js 20+
- A MongoDB Atlas M0 cluster (free)
- Cloudinary account (free tier)

### Setup

```bash
git clone https://github.com/your-username/MERN_INTERNSHIP_Proj.git
cd MERN_INTERNSHIP_Proj

# Install server dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# Create environment file
cp .env.example .env
# Fill in MONGO_URI, JWT_SECRET, CLOUDINARY_* (see §14)
```

### Running

```bash
# Start both server (port 5000) and client (port 3000) concurrently
npm run dev

# Or separately:
npm run server    # nodemon, hot-reload
npm run client    # Vite dev server
```

### Database Migrations

```bash
# Check which migrations are pending
npm run migrate:status

# Apply all pending
npm run migrate:up
```

### Seed Demo Data

```bash
node scripts/seed-demo-data.js
```

Creates: a sample community with channels, three LFG squads, and three notifications for the admin account.

---

## 13. Deployment

### Frontend — Vercel

1. Connect the repository to Vercel; set the **root directory** to `client`
2. Build command: `npm run build` | Output: `dist`
3. Add `client/vercel.json` (already present): rewrites `/api/*` to the Render backend URL

### Backend — Render

1. Create a **Web Service** pointing to the repository root
2. Build command: `npm install`
3. Start command: `node server/server.js`
4. Add all environment variables (see §14)

### Database Migrations on Deploy

Run migrations against Atlas before or immediately after deploying a new server version:

```bash
MONGO_URI=<atlas-uri> npm run migrate:up          # original track
MONGO_URI=<atlas-uri> npm run migrate:domains    # auth → feed → communities → squads
```

Run `npm run migrate:domains:status` first; each track records itself in its own
`changelog_<domain>` collection.

---

## 14. Environment Variables

### Required (server)

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string including database name |
| `JWT_SECRET` | Random 64-char secret for JWT signing |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

### Optional (server)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | HTTP listen port |
| `NODE_ENV` | `development` | Set to `production` on Render |
| `TRUST_PROXY` | `1` | Hop count behind reverse proxy |
| `RATE_LIMIT_MAX` | `1000` | Global REST rate limit per 5 min window |
| `YOUTUBE_API_KEY` | — | YouTube Data API v3 key; bot is disabled without this |
| `REDIS_ENABLED` | `0` | Set to `1` to enable the Redis cache and like buffer |
| `UPSTASH_REDIS_REST_URL` | — | Upstash Redis endpoint; required only when `REDIS_ENABLED=1` |
| `UPSTASH_REDIS_REST_TOKEN` | — | Upstash Redis token; required only when `REDIS_ENABLED=1` |
| `DISABLE_LIKE_BUFFER` | `0` | Set to `1` to force direct DB writes even when Redis is up |
| `ALLOWED_ORIGINS` | built-in list | Comma-separated exact origins for CORS |
| `GOOGLE_CLIENT_ID` | — | OAuth client id for Google Sign-In; the button is hidden without it |
| `MONGO_URI_SQUADS` | `MONGO_URI` | Optional separate cluster for the temporary squad-chat domain |
| `MONGO_MAX_POOL_SIZE_SQUADS` | `20` | Connection ceiling for the isolated squads pool |
| `INVITE_RATE_LIMIT_MAX` | `30` | Invitations per user per hour |
| `SQUAD_CHAT_RATE_LIMIT_MAX` | `120` | Squad-chat REST writes per minute |
| `EXPORT_RATE_LIMIT_MAX` | `5` | Data exports per user per hour |

---

## 15. Testing

The server suite uses Node's built-in test runner (no external framework) and the
client suite uses Vitest + Testing Library.

```bash
npm test                      # server: 117 checks, no database needed
npm test --prefix client      # client components: 28 checks in jsdom
```

**117 server checks across 13 suites — all passing.**

| Suite | Coverage area |
|---|---|
| `permissions.test.js` | Community role hierarchy, capability resolution, kick/assign rules |
| `sanitize.test.js` | Input sanitizers, HTML entity decode, tag normalisation, regex escape |
| `ssrf.test.js` | Private IPv4/IPv6 range blocking, redirect chain inspection |
| `origins.test.js` | CORS allow-list: production exact match, development loopback, comma list |
| `lfg.test.js` | Party creation rules, join/leave constraints, TTL expiry, board filters |
| `feedRanking.test.js` | Personalized score: favourites, engagement, recency penalty, determinism |
| `cache.test.js` | TTL eviction, concurrent miss collapsing, maxEntries LRU behaviour |
| `botSecurity.test.js` | YouTube bot: key never exposed, notification URL validation, unconfigured state |
| `likeBuffer.test.js` | Last-write-wins collapsing, idempotent pipeline, retry on failed write, one-time viral medal, worker lifecycle |
| `redisCache.test.js` | L1/L2 layering, TTL, 30 s degrade window and recovery, miss collapsing, failed loads never cached |
| `reactions.test.js` | Reaction allowlist, emoji normalisation, aggregation |
| `mentions.test.js` | Mention extraction, `@everyone` detection, reply previews, caps |
| `fileValidator.test.js` | Magic-byte sniffing per allowlisted MIME, oversize and spoofed types |
| `privacy.test.js` | Consent matrix, symmetric blocking, privacy patch validation, account gate, erasure payload |
| `squadLifecycle.test.js` | 15-day expiry boundary, owner-only refresh, membership, countdown formatting |
| `connections.test.js` | Domain pooling rules, per-domain URI precedence, test-mode URI pinning, readiness shape |

Both Redis suites run against an in-memory fake installed in front of
`@upstash/redis` (`server/tests/helpers/fakeRedis.js`), so they are offline,
deterministic, and exercise the real feature switch and key prefix.

**28 client checks across 4 files** — `SegmentedTabs` (aria state, keyboard,
indicator), `PostActions` (label/pressed state, spark burst gated on pointer and
reduced-motion), `PostCard` (like and bookmark requests, failure path, signed-out
redirect) and `NotificationBell` (dropdown vs portalled sheet at the 640 px
breakpoint, badge count, mark-read).

End-to-end smoke tests (requires a running backend):

```bash
npm run test:e2e              # all five suites below
node scripts/e2e.js           # 59 auth/community/chat checks
node scripts/e2e-phase4.js    # 66 feed/LFG/notification/admin checks
node scripts/e2e-phase6.js    # 159 lifecycle/search/Redis-off checks
node scripts/e2e-phase7.js    # 80 Discord-interaction checks
node scripts/e2e-phase8.js    # 70 identity/consent/squad-chat/data-rights checks
```

All five run against a throwaway database derived from `MONGO_URI` and drop it
when they finish. They need no Redis: the degraded path is asserted explicitly,
so a future Redis re-enable that breaks the fallback fails here. Their shared
scaffolding (`api`, `check`, `register`, sockets) lives in
[`scripts/lib/e2e-harness.js`](scripts/lib/e2e-harness.js).

```bash
node scripts/scan-emoji.js    # design gate: no emoji/glyph in client/src
```

Start with [docs/TEST_LEDGER.md](docs/TEST_LEDGER.md): it records what each tier
covers, when it must be re-run, and the manual UI matrix, so a pass never repeats
a green check. The detailed Phase 6 write-up is in
[docs/TEST_REPORT_PHASE6.md](docs/TEST_REPORT_PHASE6.md); the plan forward is in
[docs/ROADMAP.md](docs/ROADMAP.md).

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and
pull request:

| Job | Steps |
|---|---|
| quality | `npm ci` → `npm test` → `npm test --prefix client` → `npm run build --prefix client` → emoji gate |
| e2e | all five suites against a throwaway database, then `migrate:status` and `migrate:domains:status` |

The e2e job needs `MONGO_URI` and `JWT_SECRET` repository secrets; without them it
reports a notice and skips instead of failing, so forks stay green. It never runs
`migrate:up` — a push must not mutate the database a deploy is about to use.

---

## License

MIT. See [LICENSE](LICENSE).
