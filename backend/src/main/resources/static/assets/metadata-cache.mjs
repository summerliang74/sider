/** Bounded, expiring JSON values in this tab only. Each caller owns its wait,
 * while speculative and foreground callers share the underlying request. */
export class MetadataCache {
  constructor({ limit = 24, now = Date.now } = {}) { this.entries = new Map(); this.limit = limit; this.now = now; }
  read(key, load, { ttl = 30000, signal, fresh = false } = {}) {
    signal?.throwIfAborted();
    let entry = this.entries.get(key);
    if (fresh || entry && !entry.pending && entry.expires <= this.now()) { this.invalidate(name => name === key); entry = null; }
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, pending: true };
      this.entries.set(key, entry);
      entry.promise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(controller.signal); }).then(value => {
        if (this.entries.get(key) === entry) { entry.pending = false; entry.expires = this.now() + ttl; }
        return value;
      }).catch(error => { if (this.entries.get(key) === entry) this.entries.delete(key); throw error; });
      while (this.entries.size > this.limit) {
        // Evicted in-flight readers may finish, but cannot refill the cache.
        this.entries.delete(this.entries.keys().next().value);
      }
    }
    entry.readers = (entry.readers || 0) + 1;
    return waitFor(entry.promise, signal).then(value => { signal?.throwIfAborted(); return structuredClone(value); }).finally(() => {
      entry.readers--;
      if (entry.pending && !entry.readers) {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        entry.controller.abort();
      }
    });
  }
  invalidate(matches = () => true) {
    for (const [key, entry] of this.entries) if (matches(key)) { this.entries.delete(key); entry.controller.abort(); }
  }
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
