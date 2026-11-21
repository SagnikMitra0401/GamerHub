# Migration tracks

Each workload domain migrates independently, with its own folder, `changelog_*`
collection and lock, so a failure in one track cannot block another.

| Track | Folder | Changelog | Command |
|---|---|---|---|
| Identity & auth | `migrations/auth/` | `changelog_auth` | `npm run migrate:auth` |
| Social & feed | `migrations/feed/` | `changelog_feed` | `npm run migrate:feed` |
| Communities | `migrations/communities/` | `changelog_communities` | `npm run migrate:communities` |
| Squads & chat | `migrations/squads/` | `changelog_squads` | `npm run migrate:squads` |
| Catalog & media reference | `migrations/catalog/` | `changelog_catalog` | `npm run migrate:catalog` |

`npm run migrate:domains` runs all five in order; `npm run migrate:domains:status`
reports each one. The policy for which change belongs in which track — and
which changes should be a job instead — is in [docs/MIGRATIONS.md](../docs/MIGRATIONS.md).

`migrations/` (the repo root track) is the original, already-applied history and
is left untouched so its `changelog` collection stays valid. Continue using
`npm run migrate:up` for that track, or add new files to the matching domain
folder from now on.

Phase 16's stories, story views and broadcast-channel collections are written by
the feed track (`20261119120000-phase16-stories-broadcasts.js`); see
[docs/MIGRATIONS.md](../docs/MIGRATIONS.md) for what it creates and backfills.

Always run a track's status first. `migrate:down` is destructive — back up
before using it on a production cluster.
