/**
 * HTTP transport for the MCP server.
 * Exposes the 7 data tools of the stdio MCP server plus send_feedback (validate_iban, batch_validate_iban,
 * lookup_bic, check_compliance, lookup_ch_clearing, validate_payment_reference, check_postal_address) via
 * Streamable HTTP at /mcp — compatible with Smithery, remote MCP clients, etc.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateIBAN } from '../lib/iban.js';
import { createEnrichCache, enrichResult } from '../lib/enrich.js';
import { recordFeedbackRow, FEEDBACK_ERROR_TYPES } from './feedback.js';
import { lookup } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { lookupClearingByBankCode, normalizeIid } from '../lib/ch-clearing.js';
import { validatePaymentReference, buildReferenceCheck } from '../lib/payment-reference.js';
import { checkPostalAddress, ADDRESS_SCHEMES, type AddressScheme } from '../lib/address-conformity.js';
import { extractClientIp } from '../lib/stats.js';
import { buildCountriesPayload, buildPricingPayload, buildValidateAndExplainPrompt } from '../lib/mcp-resources.js';
import { datasetFacts } from '../lib/dataset-facts.js';
import { MCP_INSTRUCTIONS } from '../mcp/instructions.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();

/**
 * The bank-code verdict, declared once and reused by all three tool schemas.
 *
 * An agent reading this needs the branch spelled out, because the difference
 * between the three statuses is the difference between stopping a payment and
 * letting it through: only `authoritative: true` turns `not_in_register` into
 * evidence that the bank code does not exist.
 */
/**
 * What an agent should do next. Declared once, attached to all three tools, for
 * the same reason as BANK_CODE_CHECK_SCHEMA: the MCP SDK validates a tool's
 * output against its declared schema and silently drops `structuredContent` on
 * a mismatch, so a field added to the response and not to every schema stops
 * the structured path without any error.
 */
const NEXT_STEPS_SCHEMA = z
  .array(
    z.object({
      code: z.string().describe('Stable identifier. Branch on this.'),
      do: z.string(),
      because: z.string().describe('The response field that produced this step.'),
      action: z.string().optional().describe('An IBANforge call that performs the step, when one exists.'),
    }),
  )
  .optional()
  .describe('Ordered advice derived from THIS result: what blocks a payment first, what merely enriches it after. Branch on `code`, never on the prose. `because` names the field that produced the step so the advice is auditable. Empty for an IBAN that failed validation.');

/**
 * The official identity a central bank publishes for the resolved code.
 *
 * Declared here and attached to every tool whose result can carry it, for the
 * reason spelled out above NEXT_STEPS_SCHEMA: the SDK validates output against
 * the declared schema and Zod SILENTLY STRIPS what the schema does not name. A
 * block left out here would vanish from `structuredContent` without an error —
 * and this one carries licence conditions (`source`, `free_of_charge`) that
 * both publishers require to accompany the data on every access.
 */
const OFFICIAL_IDENTITY_SCHEMA = z
  .object({
    name: z.string().describe("The institution's name as the publisher writes it."),
    lei: z.string().nullable(),
    address: z.string().nullable().describe('One-line registered address as published.'),
    category: z.string(),
    matched_by: z.string().describe('lei | national_code'),
    source: z.string().describe('The publisher, cited as their licence requires. Relay it.'),
    free_of_charge: z
      .string()
      .describe(
        'Both publishers require buyers to be told, on every access, that the data is available free of charge from their own website. Relay it with the answer; do not strip it.',
      ),
    attribution: z.string().optional().describe('The Banco de Espana citation formula, verbatim. Spanish blocks only.'),
    as_of: z.string().describe('Date of the list this row came from. Both lists are republished every business day.'),
    authoritative: z.boolean().describe('Always false. Neither publisher allocates bank codes.'),
  })
  .optional()
  .describe(
    'Who a central bank says holds the resolved code (ECB by LEI and for FR bank codes, Banco de Espana for ES). Present only on a match — absence is not a negative. INFORMATIONAL ONLY: it never changes valid or bank_code_check, because both publishers relay rather than allocate.',
  );

/**
 * Where a derived BIC came from, declared once for the three tools that serve
 * one.
 *
 * Same trap as NEXT_STEPS_SCHEMA above, and this field is the worst one to lose
 * to it: an agent that cannot see the basis has no way to tell a register
 * pairing from a prefix guess, and the guess is the one it must not settle
 * against. Zod strips what the schema does not name, silently.
 */
const BIC_BASIS_SCHEMA = z
  .string()
  .optional()
  .describe(
    'Where the bank code to BIC pairing came from, and therefore what may be done with the BIC. ' +
      'national_register (the country register publishes this BIC for this bank code — today DE, AT, BE and BG; settlement-grade) | ' +
      'curated_map (our maintained bank-code map, exact key, usually right and not an allocation record) | ' +
      'directory_prefix (the bic8 LIKE fallback, which can match several institutions — read bank_code_check.candidates). ' +
      'Outside a national_register basis the BIC is ADVISORY: confirm it with the beneficiary or the bank before storing it as a routing instruction.',
  );

const BIC_AUTHORITATIVE_SCHEMA = z
  .boolean()
  .optional()
  .describe(
    'Whether this BIC may be stored and settled against. Derived from basis, so the two cannot disagree. ' +
      'NOT bank_code_check.authoritative, which answers a different question — whether a national register was consulted about the BANK CODE. In Switzerland the register confirms the code while the BIC still comes from our curated map.',
  );

const BANK_CODE_CHECK_SCHEMA = z
  .object({
    value: z.string(),
    status: z
      .string()
      .describe(
        'verified | not_in_register | unavailable. A separate verdict on the bank code, so bic:null stops meaning three different things.',
      ),
    reason: z
      .string()
      .optional()
      .describe(
        'WHY the verdict is not verified, as one token to branch on. Absent when status is verified. ' +
          'not_allocated (a national register denies the code — the only value that licenses "do not send") | ' +
          'absent_from_reference_data (our composite map does not carry it; the country register was not consulted) | ' +
          'no_reference_data_for_country | ' +
          'register_names_no_holder (the register defines the code space and publishes no holder — silence, not a denial) | ' +
          'national_register_unavailable (the register this country is normally decided against could not be consulted) | ' +
          'lookup_failed (the lookup could not run: timeout, unreadable database). ' +
          'The last two describe IBANforge, never the beneficiary. Never escalate either into a refusal.',
      ),
    match: z.string().nullable().describe('register (exact key) | prefix (bic8 LIKE heuristic) | null'),
    register: z.string().nullable(),
    authoritative: z
      .boolean()
      .describe(
        'True only where the reference set is the national register (CH, LI, DE). Only then does not_in_register mean the code is not allocated.',
      ),
    candidates: z.number().optional().describe('BIC8 the prefix matched; >1 means the BIC may belong to another institution.'),
    retired: z
      .boolean()
      .optional()
      .describe('True when an authoritative register is withdrawing the code. Still a verified result: it WAS allocated.'),
    superseded_by: z.string().optional().describe('The bank code that takes over. Re-paper the beneficiary against it.'),
    as_of: z.string(),
  })
  .optional();


const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const mcpHttp = new Hono<HonoEnv>();

