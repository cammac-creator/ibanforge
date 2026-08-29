/**
 * The JSON Schema fragment describing `bank_code_check`, written once.
 *
 * It is served from three places that a machine may read before it ever calls
 * the API — the OpenAPI document, the x402 payment-required body, and the MCP
 * tool contracts — and the whole point of the field is that a caller knows which
 * of three states it is in. Three hand-copied descriptions would drift, and a
 * drifted description here is worse than none: it would tell an agent it may
 * treat a miss as non-existence in a country where it may not.
 */
export const BANK_CODE_CHECK_SCHEMA = {
  type: 'object' as const,
  description:
    'Separate verdict on the BBAN bank code. `valid` answers ISO 13616 (structure + mod-97) and says nothing about whether the bank code identifies an institution; this field answers that, and states how much weight the answer carries. Present only when the IBAN is valid.',
  properties: {
    value: {
      type: 'string',
      description:
        'The bank code that was actually checked. Normally identical to bban.bank_code. It differs in Finland, where the monetary institution code is 1 to 4 characters depending on its leading digits while bban.bank_code stays the fixed positional slice: a Nordea IBAN carries bban.bank_code "123" and value "1". When they differ, this field is the one the verdict is about.',
    },
    status: {
      type: 'string',
      enum: ['verified', 'not_in_register', 'unavailable'],
      description:
        'verified: resolves to an institution we can name. not_in_register: it does not, in reference data we do hold for this country — actionable as non-existence ONLY when authoritative is true. unavailable: we hold no reference data for this country, so no opinion.',
    },
    reason: {
      type: 'string',
      enum: [
        'not_allocated',
        'absent_from_reference_data',
        'no_reference_data_for_country',
        'register_names_no_holder',
        'national_register_unavailable',
        'lookup_failed',
      ],
      description:
        'WHY the verdict is not verified, as one token to branch on. Present on every not_in_register and every unavailable; absent on verified. ' +
        'not_allocated: a national register denies the code — the only value that licenses "do not send", and it appears only with authoritative true. ' +
        'absent_from_reference_data: our composite map does not carry it, which says nothing about the country\'s own register because we did not consult one. ' +
        'no_reference_data_for_country: we hold nothing at all for this country. ' +
        'register_names_no_holder: the national register defines this code space and publishes no holder for it — silence, not a denial. ' +
        'national_register_unavailable: the country HAS a register we normally decide against and it could not be consulted for this call, so the verdict beside it comes from the composite map and carries composite weight. ' +
        'lookup_failed: the reference lookup could not run at all (timeout, unreadable database, missing table). ' +
        'The last two describe US, never your beneficiary: neither is evidence about the account, and neither may be escalated into a refusal.',
    },
    match: {
      type: ['string', 'null'],
      enum: ['register', 'prefix', null],
      description:
        'register: exact key in the reference set, deterministic. prefix: the bic8 LIKE fallback, reachable only in the 30 countries whose bank code may open on a letter (a BIC8 always does) — check candidates.',
    },
    register: {
      type: ['string', 'null'],
      description:
        'Name of the reference set consulted. For LV and GI it names a published structural rule instead — Latvijas Banka and the Gibraltar Financial Services Commission (Guidance Note 07) both publish that IBAN positions 5-8 ARE the first four characters of the institution\'s BIC. That is a documented rule rather than our own assembly, but it says how to READ the IBAN, not that the BIC it points at was allocated, so authoritative stays false.',
    },
    authoritative: {
      type: 'boolean',
      description:
        'True only where that reference set is the national register: today CH and LI against the SIX BankMaster, DE against the Bundesbank Bankleitzahlendatei, FI against the Finance Finland monetary institution list, AT against the Oesterreichische Nationalbank SEPA-Zahlungsverkehrs-Verzeichnis, BE against the Banque nationale de Belgique bank identification codes, and BG against the Bulgarian National Bank BAE register. This is the flag to branch on: everywhere else an absence is evidence of absence from our data, not of non-existence. Two asymmetries worth knowing: FI allocates prefixes to banking groups rather than to institutions, so a Finnish verified confirms the group and its BIC rather than one specific bank; and a Bulgarian BAE code covers IBAN positions 5-12 (bank code AND branch digits) while the verdict is made on the four-letter bank code alone, because the register does not enumerate every bank branch to one standard. The negative direction carries full weight in all seven.',
    },
    candidates: {
      type: 'integer',
      description:
        'BIC8 the search matched. Present for match=prefix, and for the LV/GI structural rule when the published rule alone leaves more than one BIC8 standing. Greater than 1 means the returned BIC is one of several and may belong to a different institution than the account does.',
    },
    retired: {
      type: 'boolean',
      description:
        'Present and true when an authoritative register marks the code for deletion: the institution is being retired. The code WAS allocated, so this is a verified result, not a denial. See superseded_by.',
    },
    superseded_by: {
      type: 'string',
      description: 'The bank code that takes over, when the register names one. Re-paper the beneficiary against it.',
    },
    institution: {
      type: 'object',
      description:
        'What the national register publishes about the allocated institution. Present only on an authoritative answer — composite-map hits stay bare (naming a BIC holder is the bic block, and its address would imply a register that was not consulted). Depth varies by register: SIX (CH/LI) and the OeNB (AT) publish the full seat address, the Bundesbank (DE) publishes postal code and town only, the Banque nationale de Belgique (BE) and the Bulgarian National Bank (BG) publish names alone; Finland stays without this block, its codes belong to banking groups. Names are served exactly as the register writes them, which for BG means Cyrillic — transliterating would be an alteration its terms forbid. Absent fields are null, never guessed. This is the institution allocated the BANK CODE — not a branch, and not proof of any account.',
      properties: {
        name: { type: 'string' },
        street: {
          type: ['string', 'null'],
          description: 'One line, house number included, matching the GLEIF shape. Null where the register publishes none (DE, BE).',
        },
        post_code: { type: ['string', 'null'] },
        town: { type: ['string', 'null'] },
        country: { type: 'string' },
        lei: {
          type: ['string', 'null'],
          description: 'Legal Entity Identifier, where the register publishes one (the OeNB does, 99% of entries).',
        },
      },
      required: ['name', 'street', 'post_code', 'town', 'country'],
    },
    as_of: {
      type: 'string',
      description:
        'Year-month the consulted reference set was last refreshed. Where the register publishes an effective date of its own it is that date, not ours: the Bulgarian BAE register is republished on request rather than on a calendar, so dating it with our monthly refresh would overstate how current it is.',
    },
  },
  required: ['value', 'status', 'match', 'register', 'authoritative', 'as_of'],
};

