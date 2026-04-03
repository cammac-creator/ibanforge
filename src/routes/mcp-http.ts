/**
 * HTTP transport for the MCP server.
 * Exposes the same tools as the stdio MCP server (validate_iban, batch_validate_iban, lookup_bic)
 * via Streamable HTTP at /mcp — compatible with Smithery, remote MCP clients, etc.
 */

import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { lookup } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';

const mcpHttp = new Hono();

// Store active transports by session ID
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'ibanforge', version: '1.0.0' });

  server.tool(
    'validate_iban',
    'Validate a single IBAN — returns country, BIC, SEPA info, issuer classification, and risk indicators. 75+ countries.',
    { iban: z.string().describe('IBAN to validate (spaces/hyphens stripped automatically)') },
    async ({ iban }) => {
      const result = validateIBAN(iban);
      enrichResult(result);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'batch_validate_iban',
    'Validate up to 100 IBANs in one call — each result includes BIC, SEPA, issuer, and risk data.',
    { ibans: z.array(z.string()).min(1).max(100).describe('Array of IBANs (1-100)') },
    async ({ ibans }) => {
      const results = ibans.map((iban) => {
        const result = validateIBAN(iban);
        enrichResult(result);
        return result;
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    'lookup_bic',
    'Look up a BIC/SWIFT code — returns institution, country, city, LEI, branch info. 39K+ entries from GLEIF.',
    { bic: z.string().describe('BIC/SWIFT code (8 or 11 chars)') },
    async ({ bic }) => {
      const validation = validateBIC(bic);
      if (!validation.valid) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ bic: validation.bic, valid: false, error: validation.error }, null, 2) }],
        };
      }
      const row = lookup(validation.bic11!);
      const result = {
        bic: validation.bic, bic8: validation.bic8, bic11: validation.bic11,
        valid_format: true, found: row !== null,
        institution: row?.institution ?? null,
        country_code: validation.country_code, country_name: row?.country_name ?? null,
        city: row?.city ?? null, branch_code: validation.branch_code,
        branch_info: row?.branch_info ?? null,
        lei: row?.lei ?? null, lei_status: row?.lei_status ?? null,
        is_test_bic: validation.is_test_bic,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

// Handle POST /mcp (client → server messages)
mcpHttp.post('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');

  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    // New session — create transport and connect server
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });

    const server = createMcpServer();
    await server.connect(transport);
  }

  const response = await transport.handleRequest(c.req.raw);
  return response;
});

// Handle GET /mcp (SSE stream for server → client notifications)
mcpHttp.get('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    return c.json({ error: 'No active session. Send a POST first.' }, 400);
  }

  const response = await transport.handleRequest(c.req.raw);
  return response;
});

// Handle DELETE /mcp (close session)
mcpHttp.delete('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    return c.json({ error: 'No active session.' }, 400);
  }

  const response = await transport.handleRequest(c.req.raw);
  transports.delete(sessionId!);
  return response;
});

export { mcpHttp };