// ── Session store ─────────────────────────────────────────────────────────────
/**
 * Active transports, held by session id — with two exit doors.
 *
 * Every open session holds a whole McpServer: 2.77 MB of heap, measured after
 * two forced GCs (security audit SEC-01 / MCP-08, 2026-09-01). Until that audit
 * this was a bare Map with no exit door at all: `onsessionclosed` and `onclose`
 * fire only for a client that sends DELETE or drops its stream, and directory
 * crawlers (Smithery, Glama, MCP.so) do neither — they open a session and walk
 * away. 300 anonymous POSTs from one IP retained 812 MB, and session #1 still
 * answered afterwards, which is the proof that nothing was ever released.
 *
 * So: a session unused for 30 minutes is swept, and the store is capped, the
 * least recently used going first. Both are cheap for a client and decisive for
 * the container — losing a session costs one `initialize`, which every MCP
 * client knows how to send (and which the POST handler now names explicitly);
 * losing the process to an OOM costs every client at once.
 */
const MCP_SESSION_IDLE_MS = 30 * 60 * 1000;
const MCP_MAX_SESSIONS = 300;

export interface McpSessionStore {
  readonly size: number;
  /** Reading a session marks it in use, which is what keeps it out of the sweep. */
  get(id: string, now?: number): WebStandardStreamableHTTPServerTransport | undefined;
  set(id: string, transport: WebStandardStreamableHTTPServerTransport, now?: number): void;
  delete(id: string): boolean;
  /** Drops every session idle for longer than the TTL; returns how many went. */
  sweep(now?: number): number;
}

/**
 * `maxSessions` and `idleMs` are parameters rather than constants read from the
 * module so the eviction rules can be exercised on a store of three sessions
 * instead of three hundred — the alternative is a test that allocates ~830 MB
 * of McpServer and leaves it in the runner for every file that comes after.
 */
export function createMcpSessionStore(
  maxSessions: number = MCP_MAX_SESSIONS,
  idleMs: number = MCP_SESSION_IDLE_MS,
): McpSessionStore {
  interface Entry {
    transport: WebStandardStreamableHTTPServerTransport;
    lastSeen: number;
  }
  // Insertion order is kept as recency order (a read re-inserts), so the head
  // of the Map is always the least recently used entry.
  const entries = new Map<string, Entry>();

  /** Forget the session AND let the SDK release the stream it still holds. */
  const release = (id: string, entry: Entry): void => {
    // Delete first: close() calls back into `onclose`, which deletes again, and
    // this ordering is what makes that re-entry a no-op instead of a surprise.
    entries.delete(id);
    try {
      void Promise.resolve(entry.transport.close()).catch(() => undefined);
    } catch {
      // A transport that refuses to close must not take the sweep down with it.
    }
  };

  return {
    get size(): number {
      return entries.size;
    },
    get(id: string, now: number = Date.now()): WebStandardStreamableHTTPServerTransport | undefined {
      const entry = entries.get(id);
      if (!entry) return undefined;
      entry.lastSeen = now;
      entries.delete(id);
      entries.set(id, entry);
      return entry.transport;
    },
    set(id: string, transport: WebStandardStreamableHTTPServerTransport, now: number = Date.now()): void {
      entries.delete(id);
      while (entries.size >= maxSessions) {
        const oldest = entries.entries().next();
        if (oldest.done) break;
        const [victimId, victim] = oldest.value;
        release(victimId, victim);
      }
      entries.set(id, { transport, lastSeen: now });
    },
    delete(id: string): boolean {
      return entries.delete(id);
    },
    sweep(now: number = Date.now()): number {
      const stale = [...entries].filter(([, entry]) => now - entry.lastSeen >= idleMs);
      for (const [id, entry] of stale) release(id, entry);
      return stale.length;
    },
  };
}

/** The live store. Exported so the idle sweep can be exercised end to end. */
export const mcpSessions = createMcpSessionStore();

/**
 * What this transport costs, said in the description an agent actually reads.
 *
 * Six of the seven data tools named no price at all on either shipped surface
 * (MCP-10, audit 2026-09-01): an agent reading tools/list had no basis on which
 * to decide to pay, so it never did. The catalogue price and the free allowance
 * belong in the same sentence — one without the other either scares the agent
 * off or hides the bill.
 */
const FREE_TIER_NOTE =
  'free: 10 units/IP/day on this transport, one per call and one per IBAN in batch_validate_iban, '
  + 'or a free API key at POST https://api.ibanforge.com/v1/keys/generate for 200 REST calls/month';
const costLine = (price: string): string => `COST: ${price} (${FREE_TIER_NOTE}).`;

/**
 * Say what was billed, and separately what it is worth.
 *
 * Every tool answered `cost_usdc: 0.005` on the free MCP tier, so an agent
 * relaying that field told its operator about a charge nobody made (MCP-17,
 * audit 2026-09-01). `cost_usdc` is now what this call actually cost — zero on
 * this transport — and the catalogue price moves to `list_price_usdc`, which is
 * the number an agent needs to compare paying against the REST route.
 *
 * ⚠️ Both fields must be declared in each tool's outputSchema: the SDK
 * validates the payload against it and drops `structuredContent` silently on a
 * mismatch, so an undeclared field is a field no agent will ever see.
 */
