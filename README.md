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
* **Hierarchical RBAC:** Guild-scoped governance (`Owner` &rarr; `Admin` &rarr; `Moderator` &rarr; `Member`).
* **Channel Permissions:** Granular `minRoleToRead` and `minRoleToWrite` gates per channel.
* **WebSocket Engine:** Room-based real-time messaging, typing broadcasts, and live tombstone message deletion.
* **Slowmode & Flood Control:** Sliding-window rate limiter (max 5 msgs / 5 sec) and configurable channel cooldown timers (5s to 60s).
* **Content Protection:** Optional restriction flag preventing unauthorized copying, selecting, or asset saving.

### 2. Gamer Passport & Hardware Showcase
* **Battle Station Discovery:** WebGL device telemetry capturing unmasked GPU vendor/renderer strings, CPU concurrency, device memory, and display resolutions.
* **Resolution DPI Compensation:** Normalizes logical pixel scaling across 125% and 150% Windows DPI factors to reflect true physical display panels (e.g., 1080p FHD, 1440p QHD).
* **Multi-Rig Profiles:** Up to 5 custom hardware configurations with duplicate rig detection and exportable text specs.
* **In-Game Identity:** Instant 1-click clipboard integration for Riot IDs, Steam vanity tags, PSN tags, Xbox Gamertags, and Discord tags.

### 3. Social Graph & Content Hub
* **Multimedia Streams:** Image uploads and gameplay clips with hover-to-play muted previews.
* **Link Scraper:** Automatic OpenGraph preview scraper for YouTube, Twitch, Instagram, and web resources.
* **Engagement Engine:** XP leveling formula ($Level = \lfloor XP / 25 \rfloor + 1$), dynamic progress bars, and verifiable achievement medals.

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
| **Bulk Scraping & Exfiltration** | Opaque cursor-based pagination (`before_id`), strict route rate limits, and removal of bulk export endpoints. |
| **Audit & Compliance** | Immutable `AuditLog` collection tracking all administrative actions (role updates, channel deletions, message purges). |
| **GDPR Right to Erasure** | Soft-delete tombstone protocol (`isDeleted: true`, `"This message was deleted"`). |

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
│   ├── config/              # MongoDB connection and Socket.io initialization
│   ├── controllers/         # Endpoint business logic
│   ├── middleware/          # JWT auth, error handlers, and ownership checks
│   ├── models/              # Mongoose schemas (User, Post, Community, Channel, Message, AuditLog)
│   ├── routes/              # Express API route declarations
│   └── utils/               # Gamification math and token generation
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
```

#### Frontend Configuration (`client/.env`)
```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

### 3. Install Dependencies & Launch

```bash
# Terminal 1: Backend
cd server
npm install
npm run dev

# Terminal 2: Frontend
cd client
npm install
npm run dev
```

The application will be accessible at `https://gamer-hub-nu.vercel.app/`.

---

## Production Deployment Architecture

* **Frontend:** Hosted on **Vercel** with automatic SPA rewrites and edge proxy routing.
* **Backend:** Hosted on **Render** (persistent container service enabling persistent WebSocket connections).
* **Authentication Proxy:** Client routes `/api/*` requests through Vercel's proxy to maintain same-origin `HttpOnly` cookie persistence across domains.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
