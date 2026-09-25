import { z } from 'zod';
import { nationalRegisterBicCodes } from '../lib/register-lists.js';
import {
  BANK_CODE_HOLDER_NOTE,
  BANK_REACHABILITY_NOTE,
  BIC_SOURCE_AS_OF_NOTE,
  CHECKS_NOTE,
  LISTED_IN_CURRENT_SOURCE_NOTE,
  VOP_REGISTER_STATUS_NOTE,
  bicSourceNote,
} from '../lib/field-notes.js';
import { CHECK_KEYS } from '../lib/checks.js';

/**
 * The `outputSchema` every MCP tool declares, shared by the two internal
 * transports.
 *
 * ## Why this file exists
 *
 * Audit of 2026-09-01 (MCP-15): `src/routes/mcp-http.ts` declared an
 * `outputSchema` on every data tool, so the MCP SDK validated each payload and
 * returned `structuredContent` a client can read without re-parsing the text
 * block. `src/mcp/server.ts` (stdio, `npm run mcp`) declared none at all,
 * except on `send_feedback` — so every other tool on that transport answered
 * `content` only. A conformant client that expects `structuredContent`
 * whenever `outputSchema` is advertised would never have known to ask for it
 * here, because stdio never advertised one; the npm package hit the opposite
 * bug (`outputSchema` declared, `structuredContent` never sent) and it sat
 * unnoticed for two months (see `mcp/src/index.test.ts`). Neither half of
 * that contract can be right on its own.
 *
 * This module is now the single place these schemas are written. Both
 * `src/mcp/server.ts` and `src/routes/mcp-http.ts` import `TOOL_OUTPUT_SCHEMAS`
 * rather than declaring their own, so the two transports cannot drift the way
 * `lookup_bic`'s five-way tool-count did before `src/mcp/inventory.ts` (audit
 * DX-01): a field added here reaches both transports in the same edit, and one
 * missed on either side fails `output-schemas.test.ts` instead of shipping.
 *
 * `mcp/src/index.ts` (the published npm package) is deliberately NOT wired to
 * this file — it is a separate package with its own dependency tree and
 * cannot import from `src/`, the same reason it keeps its own copy of
 * `MCP_INSTRUCTIONS` (see `src/mcp/instructions.ts`).
 */

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
export const NEXT_STEPS_SCHEMA = z
  .array(
    z.object({
      code: z.string().describe('Stable identifier. Branch on this.'),
      do: z.string(),
      because: z.string().describe('The response field that produced this step.'),
      action: z
        .string()
        .optional()
        .describe('An IBANforge call that performs the step, when one exists.'),
    }),
  )
  .optional()
  .describe(
    'Ordered advice derived from THIS result: what blocks a payment first, what merely enriches it after. Branch on `code`, never on the prose. `because` names the field that produced the step so the advice is auditable. Empty for an IBAN that failed validation.',
  );

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
export const OFFICIAL_IDENTITY_SCHEMA = z
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
    attribution: z
      .string()
      .optional()
      .describe('The Banco de Espana citation formula, verbatim. Spanish blocks only.'),
    as_of: z
      .string()
      .describe(
        'Date of the list this row came from. Both lists are republished every business day.',
      ),
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
export const BIC_BASIS_SCHEMA = z
  .string()
  .optional()
  .describe(
    'Where the bank code to BIC pairing came from, and therefore what may be done with the BIC. ' +
      `national_register (the country register publishes this BIC for this bank code — today ${nationalRegisterBicCodes()}; settlement-grade) | ` +
      'curated_map (our maintained bank-code map, exact key, usually right and not an allocation record) | ' +
      'directory_prefix (the bic8 LIKE fallback, which can match several institutions — read bank_code_check.candidates). ' +
      'Outside a national_register basis the BIC is ADVISORY: confirm it with the beneficiary or the bank before storing it as a routing instruction.',
  );

