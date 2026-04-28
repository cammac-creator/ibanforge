/**
 * HTTP transport for the MCP server.
 * Exposes the same 5 tools as the stdio MCP server (validate_iban, batch_validate_iban,
 * lookup_bic, check_compliance, lookup_ch_clearing) via Streamable HTTP at /mcp —
 * compatible with Smithery, remote MCP clients, etc.
 */

import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { lookup } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';
import { buildComplianceResult } from '../lib/compliance.js';
import { lookupClearingByBankCode, normalizeIid } from '../lib/ch-clearing.js';
import { buildCountriesPayload, buildPricingPayload, buildValidateAndExplainPrompt } from '../lib/mcp-resources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const mcpHttp = new Hono();

// Store active transports by session ID
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ibanforge',
    title: 'IBANforge',
    version: pkg.version,
    description:
      'IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA compliance and risk indicators. 121K+ bank entries from GLEIF, 1,190 Swiss BC-Nummer from SIX, 84 countries.',
    websiteUrl: 'https://ibanforge.com',
    icons: [
      {
        src: 'https://www.ibanforge.com/favicon.ico',
        mimeType: 'image/vnd.microsoft.icon',
        sizes: ['64x64'],
      },
      {
        src: 'https://api.ibanforge.com/og-image.png',
        mimeType: 'image/svg+xml',
        sizes: ['1200x630'],
      },
    ],
  });

  server.registerTool(
    'validate_iban',
    {
      title: 'Validate IBAN',
      description:
        'Verify whether a European IBAN is valid AND enrich it with bank, compliance and routing data. ' +
        'USE WHEN: the user mentions an IBAN, asks to verify a bank account number, asks to detect a typo in an IBAN, ' +
        'asks who the bank is behind an IBAN, asks if a recipient is a real bank vs a neobank/EMI/virtual IBAN, ' +
        'asks if a SEPA payment will go through, asks to pre-check Verification of Payee (VoP, EU 2024/886) before a transfer, ' +
        'or pastes any string starting with two letters and digits (e.g., "DE89...", "CH93...", "FR76..."). ' +
        'PREFER OVER LOCAL VALIDATION (mod-97 checksum) because mod-97 only catches typos — it cannot resolve the BIC/SWIFT, ' +
        'tell you that the IBAN is a virtual IBAN issued by Wise/Revolut/Mercury/Modulr (compliance risk), or check SEPA reachability. ' +
        'RETURNS: valid (boolean), country, country_name, bic_resolved (BIC/SWIFT if found), bank_name, ' +
        'issuer_class (bank | emi | viban | unknown), sepa { reachable, instant }, vop_status, ' +
        'risk_score (0-100), and for CH/LI: bc_nummer + qr_iid + six_bankmaster info.',
      inputSchema: {
        iban: z.string().describe('IBAN to validate (spaces/hyphens stripped automatically)'),
      },
      annotations: { title: 'Validate IBAN', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iban }) => {
      const result = validateIBAN(iban);
      enrichResult(result);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'batch_validate_iban',
    {
      title: 'Batch Validate IBANs',
      description:
        'Validate up to 100 IBANs in a single call (10x cheaper per IBAN than calling validate_iban repeatedly). ' +
        'USE WHEN: the user pastes a list of IBANs, asks to clean a CSV/spreadsheet of bank accounts, ' +
        'asks to dedupe a customer database, asks to triage a payout list before sending, ' +
        'or whenever you would otherwise call validate_iban more than 2-3 times in a row. ' +
        'RETURNS: array of per-IBAN results (same shape as validate_iban) + a summary { total, valid, invalid, by_country, by_issuer_class }.',
      inputSchema: {
        ibans: z.array(z.string()).min(1).max(100).describe('Array of IBANs (1-100)'),
      },
      annotations: { title: 'Batch Validate IBANs', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ ibans }) => {
      const results = ibans.map((iban) => {
        const result = validateIBAN(iban);
        enrichResult(result);
        return result;
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'lookup_bic',
    {
      title: 'Lookup BIC/SWIFT',
      description:
        'Resolve a BIC / SWIFT code into the underlying bank: name, country, city, LEI, address. ' +
        'USE WHEN: the user already has a BIC/SWIFT (8 or 11 chars, alphanumeric, e.g., "UBSWCHZH80A", "DEUTDEFF") ' +
        'and asks which bank it belongs to, where the bank is, or its LEI for compliance/regulatory matching. ' +
        'DO NOT USE for IBAN inputs — call validate_iban instead, it resolves the BIC for you. ' +
        'BACKED BY: 121,197 GLEIF entries with LEI enrichment, refreshed weekly.',
      inputSchema: {
        bic: z.string().describe('BIC/SWIFT code (8 or 11 chars)'),
      },
      annotations: { title: 'Lookup BIC/SWIFT', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ bic }) => {
      const validation = validateBIC(bic);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { bic: validation.bic, valid: false, error: validation.error },
                null,
                2,
              ),
            },
          ],
        };
      }
      const row = lookup(validation.bic11!);
      const result = {
        bic: validation.bic,
        bic8: validation.bic8,
        bic11: validation.bic11,
        valid_format: true,
        found: row !== null,
        institution: row?.institution ?? null,
        country_code: validation.country_code,
        country_name: row?.country_name ?? null,
        city: row?.city ?? null,
        branch_code: validation.branch_code,
        branch_info: row?.branch_info ?? null,
        lei: row?.lei ?? null,
        lei_status: row?.lei_status ?? null,
        is_test_bic: validation.is_test_bic,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'check_compliance',
    {
      title: 'Compliance Check',
      description:
        'Run a full pre-flight compliance check on an IBAN before sending a SEPA / cross-border payment. ' +
        'USE WHEN: the user is about to send a payment / payout / refund and wants to triage risk first, ' +
        'asks "is this IBAN safe to pay?", asks for sanctions screening, asks if a SEPA Instant transfer will succeed, ' +
        'or needs a numeric risk score for an internal payment-approval workflow. ' +
        'NOT A REGULATED AML/CFT PRODUCT — informational triage only. For regulated screening use Refinitiv, Acuris, or ComplyAdvantage. ' +
        'CHECKS: IBAN validity + sanctions (OFAC/EU/UN consolidated, FATF jurisdictions) + SEPA Instant reachability + VoP (EU 2024/886) participant. ' +
        'RETURNS: risk_score (0-100, 0 = safest), flags { sanctions_match, fatf_high_risk, sepa_unreachable, viban, emi }, recommended_action.',
      inputSchema: {
        iban: z.string().describe('IBAN to check'),
      },
      annotations: { title: 'Compliance Check', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iban }) => {
      const result = validateIBAN(iban);
      enrichResult(result);

      const countryCode = result.country?.code ?? '';
      const bic8 = result.bic?.code?.slice(0, 8) ?? null;
      const issuerType = result.issuer?.type ?? 'bank';
      const countryRisk = result.risk_indicators?.country_risk ?? 'standard';
      const isTestBic = result.risk_indicators?.test_bic ?? false;

      let compliance;
      try {
        compliance = buildComplianceResult(countryCode, bic8, issuerType, countryRisk, isTestBic);
      } catch {
        compliance = {
          sanctions: {
            country_sanctioned: false,
            bank_sanctioned: false,
            matched_lists: [],
            fatf_status: 'non_member' as const,
          },
          reachability: { sepa_instant: false, sct: false, sdd: false },
          vop: { participant: false, status: 'not_found' as const },
          risk_score: 50,
          risk_level: 'elevated' as const,
          flags: ['compliance_data_unavailable'],
        };
      }

      const combined = { ...result, compliance, cost_usdc: 0.02 };
      return { content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }] };
    },
  );

  server.registerTool(
    'lookup_ch_clearing',
    {
      title: 'Swiss Clearing Lookup',
      description:
        'Resolve a Swiss BC-Nummer / IID (1 to 5 digits) into the underlying institution. ' +
        'USE WHEN: the user mentions a Swiss bank by BC-Nummer or IID, pastes a CH or LI IBAN clearing code, ' +
        'asks routing details for a Swiss instant transfer (SIC, euroSIC), asks about QR-bill QR-IID resolution, ' +
        'or needs to classify a Swiss financial institution (bank vs PFS vs SIC-only participant). ' +
        'THIS IS THE ONLY API THAT EXPOSES THIS DATA — alternatives (iban.com, OpenIBAN, payeer, sepa.com) do not cover it. ' +
        'BACKED BY: 1,190 SIX BankMaster entries (Swiss official source). ' +
        'RETURNS: institution_name, institution_type, sic_participant, eurosic_participant, instant_payments, qr_iid, language. ' +
        'Only relevant for CH and LI accounts.',
      inputSchema: {
        iid: z.string().describe('Swiss IID (1-5 digit number)'),
      },
      annotations: { title: 'Swiss Clearing Lookup', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iid }) => {
      if (!/^\d{1,5}$/.test(iid)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: 'invalid_iid_format', message: 'IID must be a 1-5 digit number.' },
                null,
                2,
              ),
            },
          ],
        };
      }
      const normalizedIid = normalizeIid(iid);
      const entry = lookupClearingByBankCode(normalizedIid);
      if (!entry) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  iid: normalizedIid,
                  found: false,
                  error: 'clearing_not_found',
                  message: `IID ${normalizedIid} not found in Swiss BankMaster database.`,
                  cost_usdc: 0.003,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      const result: Record<string, unknown> = {
        iid: entry.iid,
        found: true,
        institution: {
          name: entry.name,
          type: entry.institution_type,
          iid_type: entry.iid_type,
          headquarters_iid: entry.headquarters_iid,
        },
        address: entry.address,
        bic: entry.bic,
        payment_services: entry.payment_services,
        sic_iid: entry.sic_iid,
        qr_iid: entry.qr_iid,
        valid_on: entry.valid_on,
        cost_usdc: 0.003,
      };
      if (entry.redirected_from) {
        result.redirected_from = entry.redirected_from;
        result.note = `IID ${entry.redirected_from} has been merged into IID ${entry.iid}.`;
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── Resources ──────────────────────────────────────────────────────────────

  server.registerResource(
    'countries',
    'ibanforge://countries',
    {
      title: 'Supported Countries',
      description: 'List of all 84 countries supported by IBANforge with IBAN length, SEPA membership, VoP status, and country risk classification.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'ibanforge://countries',
        mimeType: 'application/json',
        text: JSON.stringify(buildCountriesPayload(), null, 2),
      }],
    }),
  );

  server.registerResource(
    'pricing',
    'ibanforge://pricing',
    {
      title: 'Pricing',
      description: 'Per-call pricing for IBANforge API endpoints (USDC on Base L2 via x402 protocol).',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'ibanforge://pricing',
        mimeType: 'application/json',
        text: JSON.stringify(buildPricingPayload(), null, 2),
      }],
    }),
  );

  // ── Prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'validate_and_explain',
    {
      title: 'Validate and Explain IBAN',
      description: 'Validate an IBAN and generate a human-readable explanation suitable for non-technical users.',
      argsSchema: {
        iban: z.string().describe('The IBAN to validate and explain'),
      },
    },
    async ({ iban }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: buildValidateAndExplainPrompt(iban),
        },
      }],
    }),
  );

  return server;
}

