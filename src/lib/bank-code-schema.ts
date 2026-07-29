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
    value: { type: 'string', description: 'The bank code taken from the BBAN, echoed back.' },
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
        'True only where that reference set is the national register — today CH and LI, checked against the SIX BankMaster. This is the flag to branch on: everywhere else an absence is evidence of absence from our data, not of non-existence.',
    },
    candidates: {
      type: 'integer',
      description:
        'BIC8 the prefix search matched. Present only for match=prefix. Greater than 1 means the returned BIC is one of several and may belong to a different institution than the account does.',
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
          'Stable identifier. Today: bank_code_not_allocated (the national register denies the code, do not send), verify_payee_name (we cannot confirm it, treat as unavailable and let a name check decide), bic_is_advisory (the BIC was picked from several candidates), test_bic, expect_virtual_iban (curated non-bank issuer, account holder and IBAN holder often differ), screen_compliance.',
      },
      do: { type: 'string', description: 'The instruction, in one sentence an agent can relay to a person.' },
      because: { type: 'string', description: 'The field of this response that produced the step, so the advice is auditable.' },
      action: { type: 'string', description: 'An IBANforge call that performs the step, when one exists.' },
    },
    required: ['code', 'do', 'because'],
  },
};
