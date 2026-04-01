import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ibanValidate } from './routes/iban-validate.js';
import { ibanBatch } from './routes/iban-batch.js';
import { bicLookup } from './routes/bic-lookup.js';
import { health } from './routes/health.js';
import { stats } from './routes/stats.js';
import { demo } from './routes/demo.js';
import { landing } from './routes/landing.js';
import { createX402Middleware, ensureWalletConfigured } from './middleware/x402.js';

// Fail-fast: refuse to start in production without wallet config
ensureWalletConfigured();

const app = new Hono();

// Global middleware
app.use('*', cors());
app.use('*', logger());

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

// Landing page (must be last — catches GET /)
app.route('/', landing);

const port = parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`IBANforge running on http://localhost:${port}`);
});
