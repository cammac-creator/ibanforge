/**
 * HTTP transport for the MCP server.
 * Exposes the 5 data tools of the stdio MCP server plus send_feedback (validate_iban, batch_validate_iban,
 * lookup_bic, check_compliance, lookup_ch_clearing) via Streamable HTTP at /mcp —
 * compatible with Smithery, remote MCP clients, etc.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { recordFeedbackRow, FEEDBACK_ERROR_TYPES } from './feedback.js';
import { lookup } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { lookupClearingByBankCode, normalizeIid } from '../lib/ch-clearing.js';
import { extractClientIp } from '../lib/stats.js';
import { buildCountriesPayload, buildPricingPayload, buildValidateAndExplainPrompt } from '../lib/mcp-resources.js';
import { datasetFacts } from '../lib/dataset-facts.js';

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

const BANK_CODE_CHECK_SCHEMA = z
  .object({
    value: z.string(),
    status: z
      .string()
      .describe(
        'verified | not_in_register | unavailable. A separate verdict on the bank code, so bic:null stops meaning three different things.',
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

// Store active transports by session ID
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

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
    // the single best-placed sentences we own. 14k discovery handshakes over
    // one August week produced ~zero tool calls; the gap between "listed the
    // tools" and "tried one" is what these lines exist to close.
    instructions:
      'Start with validate_iban on any IBAN-looking string (e.g. DE89370400440532013000) — one call returns validity, the issuing bank + BIC, virtual-IBAN/EMI detection, SEPA reachability and VoP readiness. ' +
      // 2026-08-17: this sentence used to read "For unlimited use … in one
      // step" — an agent took it literally and scripted 42 keys in a
      // morning. Sell the same path truthfully: one key per developer, and
      // repeat creations from one network go through mailbox verification.
      // The example address has to pass the signup guard: example.com is on
      // the disposable-domain blocklist, so the literal copy of the previous
      // wording ("you@example.com") answered 400 disposable_email.
      'Free tier: 10 tool calls/IP/day, no signup. For sustained use, POST https://api.ibanforge.com/v1/keys/generate {"email":"you@company.com"} issues a free API key (200 REST calls/month, one per developer — repeat creations from the same network require e-mail verification); prepaid credit packs from $5 per 1,000 calls, no expiry. ' +
      'Missing data, wrong result, or something blocking you from paying? Call send_feedback — a human reads every report. ' +
      'Paying as an agent (wallet, USDC on Base, one $5 payment for 1,000 calls): https://ibanforge.com/docs/pay-as-an-agent — ' +
      'Docs and code samples: https://ibanforge.com/docs/recipes',
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
        'RETURNS: valid (boolean), country { code, name }, bic { code, bank_name, city, source, as_of, lei, lei_status, address { street, post_code, region, city, country, romanized, romanization, source, language, as_of } } — lei and address are read from the same directory row /v1/bic/:code serves, so this call already carries them; both are null when GLEIF publishes nothing for that BIC, which means "no LEI on file", not "the institution has none". bic.address is the LEGAL ENTITY seat, so bic.address.city may legitimately differ from bic.city (the register city for THIS bank code), and bic.address.as_of dates the entity last filing, usually much older than bic.as_of. ' +
        'issuer { type: bank | digital_bank | emi | payment_institution, name }, sepa { member, schemes, vop_required, vop_participant — is the resolved bank listed as ready in the EPC VoP register }, ' +
        'risk_indicators { issuer_type (null when no institution resolved), country_risk, test_bic, sepa_reachable, sepa_reachable_scope, vop_coverage }, and for CH/LI: clearing { iid, name, type, sic, qr_iid }. ' +
        'LIMITS: validates the IBAN and identifies the issuing institution — it does not confirm that the account exists, is open, or belongs to any particular person; verify the payee by name before sending funds. ' +
        'IMPORTANT — bic: null does not mean the bank code is wrong. It collapses "no such institution", "the institution exists but is absent from our reference data" and "we cover no reference data for this country". Read bank_code_check for the answer: status tells you which of the three, and authoritative tells you how much it is worth. Only where authoritative is true (today CH and LI against the SIX BankMaster, and DE against the Bundesbank Bankleitzahlendatei) does not_in_register mean the bank code is not allocated; everywhere else treat it as UNAVAILABLE and let the downstream name check decide. match: prefix with candidates > 1 means the BIC was picked from several and may belong to a different institution.',
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
        }).nullable().optional().describe('Resolved BIC/SWIFT when BBAN→BIC mapping exists.'),
        sepa: z.object({
          member: z.boolean(),
          schemes: z.array(z.string()),
          vop_required: z.boolean(),
          vop_participant: z.boolean().nullable().optional().describe('true = resolved bank is listed as ready in the EPC VoP scheme register; null = no institution resolved.'),
        }).optional(),
        issuer: z.object({
          type: z.string().describe('bank | digital_bank | emi | payment_institution'),
          name: z.string(),
          classification: z
            .string()
            .describe(
              'curated | default. Whether the type was established or assumed. curated = the BIC8 is in the issuer set, so this is an identification. default = nothing is on file and "bank" is the fallback, which covers 97.9% of BIC8 (measured 29/07/2026). Count only curated when sizing virtual-IBAN exposure.',
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
        cost_usdc: z.number(),
        processing_ms: z.number().optional(),
      },
      annotations: { title: 'Validate IBAN', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iban }) => {
      const result = validateIBAN(iban);
      enrichResult(result);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
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
        'RETURNS: { results: [...same shape as validate_iban], count, valid_count }.',
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
          }).nullable().optional(),
          issuer: z.object({ type: z.string(), name: z.string(), classification: z.string() }).optional(),
          sepa: z.object({
            member: z.boolean(),
            schemes: z.array(z.string()),
            vop_required: z.boolean(),
            vop_participant: z.boolean().nullable().optional(),
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
          cost_usdc: z.number(),
        })).describe('One result per input IBAN, in the same order. Same shape as validate_iban.'),
        count: z.number().describe('Number of IBANs processed.'),
      },
      annotations: { title: 'Batch Validate IBANs', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ ibans }) => {
      const results = ibans.map((iban) => {
        const result = validateIBAN(iban);
        enrichResult(result);
        return result;
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        structuredContent: { results: results as unknown as Array<Record<string, unknown>>, count: results.length },
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
        `BACKED BY: ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF; additional rows from SwiftCodes (MIT), Bundesbank, SIX, NBP, EBA Step2 SCT), refreshed monthly.`,
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
        'RETURNS: the full validate enrichment plus a compliance object with risk_score (0-100, 0 = safest), risk_level (low/medium/elevated/high/critical), sanctions matched_lists + fatf_status, reachability, vop status, and flags[] (e.g. sanctioned_country, fatf_grey_list, emi_issuer, no_vop).',
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
        cost_usdc: z.number(),
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
      const combined = { ...buildComplianceResponse(iban), cost_usdc: 0.02 };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }],
        structuredContent: combined as unknown as Record<string, unknown>,
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
        'Only relevant for CH and LI accounts.',
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
        cost_usdc: z.number().optional(),
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
        const notFoundPayload = {
          iid: normalizedIid,
          found: false,
          error: 'clearing_not_found',
          message: `IID ${normalizedIid} not found in Swiss BankMaster database.`,
          cost_usdc: 0.003,
        };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(notFoundPayload, null, 2),
            },
          ],
          structuredContent: notFoundPayload as unknown as Record<string, unknown>,
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
        structuredContent: result,
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
const MCP_DAILY_LIMIT = 10;
const mcpCallCounts = new Map<string, { count: number; date: string }>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, val] of mcpCallCounts) {
    if (val.date !== today) mcpCallCounts.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * `units` is the number of tool calls this HTTP request carries — a JSON-RPC
 * batch bills every element, not one. Defaulting to 1 keeps the single-message
 * path unchanged.
 */
