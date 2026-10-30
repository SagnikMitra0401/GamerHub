# Migration tracks

Each workload domain migrates independently, with its own folder, `changelog_*`
collection and lock, so a failure in one track cannot block another.

| Track | Folder | Changelog | Command |
|---|---|---|---|
| Identity & auth | `migrations/auth/` | `changelog_auth` | `npm run migrate:auth` |
| Social & feed | `migrations/feed/` | `changelog_feed` | `npm run migrate:feed` |
| Communities | `migrations/communities/` | `changelog_communities` | `npm run migrate:communities` |
| Squads & chat | `migrations/squads/` | `changelog_squads` | `npm run migrate:squads` |

`npm run migrate:domains` runs all four in order; `npm run migrate:domains:status`
reports each one.

`migrations/` (the repo root track) is the original, already-applied history and
is left untouched so its `changelog` collection stays valid. Continue using
`npm run migrate:up` for that track, or add new files to the matching domain
folder from now on.

Always run a track's status first. `migrate:down` is destructive — back up
before using it on a production cluster.