export const NEXT_STEPS_SCHEMA = {
  type: 'array' as const,
  description:
    'Ordered advice derived from THIS result: what blocks a payment first, what merely enriches it after. Branch on `code`, never on the prose. Absent or empty for an IBAN that failed validation, since the error already says what to do.',
  items: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'Stable identifier. Today: bank_code_not_allocated (the national register denies the code, do not send), bank_code_retired (allocated but being withdrawn, re-paper against superseded_by), verify_payee_name (we cannot confirm it, treat as unavailable and let a name check decide), bic_is_advisory (the BIC was picked from several candidates), issuer_not_a_known_iban_issuer (the code resolves to a BIC, but its holder is not among the providers known to issue IBANs in that country), test_bic, expect_virtual_iban (curated non-bank issuer, account holder and IBAN holder often differ), screen_compliance, generate_payment_qr (partner handoff to PayQR on a register-confirmed SEPA account: generate and self-check a SPAYD or EPC/GiroCode payment QR).',
      },
      do: { type: 'string', description: 'The instruction, in one sentence an agent can relay to a person.' },
      because: { type: 'string', description: 'The field of this response that produced the step, so the advice is auditable.' },
      action: { type: 'string', description: 'The call that performs the step, when one exists: an IBANforge endpoint, or the partner site for a partner handoff.' },
    },
    required: ['code', 'do', 'because'],
  },
};

/**
 * The JSON Schema fragment describing `official_identity`, written once.
 *
 * Same reasoning as BANK_CODE_CHECK_SCHEMA above: the field appears on two
 * endpoints, and a hand-copied second description would drift. Here drift would
 * be worse than usual — the description is where a caller learns that this block
 * is informational and carries licence conditions, and a copy that lost either
 * point would invite exactly the reading both publishers forbid.
 */