export const BIC_AUTHORITATIVE_SCHEMA = z
  .boolean()
  .optional()
  .describe(
    'Whether this BIC may be stored and settled against. Derived from basis, so the two cannot disagree. ' +
      'NOT bank_code_check.authoritative, which answers a different question — whether a national register was consulted about the BANK CODE. San Marino is where the two part: the pairing is the supervisor’s, the code space is not its to settle.',
  );

// Ces blocs nomment les champs réellement renvoyés par enrichResult. Le client
// MCP officiel rejette une propriété non déclarée dans un objet de sortie fermé.
const REGISTER_INSTITUTION_SCHEMA = z.object({
  name: z.string(),
  street: z.string().nullable(),
  post_code: z.string().nullable(),
  town: z.string().nullable(),
  country: z.string(),
  lei: z.string().nullable().optional(),
});

const POSTAL_ADDRESS_SCHEMA = z.object({
  strt_nm: z.string().optional(),
  bldg_nb: z.string().optional(),
  pst_cd: z.string().optional(),
  twn_nm: z.string(),
  ctry: z.string(),
  adr_line: z.array(z.string()).optional(),
  format: z.enum(['structured', 'hybrid']),
  source: z.string(),
  as_of: z.string().nullable(),
});

const REGISTERED_ADDRESS_SCHEMA = z.object({
  type: z.literal('registered'),
  street: z.string().nullable(),
  post_code: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  romanized: z.string().nullable(),
  romanization: z.enum(['original_latin', 'gleif_english', 'unavailable']),
  source: z.string(),
  language: z.string().nullable(),
  as_of: z.string().nullable(),
});

const ENRICHED_BIC_SCHEMA = z
  .object({
    code: z.string(),
    bic8: z
      .string()
      .optional()
      .describe(
        'The eight characters of the institution — the field to compare a supplied BIC against. ' +
          'code is served as the consulted source publishes it, so it is 8 or 11 characters; this one never moves. ' +
          'The branch code (last three characters) is informational: in a cooperative network it names the LOCAL bank and the first eight its clearing institution.',
      ),
    redirected_from: z
      .string()
      .optional()
      .describe(
        'The bank code asked about, when the register answered for the one that took over its clearing (CH/LI only today: SIX marks an IID concatenated and publishes its successor). The IBAN stays valid — a redirect is not a retirement.',
      ),
    bank_name: z.string().nullable(),
    city: z.string().nullable(),
    basis: BIC_BASIS_SCHEMA,
    authoritative: BIC_AUTHORITATIVE_SCHEMA,
    source: z
      .string()
      .nullable()
      .optional()
      .describe('Source of the bank-code/BIC pairing; keep its provenance.'),
    as_of: z.string().nullable().optional(),
    source_as_of: z.string().optional().describe(BIC_SOURCE_AS_OF_NOTE),
    listed_in_current_source: z
      .boolean()
      .nullable()
      .optional()
      .describe(LISTED_IN_CURRENT_SOURCE_NOTE),
    lei: z
      .string()
      .nullable()
      .optional()
      .describe('GLEIF identity of the resolved BIC holder, not necessarily the bank-code holder.'),
    lei_status: z.string().nullable().optional(),
    address: REGISTERED_ADDRESS_SCHEMA.nullable().optional(),
    postal_address: POSTAL_ADDRESS_SCHEMA.nullable().optional(),
  })
  .nullable()
  .optional();

export const BANK_CODE_CHECK_SCHEMA = z
  .object({
    institution: REGISTER_INSTITUTION_SCHEMA.optional(),
    check_digit: z.object({ valid: z.boolean(), algorithm: z.string() }).optional(),
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
    match: z
      .string()
      .nullable()
      .describe('register (exact key) | prefix (bic8 LIKE heuristic) | null'),
    register: z.string().nullable(),
    authoritative: z
      .boolean()
      .describe(
        'True only where the reference set is the national register (CH, LI, DE). Only then does not_in_register mean the code is not allocated.',
      ),
    candidates: z
      .number()
      .optional()
      .describe('BIC8 the prefix matched; >1 means the BIC may belong to another institution.'),
    retired: z
      .boolean()
      .optional()
      .describe(
        'True when an authoritative register is withdrawing the code. Still a verified result: it WAS allocated.',
      ),
    superseded_by: z
      .string()
      .optional()
      .describe('The bank code that takes over. Re-paper the beneficiary against it.'),
    as_of: z.string(),
  })
  .optional();

