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
import { enrich402Middleware } from './middleware/enrich-402.js';
import { apiKeys } from './routes/api-keys.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { recordRequest } from './lib/stats.js';

// Fail-fast: refuse to start in production without wallet config
ensureWalletConfigured();

import type { HonoEnv } from './types.js';

const app = new Hono<HonoEnv>();

// Global middleware
const configuredOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use('*', cors({
  origin: (origin) => {
    if (configuredOrigins.includes('*')) return '*';
    if (localhostPattern.test(origin)) return origin;
    return configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
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

// ─── Crawler / agent-friendly metadata ───────────────────────────────────────

// /robots.txt — allow all bots, point crawlers to OpenAPI + agent discovery
app.get('/robots.txt', (c) => {
  return c.text(
    [
      'User-agent: *',
      'Allow: /',
      '',
      '# AI agent discovery',
      'Sitemap: https://ibanforge.com/sitemap.xml',
      'X-OpenAPI: https://api.ibanforge.com/openapi.json',
      'X-x402: https://api.ibanforge.com/.well-known/x402',
      'X-MCP: https://api.ibanforge.com/mcp',
    ].join('\n'),
    200,
    { 'Content-Type': 'text/plain; charset=utf-8' },
  );
});

// /llms.txt — emerging standard (llmstxt.org) for AI agents to understand the API
app.get('/llms.txt', (c) => {
  return c.text(
    `# IBANforge

> IBAN validation, BIC/SWIFT lookup, Swiss clearing and compliance risk scoring API designed for AI agents and developers. 121K+ bank entries from GLEIF, 1,190 Swiss BC-Nummer from SIX, 84 countries, 85 EMI/vIBAN issuer classifications.

## Quick start for agents

- **Free demo (no auth):** GET https://api.ibanforge.com/v1/demo
- **Free tier (200 req/month):** POST https://api.ibanforge.com/v1/keys/generate {"email":"you@example.com"} then use \`Authorization: Bearer ifk_xxx\` (or \`X-API-Key: ifk_xxx\`).
- **Pay per call (x402, USDC on Base L2):** see https://api.ibanforge.com/.well-known/x402

## Discovery endpoints

- OpenAPI 3.1: https://api.ibanforge.com/openapi.json
- x402 metadata: https://api.ibanforge.com/.well-known/x402
- Agent capabilities: https://api.ibanforge.com/.well-known/agents.json
- MCP HTTP transport: https://api.ibanforge.com/mcp
- MCP server card: https://api.ibanforge.com/.well-known/mcp/server-card.json

## Endpoints

- POST /v1/iban/validate — single IBAN validation ($0.005)
- POST /v1/iban/batch — up to 100 IBANs ($0.002 each)
- GET /v1/bic/:code — BIC/SWIFT lookup ($0.003)
- POST /v1/iban/compliance — full compliance check ($0.02)
- GET /v1/ch/clearing/:iid — Swiss clearing lookup ($0.003)

## Documentation

- Human docs: https://ibanforge.com/docs
- Pricing: https://ibanforge.com/pricing
- GitHub: https://github.com/cammac-creator/ibanforge
`,
    200,
    { 'Content-Type': 'text/plain; charset=utf-8' },
  );
});

// /v1 index — agents that probe /v1 root expect a discovery hint instead of 404
app.get('/v1', (c) =>
  c.json({
    name: 'IBANforge API v1',
    documentation: 'https://api.ibanforge.com/openapi.json',
    discovery: {
      x402: 'https://api.ibanforge.com/.well-known/x402',
      mcp: 'https://api.ibanforge.com/mcp',
      agents: 'https://api.ibanforge.com/.well-known/agents.json',
      llms: 'https://api.ibanforge.com/llms.txt',
    },
    endpoints: {
      paid: ['POST /v1/iban/validate', 'POST /v1/iban/batch', 'GET /v1/bic/:code', 'POST /v1/iban/compliance', 'GET /v1/ch/clearing/:iid'],
      free: ['GET /v1/demo', 'POST /v1/keys/generate', 'GET /v1/keys/usage'],
    },
  }),
);

// /docs — common path agents try; redirect to actual docs
app.get('/docs', (c) => c.redirect('https://ibanforge.com/docs', 302));

// /api and /api/v1 aliases — common probing patterns
app.get('/api', (c) => c.redirect('/v1', 302));
app.get('/api/v1', (c) => c.redirect('/v1', 302));

// Pre-validate requests before x402 paywall (don't charge for invalid input).
// Field names are case-insensitive (handled by route handlers via getIban/getIbansArray).
import { getIban, getIbansArray } from './lib/request-helpers.js';

app.post('/v1/iban/validate', async (c, next) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const iban = getIban(body);
  if (!iban || typeof iban !== 'string' || iban.trim() === '') {
    return c.json({ error: 'invalid_request', message: "Request body must include an 'iban' field (case-insensitive: 'iban', 'IBAN', 'Iban' all work)." }, 400);
  }
  await next();
});
app.post('/v1/iban/compliance', async (c, next) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const iban = getIban(body);
  if (!iban || typeof iban !== 'string' || iban.trim() === '') {
    return c.json({ error: 'invalid_request', message: "Request body must include an 'iban' field (case-insensitive)." }, 400);
  }
  await next();
});
app.post('/v1/iban/batch', async (c, next) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const ibans = getIbansArray(body);
  if (!Array.isArray(ibans) || ibans.length === 0) {
    return c.json({ error: 'invalid_request', message: "Request body must include a non-empty array of IBANs. Field accepted: 'ibans', 'iban_list' or 'list'." }, 400);
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

// Enrich empty 402 responses with human-readable instructions
app.use('/v1/*', enrich402Middleware());

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
