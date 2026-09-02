import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { datasetFacts } from '../lib/dataset-facts.js';
import { dataTools, priceLabel } from '../mcp/inventory.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

/**
 * The long, agent-facing text for the tools that have one, keyed by tool name.
 *
 * The LIST is no longer written here: it comes from `dataTools()` (audit
 * 2026-09-01, DX-01). Only the prose lives here, because these paragraphs say
 * when NOT to call a tool and what a negative answer means, which a
 * one-sentence inventory entry cannot carry. A tool with no entry below still
 * appears on the card, described by its inventory sentence and its price,
 * which is the behaviour that makes a ninth tool publish itself.
 */
const LONG_DESCRIPTIONS: Record<string, string> = {
  validate_iban:
    'Verify a European IBAN AND enrich it with bank, compliance and routing data. Use whenever the user mentions an IBAN, asks who the bank is, or asks whether the recipient bank is reachable on SEPA rails. Returns: valid, country, BIC, bank name, EMI/vIBAN flag, SEPA + VoP, risk_score, Swiss bc_nummer for CH/LI. Does not confirm the account exists or belongs to anyone. Cost: $0.005.',
  batch_validate_iban:
    'Validate up to 100 IBANs in one call (cheaper than calling validate_iban repeatedly). Use for CSV/spreadsheet cleanup, customer DB dedup, or pre-flight payout list triage. Cost: $0.002 per IBAN, max $0.20 per batch.',
  lookup_bic: `Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank. Use only when the user already has a BIC — for IBAN inputs, prefer validate_iban which resolves the BIC automatically. Backed by ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF, refreshed monthly). Cost: $0.003.`,
  check_compliance:
    'Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: sanctions screening (OFAC), FATF jurisdiction flag, SEPA Instant reachability, VoP (EU 2024/886) participant. Returns risk_score 0-100. Informational, not a regulated AML/CFT product. Cost: $0.02.',
  lookup_ch_clearing: `Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, address, BIC and the full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus QR-IID — the deepest Swiss clearing data in any public API. Backed by ${F.claim.chClearing} SIX BankMaster entries (refreshed monthly). Cost: $0.003. Only relevant for CH/LI accounts.`,
  validate_payment_reference:
    'Validate a structured payment reference — RF/ISO 11649 ("SCOR", mod 97-10), Swiss QR reference ("QRR", 27 digits, modulo 10 recursive), Belgian OGM/VCS, Finnish viitenumero — each against a dated primary source that publishes the rule. Pass an IBAN and you also get the PAIRING verdict: a QRR reference may only travel with a QR-IBAN (SIX range 30000-31999) and an ISO 11649 reference may not, per the Swiss Implementation Guidelines. Norwegian KID and Swedish OCR are recognised but answer valid: null — their rules are configured per creditor account by the beneficiary bank. Cost: free.',
  check_postal_address:
    "Check a structured ISO 20022 postal address against a payment rail's published address rules — 'sps' (Swiss Payment Standards, SIX), 'hvps_plus' (HVPS+/T2, ECB) or 'fedwire' (Federal Reserve) — rule by rule, each verdict citing the document and its validity date. The November 2026 changes remove the fully unstructured address option; this is the pre-flight that says whether an address survives them. Deliberately no 'cbpr+' scheme: that guideline is unreachable to automated readers, and a conformity boolean quoting an unread document would be a guess dressed as a verdict. Cost: free.",
};

// MCP server card. Served at the canonical /.well-known/mcp/server-card.json
// and at the /.well-known/mcp.json and /mcp.json aliases that agent/MCP
// directory crawlers request (a steady monthly stream previously landed in 404).
//
// The card advertises the DATA tools only: send_feedback writes and is not a
// capability a crawler should index as buyable. That exclusion is now derived
// from `readOnly` instead of being a shorter hand-kept list, which is what let
// the card and the tool servers drift apart in the first place.
const MCP_SERVER_CARD = {
  name: 'IBANforge',
  description: `IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA compliance and risk scoring API for AI agents. ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF), ${F.claim.chClearing} Swiss BC-Nummer from SIX, 89 countries, refreshed monthly.`,
  url: 'https://api.ibanforge.com/mcp',
  transport: 'streamable-http',
  version: pkg.version,
  tools: dataTools().map((tool) => ({
    name: tool.name,
    description:
      LONG_DESCRIPTIONS[tool.name] ?? `${tool.description} Cost: ${priceLabel(tool.price)}.`,
  })),
  homepage: 'https://ibanforge.com',
  repository: 'https://github.com/cammac-creator/ibanforge',
  documentation: 'https://ibanforge.com/docs/mcp',
};

const mcpCard = new Hono();

for (const path of [
  '/.well-known/mcp/server-card.json',
  '/.well-known/mcp.json',
  '/mcp.json',
  '/.well-known/mcp',
]) {
  mcpCard.get(path, (c) => c.json(MCP_SERVER_CARD));
}

export { mcpCard };