/**
 * `checks` : un statut par contrôle (25/09/2026). Objet fermé à clés fixes, lues
 * dans CHECK_KEYS : une clé ajoutée là est déclarée ici du même coup.
 */
const CHECKS_SCHEMA = z
  .object(
    Object.fromEntries(
      CHECK_KEYS.map((k) => [
        k,
        z.string().describe('pass | fail | inferred | unknown | not_checked | not_applicable'),
      ]),
    ) as Record<(typeof CHECK_KEYS)[number], z.ZodString>,
  )
  .optional()
  .describe(CHECKS_NOTE);

const VALIDATE_IBAN_OUTPUT_SCHEMA = {
  iban: z.string().describe('Normalized IBAN (uppercase, no spaces).'),
  valid: z.boolean(),
  bank_code_holder: z
    .string()
    .optional()
    .describe(`confirmed | inferred | not_allocated | unknown. ${BANK_CODE_HOLDER_NOTE}`),
  checks: CHECKS_SCHEMA,
  formatted: z.string().optional().describe('IBAN with 4-char groups for display.'),
  country: z
    .object({
      code: z.string().describe('ISO 3166-1 alpha-2 country code.'),
      name: z.string(),
    })
    .optional(),
  check_digits: z.string().optional(),
  bban: z
    .object({
      bank_code: z.string(),
      branch_code: z.string().optional(),
      account_number: z.string(),
    })
    .optional(),
  bic: ENRICHED_BIC_SCHEMA,
  sepa: z
    .object({
      member: z.boolean(),
      schemes: z.array(z.string()),
      vop_required: z.boolean(),
      vop_participant: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          'true = resolved bank is listed as ready in the EPC VoP scheme register; null = no institution resolved, or the VoP register is not loaded (not consulted); a resolved bank outside the SEPA area is answered false from the country either way.',
        ),
      // Declared because `enrichResult` now serves it: the SDK validates
      // this payload against the schema and drops `structuredContent`
      // silently on a field it does not know, so an undeclared field is a
      // field no agent ever sees.
      basis: z
        .enum(['country_default', 'epc_register'])
        .optional()
        .describe(
          'Where `schemes` came from: read at the EPC register for this bank, or defaulted from the country.',
        ),
      // Le grain de la banque (25/09/2026), jamais emprunté au pays.
      bank_reachability: z
        .string()
        .nullable()
        .optional()
        .describe(
          `listed | not_listed | no_bank | bank_code_not_allocated, or null. ${BANK_REACHABILITY_NOTE}`,
        ),
      bank_schemes: z
        .array(z.string())
        .nullable()
        .optional()
        .describe(
          "The bank's own schemes from the EPC registers when bank_reachability is listed; [] for an unallocated bank code; null otherwise.",
        ),
      vop_register_status: z
        .string()
        .nullable()
        .optional()
        .describe(`active | pending | inactive | not_listed, or null. ${VOP_REGISTER_STATUS_NOTE}`),
    })
    .optional(),
  issuer: z
    .object({
      type: z
        .string()
        .nullable()
        .describe('bank | digital_bank | emi | payment_institution; null when unsubstantiated'),
      iban_issuer: z.enum(['confirmed', 'not_listed']).optional(),
      name: z.string(),
      classification: z
        .string()
        .describe(
          'curated | register | default. Whether the type was established or assumed. curated = the BIC8 is in the issuer set, so this is an identification. register = an official register names the holder of this bank code and says what it is; it carries a date and an authority in psd_registration, and it only ever replaces a default. default = nothing is on file and "bank" is the fallback, which covers 97.9% of BIC8 (measured 29/07/2026). Count curated and register when sizing virtual-IBAN exposure, never default.',
        ),
    })
    .optional(),
  risk_indicators: z
    .object({
      issuer_type: z
        .string()
        .nullable()
        .describe('Null when no institution resolved — it no longer defaults to "bank".'),
      country_risk: z.string(),
      test_bic: z.boolean(),
      sepa_reachable: z.boolean(),
      sepa_reachable_scope: z
        .string()
        .describe('Scope the reachability holds at. Country-derived, not account-derived.'),
      vop_coverage: z.boolean(),
    })
    .optional(),
  bank_code_check: BANK_CODE_CHECK_SCHEMA,
  official_identity: OFFICIAL_IDENTITY_SCHEMA,
  next_steps: NEXT_STEPS_SCHEMA,
  clearing: z
    .object({
      iid: z.string(),
      name: z.string(),
      type: z.string(),
      town: z.string().nullable(),
      sic: z.boolean(),
      instant_payments_chf: z.boolean(),
      eurosic: z.boolean(),
      qr_iid: z.string().nullable(),
      qr_iid_source: z.enum(['register', 'headquarters']).nullable(),
      qr_iids: z.array(z.string()).optional(),
      is_qr_iid: z.boolean().optional(),
    })
    .nullable()
    .optional()
    .describe('Swiss clearing data when country is CH or LI.'),
  modulus_check: z
    .object({
      checked: z.boolean(),
      passed: z.boolean().nullable(),
      source: z.string(),
      table_fetched_on: z.string(),
    })
    .optional(),
  pra_authorisation: z
    .object({
      authorised: z.literal(true),
      firm_name: z.string(),
      frn: z.string(),
      section: z.string(),
      basis: z.string(),
      source: z.string(),
      list_month: z.string(),
    })
    .optional(),
  psd_registration: z
    .object({
      registered: z.literal(true),
      entity_type: z.string(),
      name: z.string(),
      country: z.string(),
      competent_authority: z.string(),
      source: z.string(),
      as_of: z.string(),
    })
    .optional(),
  error: z.string().optional(),
  error_detail: z.string().optional(),
  cost_usdc: z.number().describe('What THIS call was billed. Zero on the free MCP tier.'),
  list_price_usdc: z
    .number()
    .optional()
    .describe('Catalogue price of the same call on the paid REST/x402 route.'),
  processing_ms: z.number().optional(),
};