function billedFree(payload: Record<string, unknown>, listPrice?: number): Record<string, unknown> {
  const listed = listPrice ?? payload.cost_usdc;
  if (typeof listed !== 'number') return payload;
  return { ...payload, cost_usdc: 0, list_price_usdc: listed };
}

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
      `Pre-payout screening for agents — check the bank behind a counterparty IBAN before you send funds: IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA/VoP reachability, sanctions and risk indicators. ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF), ${F.claim.chClearing} Swiss BC-Nummer from SIX, 89 countries, refreshed monthly.`,
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
  }, {
    // Injected by MCP clients into their model's context at connect time —
    // the single best-placed sentences we own. Shared with the two stdio
    // surfaces since 2026-09-01 (MCP-11): three copies of one paragraph is
    // three chances to fix one and forget two.
    instructions: MCP_INSTRUCTIONS,
  });

  server.registerTool(
    'validate_iban',
    {
      title: 'Validate IBAN',
      description:
        'Verify whether a European IBAN is valid AND enrich it with bank, compliance and routing data. ' +
        'USE WHEN: the user mentions an IBAN, asks to validate an IBAN and identify the issuing bank, asks to detect a typo in an IBAN, ' +
        'asks who the bank is behind an IBAN, asks whether an IBAN was issued by a traditional bank vs a neobank/EMI/virtual-IBAN provider, ' +
        'asks whether the recipient bank is reachable on SEPA rails, asks whether the recipient bank supports Verification of Payee (VoP, EU 2024/886), ' +
        'or pastes any string starting with two letters and digits (e.g., "DE89...", "CH93...", "FR76..."). ' +
        'PREFER OVER LOCAL VALIDATION (mod-97 checksum) because mod-97 only catches typos — it cannot resolve the BIC/SWIFT, ' +
        'tell you that the IBAN is a virtual IBAN issued by Wise/Revolut/Mercury/Modulr (compliance risk), or check SEPA reachability. ' +
        'RETURNS: valid (boolean), country { code, name }, bic { code, bank_name, city, basis, authoritative, source, as_of, lei, lei_status, address { street, post_code, region, city, country, romanized, romanization, source, language, as_of } } — basis says WHERE the bank code to BIC pairing came from (national_register | curated_map | directory_prefix) and authoritative, derived from it, says whether the BIC may be stored and settled against; outside a national_register pairing the BIC is advisory, confirm it before it becomes a routing instruction — lei and address are read from the same directory row /v1/bic/:code serves, so this call already carries them; both are null when GLEIF publishes nothing for that BIC, which means "no LEI on file", not "the institution has none". bic.address is the LEGAL ENTITY seat, so bic.address.city may legitimately differ from bic.city (the register city for THIS bank code), and bic.address.as_of dates the entity last filing, usually much older than bic.as_of. ' +
        'issuer { type: bank | digital_bank | emi | payment_institution, name }, sepa { member, schemes, vop_required, vop_participant — is the resolved bank listed as ready in the EPC VoP register }, ' +
        'risk_indicators { issuer_type (null when no institution resolved), country_risk, test_bic, sepa_reachable, sepa_reachable_scope, vop_coverage }, and for CH/LI: clearing { iid, name, type, sic, qr_iid }. ' +
        'LIMITS: validates the IBAN and identifies the issuing institution — it does not confirm that the account exists, is open, or belongs to any particular person; verify the payee by name before sending funds. ' +
        'IMPORTANT — bic: null does not mean the bank code is wrong. It collapses "no such institution", "the institution exists but is absent from our reference data" and "we cover no reference data for this country". Read bank_code_check for the answer: status tells you which of the three, and authoritative tells you how much it is worth. Only where authoritative is true (today CH and LI against the SIX BankMaster, and DE against the Bundesbank Bankleitzahlendatei) does not_in_register mean the bank code is not allocated; everywhere else treat it as UNAVAILABLE and let the downstream name check decide. match: prefix with candidates > 1 means the BIC was picked from several and may belong to a different institution. ' +
        costLine('$0.005 per call'),
      inputSchema: {
        iban: z.string().describe('IBAN to validate (spaces/hyphens stripped automatically)'),
      },
      outputSchema: {
        iban: z.string().describe('Normalized IBAN (uppercase, no spaces).'),
        valid: z.boolean(),
        formatted: z.string().optional().describe('IBAN with 4-char groups for display.'),
        country: z.object({
          code: z.string().describe('ISO 3166-1 alpha-2 country code.'),
          name: z.string(),
        }).optional(),
        check_digits: z.string().optional(),
        bban: z.object({
          bank_code: z.string(),
          branch_code: z.string().optional(),
          account_number: z.string(),
        }).optional(),
        bic: z.object({
          code: z.string(),
          bank_name: z.string().nullable(),
          city: z.string().nullable(),
          basis: BIC_BASIS_SCHEMA,
          authoritative: BIC_AUTHORITATIVE_SCHEMA,
        }).nullable().optional().describe('Resolved BIC/SWIFT when BBAN→BIC mapping exists. Read basis before storing it as a routing instruction: only a national_register pairing is settlement-grade.'),
        sepa: z.object({
          member: z.boolean(),
          schemes: z.array(z.string()),
          vop_required: z.boolean(),
          vop_participant: z.boolean().nullable().optional().describe('true = resolved bank is listed as ready in the EPC VoP scheme register; null = no institution resolved.'),
          // Declared because `enrichResult` now serves it: the SDK validates
          // this payload against the schema and drops `structuredContent`
          // silently on a field it does not know, so an undeclared field is a
          // field no agent ever sees.
          basis: z.enum(['country_default', 'epc_register']).optional().describe('Where `schemes` came from: read at the EPC register for this bank, or defaulted from the country.'),
        }).optional(),
        issuer: z.object({
          type: z.string().describe('bank | digital_bank | emi | payment_institution'),
          name: z.string(),
          classification: z
            .string()
            .describe(
              'curated | register | default. Whether the type was established or assumed. curated = the BIC8 is in the issuer set, so this is an identification. register = an official register names the holder of this bank code and says what it is; it carries a date and an authority in psd_registration, and it only ever replaces a default. default = nothing is on file and "bank" is the fallback, which covers 97.9% of BIC8 (measured 29/07/2026). Count curated and register when sizing virtual-IBAN exposure, never default.',
            ),
        }).optional(),
        risk_indicators: z.object({
          issuer_type: z.string().nullable().describe('Null when no institution resolved — it no longer defaults to "bank".'),
          country_risk: z.string(),
          test_bic: z.boolean(),
          sepa_reachable: z.boolean(),
          sepa_reachable_scope: z.string().describe('Scope the reachability holds at. Country-derived, not account-derived.'),
          vop_coverage: z.boolean(),
        }).optional(),
        bank_code_check: BANK_CODE_CHECK_SCHEMA,
        official_identity: OFFICIAL_IDENTITY_SCHEMA,
        next_steps: NEXT_STEPS_SCHEMA,
        clearing: z.object({
          iid: z.string(),
          name: z.string(),
          type: z.string(),
          town: z.string().nullable(),
          sic: z.boolean(),
          instant_payments_chf: z.boolean(),
          eurosic: z.boolean(),
          qr_iid: z.string().nullable(),
        }).nullable().optional().describe('Swiss clearing data when country is CH or LI.'),
        error: z.string().optional(),
        error_detail: z.string().optional(),
        cost_usdc: z.number().describe('What THIS call was billed. Zero on the free MCP tier.'),
        list_price_usdc: z.number().optional().describe('Catalogue price of the same call on the paid REST/x402 route.'),
        processing_ms: z.number().optional(),
      },
      annotations: { title: 'Validate IBAN', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iban }) => {
      const result = validateIBAN(iban);
      enrichResult(result);
      const payload = billedFree(result as unknown as Record<string, unknown>);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    'batch_validate_iban',
    {
      title: 'Batch Validate IBANs',
      description:
        'Validate up to 100 IBANs in a single call at $0.002 per IBAN (60% cheaper than calling validate_iban repeatedly at $0.005). ' +
        'USE WHEN: the user pastes a list of IBANs, asks to clean a CSV/spreadsheet of bank accounts, ' +
        'asks to dedupe a customer database, asks to triage a payout list before sending, ' +
        'or whenever you would otherwise call validate_iban more than 2-3 times in a row. ' +
        'RETURNS: { results: [...same shape as validate_iban], count, valid_count }. ' +
        costLine('$0.002 per IBAN'),
      inputSchema: {
        ibans: z.array(z.string()).min(1).max(100).describe('Array of IBANs (1-100)'),
      },
      outputSchema: {
        results: z.array(z.object({
          iban: z.string(),
          valid: z.boolean(),
          country: z.object({ code: z.string(), name: z.string() }).optional(),
          bban: z.object({
            bank_code: z.string(),
            branch_code: z.string().optional(),
            account_number: z.string(),
          }).optional(),
          bic: z.object({
            code: z.string(),
            bank_name: z.string().nullable(),
            city: z.string().nullable(),
            basis: BIC_BASIS_SCHEMA,
            authoritative: BIC_AUTHORITATIVE_SCHEMA,
          }).nullable().optional(),
          issuer: z.object({ type: z.string(), name: z.string(), classification: z.string() }).optional(),
          sepa: z.object({
            member: z.boolean(),
            schemes: z.array(z.string()),
            vop_required: z.boolean(),
            vop_participant: z.boolean().nullable().optional(),
            basis: z.enum(['country_default', 'epc_register']).optional(),
          }).optional(),
          risk_indicators: z.object({
            issuer_type: z.string().nullable(),
            country_risk: z.string(),
            test_bic: z.boolean(),
            sepa_reachable: z.boolean(),
            sepa_reachable_scope: z.string(),
            vop_coverage: z.boolean(),
          }).optional(),
          bank_code_check: BANK_CODE_CHECK_SCHEMA,
          official_identity: OFFICIAL_IDENTITY_SCHEMA,
          next_steps: NEXT_STEPS_SCHEMA,
          clearing: z.object({
            iid: z.string(),
            name: z.string(),
            type: z.string(),
            town: z.string().nullable(),
            sic: z.boolean(),
            instant_payments_chf: z.boolean(),
            eurosic: z.boolean(),
            qr_iid: z.string().nullable(),
          }).nullable().optional(),
          error: z.string().optional(),
          error_detail: z.string().optional(),
          cost_usdc: z.number().describe('What THIS IBAN was billed. Zero on the free MCP tier.'),
          list_price_usdc: z.number().optional().describe('Catalogue price per IBAN on the paid REST/x402 route.'),
        })).describe('One result per input IBAN, in the same order. Same shape as validate_iban.'),
        count: z.number().describe('Number of IBANs processed.'),
      },
      annotations: { title: 'Batch Validate IBANs', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ ibans }) => {
      // One cache for the whole batch: a payout list is mostly the same few
      // banks, and without it every row re-resolves the same bank from scratch
      // (PERF-05). Same shape as the REST route in src/routes/iban-batch.ts.
      const cache = createEnrichCache();
      const results = ibans.map((iban) => {
        const result = validateIBAN(iban);
        enrichResult(result, cache);
        // The list price is stated explicitly here because `enrichResult`
        // stamps every row with the SINGLE-call price (0.005) while a row of a
        // batch is catalogued at 0.002 — the 60% discount this tool's own
        // description sells. Reading the field back from the row would publish
        // the wrong catalogue number under the right name.
        return billedFree(result as unknown as Record<string, unknown>, 0.002);
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        structuredContent: { results, count: results.length },
      };
    },
  );

  server.registerTool(
    'lookup_bic',
    {
      title: 'Lookup BIC/SWIFT',
      description:
        'Resolve a BIC / SWIFT code into the underlying bank: name, country, city, LEI, and registered head-office address (where available). ' +
        'USE WHEN: the user already has a BIC/SWIFT (8 or 11 chars, alphanumeric, e.g., "UBSWCHZH80A", "DEUTDEFF") ' +
        'and asks which bank it belongs to, where the bank is, or its LEI for compliance/regulatory matching. ' +
        'DO NOT USE for IBAN inputs — call validate_iban instead, it resolves the BIC for you. ' +
        `BACKED BY: ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF; additional rows from SwiftCodes (MIT), Bundesbank, SIX, NBP, EBA Step2 SCT), refreshed monthly. ` +
        costLine('$0.003 per call'),
      inputSchema: {
        bic: z.string().describe('BIC/SWIFT code (8 or 11 chars)'),
      },
      outputSchema: {
        bic: z.string().describe('Echo of the input, normalized to uppercase.'),
        bic8: z.string().optional().describe('8-char form (institution-level).'),
        bic11: z.string().optional().describe('11-char form including branch.'),
        valid_format: z.boolean().optional(),
        found: z.boolean().optional(),
        institution: z.string().nullable().optional().describe('Bank legal name.'),
        country_code: z.string().optional().describe('DEPRECATED since 1.4.0, removed no earlier than 2027-01-01. Use country.code.'),
        country_name: z.string().nullable().optional().describe('DEPRECATED since 1.4.0, removed no earlier than 2027-01-01. Use country.name, which falls back to the code rather than to null.'),
        country: z
          .object({ code: z.string(), name: z.string() })
          .optional()
          .describe('Same shape as REST GET /v1/bic/:code. name falls back to the country code when the row carries no name.'),
        city: z.string().nullable().optional(),
        branch_code: z.string().optional(),
        branch_info: z.string().nullable().optional(),
        lei: z.string().nullable().optional().describe('Legal Entity Identifier (ISO 17442) if available.'),
        lei_status: z.string().nullable().optional(),
        is_test_bic: z.boolean().optional(),
        valid: z.boolean().optional().describe('Set when the BIC failed format validation.'),
        error: z.string().optional(),
      },
      annotations: { title: 'Lookup BIC/SWIFT', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ bic }) => {
      const validation = validateBIC(bic);
      if (!validation.valid) {
        const errorPayload = { bic: validation.bic, valid: false, error: validation.error };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(errorPayload, null, 2),
            },
          ],
          structuredContent: errorPayload as unknown as Record<string, unknown>,
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
      // Aligned on the REST shape (GET /v1/bic/:code returns country: {code, name}),
        // which validate_iban already used on both surfaces. The flat pair stays
        // for now so no agent breaks mid-conversation; it is deprecated and dated
        // in the tool description.
        //
        // The two keep DIFFERENT null semantics on purpose. REST falls back to the
        // country code when the row carries no name; the flat MCP key has always
        // answered null. Mirroring REST into `country.name` while leaving
        // `country_name: null` is the honest reading of both histories: the nested
        // object is the aligned one, the flat pair is preserved exactly as it was.
        country: { code: validation.country_code, name: row?.country_name ?? validation.country_code },
        city: row?.city ?? null,
        branch_code: validation.branch_code,
        branch_info: row?.branch_info ?? null,
        lei: row?.lei ?? null,
        lei_status: row?.lei_status ?? null,
        is_test_bic: validation.is_test_bic,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
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
        'CHECKS: IBAN validity + sanctions (OFAC list, FATF jurisdictions) + SEPA Instant reachability + VoP (EU 2024/886) participant. ' +
        'RETURNS: the full validate enrichment plus a compliance object with risk_score (0-100, 0 = safest), risk_level (low/medium/elevated/high/critical), sanctions matched_lists + fatf_status, reachability, vop status, and flags[] (e.g. sanctioned_country, fatf_grey_list, emi_issuer, no_vop). ' +
        costLine('$0.02 per call'),
      inputSchema: {
        iban: z.string().describe('IBAN to check'),
      },
      outputSchema: {
        iban: z.string(),
        valid: z.boolean(),
        country: z.object({ code: z.string(), name: z.string() }).optional(),
        bic: z.object({
          code: z.string(),
          bank_name: z.string().nullable(),
          city: z.string().nullable(),
          basis: BIC_BASIS_SCHEMA,
          authoritative: BIC_AUTHORITATIVE_SCHEMA,
        }).nullable().optional(),
        issuer: z.object({ type: z.string(), name: z.string(), classification: z.string() }).optional(),
        sepa: z.object({
          member: z.boolean(),
          schemes: z.array(z.string()),
          vop_required: z.boolean(),
        }).optional(),
        risk_indicators: z.object({
          issuer_type: z.string().nullable().describe('Null when no institution resolved — it no longer defaults to "bank".'),
          country_risk: z.string(),
          test_bic: z.boolean(),
          sepa_reachable: z.boolean(),
          sepa_reachable_scope: z.string().describe('Scope the reachability holds at. Country-derived, not account-derived.'),
          vop_coverage: z.boolean(),
        }).optional(),
        bank_code_check: BANK_CODE_CHECK_SCHEMA,
        official_identity: OFFICIAL_IDENTITY_SCHEMA,
        next_steps: NEXT_STEPS_SCHEMA,
        compliance: z.object({
          sanctions: z.object({
            country_sanctioned: z.boolean(),
            bank_sanctioned: z.boolean(),
            matched_lists: z.array(z.string()),
            fatf_status: z.string(),
          }),
          reachability: z.object({
            sepa_instant: z.boolean(),
            sct: z.boolean(),
            sdd: z.boolean(),
          }),
          vop: z.object({
            participant: z.boolean(),
            status: z.string(),
          }),
          // .nullable() is load-bearing, not defensive. This tool returns
          // structuredContent, so the MCP SDK validates the payload against
          // this schema and throws McpError on a mismatch. Without it, every
          // invalid-IBAN call on the production /mcp transport would become a
          // JSON-RPC protocol error instead of the fixed verdict.
          risk_score: z
            .number()
            .min(0)
            .max(100)
            .nullable()
            .describe('0 = safest, 100 = block. null when the IBAN could not be validated: there was nothing to score.'),
          risk_level: z
            .string()
            .describe('low | medium | elevated | high | critical | unassessable. unassessable means the IBAN itself did not validate, so no screening was possible: it is the absence of a verdict, never a favourable one.'),
          flags: z.array(z.string()),
        }),
        // Declared because the shared assembly now attaches it here too. This
        // transport was the only one omitting the bank_bic_only disclaimer, and
        // an undeclared key would be stripped by the schema on the way out.
        meta: z
          .object({
            scope: z.string(),
            disclaimer: z.string(),
            sanctions_as_of: z.string().nullable().optional(),
            fatf_as_of: z.string().nullable().optional(),
            sources: z.string().optional(),
          })
          .passthrough(),
        cost_usdc: z.number().describe('What THIS call was billed. Zero on the free MCP tier.'),
        list_price_usdc: z.number().optional().describe('Catalogue price of the same call on the paid REST/x402 route.'),
        error: z.string().optional(),
        error_detail: z.string().optional(),
      },
      annotations: { title: 'Compliance Check', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iban }) => {
      // Shared with the REST route and the stdio MCP server. See
      // src/lib/compliance-response.ts. This copy was the one that omitted
      // `meta`, so the surface agents actually reach never carried the
      // disclaimer saying the screening is on the bank, not the beneficiary.
      const combined = billedFree({ ...buildComplianceResponse(iban), cost_usdc: 0.02 });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }],
        structuredContent: combined,
      };
    },
  );

  server.registerTool(
    'validate_payment_reference',
    {
      title: 'Validate Payment Reference',
      description:
        'Validate a structured payment reference and, when an IBAN is supplied, decide whether the two may legally travel together. ' +
        'USE WHEN: assembling a payment instruction from an invoice, a QR-bill or a remittance advice; whenever a Swiss IBAN and a reference appear together (the pairing rule is what most integrations get wrong); ' +
        'or when the user pastes an "RF..." string, a 27-digit number, a +++123/4567/89012+++ block, or asks whether a payment reference is correct. ' +
        'DO NOT USE to validate the IBAN itself — that is validate_iban. ' +
        'SCHEMES: RF Creditor Reference (ISO 11649, "SCOR" in Swiss Payment Standards, mod 97-10); Swiss QR reference ("QRR", 27 digits, modulo 10 recursive); Belgian OGM/VCS (12 digits, modulo 97, a remainder of 0 written 97); Finnish viitenumero (4-20 digits, weights 7-3-1 from the right). ' +
        'Norwegian KID and Swedish OCR are RECOGNISED but never judged: they answer valid: null with status unverifiable_without_creditor_config, because modulus type and length are configured per creditor account by the beneficiary bank and are not a property of the string. NEVER relay those to a user as "invalid" — say the check needs the creditor bank configuration. ' +
        'AMBIGUITY: only a leading "RF" and a 27-digit length pin a scheme down. A bare 12-digit string is both a Belgian OGM and a legal Finnish length, so the more specific reading is returned and the other appears in also_valid_as. Pass reference_type when you know the country. ' +
        'THE PAIRING RULE — the part no checksum library reproduces: pass an iban and you also get a pairing verdict. Per the Swiss Implementation Guidelines a QRR reference may ONLY be used with a QR-IBAN (institution identifier in the SIX range 30000-31999), and an ISO 11649 reference may NOT be used with one. Outside CH and LI, pairing is not_applicable — there is no QR-IBAN to pair against — and that does not affect the reference\'s own checksum verdict. ' +
        'IMPORTANT: valid and pairing are INDEPENDENT. A reference can be arithmetically valid and still illegal on that account. Read both, and relay source/as_of — they are what makes the verdict auditable. ' +
        'FREE: the checksums are published commodities. The paid surface is POST /v1/iban/validate, which returns this same pairing block with the full IBAN enrichment. ' +
        costLine('$0 per call, on every surface'),
      inputSchema: {
        reference: z.string().describe('The reference as printed; spaces, slashes and the +++…+++ wrapper are stripped'),
        reference_type: z
          .string()
          .optional()
          .describe("Optional hint: rf | scor | qrr | ogm | vcs | viitenumero | kid | ocr"),
        iban: z.string().optional().describe('Optional creditor IBAN — supply it to get the pairing verdict'),
      },
      // 🚨 Every field the handler can emit MUST be named here. The SDK
      // validates output against this schema and Zod SILENTLY STRIPS what it
      // does not name, so an omitted field vanishes from structuredContent with
      // no error at all — including `source`, which carries the provenance this
      // whole feature is built on. See the note above NEXT_STEPS_SCHEMA.
      outputSchema: {
        reference: z.string().describe('Normalized: uppercase, separators removed.'),
        scheme: z.string().nullable().describe('rf | qrr | ogm | viitenumero | kid | ocr, or null when nothing matched.'),
        valid: z
          .boolean()
          .nullable()
          .describe('null means the scheme was recognised and cannot be checked without the creditor bank configuration. Never report null as false.'),
        status: z.string().describe('checked | unverifiable_without_creditor_config | unrecognised'),
        check_digit_expected: z
          .string()
          .optional()
          .describe('A STRING, so a two-digit value beginning with zero survives (OGM remainder 3 is "03", remainder 0 is "97").'),
        also_valid_as: z
          .object({
            scheme: z.string(),
            valid: z.boolean(),
            check_digit_expected: z.string().optional(),
          })
          .optional()
          .describe('The second reading of an ambiguous string, with its own verdict.'),
        source: z.string().nullable().describe('The document publishing the rule. Null only when no scheme matched. Relay it.'),
        as_of: z.string().optional().describe('YYYY-MM of that document.'),
        note: z.string().describe('What was checked, and what was not.'),
        pairing: z
          .string()
          .optional()
          .describe('Present only when an iban was supplied: ok | qrr_requires_qr_iban | scor_forbidden_with_qr_iban | not_applicable'),
        pairing_source: z.string().optional().describe('The document publishing the pairing rule — a DIFFERENT one from source.'),
        pairing_as_of: z.string().optional(),
      },
      annotations: { title: 'Validate Payment Reference', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ reference, reference_type, iban }) => {
      const payload = iban
        ? buildReferenceCheck(validateIBAN(iban), reference, reference_type ?? null)
        : validatePaymentReference(reference, reference_type ?? null);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'check_postal_address',
    {
      title: 'Check ISO 20022 Postal Address',
      description:
        "Check a structured ISO 20022 postal address against a payment rail's published address rules, rule by rule, each verdict citing the document it comes from. " +
        'USE WHEN: assembling a payment instruction (pain.001, a Fedwire message, a T2 transfer) with a creditor or debtor address, to learn whether the rail accepts it BEFORE submitting. The November 2026 changes (SIC 20.11, Fedwire 16.11, T2 R2026.NOV) remove the fully unstructured address option — this check tells you whether an address survives them. ' +
        'DO NOT USE to verify that a street or town EXISTS: this checks conformity with the message format rules, not postal reality. ' +
        "SCHEMES: 'sps' (Swiss Payment Standards, SIX), 'hvps_plus' (HVPS+ / T2, ECB), 'fedwire' (Federal Reserve). There is deliberately NO 'cbpr+' scheme: that guideline sits behind swift.com, unreachable to automated readers, and a conformity boolean quoting an unread document would be a guess dressed as a verdict — the note field restates this on every answer. " +
        'VERDICTS: pass, fail, and not_applicable — the last marks a rule whose precondition is not met and never counts as a pass. conforms is true when no finding failed. ' +
        'IMPORTANT: relay each finding\'s source string — it names the exact document, version and validity date the rule is quoted from. They are what makes the verdict auditable. ' +
        'FREE: the rules are published commodities. The paid surface is the postal_address block that /v1/bic and /v1/iban/validate return for the resolved institution. ' +
        costLine('$0 per call, on every surface'),
      inputSchema: {
        scheme: z
          .enum(ADDRESS_SCHEMES as [AddressScheme, ...AddressScheme[]])
          .describe("Which rail's rules to check against: sps | hvps_plus | fedwire"),
        address: z
          .object({
            twn_nm: z.string().optional().describe('TwnNm — town name'),
            ctry: z.string().optional().describe('Ctry — ISO 3166-1 alpha-2 country code'),
            pst_cd: z.string().optional().describe('PstCd — postal code'),
            strt_nm: z.string().optional().describe('StrtNm — street name'),
            bldg_nb: z.string().optional().describe('BldgNb — building number'),
            adr_tp: z.string().optional().describe('AdrTp — address type (SPS forbids sending it)'),
            adr_line: z.array(z.string()).optional().describe('AdrLine — free-text lines of the hybrid address'),
          })
          .strict()
          .describe('The ISO 20022 PostalAddress under test, in ISO tag vocabulary (snake_cased).'),
      },
      // 🚨 Every field the handler can emit MUST be named here — the SDK
      // silently strips what the output schema does not name, `source` and
      // `detail` included, which are the whole point of the findings.
      outputSchema: {
        scheme: z.string().describe('sps | hvps_plus | fedwire — the rule set that was applied.'),
        conforms: z.boolean().describe('True when no finding failed. not_applicable findings never count against it.'),
        findings: z
          .array(
            z.object({
              rule: z.string().describe('Stable identifier, safe to branch on.'),
              verdict: z.string().describe('pass | fail | not_applicable'),
              detail: z.string().describe('What was looked at and what was concluded.'),
              source: z.string().describe('The document the rule comes from, with its date. Relay it.'),
            }),
          )
          .describe('One entry per rule of the scheme, in a stable order.'),
        note: z.string().describe("Why 'cbpr+' is not on the menu. Served on every answer."),
      },
      annotations: { title: 'Check ISO 20022 Postal Address', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ scheme, address }) => {
      const payload = checkPostalAddress(scheme, address);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
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
        'THE DEEPEST SWISS CLEARING DATA IN ANY PUBLIC API — full SIX BankMaster payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus QR-IID allocation, not just a name lookup. ' +
        `BACKED BY: ${F.claim.chClearing} SIX BankMaster entries (Swiss official source, refreshed monthly). ` +
        'RETURNS: institution { name, type, iid_type, headquarters_iid }, address, bic, payment_services { sic, rtgs_chf, instant_payments_chf, eurosic, lsv_bdd_chf, lsv_bdd_eur }, sic_iid, qr_iid, valid_on. ' +
        'Only relevant for CH and LI accounts. ' +
        costLine('$0.003 per call'),
      inputSchema: {
        iid: z.string().describe('Swiss IID (1-5 digit number)'),
      },
      outputSchema: {
        iid: z.string().optional().describe('Normalized 5-digit BC-Nummer.'),
        found: z.boolean().optional(),
        institution: z.object({
          name: z.string(),
          type: z.string().describe('bank | cantonal_bank | postfinance | raiffeisen | central_bank | foreign_participant'),
          iid_type: z.string().describe('headquarters | branch | other'),
          headquarters_iid: z.string(),
        }).optional(),
        address: z.object({
          street: z.string().nullable(),
          building_number: z.string().nullable(),
          post_code: z.string().nullable(),
          town: z.string().nullable(),
          country: z.string(),
        }).optional(),
        bic: z.string().nullable().optional().describe('BIC if mapped.'),
        payment_services: z.object({
          sic: z.boolean().describe('Swiss Interbank Clearing.'),
          rtgs_chf: z.boolean(),
          instant_payments_chf: z.boolean(),
          eurosic: z.boolean(),
          lsv_bdd_chf: z.boolean(),
          lsv_bdd_eur: z.boolean(),
        }).optional(),
        sic_iid: z.string().nullable().optional(),
        qr_iid: z.string().nullable().optional().describe('QR-bill enabled IID.'),
        valid_on: z.string().optional(),
        redirected_from: z.string().optional(),
        note: z.string().optional(),
        cost_usdc: z.number().optional().describe('What THIS call was billed. Zero on the free MCP tier.'),
        list_price_usdc: z.number().optional().describe('Catalogue price of the same call on the paid REST/x402 route.'),
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: { title: 'Swiss Clearing Lookup', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iid }) => {
      if (!/^\d{1,5}$/.test(iid)) {
        const errorPayload = { error: 'invalid_iid_format', message: 'IID must be a 1-5 digit number.' };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(errorPayload, null, 2),
            },
          ],
          structuredContent: errorPayload as unknown as Record<string, unknown>,
        };
      }
      const normalizedIid = normalizeIid(iid);
      const entry = lookupClearingByBankCode(normalizedIid);
      if (!entry) {
        const notFoundPayload = billedFree({
          iid: normalizedIid,
          found: false,
          error: 'clearing_not_found',
          message: `IID ${normalizedIid} not found in Swiss BankMaster database.`,
          cost_usdc: 0.003,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(notFoundPayload, null, 2),
            },
          ],
          structuredContent: notFoundPayload,
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
      const payload = billedFree(result);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  // ── Resources ──────────────────────────────────────────────────────────────

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

  server.registerTool(
    'send_feedback',
    {
      title: 'Send Feedback to IBANforge',
      description:
        'Report a problem or a need directly to the IBANforge operators: incorrect validation result, stale or missing BIC/bank data, ' +
        'latency, or anything blocking you from using or PAYING for the service (missing network, unclear pricing, quota shape). ' +
        'USE WHEN: a result looks wrong, data you need is missing, or you hit a wall (quota, payment, capability) and want it fixed. ' +
        'This tool is free and does NOT count against the daily free-tier limit — it works even after the limit is reached. ' +
        'A human reads every report; verified data errors on paid x402 calls are refunded on-chain.',
      inputSchema: {
        error_type: z
          .enum(FEEDBACK_ERROR_TYPES)
          .describe('Category of the report. Use "other" for product feedback, pricing/payment blockers or feature needs.'),
        notes: z.string().min(3).max(4000).describe('What happened, what you needed, or what blocked you — free text.'),
        endpoint: z.string().max(200).optional().describe('Endpoint or tool concerned, e.g. /v1/iban/batch.'),
        expected: z.string().max(1000).optional().describe('What you expected (for data errors).'),
        got: z.string().max(1000).optional().describe('What you received instead (for data errors).'),
        contact: z.string().max(255).optional().describe('Where we may answer you (e-mail) — optional, reports can be anonymous.'),
        agent: z.string().max(120).optional().describe('Which agent/model is reporting, e.g. "claude-sonnet-5 via MCP".'),
      },
      outputSchema: {
        ok: z.boolean(),
        id: z.number().describe('Report id — check status at GET /v1/feedback/{id}.'),
      },
      annotations: { title: 'Send Feedback to IBANforge' },
    },
    async ({ error_type, notes, endpoint, expected, got, contact, agent }) => {
      const id = recordFeedbackRow({
        error_type,
        notes,
        endpoint: endpoint ?? null,
        expected,
        got,
        contact: contact ?? null,
        agent: agent ?? 'mcp',
        ipHash: null,
      });
      const payload = { ok: true, id };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
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

/**
 * The tool names this server really registers, read back from one throwaway
 * instance and then cached.
 *
 * `_registeredTools` is private to the SDK's McpServer, which publishes no
 * read-back of its own catalogue (checked against @modelcontextprotocol/sdk
 * 1.30.0 on 2026-09-01). The alternative is a second, hand-kept list — which is
 * exactly the drift MCP-13 found: the discovery hint listed 7 tools while
 * tools/list served 8. So we read the real one, and a test pins the result
 * against tools/list: the day the SDK renames that field this returns an empty
 * array and the test goes red, instead of the document going quietly stale.
 */
let toolNamesCache: string[] | null = null;
function registeredToolNames(): string[] {
  if (toolNamesCache) return toolNamesCache;
  const probe = createMcpServer() as unknown as { _registeredTools?: Record<string, unknown> };
  toolNamesCache = Object.keys(probe._registeredTools ?? {});
  return toolNamesCache;
}

// ── MCP tool call rate limiting ───────────────────────────────────────────────
// Free MCP access is limited to a handful of tool calls per IP per day.
// Discovery (initialize, tools/list, resources/list) is unlimited.
//
// This is the ONE path where an assistant reaches a complete, correct answer
// on its first try — including the paid Swiss clearing data — without a key or
// a wallet (reco-IA audit, 2026-07-25). It is deliberately kept open as the
// product's shop window, but it also hands out priced data for free, so the
// allowance is a taster, not a tier: 10 calls is enough to evaluate the
// service and far too few to run on. Announce it wherever it is offered —
// an undocumented free path converts nobody.
export const MCP_DAILY_LIMIT = 10;
/**
 * Opening a session is not a tool call, so until 2026-09-01 it was counted by
 * nothing at all — and it is the expensive one (a whole McpServer, see the
 * store above). 30 a day per address is far above what any client needs (one
 * per process, re-opened after a redeploy) and far below what it takes to fill
 * a container. Same ledger as the tool-call allowance, separate key.
 */
export const MCP_SESSIONS_PER_IP_DAY = 30;
const mcpCallCounts = new Map<string, { count: number; date: string }>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, val] of mcpCallCounts) {
    if (val.date !== today) mcpCallCounts.delete(key);
  }
  // Same tick, the other leak: sessions nobody ever closed (SEC-01/MCP-08).
  mcpSessions.sweep();
}, 10 * 60 * 1000).unref();

