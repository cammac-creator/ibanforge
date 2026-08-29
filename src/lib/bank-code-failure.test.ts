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

const failing = {
  lookup: false,
  referenceData: false,
  noData: false,
  deRegister: false,
  bgRegister: false,
  nationalRegister: false,
};

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
      if (failing.noData) return false;
      return actual.countryHasReferenceData(cc);
    },
  };
});

// The German register is loaded from a table the Dockerfile is allowed to build
// without: a database made before the seeder existed has no `de_blz`. Germany
// then degrades to the composite map, and the answer that comes back is a
// composite answer wearing no sign of it.
vi.mock('./de-blz.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./de-blz.js')>();
  return {
    ...actual,
    blzRegisterAvailable: () => (failing.deRegister ? false : actual.blzRegisterAvailable()),
    lookupBlz: (blz: string) => (failing.deRegister ? null : actual.lookupBlz(blz)),
  };
});

// Bulgaria and Austria/Belgium are authoritative: a swallowed failure there
// once became not_in_register + not_allocated — "do not send" — about the
// Bulgarian central bank's own code (29/08/2026 adversarial review, reproduced
// by overwriting the table's root page). The lookups now throw; these mocks
// are that broken read.
vi.mock('./bg-bae.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bg-bae.js')>();
  return {
    ...actual,
    lookupBgBankCode: (code: string) => {
      if (failing.bgRegister) throw new Error('SqliteError: database disk image is malformed');
      return actual.lookupBgBankCode(code);
    },
  };
});

vi.mock('./national-registers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./national-registers.js')>();
  return {
    ...actual,
    lookupNationalCode: (cc: string, code: string) => {
      if (failing.nationalRegister) throw new Error('SqliteError: database disk image is malformed');
      return actual.lookupNationalCode(cc, code);
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
  failing.noData = false;
  failing.deRegister = false;
  failing.bgRegister = false;
  failing.nationalRegister = false;
});

describe('an unreadable reference set is reported, never ruled on', () => {
  it('is the baseline it has to differ from: a real miss still says not_in_register', () => {
    expect(check(FABRICATED_FR).bank_code_check!.status).toBe('not_in_register');
  });

  it('answers unavailable when the bank-code lookup itself raises', () => {
    failing.lookup = true;
    const r = check(FABRICATED_FR);
    expect(r.bank_code_check!.status).toBe('unavailable');
    expect(r.bank_code_check!.reason).toBe('lookup_failed');
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
    expect(r.bank_code_check!.reason).toBe('lookup_failed');
    expect(r.bank_code_check!.register).toBeNull();
  });

  it('says the national register was unavailable rather than blaming our map', () => {
    // Germany decides against the Bundesbank table, which the image is allowed
    // to build without. Falling back to the composite map is the right
    // behaviour and the status stays what a composite miss has always been —
    // but "absent from our reference data" would describe a consultation that
    // never happened. One token separates the degradation from the finding.
    failing.deRegister = true;
    const r = check('DE44999999990532013000');
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.authoritative).toBe(false);
    expect(r.bank_code_check!.reason).toBe('national_register_unavailable');
  });

  it('keeps no_reference_data_for_country for a country we really hold nothing for', () => {
    // Reachable in code, not reachable against today's database: every IBAN
    // country currently has at least one row or one curated key. Asserted
    // through the seam so the value cannot rot into a lie for the next country
    // added without data.
    failing.noData = true;
    const r = check(FABRICATED_FR);
    expect(r.bank_code_check!.status).toBe('unavailable');
    expect(r.bank_code_check!.reason).toBe('no_reference_data_for_country');
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

  it('a broken Bulgarian register read is unavailable, never an authoritative denial', () => {
    // The exact case the 29/08/2026 review reproduced with a corrupt page: the
    // table answers the availability probe, then the real query raises. On an
    // authoritative country the swallowed version of this became
    // not_in_register + not_allocated about the central bank's own code.
    failing.bgRegister = true;
    const r = check('BG80BNBG96611020345678');
    expect(r.bank_code_check!.status).toBe('unavailable');
    expect(r.bank_code_check!.reason).toBe('lookup_failed');
    expect(r.bank_code_check!.authoritative).toBe(false);
    expect(r.bic).toBeNull();
    expect(r.next_steps?.map((s) => s.code)).not.toContain('bank_code_not_allocated');
  });

  it('a broken Austrian register read is unavailable, never an authoritative denial', () => {
    failing.nationalRegister = true;
    const r = check('AT311200000012345678');
    expect(r.bank_code_check!.status).toBe('unavailable');
    expect(r.bank_code_check!.reason).toBe('lookup_failed');
    expect(r.bank_code_check!.authoritative).toBe(false);
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
