#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult, createEnrichCache } from '../lib/enrich.js';
import { lookup } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { lookupClearingByBankCode, normalizeIid, getChClearingCount } from '../lib/ch-clearing.js';
import {
  buildCountriesPayload,
  buildPricingPayload,
  buildValidateAndExplainPrompt,
} from '../lib/mcp-resources.js';
import { validatePaymentReference, buildReferenceCheck } from '../lib/payment-reference.js';
import {
  checkPostalAddress,
  ADDRESS_SCHEMES,
  type AddressScheme,
} from '../lib/address-conformity.js';
import { datasetFacts } from '../lib/dataset-facts.js';
import { MCP_INSTRUCTIONS } from './instructions.js';
import { TOOL_OUTPUT_SCHEMAS } from './output-schemas.js';
// send_feedback : même insertion et mêmes clips de longueur que la route
// publique POST /v1/feedback et que le transport HTTP — une seule écriture,
// une seule liste de catégories.
import {
  recordFeedbackRow,
  FEEDBACK_ERROR_TYPES,
  FEEDBACK_INSERTS_PER_SOURCE_HOUR,
} from '../routes/feedback.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const server = new McpServer(
  {
    name: 'ibanforge',
    title: 'IBANforge',
    version: pkg.version,
    description: `IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA compliance and risk indicators. ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF), ${F.claim.chClearing} Swiss BC-Nummer from SIX, ${F.claim.countries} countries, refreshed monthly.`,
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
  },
  {
    // Same block as the HTTP transport and the npm package, from the shared
    // constant. This surface answered `initialize` with no instructions at all
    // until 2026-09-01 (audit MCP-11).
    instructions: MCP_INSTRUCTIONS,
  },
);

