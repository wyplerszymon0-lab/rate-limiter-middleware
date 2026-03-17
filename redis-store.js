/**
 * redis-store.js
 * Redis-backed store for distributed / multi-process deployments.
 * Requires `ioredis` package: npm install ioredis
 *
 * Uses a Lua script for atomic increment + TTL in a single round-trip.
 */

'use strict';

/**
 * Atomic Lua script:
 *  KEYS[1] = current bucket key
 *  KEYS[2] = previous bucket key
 *  ARGV[1] = TTL in seconds (2 * window)
 */
const INCR_SCRIPT = `
local curr = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
local prev = tonumber(redis.call('GET', KEYS[2])) or 0
return {curr, prev}
`;

class RedisStore {
  /**
   * @param {import('ioredis').Redis} client - an ioredis client instance
   */
  constructor(client) {
    if (!client) throw new Error('RedisStore requires an ioredis client instance.');
    this._client = client;
    this._script = INCR_SCRIPT;
  }

  /**
   * Increment the counter for a key within the given window.
   * Returns { current, previous, windowStart }.
   *
   * @param {string} key
   * @param {number} windowMs
   * @param {number} [now]
   * @returns {Promise<{ current: number, previous: number, windowStart: number }>}
   */
  async increment(key, windowMs, now = Date.now()) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const currentKey = `rl:${key}:${windowStart}`;
    const previousKey = `rl:${key}:${windowStart - windowMs}`;
    const ttlSeconds = Math.ceil((windowMs * 2) / 1000);

    const [current, previous] = await this._client.eval(
      this._script,
      2,
      currentKey,
      previousKey,
      ttlSeconds
    );

    return {
      current: Number(current),
      previous: Number(previous),
      windowStart,
    };
  }

  /**
   * Reset the counter for a key.
   * @param {string} key
   * @param {number} windowMs
   * @param {number} [now]
   */
  async reset(key, windowMs, now = Date.now()) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    await this._client.del(
      `rl:${key}:${windowStart}`,
      `rl:${key}:${windowStart - windowMs}`
    );
  }
}

module.exports = { RedisStore };
