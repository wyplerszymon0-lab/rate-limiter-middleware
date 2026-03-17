/**
 * examples/server.js
 * Example Express app demonstrating route-level rate limiting.
 *
 * Run: node examples/server.js
 */

'use strict';

const express = require('express');
const { createRateLimiter } = require('../index');

const app = express();
app.use(express.json());

// --- Global limiter: 200 req/min for all routes ---
const globalLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 200,
});
app.use(globalLimiter);

// --- Strict limiter for auth endpoints: 10 req/15min ---
const authLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 10,
  handler(req, res) {
    res.status(429).json({
      error: 'Too many login attempts. Try again in 15 minutes.',
    });
  },
});

// --- API limiter keyed by API token, not IP ---
const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
});

// Routes
app.post('/auth/login', authLimiter, (req, res) => {
  res.json({ message: 'Login OK', rateLimit: req.rateLimit });
});

app.get('/api/data', apiLimiter, (req, res) => {
  res.json({ data: [1, 2, 3], rateLimit: req.rateLimit });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  console.log('Try: curl http://localhost:3000/api/data -H "x-api-key: mytoken"');
});