server.registerTool(
  'validate_iban',
  {
    title: 'Validate IBAN',
    description: `Validate a single IBAN and retrieve the associated BIC/SWIFT code, bank details, SEPA membership, issuer classification, and risk indicators.

When to use: verifying a payment recipient before a wire transfer, checking a bank account during onboarding, or confirming IBAN format and bank identity in a KYC workflow.
When NOT to use: for multiple IBANs, use batch_validate_iban instead (60% cheaper per IBAN). For compliance/sanctions screening, use check_compliance instead.

Behavior: this tool is read-only and performs no writes, no network calls to external services, and no side effects. It validates the IBAN checksum (ISO 13616 mod-97), parses the BBAN structure, resolves the BIC from a local database of ${F.claim.bic} entries (GLEIF-sourced), and classifies the issuer type. Server-side processing is under 5 ms; network latency is yours to measure (GET /ping). Returns a single JSON object.

Returns: { valid, country: { code, name }, check_digits, bban: { bank_code, branch_code?, account_number }, bic: { code, bank_name, city, basis, authoritative, source, as_of, lei, lei_status, address: { type: 'registered', street, post_code, region, city, country, romanized, romanization, source, language, as_of } | null } | null, sepa: { member, schemes, vop_required }, issuer: { type, name, classification: curated | register | default }, psd_registration: { registered, entity_type, name, country, competent_authority, source, as_of }, risk_indicators: { issuer_type (null when no institution resolved), country_risk, test_bic, sepa_reachable, sepa_reachable_scope: 'country', vop_coverage }, bank_code_check { value, status: verified | not_in_register | unavailable, reason? (present whenever status is not verified: not_allocated | absent_from_reference_data | no_reference_data_for_country | register_names_no_holder | national_register_unavailable | lookup_failed — the last two describe IBANforge and never the beneficiary, and neither may be escalated into a refusal), match: register | prefix | null, register, authoritative, candidates?, retired?, superseded_by?, as_of }, modulus_check { checked, passed, source, table_fetched_on } (GB only), official_identity { name, lei, address, category, matched_by, source, free_of_charge, as_of, authoritative } (present only on a match), next_steps [{ code, do, because, action? }], clearing: { iid, name, type, town, sic, eurosic, qr_iid } | null, formatted, cost_usdc }

psd_registration is the EBA's PSD2 register naming the holder of the bank code as an authorised payment or e-money institution, with its competent authority, the attribution the EBA licence requires, and the date of the golden copy. It is served ONLY for countries where that register's national reference code was measured to be the code an IBAN actually carries — today Spain alone: the file holds no BIC and no LEI, and in its other 29 countries it files authorisations under company or tax numbers from unrelated registers. Absent on a miss, never negative — the register's own disclaimer states that an omitted institution is authorised all the same. When it is present it can also identify issuer.type, which is what classification: register means.

When valid is false the object carries { valid: false, error, error_detail } and none of the enrichment fields. bic is null when no BBAN-to-BIC mapping exists for the bank code. bic.basis says WHERE the bank code to BIC pairing came from — national_register (the country register publishes this BIC for this bank code, today DE, AT, BE and BG), curated_map (our maintained map, an exact key and not an allocation record) or directory_prefix (the bic8 LIKE fallback, which can match several institutions; read bank_code_check.candidates) — and bic.authoritative is derived from it: true only for national_register. Outside that basis the BIC is ADVISORY, so confirm it with the beneficiary or the bank before storing it as a routing instruction. It is a different claim from bank_code_check.authoritative, which is about the BANK CODE: in Switzerland the SIX register confirms the code while the BIC beside it still comes from our curated map. IMPORTANT — bic: null does not mean the bank code is wrong. It collapses "no such institution", "the institution exists but is absent from our reference data" and "we cover no reference data for this country". Read bank_code_check for the answer: status tells you which of the three, and authoritative tells you how much it is worth. Only where authoritative is true (today CH and LI against the SIX BankMaster, DE against the Bundesbank Bankleitzahlendatei, AT against the OeNB register, BE against the NBB register, and BG against the BNB BAE register) does not_in_register mean the bank code is not allocated; everywhere else treat it as UNAVAILABLE and let the downstream name check decide. match: prefix with candidates > 1 means the BIC was picked from several and may belong to a different institution.  branch_code is present only for countries whose BBAN defines one; clearing is present only for CH and LI when the IID is in the SIX BankMaster. modulus_check is present only for GB: it runs the Vocalink modulus checksum over the sort code and account number the IBAN carries, which is a SECOND and independent check — a GB IBAN can pass mod-97 and still name an account no bank could have issued. passed false means the pair cannot be a real account and is a reason not to send; it does NOT make valid false, so read the two separately. checked false means the published table covers no range for that sort code, in which case Vocalink instructs that the pair be presumed valid — it is not a failed check. Checksum only: it does not prove the account exists or name its holder. official_identity { name, lei, address, category, matched_by, source, free_of_charge, as_of, authoritative: false } is present when a central bank publishes the holder of the resolved code (European Central Bank by LEI and for FR bank codes, Banco de Espana for ES bank codes). It is INFORMATIONAL ONLY and never changes valid or bank_code_check, because both publishers relay rather than allocate. Absent rather than negative on a miss. Its source and free_of_charge fields are licence conditions that travel with the data on every access, not decoration: do not strip them when relaying this answer to a user.

Supports ${F.claim.countries} countries including all SEPA/EEA countries, Switzerland, UK, and 50+ non-SEPA countries.

next_steps is ordered advice derived from the result: what blocks a payment first, what merely enriches it after. Branch on the code field, not on the prose, and relay the do field to the user. bank_code_not_allocated means stop; verify_payee_name means carry on and let a beneficiary name check decide.

bic.lei and bic.address come from the same directory row /v1/bic/:code reads, so validating an IBAN no longer needs a second lookup to obtain them. Both are null when GLEIF publishes nothing for that BIC — which is common outside the countries it covers densely — and null there means "no LEI on file", never "this institution has none". IMPORTANT — bic.address is the LEGAL ENTITY seat, not the branch, and bic.address.city may differ from bic.city: bic.city is where the consulted register places this bank CODE, bic.address.city is where the entity is registered. Both are true and answer different questions. bic.address.as_of is when the entity last filed that address and is usually much older than bic.as_of, which dates the BIC reference set; do not read the address as being as fresh as the bank name beside it.

Example: input 'DE89370400440532013000' → { valid: true, country: { code: 'DE', name: 'Germany' }, bban: { bank_code: '37040044', account_number: '0532013000' }, bic: { code: 'COBADEFFXXX', bank_name: 'Commerzbank', city: 'Köln', lei: '851WYGNLUQLFZBSYGB56', lei_status: 'ACTIVE', address: { street: 'Kaiserstraße 16', post_code: '60311', city: 'Frankfurt am Main', as_of: '2026-02-24', source: 'GLEIF' } }, issuer: { type: 'bank', name: 'Commerzbank' }, ... }

For German IBANs the BIC is the Bundesbank register's exact 11-character form (branch included), because the BIC8 prefix of Sparkassen and cooperative banks names their shared Landesbank, not the account-holding bank. Elsewhere the BIC is normalised to 8 characters; ask for the branch with lookup_bic if you need the 11-character form.

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
    outputSchema: TOOL_OUTPUT_SCHEMAS.validate_iban,
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
      structuredContent: result as unknown as Record<string, unknown>,
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

Behavior: this tool is read-only with no side effects. It validates each IBAN independently using the same logic as validate_iban (mod-97 checksum, BBAN parsing, BIC resolution, issuer classification). Results are returned in the same order as the input array. If one IBAN is invalid, the others are still processed — there is no short-circuit on error. Server-side processing scales sub-linearly: a full 100-IBAN batch is a few milliseconds, network excluded. Returns a JSON array.

Input constraints: minimum 1 IBAN, maximum 100 IBANs per call. Exceeding 100 returns a validation error.

Returns: Array of objects, each identical in structure to the validate_iban response: { valid, country, bban, bic, sepa, issuer, risk_indicators, bank_code_check, next_steps }

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
    outputSchema: TOOL_OUTPUT_SCHEMAS.batch_validate_iban,
    annotations: {
      title: 'Batch Validate IBANs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ ibans }) => {
    // One resolution cache per batch: a lot of IBANs from the same bank
    // resolves the bank once (PERF-05, 2026-09-01), payloads unchanged.
    const cache = createEnrichCache();
    const results = ibans.map((iban) => {
      const result = validateIBAN(iban);
      enrichResult(result, cache);
      // validateIBAN stamps every row with the SINGLE-call price (0.005); a
      // row of a batch is catalogued at 0.002, the 60% discount this tool's
      // own description sells (see the HTTP transport's identical correction,
      // src/routes/mcp-http.ts, `billedFree(result, 0.002)`). Left alone, this
      // field would publish the wrong catalogue number under the right name —
      // and unlike the JSON text below, TOOL_OUTPUT_SCHEMAS.batch_validate_iban
      // now hands that number to a client as a validated, structured field.
      result.cost_usdc = 0.002;
      return result;
    });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      // Wrapped in { results, count }, not the bare array `content` carries:
      // matches TOOL_OUTPUT_SCHEMAS.batch_validate_iban, and mirrors the same
      // asymmetry the HTTP transport already has (src/routes/mcp-http.ts).
      structuredContent: {
        results: results as unknown as Record<string, unknown>[],
        count: results.length,
      },
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

Behavior: this tool is read-only with no side effects. It validates the BIC format (ISO 9362), then queries a local SQLite database of ${F.claim.bic} institutions sourced from GLEIF. For BIC11 lookups, if the specific branch is not found, it falls back to the head office (XXX suffix). Detects test BICs (e.g., MARKDEF patterns). Response time is under 10ms. Returns a single JSON object.

Input: accepts BIC8 (e.g., 'UBSWCHZH') or BIC11 (e.g., 'UBSWCHZH80A'). Case-insensitive.

Returns: { bic, bic8, bic11, valid_format, found, institution, country: { code, name }, city, branch_code, branch_info, lei, lei_status, is_test_bic }

country is the same shape as REST GET /v1/bic/:code, and name falls back to the country code when the row carries no name. The flat country_code and country_name keys are still returned but DEPRECATED since 1.4.0 and will be removed no earlier than 2027-01-01; country_name answers null where country.name answers the code.

Example: input 'BNPAFRPP' → { found: true, bic8: 'BNPAFRPP', bic11: 'BNPAFRPPXXX', institution: 'BNP PARIBAS', country: { code: 'FR', name: 'France' }, city: 'PARIS', lei: 'R0MUWSFPU8MPRO8K5P83', lei_status: 'ACTIVE', is_test_bic: false }
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
    outputSchema: TOOL_OUTPUT_SCHEMAS.lookup_bic,
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
      country: {
        code: validation.country_code,
        name: row?.country_name ?? validation.country_code,
      },
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
    title: 'Compliance Risk Check',
    description: `Run a full compliance check on an IBAN: validates the IBAN, enriches with bank data, then screens against sanctions lists, checks SEPA reachability, verifies VoP participation, and computes a composite risk score.

When to use: assessing compliance risk of a payment recipient for AML/KYC workflows, verifying an IBAN is not associated with a sanctioned country or bank, checking SEPA Instant and Verification of Payee participation, or producing a structured risk assessment before approving a payment.
When NOT to use: for simple IBAN format validation without compliance data, use validate_iban (4x cheaper). For BIC-only lookups, use lookup_bic.

Behavior: this tool is read-only with no side effects. It performs IBAN validation and enrichment (same as validate_iban), then queries a local compliance database for sanctions (OFAC, EU, UN lists), FATF grey/black list status, SEPA scheme participation (SCT, SDD, SCT_INST), and VoP participant status. Computes a composite risk score from 0 (lowest risk) to 100 (highest risk) based on 11 weighted risk flags. Response time is under 50ms. Returns a single JSON object. Scope: sanctions screening is at the BANK (BIC8) level only — it does NOT screen the beneficiary/account-holder name and is not a substitute for KYC/AML name screening. If compliance data is unavailable for a country/BIC, returns a fallback risk_level of 'elevated' with a flag 'compliance_data_unavailable'.

Risk score weights: sanctioned country (+50), sanctioned bank (+50), FATF black list (+30), FATF grey list (+20), high-risk country (+20), elevated-risk country (+10), payment institution issuer (+15), EMI issuer (+10), no SEPA Instant (+5), no VoP (+5), test BIC (+30).

Risk levels: low (0-19), medium (20-39), elevated (40-59), high (60-79), critical (80-100).

Returns: { valid, country, bban, bic, sepa, issuer, risk_indicators, bank_code_check, next_steps, compliance: { sanctions: { country_sanctioned, bank_sanctioned, matched_lists, fatf_status }, reachability: { sepa_instant, sct, sdd }, vop: { participant, status }, risk_score, risk_level, flags } }

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
    outputSchema: TOOL_OUTPUT_SCHEMAS.check_compliance,
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
      structuredContent: combined as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'validate_payment_reference',
  {
    title: 'Validate Payment Reference',
    description: `Validate a structured payment reference (RF/ISO 11649, Swiss QR reference, Belgian OGM/VCS, Finnish viitenumero) and, when an IBAN is supplied, decide whether the two may legally travel together.

When to use: an agent is assembling a payment instruction and has a reference from an invoice, a QR-bill or a remittance advice, and needs to know whether it is well-formed BEFORE submitting. Also use it whenever you have a Swiss IBAN and a reference: the pairing rule is the part most integrations get wrong.
When NOT to use: to validate the IBAN itself, use validate_iban. This tool checks the REFERENCE.

Behavior: read-only, no network calls, no side effects. Pure arithmetic against published check-digit rules, plus one range check against the SIX QR-IID allocation for the pairing verdict.

Schemes and their published rules:
- RF Creditor Reference (ISO 11649, "SCOR" in Swiss Payment Standards) — mod 97-10, the same arithmetic as an IBAN check digit.
- Swiss QR reference ("QRR") — 27 numeric characters, the last a modulo-10-recursive check digit.
- Belgian OGM/VCS — 12 digits, the last two a modulo-97 check on the first ten, a remainder of 0 written 97.
- Finnish viitenumero — 4 to 20 digits, weights 7-3-1 applied from right to left.
- Norwegian KID and Swedish OCR — RECOGNISED, never judged. They answer valid: null with status 'unverifiable_without_creditor_config', because the modulus type and the accepted length are configured per creditor account by the beneficiary's bank and are not a property of the string. Do not report these to a user as invalid; report that the check needs the creditor's bank configuration.

Scheme detection: only two signals are unambiguous — a leading "RF", and a 27-digit length. Every other numeric length is shared between national conventions that were never coordinated. A bare 12-digit string is both a Belgian OGM and a legal Finnish length, so the tool answers with the more specific reading and reports the other in also_valid_as. Pass reference_type when you know the country.

THE PAIRING RULE (the part no checksum library reproduces): pass an iban and you also get a pairing verdict. Per the Swiss Implementation Guidelines, a QRR reference may ONLY be used with a QR-IBAN (an institution identifier in the SIX range 30000-31999), and an ISO 11649 reference may NOT be used with one. Outside CH and LI there is no QR-IBAN to pair against, so pairing is 'not_applicable' — including for a valid RF reference, whose own checksum verdict is unaffected.

Returns: { reference, scheme, valid (true | false | null), status, check_digit_expected?, also_valid_as?, source, as_of, note, pairing?, pairing_source?, pairing_as_of? }

IMPORTANT — valid and pairing are INDEPENDENT verdicts. A reference can be arithmetically valid and still be illegal on that account, and a malformed reference can sit on exactly the right kind of account. Read both.

Every answer that names a scheme carries the document that publishes the rule and its date. Relay them: they are what makes the verdict auditable.

Example: input reference '210000000003139471430009017', iban 'CH4431999123000889012' → { scheme: 'qrr', valid: true, pairing: 'ok' }. Same reference with an ordinary Swiss IBAN → { valid: true, pairing: 'qrr_requires_qr_iban' }.

Cost: free. The checksums are published commodities; the paid surface is POST /v1/iban/validate, which returns this same pairing block alongside the full IBAN enrichment.`,
    inputSchema: {
      reference: z
        .string()
        .trim()
        .min(4, 'Reference is too short')
        .max(64, 'Reference is too long')
        .describe(
          "The payment reference as printed. Spaces, slashes and the Belgian +++...+++ wrapper are stripped automatically. Examples: 'RF18539007547034', '21 00000 00003 13947 14300 09017', '+++010/8068/17183+++', '1234561'.",
        ),
      reference_type: z
        .string()
        .optional()
        .describe(
          "Optional scheme hint, used when the string alone is ambiguous. One of 'rf' (or 'scor'), 'qrr', 'ogm' (or 'vcs'), 'viitenumero', 'kid', 'ocr'. If it contradicts the string, the tool judges as asked and says so in the note.",
        ),
      iban: z
        .string()
        .trim()
        .optional()
        .describe(
          "Optional. The creditor IBAN this reference would travel with. Supply it to get the pairing verdict — that is the reason to use this tool over a local checksum library. Example: 'CH4431999123000889012'.",
        ),
    },
    outputSchema: TOOL_OUTPUT_SCHEMAS.validate_payment_reference,
    annotations: {
      title: 'Validate Payment Reference',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ reference, reference_type, iban }) => {
    // With an IBAN the pairing verdict is available, so the richer block is
    // returned; without one there is nothing to pair against and the plain
    // checksum answer is the honest whole answer.
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
    description: `Check a structured ISO 20022 postal address against a payment rail's published address rules, rule by rule, each verdict citing the document it comes from.

When to use: an agent is assembling a payment instruction (pain.001, a Fedwire message, a T2 transfer) and holds a creditor or debtor address, and needs to know whether the rail will accept it BEFORE submitting. The November 2026 changes (SIC 20.11, Fedwire 16.11, T2 R2026.NOV) remove the fully unstructured address option, so this check is what tells you whether an address survives them.
When NOT to use: to verify that a street or town EXISTS — this tool checks conformity with the message format rules, not postal reality. Address verification services do that; this does not.

Schemes: 'sps' (Swiss Payment Standards, SIX), 'hvps_plus' (HVPS+ / T2, ECB), 'fedwire' (Federal Reserve). There is deliberately NO 'cbpr+' scheme: the CBPR+ usage guideline is published behind swift.com, which is unreachable to automated readers, and a conformity boolean quoting a document nobody here has read would be a guess dressed as a verdict. The response's note field restates this on every answer.

Behavior: read-only, no network calls, pure rule evaluation. Findings carry three verdicts: pass, fail, and not_applicable — the last is a real answer marking a rule whose precondition is not met, and it never counts as a pass.

Returns: { scheme, conforms, findings: [{ rule, verdict, detail, source }], note }. conforms is true when no finding failed.

IMPORTANT — relay the source strings when reporting to a user: each names the exact document, version and validity date the rule is quoted from (e.g. "SIX, Swiss Implementation Guidelines … SPS 2026 v2.3, valid from 14 November 2026, ch. 3.11 table 9."). They are what makes the verdict auditable.

Example: input scheme 'sps', address { strt_nm: 'Bahnhofstrasse', bldg_nb: '45', pst_cd: '8001', twn_nm: 'Zurich', ctry: 'CH' } → { conforms: true, findings: [7 rules, each sourced] }. Dropping twn_nm flips twn_nm_required to fail and conforms to false.

Cost: free. The rules are published commodities; the paid surface is the postal_address block that /v1/bic and /v1/iban/validate return for the resolved institution.`,
    inputSchema: {
      scheme: z
        .enum(ADDRESS_SCHEMES as [AddressScheme, ...AddressScheme[]])
        .describe(
          "Which rail's rules to check against: 'sps' (Swiss, SIX), 'hvps_plus' (T2, ECB) or 'fedwire' (Federal Reserve).",
        ),
      address: z
        .object({
          twn_nm: z.string().optional().describe('TwnNm — town name.'),
          ctry: z.string().optional().describe('Ctry — ISO 3166-1 alpha-2 country code.'),
          pst_cd: z.string().optional().describe('PstCd — postal code.'),
          strt_nm: z.string().optional().describe('StrtNm — street name.'),
          bldg_nb: z.string().optional().describe('BldgNb — building number.'),
          adr_tp: z
            .string()
            .optional()
            .describe(
              'AdrTp — address type. SPS forbids sending it; supply it to see that rule fire.',
            ),
          adr_line: z
            .array(z.string())
            .optional()
            .describe(
              'AdrLine — free-text lines, the hybrid-address remainder. Rails cap their number and length.',
            ),
        })
        .strict()
        .describe('The ISO 20022 PostalAddress under test, in ISO tag vocabulary (snake_cased).'),
    },
    outputSchema: TOOL_OUTPUT_SCHEMAS.check_postal_address,
    annotations: {
      title: 'Check ISO 20022 Postal Address',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
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
    title: 'Lookup Swiss Bank Clearing Number',
    description: `Look up a Swiss BC-Nummer (Bank Clearing Number / IID) and return institution details, payment infrastructure participation (SIC, euroSIC, Instant Payments), and QR-bill data.

When to use: resolving the bank behind a Swiss IBAN, checking SIC/euroSIC participation, verifying QR-bill IID allocation, or identifying PostFinance/cantonal bank accounts.
When NOT to use: for non-Swiss IBANs, use validate_iban instead.

Behavior: this tool is read-only with no side effects. It queries a local SQLite database of ${F.claim.chClearing} Swiss bank clearing entries sourced from SIX BankMaster. Follows concatenation redirects (merged IIDs). Response time is under 10ms. Returns a single JSON object.

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
    outputSchema: TOOL_OUTPUT_SCHEMAS.lookup_ch_clearing,
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
      const errorPayload = {
        error: 'invalid_iid_format',
        message: 'IID must be a 1-5 digit number.',
      };
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

/**
 * Le plafond d'écriture de `send_feedback` sur CE transport.
 *
 * Les trois surfaces MCP n'ont pas la même serrure, parce qu'elles n'ont pas la
 * même porte :
 *   - le paquet npm (mcp/src/index.ts) relaie POST /v1/feedback, et hérite donc
 *     du quota par source déjà posé sur cette route (20 insertions/heure) ;
 *   - le transport HTTP (src/routes/mcp-http.ts) est derrière le limiteur global
 *     par IP de l'application (100 req/min) ;
 *   - ce serveur-ci écrit en base SANS aucun HTTP au-dessus : ni IP, ni
 *     limiteur, ni quota. Copier le corps de la surface HTTP tel quel ouvrirait
 *     une écriture illimitée dans `feedback`.
 *
 * D'où ce compteur glissant, sur LE MÊME nombre que la route publique — un seul
 * chiffre à changer si le plafond bouge. Il est en mémoire et non en base : un
 * serveur stdio sert un seul client local, et le redémarrer est un geste de
 * l'utilisateur, pas un contournement (les clips de longueur de
 * `recordFeedbackRow`, eux, tiennent quoi qu'il arrive).
 */
const feedbackWrites: number[] = [];

function feedbackQuotaAvailable(): boolean {
  const cutoff = Date.now() - 3600_000;
  while (feedbackWrites.length > 0 && feedbackWrites[0] < cutoff) feedbackWrites.shift();
  return feedbackWrites.length < FEEDBACK_INSERTS_PER_SOURCE_HOUR;
}

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
        .describe(
          'Category of the report. Use "other" for product feedback, pricing/payment blockers or feature needs.',
        ),
      notes: z
        .string()
        .min(3)
        .max(4000)
        .describe('What happened, what you needed, or what blocked you — free text.'),
      endpoint: z
        .string()
        .max(200)
        .optional()
        .describe('Endpoint or tool concerned, e.g. /v1/iban/batch.'),
      expected: z.string().max(1000).optional().describe('What you expected (for data errors).'),
      got: z.string().max(1000).optional().describe('What you received instead (for data errors).'),
      contact: z
        .string()
        .max(255)
        .optional()
        .describe('Where we may answer you (e-mail) — optional, reports can be anonymous.'),
      agent: z
        .string()
        .max(120)
        .optional()
        .describe('Which agent/model is reporting, e.g. "claude-sonnet-5 via MCP".'),
    },
    outputSchema: TOOL_OUTPUT_SCHEMAS.send_feedback,
    annotations: { title: 'Send Feedback to IBANforge' },
  },
  async ({ error_type, notes, endpoint, expected, got, contact, agent }) => {
    if (!feedbackQuotaAvailable()) {
      // `isError` et PAS de structuredContent : un refus ne peut pas satisfaire
      // `required: [ok, id]`, et c'est la branche que la spec réserve pour ça.
      const refusal = {
        error: 'feedback_rate_limited',
        message: `At most ${FEEDBACK_INSERTS_PER_SOURCE_HOUR} feedback reports per hour on this transport. Try again later.`,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(refusal) }], isError: true };
    }
    const id = recordFeedbackRow({
      error_type,
      notes,
      endpoint: endpoint ?? null,
      expected,
      got,
      contact: contact ?? null,
      // `agent` distingue les transports dans la table : un rapport arrivé par
      // le serveur embarqué n'a ni IP ni clé, c'est la seule provenance qu'on ait.
      agent: agent ?? 'mcp-stdio',
      ipHash: null,
    });
    feedbackWrites.push(Date.now());
    const payload = { ok: true, id };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      structuredContent: payload as unknown as Record<string, unknown>,
    };
  },
);

// ── Resources ────────────────────────────────────────────────────────────────

server.registerResource(
  'countries',
  'ibanforge://countries',
  {
    title: 'Supported Countries',
    description: `List of all ${F.claim.countries} countries supported by IBANforge with IBAN length, SEPA membership, VoP status, and country risk classification.`,
    mimeType: 'application/json',
  },
  async () => ({
    contents: [
      {
        uri: 'ibanforge://countries',
        mimeType: 'application/json',
        text: JSON.stringify(buildCountriesPayload(), null, 2),
      },
    ],
  }),
);

server.registerResource(
  'pricing',
  'ibanforge://pricing',
  {
    title: 'Pricing',
    description:
      'Per-call pricing for IBANforge API endpoints (USDC on Base L2 via x402 protocol).',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [
      {
        uri: 'ibanforge://pricing',
        mimeType: 'application/json',
        text: JSON.stringify(buildPricingPayload(), null, 2),
      },
    ],
  }),
);

// ── Prompts ──────────────────────────────────────────────────────────────────

server.registerPrompt(
  'validate_and_explain',
  {
    title: 'Validate and Explain IBAN',
    description:
      'Validate an IBAN and generate a human-readable explanation suitable for non-technical users.',
    argsSchema: {
      iban: z.string().describe('The IBAN to validate and explain'),
    },
  },
  async ({ iban }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: buildValidateAndExplainPrompt(iban),
        },
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IBANforge MCP Server running on stdio');
  console.error(`Swiss clearing entries: ${getChClearingCount()}`);
}

main().catch(console.error);
