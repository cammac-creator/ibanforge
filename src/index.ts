import { serve } from '@hono/node-server';
import { closeAll } from './lib/db.js';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ibanValidate } from './routes/iban-validate.js';
import { ibanBatch } from './routes/iban-batch.js';
import { bicLookup } from './routes/bic-lookup.js';
import { ibanCompliance } from './routes/iban-compliance.js';
import { chClearing } from './routes/ch-clearing.js';
import { health } from './routes/health.js';
import { stats } from './routes/stats.js';
import { demo } from './routes/demo.js';
import { landing } from './routes/landing.js';
import { openapi } from './routes/openapi.js';
import { discovery } from './routes/discovery.js';
import { ogImage } from './routes/og-image.js';
import { mcpHttp } from './routes/mcp-http.js';
import { mcpCard } from './routes/mcp-card.js';
import { createX402Middleware, ensureWalletConfigured } from './middleware/x402.js';
import { apiKeyMiddleware } from './middleware/api-key.js';
import { apiKeys } from './routes/api-keys.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { recordRequest } from './lib/stats.js';

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
  c.header('X-API-Version', '1.1.0');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});
app.use('*', rateLimitMiddleware());
app.use('*', compress());

// Track all HTTP requests for dashboard analytics
// Exclude internal/monitoring endpoints to avoid feedback loop
const SKIP_TRACKING = new Set(['/stats', '/stats/history', '/stats/hourly', '/stats/errors', '/stats/patterns', '/health', '/ping']);
app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  const path = new URL(c.req.url).pathname;
  if (!SKIP_TRACKING.has(path)) {
    recordRequest(c.req.method, path, c.res.status, performance.now() - start);
  }
});

// /ping — ultra-lightweight endpoint for latency testing and uptime monitoring
app.get('/ping', (c) => c.text('pong'));

// Pre-validate requests before x402 paywall (don't charge for invalid input)
app.post('/v1/iban/validate', async (c, next) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.iban !== 'string' || body.iban.trim() === '') {
    return c.json({ error: 'invalid_request', message: "Request body must include an 'iban' field (string)" }, 400);
  }
  await next();
});
app.post('/v1/iban/compliance', async (c, next) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.iban !== 'string' || body.iban.trim() === '') {
    return c.json({ error: 'invalid_request', message: "Request body must include an 'iban' field (string)" }, 400);
  }
  await next();
});
app.post('/v1/iban/batch', async (c, next) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.ibans) || body.ibans.length === 0) {
    return c.json({ error: 'invalid_request', message: "Request body must include a non-empty 'ibans' array" }, 400);
  }
  await next();
});
app.get('/v1/bic/:code', async (c, next) => {
  const code = c.req.param('code');
  if (!/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/.test(code)) {
    return c.json({ error: 'invalid_bic_format', message: 'BIC code must be 8 or 11 alphanumeric characters' }, 400);
  }
  await next();
});
app.get('/v1/ch/clearing/:iid', async (c, next) => {
  const iid = c.req.param('iid');
  if (!/^\d{1,5}$/.test(iid)) {
    return c.json({ error: 'invalid_iid_format', message: 'IID must be a 1-5 digit number.' }, 400);
  }
  await next();
});

// Key management routes (free, before x402)
app.route('/', apiKeys);

// API key middleware — checks Bearer ifk_* tokens before x402
app.use('/v1/*', apiKeyMiddleware());

// x402 payment middleware (only on paid routes, skipped if API key valid)
app.use('/v1/*', createX402Middleware());

// Paid routes
app.route('/', ibanValidate);
app.route('/', ibanBatch);
app.route('/', bicLookup);
app.route('/', ibanCompliance);
app.route('/', chClearing);

// Free routes
app.route('/', health);
app.route('/', stats);
app.route('/', demo);
app.route('/', openapi);
app.route('/', discovery);
app.route('/', ogImage);
app.route('/', mcpHttp);
app.route('/', mcpCard);

// Landing page (must be last — catches GET /)
app.route('/', landing);

// JSON 404 for unmatched routes
app.notFound((c) => {
  return c.json({ error: 'not_found', message: `Route ${c.req.method} ${new URL(c.req.url).pathname} not found` }, 404);
});

const port = parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`IBANforge running on http://localhost:${port}`);
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Closing database connections...`);
  closeAll();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
