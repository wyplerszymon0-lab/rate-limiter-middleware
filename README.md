# rate-limiter-middleware 🚦

A production-ready sliding window rate limiter middleware for Express. Pluggable backend — works in-memory for single-process apps and with Redis for distributed deployments.

## Why sliding window?

Fixed window counters reset at predictable boundaries, which allows a "double burst" attack: 100 requests just before midnight + 100 requests just after = 200 requests in 1 second. The sliding window algorithm interpolates between the current and previous window, eliminating this spike.

```
Fixed window:   |──100──|──100──|  ← burst at boundary ✗
Sliding window: smooth interpolation across boundary  ✓
```

## Install

```bash
npm install rate-limiter-middleware
# Redis support (optional):
npm install ioredis
```

## Quick start

```js
const express = require('express');
const { createRateLimiter } = require('rate-limiter-middleware');

const app = express();

// 100 requests per minute per IP (default)
app.use(createRateLimiter({ windowMs: 60_000, max: 100 }));

app.get('/', (req, res) => {
  res.json({ rateLimit: req.rateLimit });
});
```

## Route-level configuration

```js
const { createRateLimiter } = require('rate-limiter-middleware');

// Strict limiter for auth endpoints
const authLimiter = createRateLimiter({
  windowMs: 15 * 60_000,  // 15 minutes
  max: 10,
  handler(req, res) {
    res.status(429).json({ error: 'Too many login attempts.' });
  },
});

// API key-based limiting
const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
});

app.post('/auth/login', authLimiter, loginHandler);
app.use('/api', apiLimiter);
```

## Redis (distributed)

```js
const Redis = require('ioredis');
const { createRateLimiter, RedisStore } = require('rate-limiter-middleware');

const redis = new Redis({ host: 'localhost', port: 6379 });

const limiter = createRateLimiter({
  windowMs: 60_000,
  max: 100,
  store: new RedisStore(redis),
});
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `windowMs` | number | `60000` | Time window in milliseconds |
| `max` | number | `100` | Max requests per window |
| `keyGenerator` | `(req) => string` | `req.ip` | Key function for identifying clients |
| `handler` | `(req, res, next, info) => void` | 429 JSON | Called when limit exceeded |
| `skip` | `(req) => bool` | `null` | Return true to skip rate limiting |
| `skipFailedRequests` | boolean | `false` | Don't count 4xx/5xx responses |
| `headers` | boolean | `true` | Send `RateLimit-*` headers |
| `store` | Store instance | `MemoryStore` | Storage backend |

## Response headers

```
RateLimit-Limit:     100
RateLimit-Remaining: 73
RateLimit-Reset:     1700000060
RateLimit-Policy:    100;w=60
Retry-After:         47        (only on 429)
```

## `req.rateLimit`

Attached to every request:

```js
req.rateLimit = {
  limit: 100,
  current: 27,
  remaining: 73,
  resetTime: 1700000060,
}
```

## Running tests

```bash
node tests/rate-limiter.test.js
```

## Architecture

```
index.js                   ← public API
src/
  rate-limiter.js          ← middleware factory
  sliding-window.js        ← interpolation math
  memory-store.js          ← in-process store (Map-based)
  redis-store.js           ← Redis store (Lua atomic increment)
examples/
  server.js                ← complete Express example
tests/
  rate-limiter.test.js     ← unit tests (no extra deps)
```
