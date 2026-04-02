import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ibanValidate } from './routes/iban-validate.js';
import { ibanBatch } from './routes/iban-batch.js';
import { bicLookup } from './routes/bic-lookup.js';
import { health } from './routes/health.js';
import { stats } from './routes/stats.js';
import { demo } from './routes/demo.js';
import { landing } from './routes/landing.js';
import { openapi } from './routes/openapi.js';
import { discovery } from './routes/discovery.js';
import { createX402Middleware, ensureWalletConfigured } from './middleware/x402.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';

// Fail-fast: refuse to start in production without wallet config
ensureWalletConfigured();

const app = new Hono();

// Global middleware
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());

app.use('*', cors({
  origin: (origin) => {
    if (allowedOrigins.includes('*')) return '*';
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Payment'],
}));
app.use('*', logger());
app.use('*', async (c, next) => {
  await next();
  c.header('X-Powered-By', 'IBANforge');
  c.header('X-API-Version', '1.0.0');
});
app.use('*', rateLimitMiddleware());
app.use('*', compress());

// /ping — ultra-lightweight endpoint for latency testing and uptime monitoring
app.get('/ping', (c) => c.text('pong'));

// x402 payment middleware (only on paid routes)
app.use('/v1/*', createX402Middleware());

// Paid routes
app.route('/', ibanValidate);
app.route('/', ibanBatch);
app.route('/', bicLookup);

// Free routes
app.route('/', health);
app.route('/', stats);
app.route('/', demo);
app.route('/', openapi);
app.route('/', discovery);

// Landing page (must be last — catches GET /)
app.route('/', landing);

const port = parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`IBANforge running on http://localhost:${port}`);
});
