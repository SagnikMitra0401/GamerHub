/**
 * Small in-memory TTL cache.
 *
 * Used to stay inside third-party quotas (YouTube Data API, FreeToGame). It
 * also collapses concurrent misses into one upstream call, so a burst of
 * requests cannot multiply the quota cost.
 */
function createTtlCache({ ttlMs = 60_000, maxEntries = 100 } = {}) {
  const store = new Map();     // key -> { value, expiresAt }
  const inflight = new Map();  // key -> Promise

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, overrideTtlMs) {
    const ttl = Number.isFinite(overrideTtlMs) ? overrideTtlMs : ttlMs;
    if (store.size >= maxEntries && !store.has(key)) {
      // Map preserves insertion order, so the first key is the oldest.
      store.delete(store.keys().next().value);
    }
    store.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  }

  /** @returns {Promise<any>} cached value, or the result of `loader()` */
  async function wrap(key, loader, overrideTtlMs) {
    const cached = get(key);
    if (cached !== undefined) return cached;

    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
      try {
        const value = await loader();
        set(key, value, overrideTtlMs);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  }

  return {
    get,
    set,
    wrap,
    delete: (key) => store.delete(key),
    clear: () => { store.clear(); inflight.clear(); },
    get size() { return store.size; }
  };
}

module.exports = { createTtlCache };