/**
 * `units` is the number of billable units this HTTP request carries — a
 * JSON-RPC batch bills every element, not one, and a `batch_validate_iban`
 * bills one per IBAN (see `mcpToolUnits`). Defaulting to 1 keeps the
 * single-message path unchanged.
 *
 * `key` is the ledger entry, not necessarily an address: session openings are
 * counted on `init:<ip>` against their own ceiling.
 */
function checkMcpRateLimit(
  key: string,
  units = 1,
  limit: number = MCP_DAILY_LIMIT,
): { allowed: boolean; used: number; remaining: number } {
  const today = new Date().toISOString().slice(0, 10);
  const entry = mcpCallCounts.get(key);
  if (!entry || entry.date !== today) {
    mcpCallCounts.set(key, { count: units, date: today });
    return { allowed: units <= limit, used: units, remaining: Math.max(0, limit - units) };
  }
  entry.count += units;
  const allowed = entry.count <= limit;
  return { allowed, used: entry.count, remaining: Math.max(0, limit - entry.count) };
}

/**
 * What one `tools/call` message costs against the free allowance.
 *
 * Counting calls rather than data made the anonymous path 150x more generous
 * than the signed-up one: 10 calls of `batch_validate_iban` at 100 IBANs each
 * is 1,000 enriched validations per IP per day, against 200 REST calls a month
 * for a verified free key (MCP-07, audit 2026-09-01). The batch tool bills per
 * IBAN everywhere else it exists — the x402 price and `billableUnits` in the
 * API-key middleware both do — so this is the one surface that disagreed.
 *
 * send_feedback stays free ON PURPOSE, and stays free past the cap: it is the
 * only way a refused agent can tell us WHY it is leaving, and capping the
 * complaint box with the limit that produced the complaint would silence
 * exactly the reports it was built for.
 */