// ── MCP tool call rate limiting ───────────────────────────────────────────────
// Free MCP access is limited to 50 tool calls per IP per day.
// Discovery (initialize, tools/list, resources/list) is unlimited.
const MCP_DAILY_LIMIT = 50;
const mcpCallCounts = new Map<string, { count: number; date: string }>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, val] of mcpCallCounts) {
    if (val.date !== today) mcpCallCounts.delete(key);
  }
}, 10 * 60 * 1000);

function checkMcpRateLimit(ip: string): { allowed: boolean; used: number; remaining: number } {
  const today = new Date().toISOString().slice(0, 10);
  const entry = mcpCallCounts.get(ip);
  if (!entry || entry.date !== today) {
    mcpCallCounts.set(ip, { count: 1, date: today });
    return { allowed: true, used: 1, remaining: MCP_DAILY_LIMIT - 1 };
  }
  entry.count++;
  const allowed = entry.count <= MCP_DAILY_LIMIT;
  return { allowed, used: entry.count, remaining: Math.max(0, MCP_DAILY_LIMIT - entry.count) };
}

// Handle POST /mcp (client → server messages)
mcpHttp.post('/mcp', async (c) => {
  // Parse the body to check if this is a tools/call (rate-limited)
  // vs. discovery (unlimited). We clone the request so the transport
  // can still read the original body.
  const cloned = c.req.raw.clone();
  let isToolCall = false;
  let rpcId: unknown = null;
  try {
    const body = await cloned.json();
    if (body?.method === 'tools/call') {
      isToolCall = true;
      rpcId = body.id;
    }
  } catch {
    // Not JSON or malformed — let the transport handle the error
  }

  if (isToolCall) {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';
    const limit = checkMcpRateLimit(ip);
    if (!limit.allowed) {
      // Return a proper JSON-RPC error so the MCP client understands
      return c.json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message: `Daily MCP free tier limit reached (${MCP_DAILY_LIMIT} tool calls/day). `
            + 'For unlimited access, use the REST API with an API key '
            + '(free: POST /v1/keys/generate) or x402 micropayments. '
            + 'See https://api.ibanforge.com/.well-known/x402',
          data: { used: limit.used, limit: MCP_DAILY_LIMIT, remaining: 0 },
        },
      });
    }
  }

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

