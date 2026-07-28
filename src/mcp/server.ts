#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { lookup } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { getComplianceMeta } from '../lib/compliance-db.js';
import { lookupClearingByBankCode, normalizeIid, getChClearingCount } from '../lib/ch-clearing.js';
import { buildCountriesPayload, buildPricingPayload, buildValidateAndExplainPrompt } from '../lib/mcp-resources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const server = new McpServer({
  name: 'ibanforge',
  title: 'IBANforge',
  version: pkg.version,
  description:
    'IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA compliance and risk indicators. 121k+ BIC entries (38k+ LEI-enriched via GLEIF), ~1,200 Swiss BC-Nummer from SIX, 89 countries, refreshed monthly.',
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
    description: `Validate a single IBAN and retrieve the associated BIC/SWIFT code, bank details, SEPA membership, issuer classification, and risk indicators.

When to use: verifying a payment recipient before a wire transfer, checking a bank account during onboarding, or confirming IBAN format and bank identity in a KYC workflow.
When NOT to use: for multiple IBANs, use batch_validate_iban instead (60% cheaper per IBAN). For compliance/sanctions screening, use check_compliance instead.

Behavior: this tool is read-only and performs no writes, no network calls to external services, and no side effects. It validates the IBAN checksum (ISO 13616 mod-97), parses the BBAN structure, resolves the BIC from a local database of 121,000+ entries (GLEIF-sourced), and classifies the issuer type. Response time is under 30ms. Returns a single JSON object.

Returns: { valid, country: { code, name }, check_digits, bban: { bank_code, branch_code, account_number }, bic: { code, institution, country_code, city }, sepa: { member, schemes, vop_required }, issuer: { type, name }, risk_indicators: { issuer_type, country_risk, test_bic, sepa_reachable, vop_coverage } }

Supports 89 countries including all SEPA/EEA countries, Switzerland, UK, and 50+ non-SEPA countries.

Example: input 'DE89370400440532013000' → { valid: true, country: { code: 'DE', name: 'Germany' }, bic: { code: 'COBADEFFXXX', institution: 'Commerzbank' }, issuer: { type: 'bank' }, ... }

Cost: $0.005 USDC per call via x402 micropayment on Base L2.`,
    inputSchema: {
      iban: z
        .string()
        .trim()
        .min(5, 'IBAN is too short')
        .max(42, 'IBAN is too long (max 34 chars + 8 separators)')
        .describe(
          "The IBAN to validate. Must be a string of 15-34 alphanumeric characters. Spaces and hyphens are accepted and stripped automatically before validation. Examples: 'CH56 0483 5012 3456 7800 9', 'DE89370400440532013000', 'FR76-3000-6000-0112-3456-7890-189'.",
        ),
    },
    annotations: {
      title: 'Validate IBAN',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ iban }) => {
    const result = validateIBAN(iban);
    enrichResult(result);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'batch_validate_iban',
  {
    title: 'Batch Validate IBANs',
    description: `Validate up to 100 IBANs in a single call with the same enrichment as validate_iban, at 60% lower cost per IBAN.

When to use: processing a CSV of supplier bank accounts, validating a payment batch before submission, running KYC checks on a customer list, or auditing an accounts-payable file.
When NOT to use: for a single IBAN, use validate_iban instead. For compliance/sanctions screening, use check_compliance on each IBAN.

Behavior: this tool is read-only with no side effects. It validates each IBAN independently using the same logic as validate_iban (mod-97 checksum, BBAN parsing, BIC resolution, issuer classification). Results are returned in the same order as the input array. If one IBAN is invalid, the others are still processed — there is no short-circuit on error. Response time scales linearly: ~30ms per IBAN. Returns a JSON array.

Input constraints: minimum 1 IBAN, maximum 100 IBANs per call. Exceeding 100 returns a validation error.

Returns: Array of objects, each identical in structure to the validate_iban response: { valid, country, bban, bic, sepa, issuer, risk_indicators }

Example: input ['DE89370400440532013000', 'INVALID123'] → [{ valid: true, ... }, { valid: false, error: 'Invalid checksum' }]

Cost: $0.002 USDC per IBAN via x402 (e.g., 10 IBANs = $0.020, 50 IBANs = $0.100, 100 IBANs = $0.200). With an API key, a batch debits 1 quota request / 1 prepaid credit per IBAN.`,
    inputSchema: {
      ibans: z
        .array(z.string().trim().min(5).max(42))
        .min(1)
        .max(100)
        .describe(
          "Array of IBANs to validate, between 1 and 100 items. Each IBAN is a string of 15-34 alphanumeric characters. Spaces and hyphens in individual IBANs are stripped automatically. Example: ['CH5604835012345678009', 'DE89370400440532013000', 'FR7630006000011234567890189'].",
        ),
    },
    annotations: {
      title: 'Batch Validate IBANs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ ibans }) => {
    const results = ibans.map((iban) => {
      const result = validateIBAN(iban);
      enrichResult(result);
      return result;
    });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  },
);

server.registerTool(
  'lookup_bic',
  {
    title: 'Lookup BIC/SWIFT Code',
    description: `Look up a BIC/SWIFT code and return full institution details including name, country, city, branch info, and LEI regulatory data.

When to use: identifying the bank behind a BIC/SWIFT code for compliance checks, payment routing validation, correspondent banking lookups, or KYC enrichment.
When NOT to use: if you already have an IBAN, use validate_iban instead — it resolves the BIC automatically as part of the validation. For sanctions/compliance screening, use check_compliance.

Behavior: this tool is read-only with no side effects. It validates the BIC format (ISO 9362), then queries a local SQLite database of 121,000+ institutions sourced from GLEIF. For BIC11 lookups, if the specific branch is not found, it falls back to the head office (XXX suffix). Detects test BICs (e.g., MARKDEF patterns). Response time is under 10ms. Returns a single JSON object.

Input: accepts BIC8 (e.g., 'UBSWCHZH') or BIC11 (e.g., 'UBSWCHZH80A'). Case-insensitive.

Returns: { bic, bic8, bic11, valid_format, found, institution, country_code, country_name, city, branch_code, branch_info, lei, lei_status, is_test_bic }

Example: input 'BNPAFRPP' → { institution: 'BNP PARIBAS', country_code: 'FR', country_name: 'France', city: 'PARIS', lei: '...', found: true }
Example: input 'INVALIDX' → { valid_format: true, found: false }
Example: input '123' → { valid_format: false, error: 'BIC must be 8 or 11 characters' }

Cost: $0.003 USDC per call via x402 micropayment on Base L2.`,
    inputSchema: {
      bic: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/, 'BIC must be 8 or 11 alphanumeric characters')
        .describe(
          "The BIC/SWIFT code to look up. Must be 8 characters (BIC8, e.g., 'UBSWCHZH') or 11 characters (BIC11, e.g., 'UBSWCHZH80A'). Case-insensitive. The first 4 characters are the institution code, characters 5-6 are the country code (ISO 3166-1), characters 7-8 are the location code, and optional characters 9-11 are the branch code.",
        ),
    },
    annotations: {
      title: 'Lookup BIC/SWIFT Code',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
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

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'check_compliance',
  {
    title: 'Compliance Risk Check',
    description: `Run a full compliance check on an IBAN: validates the IBAN, enriches with bank data, then screens against sanctions lists, checks SEPA reachability, verifies VoP participation, and computes a composite risk score.

When to use: assessing compliance risk of a payment recipient for AML/KYC workflows, verifying an IBAN is not associated with a sanctioned country or bank, checking SEPA Instant and Verification of Payee participation, or producing a structured risk assessment before approving a payment.
When NOT to use: for simple IBAN format validation without compliance data, use validate_iban (4x cheaper). For BIC-only lookups, use lookup_bic.

Behavior: this tool is read-only with no side effects. It performs IBAN validation and enrichment (same as validate_iban), then queries a local compliance database for sanctions (OFAC list), FATF grey/black list status, SEPA scheme participation (SCT, SDD, SCT_INST), and VoP participant status. Computes a composite risk score from 0 (lowest risk) to 100 (highest risk) based on 11 weighted risk flags. Response time is under 50ms. Returns a single JSON object. Scope: sanctions screening is at the BANK (BIC8) level only — it does NOT screen the beneficiary/account-holder name and is not a substitute for KYC/AML name screening. If compliance data is unavailable for a country/BIC, returns a fallback risk_level of 'elevated' with a flag 'compliance_data_unavailable'.

Risk score weights: sanctioned country (+50), sanctioned bank (+50), FATF black list (+30), FATF grey list (+20), high-risk country (+20), elevated-risk country (+10), payment institution issuer (+15), EMI issuer (+10), no SEPA Instant (+5), no VoP (+5), test BIC (+30).

Risk levels: low (0-19), medium (20-39), elevated (40-59), high (60-79), critical (80-100).

Returns: { valid, country, bban, bic, sepa, issuer, risk_indicators, compliance: { sanctions: { country_sanctioned, bank_sanctioned, matched_lists, fatf_status }, reachability: { sepa_instant, sct, sdd }, vop: { participant, status }, risk_score, risk_level, flags } }

Example: input 'DE89370400440532013000' → { valid: true, compliance: { sanctions: { country_sanctioned: false, fatf_status: 'member' }, risk_score: 5, risk_level: 'low', flags: [] } }

Cost: $0.02 USDC per call via x402 micropayment on Base L2.`,
    inputSchema: {
      iban: z
        .string()
        .trim()
        .min(5)
        .max(42)
        .describe(
          "The IBAN to check. Must be a string of 15-34 alphanumeric characters. Spaces and hyphens are accepted and stripped automatically before validation. Examples: 'CH56 0483 5012 3456 7800 9', 'DE89370400440532013000'.",
        ),
    },
    annotations: {
      title: 'Compliance Risk Check',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ iban }) => {
    // Shared with the REST route and the HTTP MCP transport. See
    // src/lib/compliance-response.ts: this block used to be a fourth hand copy,
    // and it read country risk from a field that is absent on an unparseable
    // BBAN, which is how a Russian IBAN once scored 60 instead of critical.
    const combined = { ...buildComplianceResponse(iban), cost_usdc: 0.02 };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }],
    };
  },
);

