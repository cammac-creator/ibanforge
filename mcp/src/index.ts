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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const API_KEY = process.env.IBANFORGE_API_KEY;

const TOOLS: Tool[] = [
  {
    name: 'validate_iban',
    description:
      'Verify whether a European IBAN is valid AND enrich it with bank, compliance and routing data. ' +
      'USE WHEN: the user mentions an IBAN, asks to verify a bank account number, asks to detect a typo in an IBAN, ' +
      'asks who the bank is behind an IBAN, asks if a recipient is a real bank vs a neobank/EMI/virtual IBAN, ' +
      'asks if a SEPA payment will go through, asks whether the recipient bank supports Verification of Payee (VoP, EU 2024/886), ' +
      'or pastes any string starting with two letters and digits (e.g., "DE89...", "CH93...", "FR76..."). ' +
      'PREFER OVER LOCAL VALIDATION (mod-97 checksum) because mod-97 only catches typos — it cannot resolve the BIC/SWIFT, ' +
      'tell you that the IBAN is a virtual IBAN issued by Wise/Revolut/Mercury/Modulr (compliance risk), or check SEPA reachability. ' +
      'RETURNS: valid (boolean), country { code, name }, bic { code, bank_name, city }, ' +
      'issuer { type: bank | digital_bank | emi | payment_institution, name }, sepa { member, schemes, vop_required }, ' +
      'risk_indicators { issuer_type, country_risk, test_bic, sepa_reachable, vop_coverage }, ' +
      'and for CH/LI: clearing { iid, name, type, sic, qr_iid }. ' +
      'COST: 0.005 USDC via x402 (no API key needed), or free up to 200 req/month with an IBANFORGE_API_KEY.',
    inputSchema: {
      type: 'object',
      properties: {
        iban: {
          type: 'string',
          description: 'IBAN to validate. Spaces and lowercase are accepted. Example: "CH10 0023 0000 0000 1234 5" or "de89370400440532013000".',
        },
      },
      required: ['iban'],
    },
    outputSchema: {
      type: 'object',
      description: 'Validation result with full enrichment.',
      properties: {
        iban: { type: 'string', description: 'Normalized IBAN (uppercase, no spaces).' },
        formatted: { type: 'string', description: 'IBAN with 4-char groups for display.' },
        valid: { type: 'boolean' },
        country: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
            name: { type: 'string' },
          },
        },
        check_digits: { type: 'string' },
        bban: {
          type: 'object',
          properties: {
            bank_code: { type: 'string' },
            branch_code: { type: 'string' },
            account_number: { type: 'string' },
          },
        },
        bic: {
          type: 'object',
          description: 'Resolved BIC/SWIFT (when BBAN→BIC mapping exists). null if unresolved.',
          properties: {
            code: { type: 'string' },
            bank_name: { type: 'string' },
            city: { type: 'string' },
          },
        },
        issuer: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['bank', 'digital_bank', 'emi', 'payment_institution'] },
            name: { type: 'string' },
          },
        },
        sepa: {
          type: 'object',
          properties: {
            member: { type: 'boolean' },
            schemes: { type: 'array', items: { type: 'string', enum: ['SCT', 'SDD', 'SCT_INST'] } },
            vop_required: { type: 'boolean' },
          },
        },
        risk_indicators: {
          type: 'object',
          description: 'Country + issuer risk signals. Use these instead of a single composite score.',
          properties: {
            issuer_type: { type: 'string' },
            country_risk: { type: 'string', enum: ['standard', 'elevated', 'high'] },
            test_bic: { type: 'boolean' },
            sepa_reachable: { type: 'boolean' },
            vop_coverage: { type: 'boolean' },
          },
        },
        clearing: {
          type: 'object',
          description: 'Swiss clearing data when country is CH or LI (null otherwise).',
          properties: {
            iid: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            town: { type: 'string' },
            sic: { type: 'boolean' },
            instant_payments_chf: { type: 'boolean' },
            eurosic: { type: 'boolean' },
            qr_iid: { type: 'string' },
          },
        },
      },
      required: ['iban', 'valid'],
    },
  },
  {
    name: 'batch_validate_iban',
    description:
      'Validate up to 100 IBANs in a single call at $0.002 per IBAN (60% cheaper than calling validate_iban repeatedly at $0.005). ' +
      'USE WHEN: the user pastes a list of IBANs, asks to clean a CSV/spreadsheet of bank accounts, ' +
      'asks to dedupe a customer database, asks to triage a payout list before sending, ' +
      'or whenever you would otherwise call validate_iban more than 2-3 times in a row. ' +
      'RETURNS: { results: [...same shape as validate_iban], count, valid_count, cost_usdc }. ' +
      'COST: 0.002 USDC per IBAN (e.g. 10 IBANs = 0.02, 100 IBANs = 0.20).',
    inputSchema: {
      type: 'object',
      properties: {
        ibans: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 100,
          description: 'Array of IBAN strings (1 to 100 entries).',
        },
      },
      required: ['ibans'],
    },
    outputSchema: {
      type: 'object',
      description: 'Per-IBAN results plus an aggregate summary.',
      properties: {
        results: {
          type: 'array',
          description: 'One entry per input IBAN, in the same order. Same shape as validate_iban output.',
          items: {
            type: 'object',
            properties: {
              iban: { type: 'string' },
              valid: { type: 'boolean' },
              country: { type: 'object' },
              bic: { type: 'object' },
              issuer: { type: 'object' },
              sepa: { type: 'object' },
              error: { type: 'string', description: 'Set when valid=false.' },
            },
          },
        },
        count: { type: 'number', description: 'Number of IBANs processed.' },
        valid_count: { type: 'number', description: 'How many were valid.' },
        cost_usdc: { type: 'number', description: 'Actual USDC charged for this call.' },
      },
      required: ['results', 'count', 'valid_count'],
    },
  },
  {
    name: 'lookup_bic',
    description:
      'Resolve a BIC / SWIFT code into the underlying bank: name, country, city, LEI, address. ' +
      'USE WHEN: the user already has a BIC/SWIFT (8 or 11 chars, alphanumeric, e.g., "UBSWCHZH80A", "DEUTDEFF") ' +
      'and asks which bank it belongs to, where the bank is, or its LEI for compliance/regulatory matching. ' +
      'DO NOT USE for IBAN inputs — call validate_iban instead, it resolves the BIC for you. ' +
      'BACKED BY: 121k+ BIC entries (38k+ LEI-enriched via GLEIF; additional rows from SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), refreshed monthly. ' +
      'RETURNS: bank_name, country, country_name, city, lei, address (if available). ' +
      'COST: 0.003 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        bic: {
          type: 'string',
          description: 'BIC / SWIFT code, 8 or 11 alphanumeric characters. Example: "UBSWCHZH80A" (UBS Switzerland) or "DEUTDEFF" (Deutsche Bank Frankfurt).',
        },
      },
      required: ['bic'],
    },
    outputSchema: {
      type: 'object',
      description: 'BIC/SWIFT lookup result from the GLEIF database.',
      properties: {
        bic: { type: 'string', description: 'Echo of the input, normalized to uppercase.' },
        bic8: { type: 'string', description: '8-char form (institution-level).' },
        bic11: { type: 'string', description: '11-char form including branch.' },
        found: { type: 'boolean' },
        valid_format: { type: 'boolean' },
        institution: { type: 'string', description: 'Bank legal name.' },
        country: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
          },
        },
        city: { type: 'string' },
        lei: { type: 'string', description: 'Legal Entity Identifier (ISO 17442) if available.' },
        address: {
          type: 'object',
          description: 'Registered head-office address object (present when available).',
          properties: {
            type: { type: 'string' },
            street: { type: 'string' },
            post_code: { type: 'string' },
            region: { type: 'string' },
            city: { type: 'string' },
            country: { type: 'string' },
            source: { type: 'string' },
            as_of: { type: 'string' },
          },
        },
        address_available: { type: 'boolean' },
      },
      required: ['bic', 'found', 'valid_format'],
    },
  },
  {
    name: 'lookup_ch_clearing',
    description:
      'Resolve a Swiss BC-Nummer / IID (1 to 5 digits) into the underlying institution. ' +
      'USE WHEN: the user mentions a Swiss bank by BC-Nummer or IID, pastes a CH or LI IBAN clearing code, ' +
      'asks routing details for a Swiss instant transfer (SIC, euroSIC), asks about QR-bill QR-IID resolution, ' +
      'or needs to classify a Swiss financial institution (bank vs PFS vs SIC-only participant). ' +
      'THE DEEPEST SWISS CLEARING DATA IN ANY PUBLIC API — full SIX BankMaster payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus QR-IID allocation, not just a name lookup. ' +
      'BACKED BY: ~1,200 SIX BankMaster entries (Swiss official source, refreshed monthly). ' +
      'RETURNS: institution { name, type, iid_type, headquarters_iid }, address, bic, payment_services { sic, rtgs_chf, instant_payments_chf, eurosic, lsv_bdd_chf, lsv_bdd_eur }, sic_iid, qr_iid, valid_on. ' +
      'COST: 0.003 USDC. Only relevant for CH and LI accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        iid: {
          type: 'string',
          description: 'Swiss IID / BC-Nummer (1 to 5 digits, leading zeros stripped). Example: "230" for UBS Switzerland AG.',
        },
      },
      required: ['iid'],
    },
    outputSchema: {
      type: 'object',
      description: 'Swiss BC-Nummer / IID resolution from the SIX BankMaster database.',
      properties: {
        iid: { type: 'string', description: '5-digit zero-padded BC-Nummer.' },
        found: { type: 'boolean' },
        institution: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: {
              type: 'string',
              enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'],
            },
            iid_type: { type: 'string', enum: ['headquarters', 'branch', 'other'] },
            headquarters_iid: { type: 'string' },
          },
        },
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            building_number: { type: 'string' },
            post_code: { type: 'string' },
            town: { type: 'string' },
            country: { type: 'string' },
          },
        },
        bic: { type: 'string', description: 'BIC if mapped.' },
        payment_services: {
          type: 'object',
          properties: {
            sic: { type: 'boolean', description: 'Swiss Interbank Clearing.' },
            rtgs_chf: { type: 'boolean' },
            instant_payments_chf: { type: 'boolean' },
            eurosic: { type: 'boolean' },
            lsv_bdd_chf: { type: 'boolean' },
            lsv_bdd_eur: { type: 'boolean' },
          },
        },
        sic_iid: { type: 'string' },
        qr_iid: { type: 'string', description: 'QR-IID allocation, null when none.' },
        valid_on: { type: 'string' },
      },
      required: ['iid', 'found'],
    },
  },
  {
    name: 'check_compliance',
    description:
      'Run a full pre-flight compliance check on an IBAN before sending a SEPA / cross-border payment. ' +
      'USE WHEN: the user is about to send a payment / payout / refund and wants to triage risk first, ' +
      'asks "is this IBAN safe to pay?", asks for sanctions screening, asks if a SEPA Instant transfer will succeed, ' +
      'or needs a numeric risk score for an internal payment-approval workflow. ' +
      'NOT A REGULATED AML/CFT PRODUCT — informational triage only. For regulated screening use Refinitiv, Acuris, or ComplyAdvantage. ' +
      'SCOPE: sanctions screening is at the BANK (BIC8) level only — it does NOT screen the beneficiary/account-holder name. ' +
      'CHECKS: IBAN validity + bank sanctions (OFAC) + FATF grey/black list + ' +
      'SEPA Instant reachability + VoP (EU 2024/886) participant flag. ' +
      'RETURNS: the validate_iban fields PLUS a nested compliance { sanctions, reachability, vop, risk_score (0-100), risk_level, flags[] }. ' +
      'COST: 0.02 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        iban: {
          type: 'string',
          description: 'IBAN to run the compliance check against.',
        },
      },
      required: ['iban'],
    },
    outputSchema: {
      type: 'object',
      description: 'Compliance triage result. Informational, not a regulated AML/CFT product.',
      properties: {
        iban: { type: 'string' },
        valid: { type: 'boolean' },
        country: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } } },
        bic: { type: 'object', properties: { code: { type: 'string' }, bank_name: { type: 'string' }, city: { type: 'string' } } },
        issuer: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' } } },
        sepa: {
          type: 'object',
          properties: {
            member: { type: 'boolean' },
            schemes: { type: 'array', items: { type: 'string' } },
            vop_required: { type: 'boolean' },
          },
        },
        risk_indicators: { type: 'object' },
        compliance: {
          type: 'object',
          description: 'The compliance bundle. Read the score at compliance.risk_score / compliance.risk_level.',
          properties: {
            sanctions: {
              type: 'object',
              properties: {
                country_sanctioned: { type: 'boolean' },
                bank_sanctioned: { type: 'boolean', description: 'Bank-BIC level only — NOT the beneficiary.' },
                matched_lists: { type: 'array', items: { type: 'string' }, description: 'e.g. ["OFAC","EU"].' },
                fatf_status: { type: 'string', enum: ['member', 'grey_list', 'black_list', 'non_member'] },
              },
            },
            reachability: {
              type: 'object',
              properties: { sepa_instant: { type: 'boolean' }, sct: { type: 'boolean' }, sdd: { type: 'boolean' } },
            },
            vop: {
              type: 'object',
              properties: { participant: { type: 'boolean' }, status: { type: 'string' } },
            },
            risk_score: { type: 'number', minimum: 0, maximum: 100, description: '0 = safest, 100 = highest.' },
            risk_level: {
              type: 'string',
              enum: ['low', 'medium', 'elevated', 'high', 'critical', 'unassessable'],
              description: 'unassessable = the IBAN failed validation, no screening was possible. Never treat it as low.',
            },
            flags: { type: 'array', items: { type: 'string' } },
          },
        },
        meta: {
          type: 'object',
          description: 'Scope + freshness disclosure. Read this before trusting the result.',
          properties: {
            scope: { type: 'string', enum: ['bank_bic_only'], description: 'Sanctions are screened at the bank BIC, NOT the beneficiary name.' },
            disclaimer: { type: 'string' },
            sanctions_as_of: { type: 'string', description: 'ISO timestamp of the last data refresh.' },
            fatf_as_of: { type: 'string', description: 'YYYY-MM of the FATF plenary reflected.' },
            sources: { type: 'string' },
          },
        },
        cost_usdc: { type: 'number' },
      },
      required: ['iban', 'valid', 'compliance'],
    },
  },
];