function mcpToolUnits(params: { name?: unknown; arguments?: unknown } | undefined): number {
  const name = typeof params?.name === 'string' ? params.name : '';
  if (name === 'send_feedback') return 0;
  if (name !== 'batch_validate_iban') return 1;
  const args = params?.arguments as { ibans?: unknown } | undefined;
  const ibans = args?.ibans;
  if (!Array.isArray(ibans) || ibans.length === 0) return 1;
  // Capped at the tool's own max: a schema-refused oversize batch must not be
  // able to quote a shortfall no accepted call could ever bill.
  return Math.min(ibans.length, 100);
}

/**
 * Host allow-list for the transport, or nothing at all.
 *
 * The MCP spec asks a remote server to refuse a Host it does not serve, because
 * a page on an attacker's origin can point its own hostname at this container
 * (DNS rebinding). The SDK implements it, but only when
 * `enableDnsRebindingProtection` is set as well — `allowedHosts` alone is a
 * no-op, which is how this can look done and not be. SEC-07 / MCP-14, 2026-09-01.
 *
 * Read per transport rather than once at import, so a test can flip NODE_ENV.
 * `MCP_ALLOWED_HOSTS` (comma-separated) is the escape hatch the day a second
 * hostname legitimately serves /mcp; the Railway domain is accepted by default
 * because the platform's own address answers the same app.
 */