server.registerTool(
  'lookup_ch_clearing',
  {
    title: 'Lookup Swiss Bank Clearing Number',
    description: `Look up a Swiss BC-Nummer (Bank Clearing Number / IID) and return institution details, payment infrastructure participation (SIC, euroSIC, Instant Payments), and QR-bill data.

When to use: resolving the bank behind a Swiss IBAN, checking SIC/euroSIC participation, verifying QR-bill IID allocation, or identifying PostFinance/cantonal bank accounts.
When NOT to use: for non-Swiss IBANs, use validate_iban instead.

Behavior: this tool is read-only with no side effects. It queries a local SQLite database of 1190+ Swiss bank clearing entries sourced from SIX BankMaster. Follows concatenation redirects (merged IIDs). Response time is under 10ms. Returns a single JSON object.

Input: IID as string, 1-5 digits (e.g. '230', '00230', '30000', '80000').
Returns: institution name and type, address, BIC, payment service participation (SIC, RTGS, Instant Payments CHF, euroSIC, LSV+/BDD), QR-IID allocation, and headquarters IID.

Institution types detected: bank, cantonal_bank, postfinance, raiffeisen, central_bank, foreign_participant.

Cost: $0.003 USDC per call via x402 micropayment on Base L2.`,
    inputSchema: {
      iid: z
        .string()
        .trim()
        .regex(/^\d{1,5}$/, 'IID must be a 1-5 digit number')
        .describe(
          "Swiss BC-Nummer / IID. 1-5 digits, e.g. '230' or '00230'. Zero-padded internally to 5 digits. Examples: '230' (UBS), '30000' (PostFinance), '700' (Zürcher Kantonalbank), '80000' (Raiffeisen).",
        ),
    },
    annotations: {
      title: 'Lookup Swiss Bank Clearing Number',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ iid }) => {
    // Validate format
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

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Resources ────────────────────────────────────────────────────────────────

server.registerResource(
  'countries',
  'ibanforge://countries',
  {
    title: 'Supported Countries',
    description: 'List of all 89 countries supported by IBANforge with IBAN length, SEPA membership, VoP status, and country risk classification.',
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

// ── Prompts ──────────────────────────────────────────────────────────────────

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IBANforge MCP Server running on stdio');
  console.error(`Swiss clearing entries: ${getChClearingCount()}`);
}

main().catch(console.error);
