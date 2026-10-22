# GamerHub

> A full-stack gaming social ecosystem featuring community hubs, real-time channels, battle station hardware discovery, and gamified engagement.

[![Live Demo](https://img.shields.io/badge/Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://gamer-hub-alpha.vercel.app)
[![API Status](https://img.shields.io/badge/API-Render-46E3B7?style=for-the-badge&logo=render)](https://gamerhub-backend-3108.onrender.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

---

## Architecture Overview

```
                                      +------------------------------------+
                                      |          Client (React 18)         |
                                      |   Vite + SPA + Socket.io Client   |
                                      +-----------------+------------------+
                                                        |
                                +-----------------------+-----------------------+
                                | REST (via Vercel Proxy)                       | WebSocket (Direct WSS)
                                v                                               v
              +------------------------------------+          +------------------------------------+
              |          Express API Tier          |          |          Socket.io Engine          |
              | Helmet | MongoSanitize | RateLimit |          | Room Multiplex | Flood Limiter     |
              +-----------------+------------------+          +-----------------+------------------+
                                |                                               |
                                +-----------------------+-----------------------+
                                                        | Mongoose ORM
                                                        v
                                      +------------------------------------+
                                      |        MongoDB Atlas Cluster       |
                                      | Users | Posts | Communities | Logs |
                                      +-----------------+------------------+
                                                        |
                                                        v
                                      +------------------------------------+
                                      |       Cloudinary Media CDN         |
                                      |    Video Clips | Images | Rigs     |
                                      +------------------------------------+
```

---

## Core System Modules

### 1. Discord-Style Real-Time Communities ("Squads")
* **Hierarchical RBAC:** Server-scoped governance (`Owner` &rarr; `Admin` &rarr; `Moderator` &rarr; `Member`).
* **Channel Permissions:** Granular `minRoleToRead` and `minRoleToWrite` gates per channel.
* **WebSocket Engine:** Room-based real-time messaging, typing broadcasts, and live tombstone message deletion.
* **Slowmode & Flood Control:** Sliding-window rate limiter (max 5 msgs / 5 sec) and configurable channel cooldown timers (0&ndash;120s).
* **Content Protection:** Optional restriction flag preventing unauthorized copying, selecting, or asset saving.
* **Accountability:** Every administrative action is appended to an immutable per-server audit log.

#### Server roles are maintenance-only

A server role grants power **inside that server** and nowhere else. Application
roles (`user` / `moderator` / `admin` on the account) are a separate system and
never leak into somebody else's server.

| Capability | Member | Moderator | Admin | Owner |
| :--- | :-: | :-: | :-: | :-: |
| View server &amp; channels | ✅ | ✅ | ✅ | ✅ |
| Send messages, delete own | ✅ | ✅ | ✅ | ✅ |
| Delete any message, bypass slowmode | — | ✅ | ✅ | ✅ |
| Add &amp; kick members, manage roles, channels, audit log | — | — | ✅ | ✅ |
| Rename / delete server, toggle private | — | — | — | ✅ |

Safety rails: the owner's role is immutable and cannot be granted; admins cannot
kick or demote other admins; a channel's write gate is always raised to at least
its read gate; the last channel of a server cannot be deleted. Every check lives
in [`server/utils/permissions.js`](server/utils/permissions.js) &mdash; the client
mirror ([`client/src/utils/permissions.js`](client/src/utils/permissions.js))
only decides which controls render.

### 2. Gamer Passport & Hardware Showcase
* **Battle Station Discovery:** WebGL device telemetry capturing unmasked GPU vendor/renderer strings, CPU concurrency, device memory, and display resolutions.
* **Resolution DPI Compensation:** Normalizes logical pixel scaling across 125% and 150% Windows DPI factors to reflect true physical display panels (e.g., 1080p FHD, 1440p QHD).
* **Multi-Rig Profiles:** Up to 5 custom hardware configurations with duplicate rig detection and exportable text specs.
* **In-Game Identity:** Instant 1-click clipboard integration for Riot IDs, Steam vanity tags, PSN tags, Xbox Gamertags, and Discord tags.

### 3. Social Graph & Content Hub
* **Multimedia Streams:** Image uploads and gameplay clips with hover-to-play muted previews.
* **Link Scraper:** Automatic OpenGraph preview scraper for YouTube, Twitch, Instagram, and web resources.
* **Engagement Engine:** XP leveling formula ($Level = \lfloor XP / 25 \rfloor + 1$), dynamic progress bars, and verifiable achievement medals.

### 4. LFG Squads, Presence & Discovery
* **LFG Board:** Create a squad in seconds (game, activity, 2&ndash;6 slots, rank and mic requirements). Join requests go to the leader, who accepts or declines them; an accepted player takes a slot and a full squad leaves the board. Squads self-destruct after 6 hours via a MongoDB TTL index.
* **Live Sync:** `lfg_slot_updated` re-renders every open board; `lfg_join_request` and `notification` reach the leader instantly through a per-user socket room.
* **Presence:** `online` / `in_game` / `invisible` with an active-game badge. `invisible` is stored but broadcast (and shown on public profiles) as `offline`; presence is counted per user, not per tab, so closing one tab does not make you look offline.
* **Game Catalog:** The FreeToGame catalog is fetched at most once per 10 minutes and searched in memory, so filtering never hammers the provider. Degrades to the last good snapshot (flagged `stale`) when the provider is down.
* **For You Feed:** Transparent ranking over a bounded pool of recent posts &mdash; favourite game/genre tags +50 each, followed channels +30, engagement capped at +60, minus 0.5 per hour of age. No hidden signals; see [`server/utils/feedRanking.js`](server/utils/feedRanking.js).
* **Gaming Bot:** Queries YouTube Data API v3 server-side for the player's favourite games and turns the newest video into a notification with a thumbnail. Results are cached for 30 minutes (a search costs 100 of 10,000 daily quota units), pings are de-duplicated per video, and the endpoint returns a clean `503` when no key is configured rather than failing silently.
* **Admin Monitor:** `/admin` reports secret isolation (present, strength bucket, never the value), scans the production bundle for leaked keys, shows traffic/latency/error counters, DB collection counts, provider status and the latest audit entries.

#### New API surface

| Method & path | Purpose |
| :--- | :--- |
| `GET/POST /api/lfg`, `GET /api/lfg/mine` | Browse open squads, create one, see your own |
| `POST /api/lfg/:id/request`, `PATCH /api/lfg/:id/respond`, `DELETE /api/lfg/:id` | Ask to join, leader accepts/declines, close |
| `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all` | Inbox and badge |
| `GET /api/games`, `GET /api/games/:id` | Catalog search and detail (screenshots, system requirements) |
| `PATCH /api/users/me/preferences`, `PATCH /api/users/presence` | Favourite games/genres/platforms, live status |
| `POST /api/bot/sync-youtube`, `GET /api/bot/status` | Gaming-bot sync and configuration status |
| `GET /api/admin/system-health`, `GET /api/admin/metrics` | Platform administration (application `admin` role only) |

---

## Data & Security Flow

```
[ User Action ]
       |
       v
+--------------+        Invalid Token
|  JWT Check   +----------------------------+
+------+-------+                            |
       | Valid                              |
       v                                    v
+--------------+   Exceeds Rate Limit   +-------+
| Rate Limiter +----------------------->+ Block |
+------+-------+                        +-------+
       | Pass                               ^
       v                                    |
+--------------+   Insufficient Perms       |
| RBAC Gate    +----------------------------+
+------+-------+
       | Authorized
       v
+--------------+
| Mongo / WSS  |
+--------------+
```

---

## Security & Privacy Implementation

| Threat Vector | Mitigation Strategy |
| :--- | :--- |
| **Cross-Site Scripting (XSS)** | Server-side HTML entity escaping, React DOM encoding, and protocol whitelisting (`http://` and `https://` only). |
| **NoSQL Query Injection** | Request payload sanitization via `express-mongo-sanitize` stripping `$` and `.` operators. |
| **Token Theft & Session Hijacking** | HttpOnly, `SameSite=None`, `Secure` JWT cookies coupled with token-based WebSocket handshake verification. |
| **Bulk Scraping & Exfiltration** | Capped page sizes (messages use a `before` cursor, feeds a clamped `page`/`limit`), strict route rate limits, member/channel caps, and no bulk export endpoints. |
| **Audit & Compliance** | Immutable `AuditLog` collection tracking all administrative actions (role updates, channel deletions, message purges). |
| **GDPR Right to Erasure** | Soft-delete tombstone protocol (`isDeleted: true`, `"This message was deleted"`) plus per-channel retention (`retentionDays`), purged by a background worker. |

### Chat security parameters

One frozen policy object ([`server/config/chatPolicy.js`](server/config/chatPolicy.js))
owns every limit. Change it there and both REST and the socket engine follow.

| Parameter | Value | Why |
| :--- | :--- | :--- |
| `message.maxLength` / `maxLines` | 1,000 chars / 40 lines | Bounds storage, socket buffers and DOM work per message |
| `message.maxBlankLineRun` | 2 | Stops layout-inflation via newline floods |
| `flood.windowMs` / `maxMessages` | 5s / 5 per user | Per-account sliding window shared by every open tab |
| `slowmode.minSeconds` / `maxSeconds` | 0 / 120 | Channel cooldown; moderators bypass it |
| `typing.throttleMs` | 2,000ms | One typing event per user per channel per 2s |
| `history.defaultLimit` / `maxLimit` | 50 / 50 | Hard cap on any history page |
| `channels.maxPerCommunity` | 50 | Room and fan-out cap |
| `community.maxMembers` | 5,000 | Join-time cap |
| `retention.minDays` / `maxDays` | 0 / 365 | Auto-delete horizon per channel |
| Socket `maxHttpBufferSize` | 100 kB | Rejects oversized frames before parsing |
| REST body limit | 100 kB | Same, for HTTP |
| Preview fetch timeout / max bytes | 6s / 512 kB | SSRF-safe scraper cannot be used to exhaust memory |

Text is stored raw (React escapes on render) after stripping control characters,
bidi overrides and zero-width characters &mdash; see
[`server/utils/sanitize.js`](server/utils/sanitize.js).

---

## Technology Stack

```
Frontend:
  React 18 ────── Vite ────── React Router 6 ────── Socket.io Client ────── Axios

Backend:
  Node.js ────── Express 4 ────── Socket.io ────── Mongoose 8 ────── JSON Web Tokens

Infrastructure:
  MongoDB Atlas (Database) ────── Cloudinary (Media CDN) ────── Render (API) ────── Vercel (SPA)
```

---

## Project Structure

```
GamerHub/
├── client/
│   ├── src/
│   │   ├── api/             # Axios and Socket.io client instances
│   │   ├── components/      # Modular UI components (Auth, Posts, Communities, Profile)
│   │   ├── context/         # AuthContext state provider
│   │   ├── pages/           # Route views (Feed, ProfilePage, CommunityPage)
│   │   └── utils/           # WebGL device detector and helpers
│   ├── vercel.json          # Reverse proxy configuration
│   └── vite.config.js       # Vite configuration
│
├── server/
│   ├── config/              # MongoDB connection, Socket.io initialization, chat policy
│   ├── controllers/         # Endpoint business logic (incl. LFG, games, admin, bot)
│   ├── middleware/          # JWT auth, platform-role gates, error handlers, ownership
│   ├── models/              # Mongoose schemas (User, Post, Community, Channel, Message, AuditLog, Party, Notification)
│   ├── routes/              # Express API route declarations
│   ├── tests/               # node:test unit suites (permissions, sanitisation, LFG, ranking…)
│   └── utils/               # Permissions, sanitisation, cache, metrics, YouTube bot, catalog, ranking
├── scripts/
│   ├── e2e.js               # Permission/chat end-to-end suite (throwaway DB)
│   └── e2e-phase4.js        # LFG/presence/bot/admin end-to-end suite (throwaway DB)
│
└── README.md
```

---

## Local Development Setup

### Prerequisites
* **Node.js** (v18.0.0 or higher)
* **npm** (v9.0.0 or higher)
* **MongoDB** (Atlas connection string or local instance)
* **Cloudinary Account** (Credentials for media uploads)

### 1. Clone Repository
```bash
git clone https://github.com/SagnikMitra0401/GamerHub.git
cd GamerHub
```

### 2. Environment Configuration

#### Backend Configuration (`server/.env`)
```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/gamerhub
JWT_SECRET=your_super_secret_jwt_key
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
# Optional: enables the gaming bot. Server-side only — never a VITE_ variable.
YOUTUBE_API_KEY=your_youtube_data_api_v3_key
```

The bot is the only feature that needs a third-party key. Without it the rest of
the app works normally: `/api/bot/sync-youtube` answers `503 BOT_NOT_CONFIGURED`
and the admin dashboard shows the key as `not set`.

#### Frontend Configuration (`client/.env`)
```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

### 3. Install Dependencies & Launch

```bash
# From the repository root
npm install
npm install --prefix client
npm run dev          # Express on :5000, Vite on :3000

# Unit tests and end-to-end suites
npm test
node scripts/e2e-phase4.js
```

The application will be accessible at `http://localhost:3000`. Both e2e scripts
create a throwaway database on the configured cluster and drop it afterwards.

---

## Production Deployment Architecture

* **Frontend:** Hosted on **Vercel** with automatic SPA rewrites and edge proxy routing.
* **Backend:** Hosted on **Render** (persistent container service enabling persistent WebSocket connections).
* **Authentication Proxy:** Client routes `/api/*` requests through Vercel's proxy to maintain same-origin `HttpOnly` cookie persistence across domains.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
