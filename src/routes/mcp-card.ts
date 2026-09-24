import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { datasetFacts } from '../lib/dataset-facts.js';
import {
  BANK_LEVEL_SANCTIONS,
  bicDirectorySentence,
  cannotCallJson,
  codesOf,
  freeAccessSentences,
  registerCountries,
  serverDescription,
} from '../lib/positioning.js';
import { MCP_TOOLS, dataTools, priceLabel } from '../mcp/inventory.js';
import { REST_TRIAL_WEEKLY_LIMIT } from '../lib/trial.js';
import { MCP_DAILY_LIMIT } from '../lib/mcp-limits.js';

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
  validate_iban: `Verify an IBAN from any of the ${F.claim.countries} IBAN countries AND enrich it with bank, compliance and routing data. Use whenever the user mentions an IBAN, asks who the bank is, asks whether the bank code exists, or asks whether the recipient bank is reachable on SEPA rails. Returns: valid, country, the bank-code verdict (national register in ${codesOf(registerCountries().authoritative)}, where a miss means not allocated), BIC and bank name with their source, EMI/vIBAN flag, SEPA and VoP readiness, risk indicators, Swiss bc_nummer for CH/LI. Does not confirm the account exists or belongs to anyone. Cost: $0.005; free to try, with no key, ${REST_TRIAL_WEEKLY_LIMIT} times a week per source address on POST /v1/iban/validate, and ${MCP_DAILY_LIMIT} tool calls a day per IP on the hosted MCP transport (see free_access).`,
  batch_validate_iban:
    'Validate up to 100 IBANs in one call. Paid per call in USDC via x402, an IBAN costs $0.002 in a batch instead of $0.005 in validate_iban; on a key or a credit pack each IBAN uses one request or credit, the same as one validate_iban call. Use for CSV/spreadsheet cleanup, customer DB dedup, or pre-flight payout list triage. Cost: $0.002 USDC per IBAN via x402, max $0.20 per batch; on a key or a credit pack, one credit per IBAN.',
  lookup_bic: `Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank. Use only when the user already has a BIC — for IBAN inputs, prefer validate_iban which resolves the BIC automatically. ${bicDirectorySentence({ withCount: true })} Cost: $0.003.`,
  check_compliance: `Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: ${BANK_LEVEL_SANCTIONS}; FATF status of the country; SEPA Instant reachability; whether the EPC Verification of Payee (VoP) register lists the bank as ready. Returns risk_score 0-100. Informational, not a regulated AML/CFT product. Cost: $0.02.`,
  lookup_ch_clearing: `Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, address, BIC and the full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus the QR-IID where SIX allocates one, for every IID of the SIX BankMaster: ${F.claim.chClearing} entries, refreshed monthly. Cost: $0.003. Only relevant for CH/LI accounts.`,
  validate_payment_reference:
    'Validate a structured payment reference — RF/ISO 11649 ("SCOR", mod 97-10), Swiss QR reference ("QRR", 27 digits, modulo 10 recursive), Belgian OGM/VCS, Finnish viitenumero — each against a dated primary source that publishes the rule. Pass an IBAN and you also get the PAIRING verdict: a QRR reference may only travel with a QR-IBAN (SIX range 30000-31999) and an ISO 11649 reference may not, per the Swiss Implementation Guidelines. Norwegian KID and Swedish OCR are recognised but answer valid: null — their rules are configured per creditor account by the beneficiary bank. Cost: free.',
  check_postal_address:
    "Check a structured ISO 20022 postal address against a payment rail's published address rules — 'sps' (Swiss Payment Standards, SIX), 'hvps_plus' (HVPS+/T2, ECB) or 'fedwire' (Federal Reserve) — rule by rule, each verdict citing the document and its validity date. The November 2026 changes remove the fully unstructured address option; this is the pre-flight that says whether an address survives them. Deliberately no 'cbpr+' scheme: that guideline is unreachable to automated readers, and a conformity boolean quoting an unread document would be a guess dressed as a verdict. Cost: free.",
  check_swiss_qr_bill:
    'Check a Swiss QR-bill payload (the SPC text inside the QR code): header, creditor IBAN and QR-IBAN range, QRR/SCOR/NON reference checksums and pairing, amount, currency, and whether the addresses are structured (type S) or still combined (type K), with a proposed structured form. Cost: free.',
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
  // The line Smithery and the MCP directories index. From src/lib/positioning.ts.
  description: serverDescription(),
  // The only page of the API an assistant (DeepSeek) opened live on
  // 24/09/2026 said nothing about free access. One sentence per door, every
  // figure read from the constant the code applies.
  free_access: freeAccessSentences().join(' '),
  // The same day, the lesson of the reader that cannot POST: this card is
  // opened with a GET, so it names the real answers a GET can open, and asks
  // not to simulate. Written once in src/lib/positioning.ts.
  if_you_cannot_call: cannotCallJson(),
  url: 'https://api.ibanforge.com/mcp',
  transport: 'streamable-http',
  version: pkg.version,
  tools_scope: 'read_only_data',
  available_tools: MCP_TOOLS.map((tool) => tool.name),
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
