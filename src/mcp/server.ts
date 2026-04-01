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
  `Validate an IBAN number and retrieve the associated BIC/SWIFT code and bank information.
Returns: validity status, country, bank code, BIC, bank name.
Supports 75+ countries including all SEPA countries.
Cost: $0.005 USDC per call via x402 micropayment on Base L2.`,
  {
    iban: z
      .string()
      .describe(
        "IBAN to validate. Spaces and hyphens are accepted and stripped automatically. Example: 'CH56 0483 5012 3456 7800 9'",
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
  `Validate up to 10 IBANs in a single call. More economical than individual calls ($0.020 vs $0.050).
Useful for validating supplier lists, payment batches, or KYC workflows.`,
  {
    ibans: z.array(z.string()).max(10).describe('Array of IBANs to validate (max 10)'),
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
  `Look up a BIC/SWIFT code and return institution details, country, city, and LEI data.
Returns: validity, institution name, country, city, branch info, LEI identifier.
Supports BIC8 (UBSWCHZH) and BIC11 (UBSWCHZH80A) formats.
Cost: $0.003 USDC per call via x402 micropayment on Base L2.`,
  {
    bic: z
      .string()
      .describe(
        "BIC/SWIFT code to look up. 8 or 11 characters. Example: 'UBSWCHZH' or 'BNPAFRPPXXX'",
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