// Le lot contient le même enrichissement que l'appel unitaire. Deux copies
// avaient divergé sur check_digits, le BIC, le clearing et la provenance.
const BATCH_VALIDATE_IBAN_OUTPUT_SCHEMA = {
  results: z
    .array(z.object(VALIDATE_IBAN_OUTPUT_SCHEMA))
    .describe('One result per input IBAN, in the same order. Same shape as validate_iban.'),
  count: z.number().describe('Number of IBANs processed.'),
};

const LOOKUP_BIC_OUTPUT_SCHEMA = {
  bic: z.string().describe('Echo of the input, normalized to uppercase.'),
  bic8: z.string().optional().describe('8-char form (institution-level).'),
  bic11: z.string().optional().describe('11-char form including branch.'),
  valid_format: z.boolean().optional(),
  found: z
    .boolean()
    .optional()
    .describe('True only when the row names an institution: a record is complete or not found.'),
  institution: z.string().nullable().optional().describe('Bank legal name.'),
  country_code: z
    .string()
    .optional()
    .describe('DEPRECATED since 1.4.0, removed no earlier than 2027-01-01. Use country.code.'),
  country_name: z
    .string()
    .nullable()
    .optional()
    .describe(
      "DEPRECATED since 1.4.0, removed no earlier than 2027-01-01. Use country.name, which is never null: the row's country name, else the ISO name, else the code.",
    ),
  country: z
    .object({ code: z.string(), name: z.string() })
    .optional()
    .describe(
      "Same shape as REST GET /v1/bic/:code. name is the row's country name, then the ISO name, and falls back to the country code only when neither exists.",
    ),
  city: z
    .string()
    .nullable()
    .optional()
    .describe('Null, never an empty string, when the source leaves the town blank.'),
  branch_code: z.string().optional(),
  branch_info: z.string().nullable().optional(),
  lei: z
    .string()
    .nullable()
    .optional()
    .describe('Legal Entity Identifier (ISO 17442) if available.'),
  lei_status: z.string().nullable().optional(),
  is_test_bic: z.boolean().optional(),
  // Ajoutés le 25/09/2026 : la source de la ligne, que cet outil ne rendait pas.
  // Déclarés ici, sinon le client officiel refuse l'objet fermé.
  source: z.string().nullable().optional().describe('Code of the dataset this row comes from.'),
  source_name: z.string().nullable().optional().describe(bicSourceNote()),
  source_as_of: z
    .string()
    .optional()
    .describe('Year-month the source DATA is from, present only for a frozen copy.'),
  listed_in_current_source: z
    .boolean()
    .nullable()
    .optional()
    .describe(LISTED_IN_CURRENT_SOURCE_NOTE),
  valid: z.boolean().optional().describe('Set when the BIC failed format validation.'),
  error: z.string().optional(),
};