function checkMcpRateLimit(ip: string, units = 1): { allowed: boolean; used: number; remaining: number } {
  const today = new Date().toISOString().slice(0, 10);
  const entry = mcpCallCounts.get(ip);
  if (!entry || entry.date !== today) {
    mcpCallCounts.set(ip, { count: units, date: today });
    return { allowed: units <= MCP_DAILY_LIMIT, used: units, remaining: Math.max(0, MCP_DAILY_LIMIT - units) };
  }
  entry.count += units;
  const allowed = entry.count <= MCP_DAILY_LIMIT;
  return { allowed, used: entry.count, remaining: Math.max(0, MCP_DAILY_LIMIT - entry.count) };
}

// Handle POST /mcp (client → server messages)
mcpHttp.post('/mcp', async (c) => {
  // Parse the body to check if this is a tools/call (rate-limited)
  // vs. discovery (unlimited). We clone the request so the transport
  // can still read the original body.
  const cloned = c.req.raw.clone();
  let toolCalls = 0;
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
    const messages: Array<{ method?: unknown; id?: unknown; params?: { name?: unknown } }> = Array.isArray(body) ? body : [body];
    const calls = messages.filter((m) => m?.method === 'tools/call');
    // send_feedback stays free AFTER the cap on purpose: it is the only way a
    // refused agent can tell us WHY it is leaving — capping the complaint box
    // with the same limit that produced the complaint would silence exactly
    // the reports we built it for.
    toolCalls = calls.filter((m) => m?.params?.name !== 'send_feedback').length;
    rpcId = calls[0]?.id ?? null;
  } catch {
    // Not JSON or malformed — let the transport handle the error
  }

  if (toolCalls > 0) {
    // Mark the request for the stats middleware: /mcp alone cannot tell a
    // handshake from real usage, and 14k discovery requests once read as a
    // traffic spike nobody could explain.
    c.set('mcpToolCall', true);
    // Spoof-resistant extraction (trusted-proxy last hop), same rule as the
    // global rate limiter — the FIRST X-Forwarded-For segment is chosen by the
    // caller. Audit 2026-07-25, rejected-but-fix-anyway item.
    const ip = extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
      'x-real-ip': c.req.header('x-real-ip') ?? null,
    }) ?? 'unknown';
    const limit = checkMcpRateLimit(ip, toolCalls);
    if (!limit.allowed) {
      // Return a proper JSON-RPC error so the MCP client understands
      return c.json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message: `Daily MCP free tier limit reached (${MCP_DAILY_LIMIT} tool calls/day). `
            + 'For unlimited access, use the REST API with an API key '
            + '(free: POST /v1/keys/generate) or x402 micropayments. '
            + 'See https://api.ibanforge.com/.well-known/x402',
          data: { used: limit.used, limit: MCP_DAILY_LIMIT, remaining: 0 },
        },
      });
    }
  }

  const sessionId = c.req.header('mcp-session-id');

  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    // New session — create transport and connect server
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
      // Purge the session as soon as the SDK reports it closed. Most MCP clients
      // and directory crawlers (Smithery, Glama, MCP.so) open a session and walk
      // away WITHOUT sending DELETE — without this hook the Map (and a full
      // McpServer per session) grows unbounded and eventually OOM-kills the
      // process on a long-running host (Railway).
      onsessionclosed: (id) => {
        transports.delete(id);
      },
    });

    const localTransport = transport;
    transport.onclose = () => {
      if (localTransport.sessionId) transports.delete(localTransport.sessionId);
    };

    const server = createMcpServer();
    await server.connect(transport);
  }

  const response = await transport.handleRequest(c.req.raw);
  return response;
});

// Handle GET /mcp (SSE stream for server → client notifications, OR discovery hint)
mcpHttp.get('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? transports.get(sessionId) : undefined;

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
        version: '2024-11-05',
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
          curl_initialize: `curl -X POST https://api.ibanforge.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json,text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' -i`,
        },
        tools: ['validate_iban', 'batch_validate_iban', 'lookup_bic', 'lookup_ch_clearing', 'check_compliance'],
        free_tier: {
          mcp_daily_limit: MCP_DAILY_LIMIT,
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
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    return c.json({ error: 'No active session.' }, 400);
  }

  const response = await transport.handleRequest(c.req.raw);
  transports.delete(sessionId!);
  return response;
});

export { mcpHttp };
