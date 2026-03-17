/**
 * sliding-window.js
 * Sliding window counter algorithm for rate limiting.
 * Works with any store backend (memory or Redis).
 */

'use strict';

/**
 * Calculates current request count using a sliding window.
 *
 * The window is split into two buckets:
 *  - current  bucket  (this full window period)
 *  - previous bucket  (last full window period)
 *
 * The effective count is interpolated:
 *   count = previousCount * (remainingWeightOfPreviousWindow) + currentCount
 *
 * This avoids the "reset spike" problem of fixed windows.
 *
 * @param {object} params
 * @param {number} params.previousCount  - requests in previous window
 * @param {number} params.currentCount   - requests in current window
 * @param {number} params.windowMs       - window size in milliseconds
 * @param {number} params.now            - current timestamp (ms)
 * @returns {number} estimated request count in the sliding window
 */
function slidingWindowCount({ previousCount, currentCount, windowMs, now }) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const elapsed = now - windowStart;
  const previousWeight = 1 - elapsed / windowMs;
  return Math.floor(previousCount * previousWeight + currentCount);
}

module.exports = { slidingWindowCount };