const CHECK_COMPLIANCE_OUTPUT_SCHEMA = {
  ...VALIDATE_IBAN_OUTPUT_SCHEMA,
  compliance: z.object({
    sanctions: z.object({
      bank_screened: z
        .boolean()
        .describe(
          'False means no bank was screened; do not interpret bank_sanctioned as a finding.',
        ),
      country_sanctioned: z.boolean(),
      bank_sanctioned: z
        .boolean()
        .describe('False also when no bank was screened: read institution_listed.'),
      matched_lists: z.array(z.string()),
      fatf_status: z.string(),
      // Noms honnêtes ajoutés le 25/09/2026, déclarés dans l'objet fermé.
      institution_listed: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          "Whether the payee's BANK is on a sanctions list: bank_sanctioned when a bank was screened against every list this service names, null otherwise (never false without a screen).",
        ),
      payee_screened: z
        .boolean()
        .optional()
        .describe('Always false: the payee (account holder) is never screened here.'),
    }),
    reachability: z.object({
      screened: z.boolean(),
      sepa_instant: z.boolean(),
      sct: z.boolean(),
      sdd: z.boolean(),
      listed_in_epc_registers: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          'At least one of the three schemes lists the bank; null when the EPC registers were not consulted (screened false). Outside the SEPA area the country answers (false) whether or not the registers are loaded.',
        ),
    }),
    vop: z.object({
      screened: z.boolean(),
      participant: z.boolean(),
      status: z.string(),
      register_status: z
        .string()
        .nullable()
        .optional()
        .describe(`active | pending | inactive | not_listed, or null. ${VOP_REGISTER_STATUS_NOTE}`),
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
      .describe(
        '0 = safest, 100 = block. null when the IBAN could not be validated: there was nothing to score.',
      ),
    risk_level: z
      .string()
      .describe(
        'low | medium | elevated | high | critical | unassessable. unassessable means the IBAN itself did not validate, so no screening was possible: it is the absence of a verdict, never a favourable one.',
      ),
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
      sources: z.string().nullable().optional(),
    })
    .passthrough(),
  cost_usdc: z.number().describe('What THIS call was billed. Zero on the free MCP tier.'),
  list_price_usdc: z
    .number()
    .optional()
    .describe('Catalogue price of the same call on the paid REST/x402 route.'),
  error: z.string().optional(),
  error_detail: z.string().optional(),
};

