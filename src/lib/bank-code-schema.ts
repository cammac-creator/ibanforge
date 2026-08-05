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
    match: {
      type: 'string',
      nullable: true,
      enum: ['register', 'prefix', null],
      description:
        'register: exact key in the reference set, deterministic. prefix: the bic8 LIKE fallback, reachable only in the 30 countries whose bank code may open on a letter (a BIC8 always does) — check candidates.',
    },
    register: { type: 'string', nullable: true, description: 'Name of the reference set consulted.' },
    authoritative: {
      type: 'boolean',
      description:
        'True only where that reference set is the national register: today CH and LI against the SIX BankMaster, DE against the Bundesbank Bankleitzahlendatei, FI against the Finance Finland monetary institution list, AT against the Oesterreichische Nationalbank SEPA-Zahlungsverkehrs-Verzeichnis, and BE against the Banque nationale de Belgique bank identification codes. This is the flag to branch on: everywhere else an absence is evidence of absence from our data, not of non-existence. One asymmetry worth knowing: CH, LI, DE, AT and BE allocate codes to individual institutions, while FI allocates prefixes to banking groups, so a Finnish verified confirms the group and its BIC rather than one specific bank. The negative direction carries full weight in all six.',
    },
    candidates: {
      type: 'integer',
      description:
        'BIC8 the prefix search matched. Present only for match=prefix. Greater than 1 means the returned BIC is one of several and may belong to a different institution than the account does.',
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
        'What the national register publishes about the allocated institution. Present only on an authoritative answer — composite-map hits stay bare (naming a BIC holder is the bic block, and its address would imply a register that was not consulted). Depth varies by register: SIX (CH/LI) and the OeNB (AT) publish the full seat address, the Bundesbank (DE) publishes postal code and town only, the BNB (BE) publishes names alone; Finland stays without this block, its codes belong to banking groups. Absent fields are null, never guessed. This is the institution allocated the BANK CODE — not a branch, and not proof of any account.',
      properties: {
        name: { type: 'string' },
        street: {
          type: 'string',
          nullable: true,
          description: 'One line, house number included, matching the GLEIF shape. Null where the register publishes none (DE, BE).',
        },
        post_code: { type: 'string', nullable: true },
        town: { type: 'string', nullable: true },
        country: { type: 'string' },
        lei: {
          type: 'string',
          nullable: true,
          description: 'Legal Entity Identifier, where the register publishes one (the OeNB does, 99% of entries).',
        },
      },
      required: ['name', 'street', 'post_code', 'town', 'country'],
    },
    as_of: { type: 'string', description: 'Year-month the consulted reference set was last refreshed.' },
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
          'Stable identifier. Today: bank_code_not_allocated (the national register denies the code, do not send), bank_code_retired (allocated but being withdrawn, re-paper against superseded_by), verify_payee_name (we cannot confirm it, treat as unavailable and let a name check decide), bic_is_advisory (the BIC was picked from several candidates), issuer_not_a_known_iban_issuer (the code resolves to a BIC, but its holder is not among the providers known to issue IBANs in that country), test_bic, expect_virtual_iban (curated non-bank issuer, account holder and IBAN holder often differ), screen_compliance.',
      },
      do: { type: 'string', description: 'The instruction, in one sentence an agent can relay to a person.' },
      because: { type: 'string', description: 'The field of this response that produced the step, so the advice is auditable.' },
      action: { type: 'string', description: 'An IBANforge call that performs the step, when one exists.' },
    },
    required: ['code', 'do', 'because'],
  },
};