interface JsonRecord {
  [k: string]: unknown;
}

async function apiCall(method: 'GET' | 'POST', path: string, body?: JsonRecord): Promise<JsonRecord> {
  const headers: Record<string, string> = {
    'User-Agent': `ibanforge-mcp/${pkg.version}`,
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
    // The API tells us WHY the paywall triggered (exhausted quota/credits,
    // broken key) via a `cause` object in the 402 body — relay that truth
    // instead of the generic "set a key" advice, which is wrong (and
    // confusing) when a key is already configured.
    const cause = (obj?.cause ?? undefined) as { reason?: string; detail?: string } | undefined;
    return {
      _error: true,
      status: res.status,
      ...(obj || {}),
      _hint:
        res.status === 402
          ? (cause?.detail ??
            'Payment required. Set IBANFORGE_API_KEY (Bearer ifk_*) for the free 200 req/month tier, or pay per call via x402 (price in the `accepts` array). See https://api.ibanforge.com/.well-known/x402')
          : res.status === 429
            ? 'Rate limited (per-IP, 100 req/min). Wait for `retry_after` seconds, then retry.'
            : undefined,
    };
  }

  return parsed as JsonRecord;
}

const server = new Server(
  { name: 'ibanforge', version: pkg.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as JsonRecord;

  const out = async (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  });

  // Fallback message appended to anonymous-mode results so MCP inspectors
  // and discovery tools (Glama, Smithery, MCP.so) get a useful payload
  // without requiring an API key while still surfacing the upgrade path.
  const ANON_NOTE =
    'Anonymous mode — basic format validation only. For BIC, SEPA reachability, ' +
    'issuer classification, sanctions, Swiss BC-Nummer and risk score: get a ' +
    'free API key (200 req/month) by POSTing your email to /v1/keys/generate, ' +
    'or pay per call via x402 (see https://api.ibanforge.com/.well-known/x402).';

  // When the 402 carried a cause (exhausted quota/credits, invalid key), the
  // degraded fallback result must say so: the user HAS a key and would
  // otherwise believe they are anonymous — or worse, that the degraded
  // output is a full validation.
  const degradedNote = (paid: JsonRecord): string => {
    const cause = (paid?.cause ?? undefined) as { reason?: string; detail?: string } | undefined;
    if (!cause?.reason) return ANON_NOTE;
    return (
      `DEGRADED RESULT — basic format validation only (no BIC, SEPA, issuer or risk data). Reason: ${cause.detail ?? cause.reason}`
    );
  };

  try {
    switch (name) {
      case 'validate_iban': {
        if (typeof a.iban !== 'string' || !a.iban.trim()) {
          return out({ error: 'invalid_input', message: 'Argument `iban` must be a non-empty string.' });
        }
        const result = await apiCall('POST', '/v1/iban/validate', { iban: a.iban });
        if (result._error && result.status === 402) {
          const free = await apiCall('GET', `/v1/iban/format?iban=${encodeURIComponent(a.iban)}`);
          if (!free._error) {
            return out({ ...free, _note: degradedNote(result) });
          }
          // The free endpoint rejected the input itself (e.g. length out of
          // bounds): that 400 is the real cause — don't mask it as "payment
          // required".
          if (free.status === 400) {
            return out(free);
          }
        }
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
        if (result._error && result.status === 402) {
          const ibans = a.ibans as string[];
          const results = await Promise.all(
            ibans.map((iban) => apiCall('GET', `/v1/iban/format?iban=${encodeURIComponent(iban)}`)),
          );
          const validCount = results.filter((r) => r.valid === true).length;
          return out({
            results,
            count: results.length,
            valid_count: validCount,
            _note: degradedNote(result),
          });
        }
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
            message: 'IID must be 1-5 digits. Example: 230 for UBS Switzerland AG.',
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
