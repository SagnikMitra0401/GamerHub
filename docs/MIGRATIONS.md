# Migration policy

Not every change deserves a migration, and not every migration deserves the
same process. This document defines the five change classes, which track each
one belongs to, and what must be true before it reaches production.

The runner is `migrate-mongo`. Each workload domain has its own folder,
`changelog_*` collection and lock, so a failure in one track cannot block
another:

| Track | Folder | Changelog | Command |
|---|---|---|---|
| Identity & auth | `migrations/auth/` | `changelog_auth` | `npm run migrate:auth` |
| Social & feed | `migrations/feed/` | `changelog_feed` | `npm run migrate:feed` |
| Communities & chat | `migrations/communities/` | `changelog_communities` | `npm run migrate:communities` |
| Squads & temporary chat | `migrations/squads/` | `changelog_squads` | `npm run migrate:squads` |
| Catalog & media reference | `migrations/catalog/` | `changelog_catalog` | `npm run migrate:catalog` |

`migrations/` (the root track) is the original applied history and stays
untouched so its `changelog` collection remains valid.

## Change classes

### 1. Index-only

Adding, rebuilding or dropping an index.

- **Track:** the collection's domain.
- **Rules:** name every index, use `background: true`, catch "already exists"
  so a partial run can be repeated, and always provide `down` (dropIndex).
- **When:** any deploy. No backup needed.
- **Example:** `migrations/catalog/20261117090000-game-catalog.js`.

### 2. Additive field

A new optional field, or a new collection.

- **Track:** the domain that owns the new data.
- **Rules:** expand only. Give the field a default in the Mongoose schema,
  make every reader tolerate its absence for one release, and do **not** write
  a backfill into the same migration.
- **When:** any deploy. Old code ignores the field; new code falls back.

### 3. Backfill

Reshaping existing documents to match a new shape.

- **Track:** the owning domain, but the work runs **outside** migrate-mongo via
  `scripts/lib/backfill.js`.
- **Rules:** batched (500 by default), idempotent filter, checkpoint written
  after each batch, throttled, `--dry-run` first. Never in a request path, never
  as one unbounded `updateMany`.
- **When:** after the expand deploy, before the read switch.

### 4. Destructive / contract

Dropping a field or collection, or imposing a rule old rows violate.

- **Track:** owning domain.
- **Rules:** at least one release after the switch, a fresh backup, an explicit
  operator decision, a `down` that restores what it removed (or documents why
  it cannot), and `migration-lint` passing. The lint rejects unfiltered
  `deleteMany({})`, `dropDatabase()` and `collection.drop()`.
- **When:** a dedicated maintenance window, never bundled with a feature.

### 5. Reference / seed data

Catalog rows, Cloudinary layout, provider sync.

- **Rules:** **not a migration.** Use a job: `npm run games:sync`, the admin
  catalog sync button, or a bounded script. Reference data changes on its own
  schedule and must be refreshable without a deploy.
- **Why:** a deploy should never fail because a third-party API is down.

## Expand → backfill → switch → contract

For a breaking change:

1. **Expand** — add the new field/collection; old and new code both work.
2. **Backfill** — batched job fills existing documents; checkpoints allow a
   restart.
3. **Switch** — deploy code that reads only the new shape, keeping a fallback
   for one release.
4. **Contract** — a later migration removes the old field and its index.

The media ledger followed exactly this path: new uploads write `MediaAsset`,
the feed migration backfills legacy posts and attachments, readers use
`mediaAssetId` when present, and no Cloudinary asset was renamed.

### Phase 16 worked example

`migrations/feed/20261119120000-phase16-stories-broadcasts.js` is an expand-only
change: it creates the `stories`/`storyviews` and
`broadcastchannels`/`broadcastmessages`/`broadcastsubscriptions` collections and
their named indexes (including the story TTL and the two unique pairs), tags
uploaded videos with `videoSource: 'upload'`, and derives `youtubeId` for existing
link posts with the same regex the create path uses — no network call, no
Cloudinary rename. Re-running it after a partial failure is safe: index creation
ignores “already exists” (codes 85/86) and the backfill only updates rows that
are still missing the field. Its `down` unsets the three post fields, drops the
named indexes and removes the rows in the collections this migration introduced;
collections themselves are never dropped, as the lint requires.

## Checklist before merging a migration

- [ ] Filename is `YYYYMMDDHHMMSS-kebab-case.js` and lives in the right domain
- [ ] `up` is idempotent and `down` really reverses it
- [ ] No unfiltered deletes or collection drops
- [ ] Indexes are named and created in the background
- [ ] `npm test` (which runs `migration-lint`) passes
- [ ] `npm run migrate:domains:status` checked first
- [ ] Destructive change: backup taken (`docs/BACKUP_RESTORE.md`)

## Tooling

| Command | Purpose |
|---|---|
| `npm run migration:lint` (via `npm test`) | filename, up/down, destructive patterns |
| `npm run migrate:domains` | apply every track in order |
| `npm run migrate:domains:status` | per-track status |
| `npm run db:indexes` | read-only schema-vs-live index diff |
| `npm run games:sync` | reference data (FreeToGame / optional IGDB) |

`migrate:down` is destructive. Back up first.