function mcpDnsRebindingOptions(): { allowedHosts?: string[]; enableDnsRebindingProtection?: boolean } {
  const configured = process.env.MCP_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);
  if (configured && configured.length > 0) {
    return { allowedHosts: configured, enableDnsRebindingProtection: true };
  }
  if (process.env.NODE_ENV !== 'production') return {};
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return {
    allowedHosts: ['api.ibanforge.com', ...(railway ? [railway] : [])],
    enableDnsRebindingProtection: true,
  };
}

// Handle POST /mcp (client → server messages)
mcpHttp.post('/mcp', async (c) => {
  // Parse the body to check if this is a tools/call (rate-limited)
  // vs. discovery (unlimited). We clone the request so the transport
  // can still read the original body.
  const cloned = c.req.raw.clone();
  let toolUnits = 0;
  let toolName: string | null = null;
  let rpcId: unknown = null;
  try {
    const body = await cloned.json();
    // JSON-RPC allows a BATCH: the body may be an array of messages. On an
    // array `body.method` is undefined, so the previous single-object check
    // scored a 60-call batch as zero tool calls — the daily allowance was
    // bypassed outright by wrapping the calls in `[...]`, and the global
    // per-IP rate limiter only ever saw one HTTP request, so nothing else
    // bounded it either. Count every element instead.
    // Security audit 2026-07-25, finding 2.
    const messages: Array<{ method?: unknown; id?: unknown; params?: { name?: unknown; arguments?: unknown } }> = Array.isArray(body) ? body : [body];
    const calls = messages.filter((m) => m?.method === 'tools/call');
    toolUnits = calls.reduce((sum, m) => sum + mcpToolUnits(m?.params), 0);
    toolName = calls.map((m) => (typeof m?.params?.name === 'string' ? m.params.name : null)).find((n) => n !== null) ?? null;
    rpcId = calls[0]?.id ?? messages[0]?.id ?? null;
  } catch {
    // Not JSON or malformed — let the transport handle the error
  }

  // Spoof-resistant extraction (trusted-proxy last hop), same rule as the
  // global rate limiter — the FIRST X-Forwarded-For segment is chosen by the
  // caller. Audit 2026-07-25, rejected-but-fix-anyway item.
  const ip = extractClientIp({
    'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
    'x-real-ip': c.req.header('x-real-ip') ?? null,
  }) ?? 'unknown';

  if (toolUnits > 0) {
    const limit = checkMcpRateLimit(ip, toolUnits);
    if (!limit.allowed) {
      // A refusal used to be indistinguishable from a success in request_log:
      // both landed as `POST /mcp:tools-call 200`, because the marker below was
      // set BEFORE this check (MCP-04, audit 2026-09-01). The outcome now rides
      // on a response header the telemetry middleware reads, so nobody has to
      // guess whether the free tier is turning agents away.
      c.header('X-MCP-Outcome', 'rate_limited');
      // Return a proper JSON-RPC error so the MCP client understands
      return c.json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message: `Daily MCP free tier limit reached (${MCP_DAILY_LIMIT} units/day; one per tool call, one per IBAN in batch_validate_iban). `
            + 'For unlimited access, use the REST API with an API key '
            + '(free: POST /v1/keys/generate) or x402 micropayments. '
            + 'See https://api.ibanforge.com/.well-known/x402',
          data: { used: limit.used, limit: MCP_DAILY_LIMIT, remaining: 0 },
        },
      });
    }
    // Mark the request for the stats middleware: /mcp alone cannot tell a
    // handshake from real usage, and 14k discovery requests once read as a
    // traffic spike nobody could explain. Set AFTER the cap, so it means
    // "a tool ran", not "a tool was asked for".
    c.set('mcpToolCall', true);
  }

  const sessionId = c.req.header('mcp-session-id');

  let transport = sessionId ? mcpSessions.get(sessionId) : undefined;

  if (sessionId && !transport) {
    // The SDK answers this case `400 Bad Request: Server not initialized`, which
    // describes the server rather than the session — and an LLM reading it
    // concludes the service is broken instead of re-opening a session. It
    // happens after every redeploy (the store is in memory) and now after an
    // idle sweep too, so the message has to name the remedy. 404 is what the
    // streamable-HTTP spec reserves for an unknown session id, and a compliant
    // client re-sends `initialize` on it. MCP-09, audit 2026-09-01.
    return c.json({
      jsonrpc: '2.0',
      id: rpcId,
      error: {
        code: -32001,
        message: 'Session expired or server redeployed. Send initialize again to open a new session.',
        data: { session_id: sessionId, idle_timeout_minutes: MCP_SESSION_IDLE_MS / 60000 },
      },
    }, 404);
  }

  if (!transport) {
    // Opening a session costs a full McpServer, so it is metered like the tool
    // calls are (SEC-01, audit 2026-09-01). Checked here rather than on the
    // `initialize` method alone: this is the exact line where the memory is
    // about to be spent, whatever the body claims to be.
    const opened = checkMcpRateLimit(`init:${ip}`, 1, MCP_SESSIONS_PER_IP_DAY);
    if (!opened.allowed) {
      c.header('X-MCP-Outcome', 'session_rate_limited');
      return c.json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message: `Daily MCP session limit reached (${MCP_SESSIONS_PER_IP_DAY} new sessions/day). `
            + 'Reuse the mcp-session-id returned by initialize instead of opening a session per call, '
            + 'or use the REST API with an API key (free: POST /v1/keys/generate).',
          data: { used: opened.used, limit: MCP_SESSIONS_PER_IP_DAY, remaining: 0 },
        },
      });
    }
    // New session — create transport and connect server
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      // Defence in depth against DNS rebinding, and ONLY in production: a
      // browser page on an attacker's origin can resolve its own hostname to
      // this container, and the SDK's own guard is the cheapest answer. It stays
      // off in dev and in tests, where the Host header is `localhost` and a
      // strict list would refuse every local probe. MCP-14 / SEC-07, 2026-09-01.
      ...mcpDnsRebindingOptions(),
      onsessioninitialized: (id) => {
        mcpSessions.set(id, transport!);
      },
      // Purge the session as soon as the SDK reports it closed. This is the
      // fastest door, not the only one: most MCP clients and directory crawlers
      // (Smithery, Glama, MCP.so) open a session and walk away WITHOUT sending
      // DELETE, so this hook never fires for them — the idle sweep and the cap
      // in the store above are what catch those.
      onsessionclosed: (id) => {
        mcpSessions.delete(id);
      },
    });

    const localTransport = transport;
    transport.onclose = () => {
      if (localTransport.sessionId) mcpSessions.delete(localTransport.sessionId);
    };

    const server = createMcpServer();
    await server.connect(transport);
  }

  const response = await transport.handleRequest(c.req.raw);
  // The outcome rides on the response OBJECT, not on `c.header()`: the SDK
  // builds its own Response and returning it bypasses the context's prepared
  // headers, so a served tool call reached the telemetry middleware carrying
  // nothing at all. The refusals above go through `c.json()` and keep theirs.
  if (toolUnits > 0) {
    response.headers.set('X-MCP-Outcome', 'ok');
    if (toolName) response.headers.set('X-MCP-Tool', toolName);
  }
  return response;
});

