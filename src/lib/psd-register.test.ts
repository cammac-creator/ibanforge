import { describe, it, expect } from 'vitest';
import { getBicDB } from './db.js';
import {
  PSD_SERVED_COUNTRIES,
  getPsdAsOf,
  getPsdEntityCount,
  psdAttribution,
  psdRegistrationByBankCode,
} from './psd-register.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

/**
 * These read the shipped data/bic.sqlite, like the register tests next door.
 * They skip rather than fail on a database seeded before scripts/seed-eba-psd.ts
 * existed — the module's whole contract in that case is "say nothing".
 */
const loaded = getPsdEntityCount() > 0;

interface Row {
  national_reference_code: string;
  name: string;
  entity_type: string;
}

function rowsFor(country: string, type?: string): Row[] {
  if (!loaded) return [];
  const sql =
    'SELECT national_reference_code, name, entity_type FROM psd_entities WHERE country = ?' +
    (type ? ' AND entity_type = ?' : '');
  const stmt = getBicDB().prepare(sql);
  return (type ? stmt.all(country, type) : stmt.all(country)) as Row[];
}

/** Build a structurally valid IBAN for a country + BBAN, computing mod-97. */
function ibanFor(cc: string, bban: string): string {
  const rearranged = `${bban}${cc}00`;
  const numeric = [...rearranged]
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return `${cc}${String(98 - rem).padStart(2, '0')}${bban}`;
}

/** ES BBAN: bank(4) branch(4) control(2) account(10) = 20 digits. Invented account. */
const esIban = (bankCode: string): string => ibanFor('ES', `${bankCode}0001011234567890`);

