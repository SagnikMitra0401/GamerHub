# Atlas backup and restore drill

Run this drill **before a risky migration** and after changing the production
schema. A backup you have never restored is only a hope; this procedure proves
the restore target is writable, queryable and indexed.

The project uses MongoDB Atlas. On the free **M0** tier, Atlas takes no
automatic snapshots. Take an explicit `mongodump` archive first. Paid tiers can
also use **Cloud Backup → Restore** into a separate cluster/database.

> Never restore over the production database. Use a database whose name contains
> `restore`, `drill`, `test` or `tmp`, verify it, then delete it.

## 1. Pre-flight

1. Confirm the current app and migrations are healthy:
   ```bash
   npm run migrate:domains:status
   curl -fsS https://YOUR_API/api/health/ready
   ```
2. Record the source database name and document counts. Do not paste the
   connection string into a ticket, chat or commit.
3. Make sure you have enough Atlas storage for a second copy. For M0, a
   collection-level archive of the important collections is usually enough for
   a migration trial; a full archive is required for disaster recovery.

## 2. Take a full archive (M0 / self-managed)

Install MongoDB Database Tools, then run locally with the Atlas URI already in
your environment:

```bash
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"

mongodump \
  --uri="$MONGO_URI" \
  --archive="backups/gamerhub-$STAMP.archive.gz" \
  --gzip

# Prove the archive is readable before relying on it.
mongorestore --archive="backups/gamerhub-$STAMP.archive.gz" --gzip --dryRun
```

Store the archive outside the repository and encrypt it at rest. It contains
password hashes and private messages. Delete it when the retention policy says
so.

For a paid Atlas cluster, take a Cloud Backup snapshot instead and restore it
into a temporary cluster. Keep the snapshot until the migration has been live
for at least one full backup cycle.

## 3. Restore into a drill database

Use the same cluster with a clearly temporary database name:

```bash
mongorestore \
  --uri="$MONGO_URI" \
  --archive="backups/gamerhub-$STAMP.archive.gz" \
  --gzip \
  --nsFrom="YOUR_SOURCE_DB.*" \
  --nsTo="gamerhub_restore_drill_$STAMP.*"
```

`YOUR_SOURCE_DB` is the database name at the end of `MONGO_URI` (not the whole
URI). If your archive came from Atlas Cloud Backup, use the Atlas restore UI and
choose a temporary database instead.

## 4. Verify the restore

Run the sample restore drill against the live source. It copies a small,
bounded sample into a throwaway database, recreates every non-`_id` index and
verifies the document counts before dropping it:

```bash
BACKUP_DRILL_LIMIT=25 npm run backup:drill
```

Expected shape:

```text
Restore drill passed: 33 collections, 124 sample documents, 135 indexes.
Target database: gamerhub_restore_drill_...
Drill database dropped.
```

The sample drill verifies the write/index/query path, not the completeness of a
full archive. For a full restore, use `mongosh` against the restored database
and compare the core counts manually:

```bash
mongosh "$RESTORED_URI" --eval '
  printjson({
    users: db.users.countDocuments(),
    posts: db.posts.countDocuments(),
    comments: db.comments.countDocuments(),
    communities: db.communities.countDocuments(),
    notifications: db.notifications.countDocuments(),
    productEvents: db.productevents.countDocuments()
  })
'
```

Also inspect `db.users.getIndexes()` and `db.posts.getIndexes()` in the restored
database. Then verify:

- [ ] A known user can sign in with their existing password.
- [ ] A post and its comments load with the expected author.
- [ ] A notification belongs to the expected recipient.
- [ ] The unique `product_events_first_unique` index exists.
- [ ] The `notification_retention_ttl` and `product_events_ttl` indexes exist.
- [ ] `/api/health/ready` returns `200` against the restored environment.
- [ ] The restored app can create, edit and delete one throwaway post.

## 5. Clean up

After recording the result, remove the drill database and local archive:

```bash
# Atlas UI: Database → browse the drill database → Delete database
# or, only against the drill database:
# mongosh "$DRILL_URI" --eval 'db.dropDatabase()'

shred -u backups/gamerhub-$STAMP.archive.gz   # or your OS equivalent
```

Keep the verification record (date, collection counts, index names, any
mismatch) in the release notes. Do not keep the archive in the repository.

## 6. Recovery targets

| Target | Expectation |
|---|---|
| RPO (maximum lost writes) | Whatever the latest explicit archive/snapshot represents. M0 has no automatic point-in-time recovery; schedule archives before risky changes. |
| RTO (time to restore) | Measure it during the drill. A small M0 archive should restore in minutes; a large paid cluster depends on Atlas. |
| Rollback | Restore the archive into a new database/cluster, point `MONGO_URI` at it, redeploy, then re-run `/api/health/ready` and the login smoke test. Never mutate the live database as a rollback. |

## 7. Failure signs

- `mongorestore` reports a duplicate key: the target was not empty. Drop the
  drill database and start again.
- Index creation fails with `IndexOptionsConflict`: the restored schema differs
  from the running model; run the migration status check and reconcile before
  switching traffic.
- Counts differ but the archive is readable: check whether the archive was taken
  while writes were still occurring. Take a maintenance-window archive for a
  strict comparison.
- `backup:drill` refuses the database name: the safety guard requires `drill`,
  `restore`, `test` or `tmp` in the name. This is intentional.
