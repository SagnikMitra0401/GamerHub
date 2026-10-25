/**
 * In-memory stand-in for `@upstash/redis`.
 *
 * The cache and the like buffer both reach Redis through
 * `server/config/redisClient.js`, which does `require('@upstash/redis')`. We
 * install this module into `require.cache` under that exact path *before*
 * anything requires the real package, so the production client, the feature
 * switch in `config/redis.js` and the namespaced keys are all still the real
 * code — only the network disappears.
 *
 * Nothing is mocked that the code under test does not own: if `getRedis()` or
 * `redisKey()` changes, these tests see it.
 */
const REDIS_MODULE_PATH = require.resolve('@upstash/redis');

/**
 * Shared per-process state. One client is memoised by `redisClient.js`, so the
 * tests need to inspect the same store the client writes to.
 */
function createStore() {
  return {
    strings: new Map(),   // key -> value
    hashes: new Map(),    // key -> Map(field -> value)
    sets: new Map(),      // key -> Set(member)
    calls: [],            // every command name, in order
    failCommands: new Set(),
    ttl: new Map(),       // key -> number of seconds from the last SET

    reset() {
      this.strings.clear();
      this.hashes.clear();
      this.sets.clear();
      this.ttl.clear();
      this.calls.length = 0;
      this.failCommands.clear();
    },

    hash(key) {
      if (!this.hashes.has(key)) this.hashes.set(key, new Map());
      return this.hashes.get(key);
    },

    setMembers(key) {
      if (!this.sets.has(key)) this.sets.set(key, new Set());
      return this.sets.get(key);
    },

    /** Count of a command since the last reset — cheaper than filtering. */
    count(command) {
      return this.calls.filter(name => name === command).length;
    }
  };
}

const store = createStore();

function run(command, work) {
  store.calls.push(command);
  if (store.failCommands.has(command)) {
    return Promise.reject(new Error(`fake redis: ${command} is unavailable`));
  }
  return Promise.resolve().then(work);
}

class FakeRedis {
  constructor(options) {
    this.options = options;
    FakeRedis.instances.push(this);
  }

  get(key) {
    return run('get', () => {
      const value = store.strings.get(key);
      return value === undefined ? null : value;
    });
  }

  set(key, value, options) {
    return run('set', () => {
      store.strings.set(key, value);
      if (options && Number.isFinite(options.ex)) store.ttl.set(key, options.ex);
      return 'OK';
    });
  }

  del(...keys) {
    return run('del', () => {
      let removed = 0;
      for (const key of keys.flat()) {
        if (store.strings.delete(key)) removed += 1;
        if (store.hashes.delete(key)) removed += 1;
        if (store.sets.delete(key)) removed += 1;
      }
      return removed;
    });
  }

  hset(key, fieldOrObject, maybeValue) {
    return run('hset', () => {
      const hash = store.hash(key);
      const entries = typeof fieldOrObject === 'object'
        ? Object.entries(fieldOrObject)
        : [[fieldOrObject, maybeValue]];
      let created = 0;
      for (const [field, value] of entries) {
        if (!hash.has(field)) created += 1;
        hash.set(field, value);
      }
      return created;
    });
  }

  hget(key, field) {
    return run('hget', () => {
      const value = store.hash(key).get(field);
      return value === undefined ? null : value;
    });
  }

  hgetall(key) {
    return run('hgetall', () => {
      const hash = store.hash(key);
      const result = {};
      for (const [field, value] of hash) result[field] = value;
      // Upstash returns null for a missing key.
      return Object.keys(result).length ? result : null;
    });
  }

  hdel(key, ...fields) {
    return run('hdel', () => {
      const hash = store.hash(key);
      let removed = 0;
      for (const field of fields.flat()) {
        if (hash.delete(field)) removed += 1;
      }
      return removed;
    });
  }

  sadd(key, member) {
    return run('sadd', () => {
      const set = store.setMembers(key);
      if (set.has(member)) return 0;
      set.add(member);
      return 1;
    });
  }
}

FakeRedis.instances = [];

const fakeModule = { Redis: FakeRedis, RedisError: Error };

/**
 * Install the fake in front of `@upstash/redis`. Idempotent; safe to call from
 * every test file because `node --test` gives each file its own process.
 */
function installFakeRedis() {
  require.cache[REDIS_MODULE_PATH] = {
    id: REDIS_MODULE_PATH,
    filename: REDIS_MODULE_PATH,
    loaded: true,
    exports: fakeModule
  };
  return store;
}

/** Turn the Redis feature switch on for the rest of the file. */
function enableRedis() {
  process.env.REDIS_ENABLED = '1';
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
}

function disableRedis() {
  delete process.env.REDIS_ENABLED;
}

module.exports = { installFakeRedis, enableRedis, disableRedis, store, FakeRedis };
