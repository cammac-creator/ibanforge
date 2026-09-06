import { z } from 'zod';

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
      'national_register (the country register publishes this BIC for this bank code — today DE, AT, BE, BG, SK and SM; settlement-grade) | ' +
      'curated_map (our maintained bank-code map, exact key, usually right and not an allocation record) | ' +
      'directory_prefix (the bic8 LIKE fallback, which can match several institutions — read bank_code_check.candidates). ' +
      'Outside a national_register basis the BIC is ADVISORY: confirm it with the beneficiary or the bank before storing it as a routing instruction.',
  );

export const BIC_AUTHORITATIVE_SCHEMA = z
  .boolean()
  .optional()
  .describe(
    'Whether this BIC may be stored and settled against. Derived from basis, so the two cannot disagree. ' +
      'NOT bank_code_check.authoritative, which answers a different question — whether a national register was consulted about the BANK CODE. In Switzerland the register confirms the code while the BIC still comes from our curated map.',
  );

export const BANK_CODE_CHECK_SCHEMA = z
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

const VALIDATE_IBAN_OUTPUT_SCHEMA = {
  iban: z.string().describe('Normalized IBAN (uppercase, no spaces).'),
  valid: z.boolean(),
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
  bic: z
    .object({
      code: z.string(),
      bank_name: z.string().nullable(),
      city: z.string().nullable(),
      basis: BIC_BASIS_SCHEMA,
      authoritative: BIC_AUTHORITATIVE_SCHEMA,
    })
    .nullable()
    .optional()
    .describe(
      'Resolved BIC/SWIFT when BBAN→BIC mapping exists. Read basis before storing it as a routing instruction: only a national_register pairing is settlement-grade.',
    ),
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
          'true = resolved bank is listed as ready in the EPC VoP scheme register; null = no institution resolved.',
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
    })
    .optional(),
  issuer: z
    .object({
      type: z.string().describe('bank | digital_bank | emi | payment_institution'),
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
    })
    .nullable()
    .optional()
    .describe('Swiss clearing data when country is CH or LI.'),
  error: z.string().optional(),
  error_detail: z.string().optional(),
  cost_usdc: z.number().describe('What THIS call was billed. Zero on the free MCP tier.'),
  list_price_usdc: z
    .number()
    .optional()
    .describe('Catalogue price of the same call on the paid REST/x402 route.'),
  processing_ms: z.number().optional(),
};

const BATCH_VALIDATE_IBAN_OUTPUT_SCHEMA = {
  results: z
    .array(
      z.object({
        iban: z.string(),
        valid: z.boolean(),
        country: z.object({ code: z.string(), name: z.string() }).optional(),
        bban: z
          .object({
            bank_code: z.string(),
            branch_code: z.string().optional(),
            account_number: z.string(),
          })
          .optional(),
        bic: z
          .object({
            code: z.string(),
            bank_name: z.string().nullable(),
            city: z.string().nullable(),
            basis: BIC_BASIS_SCHEMA,
            authoritative: BIC_AUTHORITATIVE_SCHEMA,
          })
          .nullable()
          .optional(),
        issuer: z
          .object({ type: z.string(), name: z.string(), classification: z.string() })
          .optional(),
        sepa: z
          .object({
            member: z.boolean(),
            schemes: z.array(z.string()),
            vop_required: z.boolean(),
            vop_participant: z.boolean().nullable().optional(),
            basis: z.enum(['country_default', 'epc_register']).optional(),
          })
          .optional(),
        risk_indicators: z
          .object({
            issuer_type: z.string().nullable(),
            country_risk: z.string(),
            test_bic: z.boolean(),
            sepa_reachable: z.boolean(),
            sepa_reachable_scope: z.string(),
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
          })
          .nullable()
          .optional(),
        error: z.string().optional(),
        error_detail: z.string().optional(),
        cost_usdc: z.number().describe('What THIS IBAN was billed. Zero on the free MCP tier.'),
        list_price_usdc: z
          .number()
          .optional()
          .describe('Catalogue price per IBAN on the paid REST/x402 route.'),
      }),
    )
    .describe('One result per input IBAN, in the same order. Same shape as validate_iban.'),
  count: z.number().describe('Number of IBANs processed.'),
};

const LOOKUP_BIC_OUTPUT_SCHEMA = {
  bic: z.string().describe('Echo of the input, normalized to uppercase.'),
  bic8: z.string().optional().describe('8-char form (institution-level).'),
  bic11: z.string().optional().describe('11-char form including branch.'),
  valid_format: z.boolean().optional(),
  found: z.boolean().optional(),
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
      'DEPRECATED since 1.4.0, removed no earlier than 2027-01-01. Use country.name, which falls back to the code rather than to null.',
    ),
  country: z
    .object({ code: z.string(), name: z.string() })
    .optional()
    .describe(
      'Same shape as REST GET /v1/bic/:code. name falls back to the country code when the row carries no name.',
    ),
  city: z.string().nullable().optional(),
  branch_code: z.string().optional(),
  branch_info: z.string().nullable().optional(),
  lei: z
    .string()
    .nullable()
    .optional()
    .describe('Legal Entity Identifier (ISO 17442) if available.'),
  lei_status: z.string().nullable().optional(),
  is_test_bic: z.boolean().optional(),
  valid: z.boolean().optional().describe('Set when the BIC failed format validation.'),
  error: z.string().optional(),
};

const CHECK_COMPLIANCE_OUTPUT_SCHEMA = {
  iban: z.string(),
  valid: z.boolean(),
  country: z.object({ code: z.string(), name: z.string() }).optional(),
  bic: z
    .object({
      code: z.string(),
      bank_name: z.string().nullable(),
      city: z.string().nullable(),
      basis: BIC_BASIS_SCHEMA,
      authoritative: BIC_AUTHORITATIVE_SCHEMA,
    })
    .nullable()
    .optional(),
  issuer: z.object({ type: z.string(), name: z.string(), classification: z.string() }).optional(),
  sepa: z
    .object({
      member: z.boolean(),
      schemes: z.array(z.string()),
      vop_required: z.boolean(),
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
      sources: z.string().optional(),
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
} satisfies Record<string, z.ZodRawShape>;
