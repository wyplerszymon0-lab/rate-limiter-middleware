/**
 * memory-store.js
 * In-process store backend. Fast, zero dependencies.
 * Not suitable for multi-process / multi-server deployments — use RedisStore for those.
 */

'use strict';

class MemoryStore {
  constructor() {
    /** @type {Map<string, { current: number, previous: number, windowStart: number }>} */
    this._buckets = new Map();
    // Periodically clean up expired keys to prevent memory leaks
    this._gcInterval = setInterval(() => this._gc(), 60_000);
    this._gcInterval.unref?.(); // don't block process exit in Node
  }

  /**
   * Increment the counter for a key within the given window.
   * Returns { current, previous, windowStart }.
   *
   * @param {string} key
   * @param {number} windowMs
   * @param {number} [now]
   * @returns {{ current: number, previous: number, windowStart: number }}
   */
  increment(key, windowMs, now = Date.now()) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    let bucket = this._buckets.get(key);

    if (!bucket) {
      bucket = { current: 1, previous: 0, windowStart };
      this._buckets.set(key, bucket);
      return { ...bucket };
    }

    if (bucket.windowStart === windowStart) {
      // Same window — just increment current
      bucket.current += 1;
    } else if (bucket.windowStart === windowStart - windowMs) {
      // Moved into next window — rotate buckets
      bucket.previous = bucket.current;
      bucket.current = 1;
      bucket.windowStart = windowStart;
    } else {
      // Window is stale (>1 window old) — full reset
      bucket.previous = 0;
      bucket.current = 1;
      bucket.windowStart = windowStart;
    }

    return { ...bucket };
  }

  /**
   * Reset the counter for a key (useful in tests or admin endpoints).
   * @param {string} key
   */
  reset(key) {
    this._buckets.delete(key);
  }

  /** Remove entries older than 2 windows. */
  _gc() {
    const now = Date.now();
    for (const [key, bucket] of this._buckets.entries()) {
      // No windowMs stored per key — use a generous 10-minute cutoff
      if (now - bucket.windowStart > 10 * 60 * 1000) {
        this._buckets.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this._gcInterval);
  }
}

module.exports = { MemoryStore };
