/**
 * Lightweight Atlas restore drill.
 *
 * This is not a replacement for an Atlas snapshot or a full mongodump. It
 * proves that a separate restore target can be created, written, indexed and
 * queried, and that the schema survives the round trip. Run it before a risky
 * migration; follow docs/BACKUP_RESTORE.md for the full snapshot procedure.
 *
 * It copies at most BACKUP_DRILL_LIMIT documents per collection (default 25),
 * never prints document content, and drops the throwaway database unless
 * BACKUP_DRILL_KEEP=1.
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const SYSTEM_COLLECTION = /^system\./;
const SAFE_TARGET_NAME = /(drill|restore|test|tmp)/i;

function databaseName(url) {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new Error('The connection string must include a database name.');
  return name;
}

function indexOptions(index) {
  const options = { ...index };
  delete options.key;
  delete options.v;
  delete options.ns;
  return options;
}

async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');

  const sourceUri = process.env.MONGO_URI;
  const sourceUrl = new URL(sourceUri);
  const sourceDbName = databaseName(sourceUrl);

  const targetUri = process.env.BACKUP_DRILL_URI || sourceUri;
  const targetUrl = new URL(targetUri);
  const requestedTargetDb = databaseName(targetUrl);
  const targetDbName = process.env.BACKUP_DRILL_DB
    || (targetUri === sourceUri ? `gamerhub_restore_drill_${Date.now().toString(36)}` : requestedTargetDb);

  if (targetDbName === sourceDbName) {
    throw new Error('Refusing to restore into the source database. Use a separate drill database.');
  }
  if (!SAFE_TARGET_NAME.test(targetDbName)) {
    throw new Error('The drill database name must contain drill, restore, test or tmp.');
  }

  const limit = Math.min(500, Math.max(1, Number(process.env.BACKUP_DRILL_LIMIT) || 25));
  const keep = process.env.BACKUP_DRILL_KEEP === '1';

  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10_000 });
  await sourceClient.connect();
  const targetClient = targetUri === sourceUri
    ? sourceClient
    : new MongoClient(targetUri, { serverSelectionTimeoutMS: 10_000 });

  if (targetClient !== sourceClient) await targetClient.connect();

  const source = sourceClient.db(sourceDbName);
  const target = targetClient.db(targetDbName);

  let collections = 0;
  let documents = 0;
  let indexes = 0;

  try {
    const infos = await source.listCollections({}, { nameOnly: false }).toArray();
    const names = infos
      .filter((info) => !SYSTEM_COLLECTION.test(info.name) && info.type !== 'view')
      .map((info) => info.name)
      .sort();

    for (const name of names) {
      const rows = await source.collection(name).find({}).limit(limit).toArray();
      if (rows.length) {
        await target.collection(name).insertMany(rows, { ordered: false });
        documents += rows.length;
      }

      const specs = await source.collection(name).listIndexes().toArray().catch(() => []);
      for (const spec of specs) {
        if (spec.name === '_id_') continue;
        await target.collection(name).createIndex(spec.key, indexOptions(spec));
        indexes += 1;
      }

      const restored = await target.collection(name).countDocuments();
      if (restored !== rows.length) {
        throw new Error(`${name}: restored ${restored} documents, expected ${rows.length}`);
      }

      const restoredIndexes = new Set(
        (await target.collection(name).listIndexes().toArray()).map((spec) => spec.name)
      );
      for (const spec of specs) {
        if (!restoredIndexes.has(spec.name)) {
          throw new Error(`${name}: index ${spec.name} was not restored`);
        }
      }

      collections += 1;
      console.log(`  ${name}: ${rows.length} sample document(s), ${specs.length - 1} index(es)`);
    }

    console.log(
      `\nRestore drill passed: ${collections} collections, ${documents} sample documents, ${indexes} indexes.`
    );
    console.log(`Target database: ${targetDbName}`);
  } finally {
    if (!keep) {
      await target.dropDatabase();
      console.log('Drill database dropped.');
    } else {
      console.log('BACKUP_DRILL_KEEP=1: drill database retained for inspection.');
    }
    await targetClient.close();
    if (targetClient !== sourceClient) await sourceClient.close();
  }
}

run().catch((err) => {
  console.error(`Backup drill failed: ${err.message}`);
  process.exit(1);
});