const VALIDATE_PAYMENT_REFERENCE_OUTPUT_SCHEMA = {
  reference: z.string().describe('Normalized: uppercase, separators removed.'),
  scheme: z
    .string()
    .nullable()
    .describe('rf | qrr | ogm | viitenumero | kid | ocr, or null when nothing matched.'),
  valid: z
    .boolean()
    .nullable()
    .describe(
      'null means the scheme was recognised and cannot be checked without the creditor bank configuration. Never report null as false.',
    ),
  status: z.string().describe('checked | unverifiable_without_creditor_config | unrecognised'),
  check_digit_expected: z
    .string()
    .optional()
    .describe(
      'A STRING, so a two-digit value beginning with zero survives (OGM remainder 3 is "03", remainder 0 is "97").',
    ),
  also_valid_as: z
    .object({
      scheme: z.string(),
      valid: z.boolean(),
      check_digit_expected: z.string().optional(),
    })
    .optional()
    .describe('The second reading of an ambiguous string, with its own verdict.'),
  source: z
    .string()
    .nullable()
    .describe('The document publishing the rule. Null only when no scheme matched. Relay it.'),
  as_of: z.string().optional().describe('YYYY-MM of that document.'),
  note: z.string().describe('What was checked, and what was not.'),
  pairing: z
    .string()
    .optional()
    .describe(
      'Present only when an iban was supplied: ok | qrr_requires_qr_iban | scor_forbidden_with_qr_iban | not_applicable',
    ),
  pairing_source: z
    .string()
    .optional()
    .describe('The document publishing the pairing rule — a DIFFERENT one from source.'),
  pairing_as_of: z.string().optional(),
};

const CHECK_POSTAL_ADDRESS_OUTPUT_SCHEMA = {
  scheme: z.string().describe('sps | hvps_plus | fedwire — the rule set that was applied.'),
  conforms: z
    .boolean()
    .describe('True when no finding failed. not_applicable findings never count against it.'),
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
};

const LOOKUP_CH_CLEARING_OUTPUT_SCHEMA = {
  iid: z.string().optional().describe('Normalized 5-digit BC-Nummer.'),
  found: z.boolean().optional(),
  institution: z
    .object({
      name: z.string(),
      type: z
        .string()
        .describe(
          'bank | cantonal_bank | postfinance | raiffeisen | central_bank | foreign_participant',
        ),
      iid_type: z.string().describe('headquarters | branch | other'),
      headquarters_iid: z.string(),
    })
    .optional(),
  address: z
    .object({
      street: z.string().nullable(),
      building_number: z.string().nullable(),
      post_code: z.string().nullable(),
      town: z.string().nullable(),
      country: z.string(),
    })
    .optional(),
  bic: z.string().nullable().optional().describe('BIC if mapped.'),
  payment_services: z
    .object({
      sic: z.boolean().describe('Swiss Interbank Clearing.'),
      rtgs_chf: z.boolean(),
      instant_payments_chf: z.boolean(),
      eurosic: z.boolean(),
      lsv_bdd_chf: z.boolean(),
      lsv_bdd_eur: z.boolean(),
    })
    .optional(),
  sic_iid: z.string().nullable().optional(),
  qr_iid: z.string().nullable().optional().describe('QR-bill enabled IID.'),
  valid_on: z.string().optional(),
  redirected_from: z.string().optional(),
  note: z.string().optional(),
  cost_usdc: z
    .number()
    .optional()
    .describe('What THIS call was billed. Zero on the free MCP tier.'),
  list_price_usdc: z
    .number()
    .optional()
    .describe('Catalogue price of the same call on the paid REST/x402 route.'),
  error: z.string().optional(),
  message: z.string().optional(),
};

const SEND_FEEDBACK_OUTPUT_SCHEMA = {
  ok: z.boolean(),
  id: z.number().describe('Report id — check status at GET /v1/feedback/{id}.'),
};

/**
 * One `outputSchema` per MCP tool, keyed by tool name exactly as
 * `src/mcp/inventory.ts` spells it. `output-schemas.test.ts` asserts this set
 * covers every tool in `MCP_TOOLS` and that both `src/mcp/server.ts` and
 * `src/routes/mcp-http.ts` register each tool with the schema found here —
 * neither a copy nor a rewrite.
 *
 * `satisfies` rather than a `: Record<string, z.ZodRawShape>` annotation: the
 * latter would erase each tool's precise shape, and `registerTool`'s generic
 * return type (what a handler is allowed to put in `structuredContent`) is
 * inferred FROM that precision.
 */
const QR_ADDRESS_SCHEMA = z.object({
  type: z.string().describe('AdrTp as carried: S (structured), K (combined) or empty.'),
  name: z.string(),
  line1: z.string().describe('StrtNm for type S, AdrLine1 for type K.'),
  line2: z.string().describe('BldgNb for type S, AdrLine2 (postal code and town) for type K.'),
  postal_code: z.string(),
  town: z.string(),
  country: z.string(),
});

