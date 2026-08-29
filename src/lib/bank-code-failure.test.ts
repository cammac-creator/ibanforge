import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A failure of ours must never come out as a refusal.
 *
 * `bank_code_check.status: 'not_in_register'` is the one verdict this API
 * publishes that a caller may act on as non-existence — on an authoritative
 * country it means "no institution holds this account, do not send". Every path
 * that produces it reads a database, so an unreadable database is one wrong
 * branch away from telling a payment engine to stop over an outage of ours.
 *
 * A regulated pilot customer made this the first of four written conditions
 * before moving an integration to production: timeouts and internal errors must
 * map to an explicit UNAVAILABLE, never to anything that reads as a decision
 * about the account. This file is that condition, asserted.
 *
 * The lookups are made to RAISE rather than to return nothing, because that is
 * the failure the guard exists for: a lookup that returns nothing lands on the
 * composite fallback, and the composite fallback used to answer
 * `not_in_register`.
 */

const failing = { lookup: false, referenceData: false };

vi.mock('./bic-lookup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bic-lookup.js')>();
  return {
    ...actual,
    lookupByCountryBank: (cc: string, bankCode: string) => {
      // The shape a corrupt or half-deployed bic.sqlite really produces.
      if (failing.lookup) throw new Error('SqliteError: no such table: bic_entries');
      return actual.lookupByCountryBank(cc, bankCode);
    },
    countryHasReferenceData: (cc: string) => {
      if (failing.referenceData) throw new Error('SqliteError: database disk image is malformed');
      return actual.countryHasReferenceData(cc);
    },
  };
});

const { enrichResult } = await import('./enrich.js');
const { validateIBAN } = await import('./iban.js');

function check(iban: string) {
  const r = validateIBAN(iban);
  enrichResult(r);
  return r;
}

// Valid mod-97, fabricated bank code: without a failure it is the canonical
// `not_in_register` answer, which is exactly what must not survive one.
const FABRICATED_FR = 'FR1499999000010123456789A42';

beforeEach(() => {
  failing.lookup = false;
  failing.referenceData = false;
});

describe('an unreadable reference set is reported, never ruled on', () => {
  it('is the baseline it has to differ from: a real miss still says not_in_register', () => {
    expect(check(FABRICATED_FR).bank_code_check!.status).toBe('not_in_register');
  });

  it('answers unavailable when the bank-code lookup itself raises', () => {
    failing.lookup = true;
    const r = check(FABRICATED_FR);
    expect(r.bank_code_check!.status).toBe('unavailable');
    // No register may be cited for a consultation that did not happen.
    expect(r.bank_code_check!.register).toBeNull();
    expect(r.bank_code_check!.authoritative).toBe(false);
    // The block a caller is already documented to read as "no opinion".
    expect(r.bic).toBeNull();
  });

  it('answers unavailable when the fallback that decides not_in_register raises', () => {
    // The narrower failure: the lookup answers (nothing found), and the query
    // that would decide whether we hold data for this country is the one that
    // breaks. Reaching not_in_register here would be a denial with no evidence.
    failing.referenceData = true;
    const r = check(FABRICATED_FR);
    expect(r.bank_code_check!.status).toBe('unavailable');
    expect(r.bank_code_check!.register).toBeNull();
  });

  it('still returns a whole result, so one bad row cannot take a batch of 100 down', () => {
    failing.lookup = true;
    const r = check(FABRICATED_FR);
    expect(r.valid).toBe(true);
    expect(r.country?.code).toBe('FR');
    expect(r.risk_indicators).toBeDefined();
  });

  it('routes the failure into the same advice as any other unavailable answer', () => {
    failing.lookup = true;
    const codes = check(FABRICATED_FR).next_steps?.map((s) => s.code) ?? [];
    // Not `bank_code_not_allocated`, which is the "do not send" step.
    expect(codes).toContain('verify_payee_name');
    expect(codes).not.toContain('bank_code_not_allocated');
  });

  it('keeps a national register verdict that DID answer, rather than discarding it', () => {
    // Germany decides against the Bundesbank register, which is read on its own
    // path. A composite lookup that failed beside it is not a reason to drop an
    // authoritative answer — that would trade a real verdict for a shrug.
    failing.lookup = true;
    const r = check('DE89370400440532013000');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.authoritative).toBe(true);
  });
});
