import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { lookup } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';
import { buildComplianceResult } from '../lib/compliance.js';

const server = new McpServer({
  name: 'ibanforge',
  version: '1.0.0',
});

// --- Tool: validate_iban ---
server.tool(
  'validate_iban',
  `Validate a single IBAN number and retrieve the associated BIC/SWIFT code and bank information.

Use this tool when you need to validate one IBAN at a time — for example, verifying a payment recipient before a wire transfer, checking a bank account provided by a user, or confirming IBAN format during onboarding.

Returns: validity status, country, bank code, BIC/SWIFT, bank name, BBAN structure, SEPA membership & schemes (SCT/SDD/SCT_INST) with VoP requirement, issuer classification (bank/digital_bank/emi/payment_institution) with institution name, and composite risk indicators (issuer_type, country_risk, test_bic, sepa_reachable, vop_coverage).
Supports 75+ countries including all SEPA countries (EU, Switzerland, UK, Norway, etc.).

Example input: 'CH56 0483 5012 3456 7800 9' (spaces are stripped automatically)
Example output: { valid: true, country: { code: 'CH', name: 'Switzerland' }, bic: 'CRESCHZZ80A', ... }

Cost: $0.005 USDC per call via x402 micropayment on Base L2.
For multiple IBANs, prefer batch_validate_iban (60% cheaper per IBAN).`,
  {
    iban: z
      .string()
      .describe(
        "IBAN to validate. Spaces and hyphens are accepted and stripped automatically. Example: 'CH56 0483 5012 3456 7800 9' or 'DE89370400440532013000'",
      ),
  },
  async ({ iban }) => {
    const result = validateIBAN(iban);
    enrichResult(result);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// --- Tool: batch_validate_iban ---
server.tool(
  'batch_validate_iban',
  `Validate up to 100 IBANs in a single call. Much more economical than individual calls ($0.002/IBAN vs $0.005/IBAN — 60% cheaper).

Use this tool when you need to validate multiple IBANs at once — for example, processing a CSV of supplier accounts, validating a payment batch before submission, running KYC checks on a list of customers, or auditing an accounts-payable file.

Returns an array of results in the same order as the input, each containing: validity, country, BIC, bank name, SEPA info & schemes, issuer classification, and risk indicators.

Example input: ['CH56 0483 5012 3456 7800 9', 'DE89370400440532013000', 'FR7630006000011234567890189']
Cost: $0.002 USDC per IBAN (e.g. 10 IBANs = $0.020, 50 IBANs = $0.100, 100 IBANs = $0.200)

For a single IBAN, use validate_iban instead.`,
  {
    ibans: z.array(z.string()).min(1).max(100).describe('Array of IBANs to validate (1–100 items). Spaces and hyphens are stripped automatically.'),
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

// --- Tool: lookup_bic ---
server.tool(
  'lookup_bic',
  `Look up a BIC/SWIFT code and return full institution details, country, city, and LEI regulatory data.

Use this tool when you have a BIC/SWIFT code and need to identify the bank behind it — for compliance checks, payment routing validation, correspondent banking lookups, or KYC enrichment.

Returns: validity, institution name, country, city, branch info, LEI identifier, LEI status.
Supports BIC8 (e.g. 'UBSWCHZH') and BIC11 (e.g. 'UBSWCHZH80A') formats.
Database: 39,000+ institutions from GLEIF with LEI enrichment.

Example input: 'BNPAFRPP' → BNP Paribas, France, Paris
Example input: 'UBSWCHZH80A' → UBS AG, Switzerland, Zurich (branch 80A)

Cost: $0.003 USDC per call via x402 micropayment on Base L2.
Tip: if you already have an IBAN, use validate_iban instead — it resolves the BIC automatically.`,
  {
    bic: z
      .string()
      .describe(
        "BIC/SWIFT code to look up. 8 or 11 characters. Examples: 'UBSWCHZH', 'BNPAFRPP', 'UBSWCHZH80A', 'BNPAFRPPXXX'",
      ),
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

// --- Tool: compliance_check ---
server.tool(
  'compliance_check',
  `Run a full compliance check on an IBAN: sanctions screening, SEPA reachability, VoP participation, and composite risk scoring.

Use this tool when you need to assess the compliance risk of a payment recipient — for example, verifying an IBAN is not associated with a sanctioned country or bank, checking if a bank participates in SEPA Instant (SCT Inst) or Verification of Payee (VoP), or producing a structured risk score for AML/KYC workflows.

Returns: IBAN validation result + compliance bundle:
  - sanctions: country_sanctioned, bank_sanctioned, matched_lists, fatf_status
  - reachability: sepa_instant (SCT Inst), sct, sdd
  - vop: participant, status
  - risk_score (0–100), risk_level (low/medium/elevated/high/critical), flags

Example input: 'CH56 0483 5012 3456 7800 9'
Example output: { valid: true, compliance: { sanctions: { country_sanctioned: false, ... }, risk_score: 10, risk_level: 'low', ... } }

Cost: $0.02 USDC per call via x402 micropayment on Base L2.`,
  {
    iban: z
      .string()
      .describe(
        "IBAN to check. Spaces and hyphens are accepted and stripped automatically. Example: 'CH56 0483 5012 3456 7800 9' or 'DE89370400440532013000'",
      ),
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
        sanctions: { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'non_member' },
        reachability: { sepa_instant: false, sct: false, sdd: false },
        vop: { participant: false, status: 'not_found' },
        risk_score: 50,
        risk_level: 'elevated',
        flags: ['compliance_data_unavailable'],
      };
    }

    const combined = { ...result, compliance, cost_usdc: 0.02 };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IBANforge MCP Server running on stdio');
}

main().catch(console.error);