// Handle GET /mcp (SSE stream for server → client notifications, OR discovery hint)
mcpHttp.get('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? mcpSessions.get(sessionId) : undefined;

  if (!transport) {
    // No session: either a dev probing with curl, or an SSE client trying to
    // open the server→client stream. The MCP streamable-http spec answers 405
    // here when the server offers no standalone SSE stream — and the status is
    // load-bearing: this endpoint used to answer 200 with this same JSON, and
    // SSE clients treated that as a broken stream to retry at once, no backoff.
    // One looping client produced ~45k GETs in a day, ten times the API's whole
    // organic traffic. A 405 tells them to stop; the JSON body keeps the
    // endpoint discoverable for the human with a browser.
    c.header('Allow', 'POST, DELETE');
    return c.json(
      {
        protocol: 'mcp',
        // Read from the SDK and from the server itself, never typed by hand:
        // this document announced protocol 2024-11-05 and 7 tools while the
        // server negotiated 2025-06-18 and served 8 (MCP-13, audit 2026-09-01).
        // Two hand-kept values in the one document a curious developer opens in
        // a browser.
        version: LATEST_PROTOCOL_VERSION,
        supported_versions: SUPPORTED_PROTOCOL_VERSIONS,
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
          curl_initialize: `curl -X POST https://api.ibanforge.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json,text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"${LATEST_PROTOCOL_VERSION}","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' -i`,
        },
        tools: registeredToolNames(),
        free_tier: {
          mcp_daily_limit: MCP_DAILY_LIMIT,
          mcp_daily_limit_unit: 'one unit per tool call, one per IBAN in batch_validate_iban',
          mcp_sessions_per_day: MCP_SESSIONS_PER_IP_DAY,
          session_idle_timeout_minutes: MCP_SESSION_IDLE_MS / 60000,
          rest_api_signup: 'POST /v1/keys/generate {"email":"you@company.com"} for 200 req/month',
        },
        x402: 'https://api.ibanforge.com/.well-known/x402',
        documentation: 'https://ibanforge.com/docs',
        llms_txt: 'https://api.ibanforge.com/llms.txt',
        // Served by the API host only — the www host 404s on this path.
        server_card: 'https://api.ibanforge.com/.well-known/mcp/server-card.json',
        registry: 'https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge',
      },
      405,
    );
  }

  const response = await transport.handleRequest(c.req.raw);
  return response;
});

// Handle DELETE /mcp (close session)
mcpHttp.delete('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? mcpSessions.get(sessionId) : undefined;

  if (!transport) {
    return c.json({ error: 'No active session.' }, 400);
  }

  const response = await transport.handleRequest(c.req.raw);
  mcpSessions.delete(sessionId!);
  return response;
});

export { mcpHttp };
