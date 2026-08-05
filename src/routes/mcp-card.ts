import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { datasetFacts } from '../lib/dataset-facts.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();


const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// MCP server card. Served at the canonical /.well-known/mcp/server-card.json
// and at the /.well-known/mcp.json and /mcp.json aliases that agent/MCP
// directory crawlers request (~135 hits/month previously landed in 404).
const MCP_SERVER_CARD = {
  name: 'IBANforge',
  description:
    `IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA compliance and risk scoring API for AI agents. ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF), ${F.claim.chClearing} Swiss BC-Nummer from SIX, 89 countries, refreshed monthly.`,
  url: 'https://api.ibanforge.com/mcp',
  transport: 'streamable-http',
  version: pkg.version,
  tools: [
    {
      name: 'validate_iban',
      description:
        'Verify a European IBAN AND enrich it with bank, compliance and routing data. Use whenever the user mentions an IBAN, asks who the bank is, or asks whether the recipient bank is reachable on SEPA rails. Returns: valid, country, BIC, bank name, EMI/vIBAN flag, SEPA + VoP, risk_score, Swiss bc_nummer for CH/LI. Does not confirm the account exists or belongs to anyone. Cost: $0.005.',
    },
    {
      name: 'batch_validate_iban',
      description:
        'Validate up to 100 IBANs in one call (cheaper than calling validate_iban repeatedly). Use for CSV/spreadsheet cleanup, customer DB dedup, or pre-flight payout list triage. Cost: $0.002 per IBAN, max $0.20 per batch.',
    },
    {
      name: 'lookup_bic',
      description:
        `Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank. Use only when the user already has a BIC — for IBAN inputs, prefer validate_iban which resolves the BIC automatically. Backed by ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF, refreshed monthly). Cost: $0.003.`,
    },
    {
      name: 'check_compliance',
      description:
        'Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: sanctions screening (OFAC), FATF jurisdiction flag, SEPA Instant reachability, VoP (EU 2024/886) participant. Returns risk_score 0-100. Informational, not a regulated AML/CFT product. Cost: $0.02.',
    },
    {
      name: 'lookup_ch_clearing',
      description:
        `Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, address, BIC and the full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus QR-IID — the deepest Swiss clearing data in any public API. Backed by ${F.claim.chClearing} SIX BankMaster entries (refreshed monthly). Cost: $0.003. Only relevant for CH/LI accounts.`,
    },
  ],
  homepage: 'https://ibanforge.com',
  repository: 'https://github.com/cammac-creator/ibanforge',
  documentation: 'https://ibanforge.com/docs/mcp',
};

const mcpCard = new Hono();

for (const path of ['/.well-known/mcp/server-card.json', '/.well-known/mcp.json', '/mcp.json', '/.well-known/mcp']) {
  mcpCard.get(path, (c) => c.json(MCP_SERVER_CARD));
}

export { mcpCard };
