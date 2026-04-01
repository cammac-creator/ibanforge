import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateIBAN } from '../lib/iban.js';
import { lookup, lookupByCountryBank } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';

const server = new McpServer({
  name: 'ibanforge',
  version: '1.0.0',
});

// --- Tool: validate_iban ---
server.tool(
  'validate_iban',
  `Validate a single IBAN number and retrieve the associated BIC/SWIFT code and bank information.

Use this tool when you need to validate one IBAN at a time — for example, verifying a payment recipient before a wire transfer, checking a bank account provided by a user, or confirming IBAN format during onboarding.

Returns: validity status, country, bank code, BIC/SWIFT, bank name, BBAN structure.
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
    if (result.valid && result.bban?.bank_code) {
      result.bic = lookupByCountryBank(result.country!.code, result.bban.bank_code);
    }
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

Returns an array of results in the same order as the input, each containing: validity, country, BIC, bank name.

Example input: ['CH56 0483 5012 3456 7800 9', 'DE89370400440532013000', 'FR7630006000011234567890189']
Cost: $0.002 USDC per IBAN (e.g. 10 IBANs = $0.020, 50 IBANs = $0.100, 100 IBANs = $0.200)

For a single IBAN, use validate_iban instead.`,
  {
    ibans: z.array(z.string()).min(1).max(100).describe('Array of IBANs to validate (1–100 items). Spaces and hyphens are stripped automatically.'),
  },
  async ({ ibans }) => {
    const results = ibans.map((iban) => {
      const result = validateIBAN(iban);
      if (result.valid && result.bban?.bank_code) {
        result.bic = lookupByCountryBank(result.country!.code, result.bban.bank_code);
      }
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IBANforge MCP Server running on stdio');
}

main().catch(console.error);
