---
title: Building an IBAN Validation API with Hono, SQLite, and MCP
published: true
tags: typescript, api, webdev, ai
cover_image: https://api.ibanforge.com/og-image.png
---

# Building an IBAN Validation API with Hono, SQLite, and MCP

I recently shipped [IBANforge](https://ibanforge.com), a free API for IBAN validation and BIC/SWIFT lookup. v1.1.0 adds Swiss clearing data (1,100+ BC-Nummer entries from SIX with SIC, euroSIC, Instant Payments), 85 EMI/neobank classifications, and 5 MCP tools for AI agents. In this article, I'll walk through the key architectural decisions and share real code from the project.

## Why Hono Over Express

When I started IBANforge, I considered Express, Fastify, and Hono. I went with Hono for three reasons:

1. **Performance** -- Hono is built for edge runtimes and benchmarks significantly faster than Express on Node.js
2. **TypeScript-first** -- Full type inference on routes, middleware, and context
3. **Lightweight middleware** -- Built-in CORS, compression, and logging with zero config

Here's how the main app comes together:

```typescript
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const app = new Hono();

app.use('*', cors({ origin: '*' }));
app.use('*', logger());
app.use('*', compress());

// x402 payment middleware only on paid routes
app.use('/v1/*', createX402Middleware());

// Routes
app.route('/', ibanValidate);
app.route('/', bicLookup);
app.route('/', health);
```

The route handler for IBAN validation is clean and readable:

```typescript
ibanValidate.post('/v1/iban/validate', async (c) => {
  const start = performance.now();
  const body = await c.req.json<{ iban?: unknown }>();

  const result = validateIBAN(body.iban as string);

  // Enrich with BIC, SEPA info, issuer classification, and risk indicators
  enrichResult(result);

  result.processing_ms = Math.round(
    (performance.now() - start) * 100
  ) / 100;

  return c.json(result);
});
```

No decorators, no class inheritance, no magic -- just functions.

## SQLite for Lookup Data

IBANforge stores 121k+ BIC/SWIFT entries aggregated from public sources (GLEIF, SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), with LEI enrichment for the 39k+ rows sourced from [GLEIF](https://www.gleif.org/) (the Global Legal Entity Identifier Foundation, CC0).

Why SQLite instead of PostgreSQL?

- **Zero infrastructure** -- The database is a single file shipped inside the Docker image
- **Read performance** -- Queries take <10ms for exact BIC lookups
- **Simplicity** -- No connection pools, no migrations server, no managed database costs

The BIC lookup uses prepared statements with an LRU cache on top:

```typescript
import { getBicDB } from './db.js';
import { LRUCache } from './cache.js';

const bicCache = new LRUCache<BICRow | null>(2000);

function lookupByBic11(bic11: string): BICRow | null {
  const db = getBicDB();
  const stmt = db.prepare(
    'SELECT * FROM bic_entries WHERE bic11 = ? LIMIT 1'
  );
  return (stmt.get(bic11) as BICRow) ?? null;
}

export function lookup(bic: string): BICRow | null {
  const cached = bicCache.get(bic);
  if (cached !== undefined) return cached;

  const result = bic.length === 11
    ? lookupByBic11(bic)
    : lookupByBic11(bic + 'XXX');

  bicCache.set(bic, result);
  return result;
}
```

The LRU cache wraps the main `lookup()` entry point, so repeated lookups for the same BIC code are sub-microsecond. For the initial lookup, SQLite returns in ~2-5ms -- fast enough for real-time validation.

## MCP Integration: How AI Agents Use the API

This is what makes IBANforge different from existing IBAN APIs. The [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) lets AI agents like Claude discover and call API tools natively.

Here's how we expose IBAN validation as an MCP tool:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'ibanforge',
  version: '1.1.0',
});

server.registerTool(
  'validate_iban',
  {
    title: 'Validate IBAN',
    description: 'Validate a single IBAN and retrieve BIC/SWIFT info.',
    inputSchema: {
      iban: z.string().describe('IBAN to validate. Spaces accepted.'),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  async ({ iban }) => {
    const result = validateIBAN(iban);
    enrichResult(result);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
);
```

Once configured, an AI agent can say "validate this IBAN: CH93 0076 2011 6238 5295 7" and get structured bank data back -- no prompt engineering required.

The MCP server runs over stdio transport, which means any MCP-compatible client (Claude Desktop, Cursor, custom agents) can plug it in with a single config entry.

## The x402 Micropayment Model

Instead of API keys and monthly subscriptions, IBANforge uses [x402](https://www.x402.org/) -- an HTTP-native payment protocol. The idea is simple: the API responds with `402 Payment Required` and the client pays per-call in USDC on Base L2.

Pricing:
- IBAN validation: $0.005 per call
- BIC lookup: $0.003 per call
- Batch validation: $0.002 per IBAN

During launch, all endpoints are free. The x402 middleware is configured but not enforced yet. When it goes live, there's no signup, no API key management, no billing dashboard -- just pay and use.

```typescript
// x402 middleware applied only to /v1/* routes
app.use('/v1/*', createX402Middleware());
```

## The Numbers

The entire infrastructure costs ~$6/month:

| Component | Cost |
|-----------|------|
| Railway (API) | $5/month |
| Vercel (frontend) | $0/month |
| Domain | ~$1/month |
| GLEIF data | free (CC0) |

The SQLite database holds 121k+ BIC entries (39k+ LEI-enriched via GLEIF). No managed database fees.

## Try It

- **Playground**: [ibanforge.com/playground](https://ibanforge.com/playground) -- test IBAN validation and BIC lookup interactively
- **API Docs**: [ibanforge.com/docs](https://ibanforge.com/docs) -- full reference with curl, Python, and TypeScript examples
- **GitHub**: [github.com/cammac-creator/ibanforge](https://github.com/cammac-creator/ibanforge) -- MIT license, self-hostable

If you're building payment workflows, KYC pipelines, or AI agents that handle bank data -- give it a try. I'd love to hear your feedback.
