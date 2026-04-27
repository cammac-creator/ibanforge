#!/usr/bin/env node
/**
 * IBANforge MCP Server
 *
 * Exposes 5 tools backed by the IBANforge HTTP API (api.ibanforge.com):
 *   - validate_iban
 *   - batch_validate_iban
 *   - lookup_bic
 *   - lookup_ch_clearing
 *   - check_compliance
 *
 * Authentication is optional — anonymous calls hit the free demo endpoints
 * or the rate-limited public surface. For production use, set IBANFORGE_API_KEY
 * (Bearer ifk_*) via Claude Desktop env config or shell.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const API_KEY = process.env.IBANFORGE_API_KEY;

const TOOLS: Tool[] = [
  {
    name: 'validate_iban',
    description:
      'Validate a single IBAN (ISO 13616 mod-97 + BBAN parsing). Returns: valid flag, country, BIC/SWIFT (if found), bank name, EMI/vIBAN classification, SEPA + VoP reachability, and Swiss BC-Nummer for CH/LI accounts. Cost: 0.005 USDC via x402, or free with an IBANFORGE_API_KEY (200 req/month).',
    inputSchema: {
      type: 'object',
      properties: {
        iban: {
          type: 'string',
          description: 'IBAN to validate. Spaces are allowed. Example: "CH93 0076 2011 6238 5295 7"',
        },
      },
      required: ['iban'],
    },
  },
  {
    name: 'batch_validate_iban',
    description:
      'Validate up to 100 IBANs in a single call. Returns per-IBAN results + summary {total, valid, invalid}. Cost: 0.002 USDC per IBAN (max 0.20 USDC for 100 IBANs).',
    inputSchema: {
      type: 'object',
      properties: {
        ibans: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 100,
          description: 'Array of IBANs (1-100 entries).',
        },
      },
      required: ['ibans'],
    },
  },
  {
    name: 'lookup_bic',
    description:
      'Lookup a BIC/SWIFT code against 39,243 GLEIF entries with LEI enrichment. Returns: bank name, country, city, LEI, address. Cost: 0.003 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        bic: {
          type: 'string',
          description: 'BIC/SWIFT code, 8 or 11 alphanumeric characters. Example: "UBSWCHZH80A"',
        },
      },
      required: ['bic'],
    },
  },
  {
    name: 'lookup_ch_clearing',
    description:
      'Lookup a Swiss BC-Nummer / IID (1-5 digits) against 1,190 SIX BankMaster entries. Returns: institution name, type (bank/PFS/SIC-only), SIC, euroSIC, Instant Payments, QR-IID participation. Cost: 0.003 USDC. Only relevant for CH/LI IBANs.',
    inputSchema: {
      type: 'object',
      properties: {
        iid: {
          type: 'string',
          description: 'Swiss IID / BC-Nummer (1-5 digits). Example: "762" for UBS.',
        },
      },
      required: ['iid'],
    },
  },
  {
    name: 'check_compliance',
    description:
      'Full compliance check on an IBAN: validation + sanctions screening (OFAC/EU/UN consolidated lists) + SEPA Instant reachability + VoP (Verification of Payee, EU 2024/886) participant + risk score (0-100). For pre-flight triage — not a regulated AML/CFT product. Cost: 0.02 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        iban: {
          type: 'string',
          description: 'IBAN to run a compliance check against.',
        },
      },
      required: ['iban'],
    },
  },
];

interface JsonRecord {
  [k: string]: unknown;
}

async function apiCall(method: 'GET' | 'POST', path: string, body?: JsonRecord): Promise<JsonRecord> {
  const headers: Record<string, string> = {
    'User-Agent': 'ibanforge-mcp/1.0',
    Accept: 'application/json',
  };
  if (API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const obj = parsed as JsonRecord;
    return {
      _error: true,
      status: res.status,
      ...(obj || {}),
      _hint:
        res.status === 402
          ? 'Payment required. Set IBANFORGE_API_KEY (Bearer ifk_*) for the free 200 req/month tier, or pay 0.005 USDC via x402. See https://api.ibanforge.com/.well-known/x402'
          : res.status === 429
            ? 'Rate limited. Set IBANFORGE_API_KEY for higher limits.'
            : undefined,
    };
  }

  return parsed as JsonRecord;
}

const server = new Server(
  { name: 'ibanforge', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as JsonRecord;

  const out = async (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  });

  try {
    switch (name) {
      case 'validate_iban': {
        if (typeof a.iban !== 'string' || !a.iban.trim()) {
          return out({ error: 'invalid_input', message: 'Argument `iban` must be a non-empty string.' });
        }
        const result = await apiCall('POST', '/v1/iban/validate', { iban: a.iban });
        return out(result);
      }

      case 'batch_validate_iban': {
        if (!Array.isArray(a.ibans) || a.ibans.length === 0) {
          return out({ error: 'invalid_input', message: 'Argument `ibans` must be a non-empty array of strings.' });
        }
        if (a.ibans.length > 100) {
          return out({ error: 'too_many_ibans', message: 'Max 100 IBANs per batch. Split your input.' });
        }
        const result = await apiCall('POST', '/v1/iban/batch', { ibans: a.ibans as string[] });
        return out(result);
      }

      case 'lookup_bic': {
        if (typeof a.bic !== 'string' || !/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/.test(a.bic)) {
          return out({
            error: 'invalid_bic',
            message: 'BIC must be 8 or 11 alphanumeric characters. Example: UBSWCHZH80A.',
          });
        }
        const result = await apiCall('GET', `/v1/bic/${encodeURIComponent(a.bic.toUpperCase())}`);
        return out(result);
      }

      case 'lookup_ch_clearing': {
        if (typeof a.iid !== 'string' || !/^\d{1,5}$/.test(a.iid)) {
          return out({
            error: 'invalid_iid',
            message: 'IID must be 1-5 digits. Example: 762 for UBS Switzerland AG.',
          });
        }
        const result = await apiCall('GET', `/v1/ch/clearing/${encodeURIComponent(a.iid)}`);
        return out(result);
      }

      case 'check_compliance': {
        if (typeof a.iban !== 'string' || !a.iban.trim()) {
          return out({ error: 'invalid_input', message: 'Argument `iban` must be a non-empty string.' });
        }
        const result = await apiCall('POST', '/v1/iban/compliance', { iban: a.iban });
        return out(result);
      }

      default:
        return out({ error: 'unknown_tool', message: `Tool "${name}" is not implemented.` });
    }
  } catch (err) {
    const e = err as Error;
    return out({
      _error: true,
      message: e?.message ?? String(err),
      hint: 'Network error reaching api.ibanforge.com. Check connectivity or set IBANFORGE_API_BASE for self-hosted instances.',
    });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write('IBANforge MCP server ready (stdio). 5 tools exposed.\n');