const QR_PARTY_SCHEMA = z.object({
  present: z.boolean(),
  address: QR_ADDRESS_SCHEMA,
  structured: z
    .boolean()
    .nullable()
    .describe('true = type S, false = type K (combined), null = absent or invalid type.'),
  sps_check: z
    .object({
      scheme: z.string(),
      conforms: z.boolean(),
      findings: z.array(
        z.object({ rule: z.string(), verdict: z.string(), detail: z.string(), source: z.string() }),
      ),
      note: z.string(),
    })
    .nullable()
    .describe('The SPS structured-address verdicts for a type S address; null otherwise.'),
  proposed_structured: z
    .object({
      strt_nm: z.string().optional(),
      bldg_nb: z.string().optional(),
      pst_cd: z.string().optional(),
      twn_nm: z.string().optional(),
      ctry: z.string().optional(),
      confidence: z.string().describe('high | low'),
      note: z.string(),
    })
    .nullable()
    .describe('For a combined (K) address: the type S fields derived from the combined lines.'),
});

const CHECK_SWISS_QR_BILL_OUTPUT_SCHEMA = {
  valid: z.boolean().describe('True when no finding has severity error.'),
  ready_for_2026_11_14: z
    .boolean()
    .describe(
      'valid AND every present address is structured (type S): what banks require from 14.11.2026.',
    ),
  qr_type: z.string(),
  version: z.string(),
  coding: z.string(),
  creditor_iban: z.object({
    value: z.string(),
    valid: z.boolean(),
    country: z.string().nullable(),
    qr_iban: z.boolean().describe('IID in 30000-31999, which requires reference type QRR.'),
    iid: z.string().nullable(),
  }),
  creditor: QR_PARTY_SCHEMA,
  ultimate_creditor_empty: z.boolean(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  ultimate_debtor: QR_PARTY_SCHEMA,
  reference: z.object({
    type: z.string().describe('QRR | SCOR | NON as carried.'),
    value: z.string(),
    valid: z.boolean().nullable(),
    note: z.string(),
  }),
  unstructured_message: z.string().nullable(),
  trailer: z.string(),
  billing_information: z.string().nullable(),
  alternative_schemes: z.array(z.string()),
  findings: z.array(
    z.object({
      code: z.string().describe('Stable identifier, safe to branch on.'),
      severity: z.string().describe('error | warning'),
      field: z.string(),
      detail: z.string(),
      source: z.string().describe('The SIX document the rule comes from. Relay it.'),
    }),
  ),
  next_steps: z.array(z.string()),
  source: z.string(),
};

/**
 * `request_api_key` — le device grant vu par l'agent.
 *
 * 🚨 `device_code` N'EST PAS DANS CE SCHÉMA, et ce n'est pas un oubli. C'est le
 * porteur UNIQUE de la clé : quiconque le lit appelle
 * `POST /v1/keys/device/token` et retire la clé à la place de l'agent, sans
 * jeton et sans adresse. Une sortie d'outil traverse le transcript du modèle
 * conservé chez son fournisseur, les journaux du client MCP et les
 * copier-coller de rapport d'incident ; une consigne adressée à un modèle
 * (« ne le montre à personne ») n'est pas un contrôle d'accès. Il n'est de
 * surcroît utile à aucune surface : `poll_api_key` reprend le dernier
 * `device_code` demandé. Il reste rendu par la réponse HTTP 201, pour les
 * clients REST qui n'ont pas de mémoire de session.
 *
 * L'identifiant journalisable sans risque existe déjà : le `user_code`, qui ne
 * retire aucune clé.
 */
export const REQUEST_API_KEY_OUTPUT_SCHEMA = {
  // 🚨 `status` D'ABORD : cet outil peut être REFUSÉ, parce que `openGrant()`
  // porte la réservation sur les trois surfaces. Un refus arrive comme une
  // DONNÉE, jamais comme une erreur d'outil — sinon l'agent conclut à une panne
  // au lieu de prendre le chemin de repli que ce module existe pour ouvrir.
  status: z
    .enum(['ok', 'device_rate_limited', 'device_unavailable'])
    .describe('ok means a code was issued. Anything else: read display_to_human and fall back.'),
  user_code: z
    .string()
    .nullable()
    .describe('Show this to the human, exactly as written, e.g. WDJB-MJHT.'),
  verification_uri: z
    .string()
    .nullable()
    .describe('The page the human opens. Never open it yourself.'),
  verification_uri_complete: z
    .string()
    .nullable()
    .describe('Same page with the code pre-filled. This is the one to show.'),
  expires_in: z.number().nullable().describe('Seconds until the code stops working.'),
  interval: z.number().nullable().describe('Minimum seconds between two poll_api_key calls.'),
  display_to_human: z
    .string()
    .describe('A ready-made block of text to show verbatim. Do not paraphrase it.'),
} satisfies z.ZodRawShape;

/**
 * `poll_api_key` — le retrait, unique.
 *
 * 🚨 Seuls `status` et `message` sont TOUJOURS présents ; tout le reste est
 * `nullable`. Le SDK **valide** la charge contre ce schéma et abandonne
 * `structuredContent` EN SILENCE sur divergence : un champ non déclaré est un
 * champ qu'aucun agent ne verra jamais, et un champ déclaré non nullable qui
 * arrive nul emporte toute la sortie structurée avec lui.
 */
export const POLL_API_KEY_OUTPUT_SCHEMA = {
  status: z
    .enum(['authorization_pending', 'approved', 'access_denied', 'expired_token', 'invalid_grant'])
    .describe('authorization_pending is normal: wait `retry_in_seconds` and call again.'),
  api_key: z.string().nullable().describe('Present exactly once, on the first approved poll.'),
  key_prefix: z.string().nullable(),
  // 🚨 LES QUATRE valeurs de KeyTier, pas deux : un enum trop étroit fait
  // tomber `structuredContent` en silence. `claimed` et `paid` n'arrivent pas
  // par cette route aujourd'hui, mais une clé montée entre deux polls les
  // rendrait, et le rail de paiement les rendra.
  tier: z
    .enum(['anonymous', 'email', 'claimed', 'paid'])
    .nullable()
    .describe('anonymous = the entry allowance, email/claimed/paid = the raised one.'),
  monthly_limit: z.number().nullable(),
  email: z.string().nullable().describe('Absent on the anonymous tier: no address was ever given.'),
  retry_in_seconds: z.number().nullable(),
  expires_in: z.number().nullable(),
  config_line: z
    .string()
    .nullable()
    .describe('The exact command line to give the human. Do not run it yourself.'),
  message: z.string().describe('One sentence for the human.'),
} satisfies z.ZodRawShape;

export const TOOL_OUTPUT_SCHEMAS = {
  validate_iban: VALIDATE_IBAN_OUTPUT_SCHEMA,
  batch_validate_iban: BATCH_VALIDATE_IBAN_OUTPUT_SCHEMA,
  lookup_bic: LOOKUP_BIC_OUTPUT_SCHEMA,
  check_compliance: CHECK_COMPLIANCE_OUTPUT_SCHEMA,
  validate_payment_reference: VALIDATE_PAYMENT_REFERENCE_OUTPUT_SCHEMA,
  check_postal_address: CHECK_POSTAL_ADDRESS_OUTPUT_SCHEMA,
  check_swiss_qr_bill: CHECK_SWISS_QR_BILL_OUTPUT_SCHEMA,
  lookup_ch_clearing: LOOKUP_CH_CLEARING_OUTPUT_SCHEMA,
  send_feedback: SEND_FEEDBACK_OUTPUT_SCHEMA,
  request_api_key: REQUEST_API_KEY_OUTPUT_SCHEMA,
  poll_api_key: POLL_API_KEY_OUTPUT_SCHEMA,
} satisfies Record<string, z.ZodRawShape>;