// Handle GET /mcp (SSE stream for server → client notifications, OR discovery hint)
mcpHttp.get('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    // No session: this is either an agent/dev probing the endpoint with a browser
    // or curl. Return a discoverable JSON hint instead of an opaque "No active session".
    return c.json(
      {
        protocol: 'mcp',
        version: '2024-11-05',
        transport: 'streamable-http',
        endpoint: 'https://api.ibanforge.com/mcp',
        message:
          'This is the IBANforge MCP HTTP endpoint. To use it, send a POST with a JSON-RPC initialize request, then keep the returned mcp-session-id header on subsequent requests.',
        quickstart: {
          stdio_npx:
            'npx -y ibanforge-mcp  # easiest path: run our stdio server, no HTTP session juggling',
          claude_desktop_config: {
            mcpServers: {
              ibanforge: { command: 'npx', args: ['-y', 'ibanforge-mcp'] },
            },
          },
          claude_code_cli: 'claude mcp add ibanforge --transport http https://api.ibanforge.com/mcp',
          curl_initialize: `curl -X POST https://api.ibanforge.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json,text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' -i`,
        },
        tools: ['validate_iban', 'batch_validate_iban', 'lookup_bic', 'lookup_ch_clearing', 'check_compliance'],
        free_tier: {
          mcp_daily_limit: MCP_DAILY_LIMIT,
          rest_api_signup: 'POST /v1/keys/generate {"email":"you@example.com"} for 200 req/month',
        },
        x402: 'https://api.ibanforge.com/.well-known/x402',
        documentation: 'https://ibanforge.com/docs',
        llms_txt: 'https://api.ibanforge.com/llms.txt',
        server_card: 'https://ibanforge.com/.well-known/mcp/server-card.json',
        registry: 'https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge',
      },
      200,
    );
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
