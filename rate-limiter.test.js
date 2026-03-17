'use strict';

/**
 * tests/rate-limiter.test.js
 * Unit tests using Node's built-in assert (no external test runner needed).
 */

const assert = require('assert');
const { slidingWindowCount } = require('../src/sliding-window');
const { MemoryStore } = require('../src/memory-store');
const { createRateLimiter } = require('../src/rate-limiter');

// ---------------------------------------------------------------------------
// Helper: mock Express req/res/next
// ---------------------------------------------------------------------------
function mockReq(ip = '127.0.0.1', headers = {}) {
  return { ip, headers, socket: { remoteAddress: ip } };
}

function mockRes() {
  const res = {
    _headers: {},
    _status: null,
    _body: null,
    setHeader(k, v) { this._headers[k] = v; },
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Sliding window math
// ---------------------------------------------------------------------------
function testSlidingWindowCount() {
  const windowMs = 60_000;
  // Use a base that's aligned: 1_700_000_040_000 % 60000 = 40000 — no
  // Find a 'now' where (now % 60000) === 30000 exactly
  // 1_700_000_010_000 % 60_000 = 10000, try 1_700_000_050_000 % 60000
  // Easier: just compute it
  const base = Math.ceil(1_700_000_000_000 / windowMs) * windowMs; // next window boundary
  const now = base + 30_000; // exactly 30s into that window
  const elapsed = now - Math.floor(now / windowMs) * windowMs;
  const weight = 1 - elapsed / windowMs;

  // 100 requests in prev window, 50 in current → 100*0.5 + 50 = 100
  const count = slidingWindowCount({ previousCount: 100, currentCount: 50, windowMs, now });
  const expected = Math.floor(100 * weight + 50);
  assert.strictEqual(count, expected, `Expected ${expected}, got ${count}`);
  console.log(`✓ slidingWindowCount interpolates correctly (weight=${weight}, count=${count})`);
}

function testSlidingWindowNoCarryover() {
  const windowMs = 60_000;
  // Use a timestamp exactly at a window boundary (divisible by windowMs)
  const now = Math.ceil(1_700_000_000_000 / windowMs) * windowMs; // exact boundary
  const count = slidingWindowCount({ previousCount: 100, currentCount: 0, windowMs, now });
  // elapsed = 0 → weight = 1 → 100*1 + 0 = 100
  assert.strictEqual(count, 100);
  console.log('✓ slidingWindowCount at window boundary (weight=1)');
}

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------
function testMemoryStoreIncrement() {
  const store = new MemoryStore();
  const windowMs = 60_000;
  const now = 1_700_000_000_000;

  const r1 = store.increment('user:1', windowMs, now);
  assert.strictEqual(r1.current, 1);

  const r2 = store.increment('user:1', windowMs, now + 1000);
  assert.strictEqual(r2.current, 2);
  console.log('✓ MemoryStore increments within window');

  store.destroy();
}

function testMemoryStoreWindowRotation() {
  const store = new MemoryStore();
  const windowMs = 60_000;
  const t0 = 1_700_000_000_000; // window A start

  store.increment('user:2', windowMs, t0);
  store.increment('user:2', windowMs, t0 + 1000);

  // Move to next window
  const t1 = t0 + windowMs;
  const r = store.increment('user:2', windowMs, t1);
  assert.strictEqual(r.current, 1);
  assert.strictEqual(r.previous, 2);
  console.log('✓ MemoryStore rotates buckets correctly');

  store.destroy();
}

function testMemoryStoreReset() {
  const store = new MemoryStore();
  const windowMs = 60_000;
  const now = Date.now();

  store.increment('user:3', windowMs, now);
  store.increment('user:3', windowMs, now);
  store.reset('user:3');

  const r = store.increment('user:3', windowMs, now);
  assert.strictEqual(r.current, 1);
  console.log('✓ MemoryStore.reset clears bucket');

  store.destroy();
}

// ---------------------------------------------------------------------------
// Middleware integration
// ---------------------------------------------------------------------------
async function testMiddlewareAllowsUnderLimit() {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });

  let nextCalled = false;
  const req = mockReq('10.0.0.1');
  const res = mockRes();
  await limiter(req, res, () => { nextCalled = true; });

  assert.ok(nextCalled, 'next() should be called when under limit');
  assert.strictEqual(res._headers['RateLimit-Limit'], 5);
  assert.ok(req.rateLimit.remaining >= 0);
  console.log('✓ Middleware calls next() when under limit');
}

async function testMiddlewareBlocksAtLimit() {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
  const ip = '10.0.0.2';

  // Exhaust the limit
  for (let i = 0; i < 3; i++) {
    await limiter(mockReq(ip), mockRes(), () => {});
  }

  // 4th request should be blocked
  const res = mockRes();
  let nextCalled = false;
  await limiter(mockReq(ip), res, () => { nextCalled = true; });

  assert.ok(!nextCalled, 'next() should NOT be called when limit exceeded');
  assert.strictEqual(res._status, 429);
  console.log('✓ Middleware returns 429 when limit exceeded');
}

async function testMiddlewareSkip() {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    skip: (req) => req.headers['x-skip'] === 'true',
  });

  const req = mockReq('10.0.0.3', { 'x-skip': 'true' });
  // Would be blocked without skip (limit=1), but skip returns true
  for (let i = 0; i < 5; i++) {
    let nextCalled = false;
    await limiter(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled, `Request ${i + 1} should skip rate limiting`);
  }
  console.log('✓ skip() predicate bypasses rate limiting');
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------
async function runAll() {
  testSlidingWindowCount();
  testSlidingWindowNoCarryover();
  testMemoryStoreIncrement();
  testMemoryStoreWindowRotation();
  testMemoryStoreReset();
  await testMiddlewareAllowsUnderLimit();
  await testMiddlewareBlocksAtLimit();
  await testMiddlewareSkip();
  console.log('\nAll tests passed ✓');
}

runAll().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