export const OFFICIAL_IDENTITY_SCHEMA = {
  type: 'object' as const,
  description:
    'The official identity a central bank publishes for the institution behind the code we resolved: legal name, LEI, registered address, and the publisher\'s own category. ' +
    'Sources: the European Central Bank\'s daily list of monetary financial institutions (reached by LEI, and by the five-digit French code banque, which is what a French RIAD code contains), and the Banco de España\'s list of Spanish MFIs (reached by the four-digit supervisory code it publishes bare). ' +
    'PURELY INFORMATIONAL. It never changes `valid` and never changes `bank_code_check` — neither publisher allocates bank codes, both relay what national authorities report, and the Banco de España\'s terms forbid presenting its data as having legal or evidentiary effect. ' +
    'Present only on a match: an institution absent from a list produces no block at all, never a negative one, because absence from these lists is not evidence about the institution. ' +
    'Both publishers permit this reuse on conditions that travel with the data, which is why `source`, `free_of_charge` and `as_of` are always present.',
  properties: {
    name: { type: 'string', description: 'The institution\'s name as the publisher writes it. May differ from `institution` / `bic.bank_name`, which come from the BIC directory — both are served so the two can be compared rather than one silently overwriting the other.', example: 'Alpha Bank Example, S.A.' },
    lei: { type: ['string', 'null'], description: 'Null where the publisher lists none, which is common for money market funds and branches.' },
    address: { type: ['string', 'null'], description: 'One-line registered address as published. Null when the publisher gives none.' },
    category: { type: 'string', description: 'The publisher\'s classification.', example: 'Credit Institution' },
    matched_by: {
      type: 'string',
      enum: ['lei', 'national_code'],
      description: 'lei: joined on the LEI the resolved BIC row carries — exact, and unscoped by country because a legal identity does not change with which of an entity\'s BICs was asked about. national_code: joined on the bank code the publisher itself publishes (FR five digits, ES four digits).',
    },
    source: { type: 'string', description: 'The publisher, cited as both licences require.', example: 'European Central Bank, list of monetary financial institutions (free at ecb.europa.eu)' },
    free_of_charge: {
      type: 'string',
      description: 'Both publishers require that buyers of a product incorporating their data be told, on EVERY access, that the information is available free of charge from the publisher\'s own website. This API is sold, so that notice ships inside every block rather than living on a documentation page.',
    },
    attribution: {
      type: 'string',
      description: 'The citation formula the Banco de España requires, reproduced verbatim. Spanish blocks only — the ECB asks to be cited as the source, which `source` does.',
      example: 'Own elaboration based on data from the Banco de España website (www.bde.es)',
    },
    as_of: {
      type: 'string',
      format: 'date',
      description: 'Date of the list this row came from, read from the published file and never from a clock. Both lists are republished every business day.',
    },
    authoritative: {
      type: 'boolean',
      enum: [false],
      description: 'Always false. Both publishers relay; neither allocates bank codes, and the attribution of a code remains the national authority\'s. Read `bank_code_check.authoritative` for the verdict that can be branched on.',
    },
  },
  required: ['name', 'lei', 'address', 'category', 'matched_by', 'source', 'free_of_charge', 'as_of', 'authoritative'],
};

/**
 * The JSON Schema fragment describing `postal_address`, written once for the
 * two surfaces that serve it (`/v1/bic/:code` and the `bic` block of
 * `/v1/iban/validate`).
 *
 * The description carries the one thing a machine must not get wrong: `strt_nm`
 * and `bldg_nb` appear ONLY when the source publishes them apart, so their
 * absence means "the source gave one concatenated line", never "this
 * institution has no street".
 */
export const POSTAL_ADDRESS_SCHEMA = {
  type: 'object' as const,
  description:
    'The institution seat expressed as an ISO 20022 PostalAddress, for the November 2026 structured-address rules (SPS 2026 in force 14 Nov 2026, Fedwire production 16 Nov 2026, T2 R2026.NOV). Purely additive — the `address` block beside it is unchanged and keeps the full untruncated street. Present only when TwnNm and Ctry can both be filled; absent fields are absent, never guessed.',
  properties: {
    strt_nm: {
      type: 'string',
      description:
        'StrtNm. Present ONLY when the source really separates street from number — in practice the SIX BankMaster register for Swiss and Liechtenstein institutions. Its absence means the source published one concatenated line (which is then served as adr_line), NOT that the institution has no street.',
    },
    bldg_nb: { type: 'string', description: 'BldgNb. Same condition as strt_nm — never split out of a joined line.' },
    pst_cd: { type: 'string', description: 'PstCd.' },
    twn_nm: { type: 'string', description: 'TwnNm. Mandatory in SPS and Fedwire; always present when this block is.' },
    ctry: { type: 'string', description: 'Ctry, ISO 3166-1 alpha-2.', example: 'CH' },
    adr_line: {
      type: 'array',
      items: { type: 'string', maxLength: 70 },
      maxItems: 2,
      description:
        'AdrLine, at most 2 lines of at most 70 characters, never repeating a value already served in a structured element above. A concatenated street line goes here rather than into strt_nm. Omitted rather than truncated when the line cannot fit in two lines — the full line stays in the `address` block.',
    },
    format: {
      type: 'string',
      enum: ['structured', 'hybrid'],
      description:
        'structured: every element served has its own ISO 20022 element, no AdrLine. hybrid: structured elements plus at most two AdrLine. Derived from the block, so it cannot disagree with the fields it labels.',
    },
    source: {
      type: 'string',
      description: 'The dataset this address came from, named as its publisher names it. It can differ from `address.source`: a Swiss institution is served from the SIX register while `address` stays GLEIF.',
      example: 'SIX BankMaster (Swiss IID register)',
    },
    as_of: {
      type: ['string', 'null'],
      description:
        'When the SOURCE last stated this address (a SIX validity date, a GLEIF filing date). Null when the dataset publishes none — never a clock read, and never the date our database was refreshed.',
    },
  },
  required: ['twn_nm', 'ctry', 'format', 'source', 'as_of'],
};