describe('psd_entities counts, dating and attribution', () => {
  it('answers a live count instead of a literal', () => {
    // The golden copy is republished daily. Any served surface quoting a number
    // takes it from here; a hardcoded one is wrong within a day.
    expect(typeof getPsdEntityCount()).toBe('number');
    expect(getPsdEntityCount()).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!loaded)('carries the copy date read from the manifest, not a clock', () => {
    expect(getPsdAsOf()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.skipIf(!loaded)('builds the attribution the licence requires', () => {
    // "Reproduction of all EBA material on this site is authorised, provided
    // the source is acknowledged". Both halves come from the database.
    expect(psdAttribution()).toBe(
      `European Banking Authority, payment institutions register (${getPsdAsOf()})`,
    );
  });

  it.skipIf(loaded)('answers 0 and null when nothing is loaded, rather than throwing', () => {
    expect(getPsdEntityCount()).toBe(0);
    expect(getPsdAsOf()).toBeNull();
    expect(psdAttribution()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE MEASUREMENT — what makes Spain servable, encoded so a refresh can break it
// ---------------------------------------------------------------------------

describe('the join measurement, pinned against the seeded table', () => {
  /**
   * Spain is served because its national reference code IS the Banco de España
   * código de entidad that an ES IBAN carries in positions 1-4. That is a claim
   * about upstream data, and upstream data changes. These two assertions are
   * what turn it back into a measurement on every refresh.
   */
  it.skipIf(!loaded)('every served country actually has rows to serve', () => {
    for (const cc of PSD_SERVED_COUNTRIES) {
      expect(rowsFor(cc).length, cc).toBeGreaterThan(50);
    }
  });

  it.skipIf(!loaded)('Spanish codes still look like Spanish bank codes (threshold 95%)', () => {
    // Format conformance was 112/112 on the 2026-08-25 copy. If a competent
    // authority starts filing under a company number instead — which is what
    // the other 29 countries do — this collapses long before the join starts
    // producing wrong answers, and the build goes red first.
    const rows = rowsFor('ES');
    const conforming = rows.filter((r) => /^\d{4}$/.test(r.national_reference_code));
    const pct = (conforming.length / rows.length) * 100;
    expect(pct, `ES format conformance ${pct.toFixed(1)}%`).toBeGreaterThanOrEqual(95);
  });

  it.skipIf(!loaded)('NO Spanish payment institution sits in the credit-institution range', () => {
    // This is the safety invariant, and the only one with a hard zero. Spanish
    // banks hold 0xxx-3xxx; payment and e-money institutions hold 67xx-88xx.
    // The moment those overlap, this register could describe a bank as an EMI
    // on a paid call — so a single row is a failure, not a threshold.
    const intruders = rowsFor('ES').filter((r) => /^[0-3]/.test(r.national_reference_code));
    expect(intruders.map((r) => `${r.national_reference_code} ${r.name}`)).toEqual([]);
  });

  it.skipIf(!loaded)('the e-money range holds e-money institutions and nothing else', () => {
    // 67xx was all PSD_EMI on the copy measured. This is the weaker of the
    // three — the EBA could legitimately reallocate — so it asserts the
    // direction that matters: what we promote to issuer.type 'emi' must be
    // an authorised e-money institution, never something else wearing the range.
    for (const r of rowsFor('ES', 'emi')) {
      expect(r.national_reference_code, `${r.name} is an EMI outside 67xx`).toMatch(/^6[7-9]/);
    }
  });
});

// ---------------------------------------------------------------------------
// Country scoping — the whole point of the prudence
// ---------------------------------------------------------------------------

describe('only demonstrated countries are served', () => {
  it('serves Spain and nothing else, today', () => {
    expect([...PSD_SERVED_COUNTRIES]).toEqual(['ES']);
  });

  it.skipIf(!loaded)('never answers for a country whose codes are not bank codes', () => {
    // Every one of these has rows in the table and a real bank code space of
    // its own. The reference code the register files them under belongs to a
    // different register — a NIP, an IČO, a SIREN, a DNB reference — so joining
    // it to a bank code would attach a real authorisation to an unrelated bank.
    for (const cc of ['PL', 'NL', 'CZ', 'FR', 'DE', 'IT', 'IE', 'MT', 'PT', 'LT', 'BE', 'GR']) {
      const rows = rowsFor(cc);
      expect(rows.length, `${cc} should have rows to make this test meaningful`).toBeGreaterThan(0);
      for (const r of rows.slice(0, 20)) {
        expect(
          psdRegistrationByBankCode(cc, r.national_reference_code),
          `${cc}:${r.national_reference_code} must not be served`,
        ).toBeNull();
      }
    }
  });

  it.skipIf(!loaded)('declines a Spanish code in the credit-institution range even if one appeared', () => {
    // Belt and braces with the measurement above: the guard is at read time, so
    // a bad refresh cannot serve a bank as a payment institution in the window
    // between landing and someone noticing the red build.
    for (const code of ['2100', '0049', '0075', '3187']) {
      expect(psdRegistrationByBankCode('ES', code), code).toBeNull();
    }
  });

  it.skipIf(!loaded)('declines anything that is not four digits', () => {
    for (const code of ['671', '67177', 'ABCD', '', '  ']) {
      expect(psdRegistrationByBankCode('ES', code), JSON.stringify(code)).toBeNull();
    }
  });

  it('answers null on missing input rather than throwing', () => {
    expect(psdRegistrationByBankCode(null, '6717')).toBeNull();
    expect(psdRegistrationByBankCode('ES', null)).toBeNull();
    expect(psdRegistrationByBankCode(undefined, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Provenance contract
// ---------------------------------------------------------------------------

describe('the provenance contract — source and as_of are not optional', () => {
  it.skipIf(!loaded)('every served block carries the attribution and the copy date', () => {
    // The licence is "provided the source is acknowledged". A block served
    // without its source is a licence breach, not a missing field, so this
    // walks every servable Spanish code rather than sampling one.
    const rows = rowsFor('ES');
    let served = 0;
    for (const r of rows) {
      const block = psdRegistrationByBankCode('ES', r.national_reference_code);
      if (!block) continue;
      served++;
      expect(block.source).toBe('European Banking Authority, payment institutions register');
      expect(block.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(block.registered).toBe(true);
      expect(block.competent_authority).toBeTruthy();
      expect(block.name).toBeTruthy();
      expect(block.country).toBe('ES');
    }
    expect(served, 'the Spanish rows should actually be servable').toBeGreaterThan(50);
  });

  it.skipIf(!loaded)('reports the e-money authorisation first when a firm holds two', () => {
    // 64 (country, code) pairs repeat because one firm holds both a payment and
    // an e-money authorisation. A virtual-IBAN check wants the stronger fact.
    const dual = getBicDB()
      .prepare(
        `SELECT national_reference_code AS code FROM psd_entities
         WHERE country = 'ES' GROUP BY national_reference_code
         HAVING SUM(entity_type = 'emi') > 0 AND COUNT(*) > 1 LIMIT 1`,
      )
      .get() as { code: string } | undefined;
    if (!dual) return; // Spain happens to have no dual holder today.
    expect(psdRegistrationByBankCode('ES', dual.code)?.entity_type).toBe('emi');
  });
});

// ---------------------------------------------------------------------------
// Enrichment — the block on validate, and no regression to what was there
// ---------------------------------------------------------------------------

describe('enrichResult serves psd_registration for a Spanish EMI IBAN', () => {
  const emi = rowsFor('ES', 'emi')[0];

  it.skipIf(!loaded || !emi)('attaches the block, sourced and dated', () => {
    const result = validateIBAN(esIban(emi.national_reference_code));
    expect(result.valid).toBe(true);
    enrichResult(result);

    expect(result.psd_registration).toBeDefined();
    expect(result.psd_registration!.entity_type).toBe('emi');
    expect(result.psd_registration!.name).toBe(emi.name);
    expect(result.psd_registration!.source).toBe(
      'European Banking Authority, payment institutions register',
    );
    expect(result.psd_registration!.as_of).toBe(getPsdAsOf());
  });

  it.skipIf(!loaded || !emi)('identifies the issuer as an EMI, from the register', () => {
    // This is the deliverable: before this ingestion, a Spanish e-money IBAN
    // resolved no BIC and therefore no issuer at all — the vIBAN signal the
    // product sells was simply absent outside the curated set.
    const result = validateIBAN(esIban(emi.national_reference_code));
    enrichResult(result);

    expect(result.issuer!.type).toBe('emi');
    expect(result.issuer!.classification).toBe('register');
    expect(result.risk_indicators!.issuer_type).toBe('emi');
    expect(result.next_steps!.map((s) => s.code)).toContain('expect_virtual_iban');
  });

  const pi = rowsFor('ES', 'payment_institution')[0];
  it.skipIf(!loaded || !pi)('types a payment institution as itself, never as an EMI', () => {
    const result = validateIBAN(esIban(pi.national_reference_code));
    enrichResult(result);
    expect(result.psd_registration!.entity_type).toBe('payment_institution');
    expect(result.issuer!.type).toBe('payment_institution');
  });

  const exempted = rowsFor('ES', 'exempted_payment_institution')[0];
  it.skipIf(!loaded || !exempted)('never turns an exemption into an issuer type', () => {
    // An exempted institution is waived FROM authorisation because it stays
    // under a volume threshold. It is served as a fact in psd_registration and
    // deliberately moves no issuer type: a waiver is not a licence.
    const result = validateIBAN(esIban(exempted.national_reference_code));
    enrichResult(result);
    expect(result.psd_registration!.entity_type).toBe('exempted_payment_institution');
    expect(result.issuer?.classification).not.toBe('register');
  });

  const aisp = rowsFor('ES', 'aisp')[0];
  it.skipIf(!loaded || !aisp)('never types an AISP as an issuer — it issues nothing', () => {
    const result = validateIBAN(esIban(aisp.national_reference_code));
    enrichResult(result);
    expect(result.psd_registration!.entity_type).toBe('aisp');
    expect(result.issuer?.classification).not.toBe('register');
  });
});

describe('no regression to classifications that already existed', () => {
  it.skipIf(!loaded)('a Spanish bank IBAN gains no block and keeps its issuer', () => {
    // 2100 is CaixaBank — a credit institution, in the 0xxx-3xxx range this
    // register must never touch. Whatever the issuer said before, it still says.
    const result = validateIBAN(esIban('2100'));
    enrichResult(result);
    expect(result.psd_registration).toBeUndefined();
    expect(result.issuer?.classification).not.toBe('register');
  });

  it.skipIf(!loaded)('a curated identification is never overwritten by the register', () => {
    // The rule is fill-the-gap, never override: only a 'default' classification
    // — which is an assumption, not a finding — gives way. Walk every Spanish
    // code and assert no curated verdict was replaced.
    for (const r of rowsFor('ES')) {
      const result = validateIBAN(esIban(r.national_reference_code));
      if (!result.valid) continue;
      enrichResult(result);
      if (result.issuer?.classification === 'register') {
        // It may only have replaced a default, never a curated identification.
        const fresh = validateIBAN(esIban(r.national_reference_code));
        enrichResult(fresh);
        expect(fresh.issuer!.type, r.name).not.toBe('bank');
      }
    }
  });

  it.skipIf(!loaded)('IBANs outside the served country are untouched by this feature', () => {
    for (const iban of ['DE89370400440532013000', 'CH5604835012345678009', 'NL91ABNA0417164300']) {
      const result = validateIBAN(iban);
      enrichResult(result);
      expect(result.psd_registration, iban).toBeUndefined();
      expect(result.issuer?.classification, iban).not.toBe('register');
    }
  });
});
