import Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Turquie (18/11/2026, rang 5 du classement « données fraîches ») : la liste des
 * participants des systèmes de paiement de la TCMB (membre `register_tr` de la surcouche
 * privée, src/lib/restricted-family.ts), lue APRÈS les clés de la TBB (`map_tr`, autre
 * membre de la même surcouche).
 *
 * Les deux membres sont indépendants (`mayBeAbsent`, retrait par origine) : la matrice
 * entière est éprouvée.
 *
 * | État | Ce qui tient |
 * |---|---|
 * | aucun membre | la réponse d'avant, partout (« non consulté ») |
 * | `map_tr` seul (la production tant que la chaîne privée n'a pas construit la liste) | la réponse d'avant, partout |
 * | les deux | un code de la TBB garde sa réponse, même nommé autrement par la TCMB ; un code de la TCMB seule est nommé ; un code absent des deux garde sa réponse |
 * | `register_tr` seul (TBB retirée) | un code de la TCMB est nommé ; une absence garde la réponse d'avant |
 *
 * 🔒 Tout est INVENTÉ (codes 991xx, noms « ÖRNEK », BIC `XMPZ…`) : la liste de la TCMB
 * et les clés de la TBB sont de la case 2 de la règle du 28/10/2026 et n'entrent pas
 * dans ce dépôt public. Seule la phrase du crédit est la nôtre.
 */
const { fixture, failing } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  const { restrictedTable } = await import('./restricted-family.js');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const Db = require('better-sqlite3');
  const installed = m.installRestrictedFixture();
  const db = new Db(installed.bicPath);
  for (const sql of restrictedTable('bic', 'curated_bank_codes').ddl) db.prepare(sql).run();
  db.close();
  return { fixture: installed, failing: { lookup: false } };
});
afterAll(() => fixture.restore());

// La lecture de la carte composite peut être rendue illisible, comme dans
// bank-code-failure.test.ts : c'est le cas où la liste de la TCMB ne doit pas répondre.
vi.mock('./bic-lookup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bic-lookup.js')>();
  return {
    ...actual,
    lookupByCountryBank: (cc: string, bankCode: string) => {
      if (failing.lookup) throw new Error('SqliteError: no such table: bic_entries');
      return actual.lookupByCountryBank(cc, bankCode);
    },
  };
});

const { ibanFor } = await import('../test-support/restricted-fixtures.js');
const { validateIBAN } = await import('./iban.js');
const { COMPOSITE_REGISTER, enrichResult, registerCoverage } = await import('./enrich.js');
const { getReferenceAsOf, resetStatements } = await import('./bic-lookup.js');
const { nationalRegisterIsExhaustive, resetNationalRegisterStatements } =
  await import('./national-registers.js');
const { registerCountries } = await import('./positioning.js');
const { trRegisterName } = await import('./tr-credit.js');
const { buildComplianceResponse } = await import('./compliance-response.js');

afterEach(() => {
  failing.lookup = false;
});

/** La phrase que le seeder stocke avec chaque ligne (scripts/seed-national-tr.ts, TR_SOURCE). */
const SOURCE =
  'Central Bank of the Republic of Türkiye (TCMB), list of participants in the TCMB payment systems (TCMB Ödeme Sistemleri Katılımcıları), https://www.tcmb.gov.tr';
const READ_ON = '2099-01-15';
const TBB_CREDIT =
  'mdomke/schwifty 2099.1.0 (MIT), compiled from Türkiye Bankalar Birliği (The Banks Association of Türkiye)';

/** Un IBAN turc valide : 5 chiffres de banque, le chiffre réservé 0, 16 de compte. */
const tr = (code: string) => ibanFor('TR', `${code}0${'0000001234567890'}`);

const PROBES = {
  /** Porté par la TBB ET par la TCMB, sous un autre nom (le cas d'un changement de nom). */
  both: tr('99101'),
  /** Porté par la TBB seule. */
  tbbOnly: tr('99102'),
  /** Porté par la TCMB seule : le cas des codes demandés sans réponse. */
  tcmbOnly: tr('99103'),
  /** Porté par aucune des deux. */
  neither: tr('99104'),
} as const;
type Probe = keyof typeof PROBES;

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

/** Ce qu'une réponse dit de la banque : le verdict du code, le détenteur et le bloc BIC. */
function answer(iban: string) {
  const r = check(iban);
  return { bank_code_check: r.bank_code_check, bank_code_holder: r.bank_code_holder, bic: r.bic };
}

function write(sql: string, ...rows: unknown[][]): void {
  const db = new Database(fixture.bicPath);
  const statement = db.prepare(sql);
  for (const row of rows) statement.run(...row);
  db.close();
  resetStatements();
  resetNationalRegisterStatements();
}

const setTbb = (on: boolean) =>
  on
    ? write(
        "INSERT INTO curated_bank_codes (country, code, bic, source, as_of) VALUES ('TR', ?, ?, ?, '2099-01-02')",
        ['99101', 'XMPZTR31XXX', TBB_CREDIT],
        ['99102', 'XMPZTR32XXX', TBB_CREDIT],
      )
    : write("DELETE FROM curated_bank_codes WHERE country = 'TR'", []);

const setTcmb = (on: boolean) =>
  on
    ? write(
        `INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei, source, as_of)
         VALUES ('TR', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        ['99101', 'ÖRNEK YENİ UNVAN BANKASI A.Ş.', SOURCE, READ_ON],
        ['99103', 'ÖRNEK KATILIM BANKASI A.Ş.', SOURCE, READ_ON],
      )
    : write("DELETE FROM national_bank_codes WHERE country = 'TR'", []);

function state(tbb: boolean, tcmb: boolean): void {
  setTbb(false);
  setTcmb(false);
  if (tbb) setTbb(true);
  if (tcmb) setTcmb(true);
}

function all(): Record<Probe, ReturnType<typeof answer>> {
  return Object.fromEntries(
    (Object.keys(PROBES) as Probe[]).map((name) => [name, answer(PROBES[name])]),
  ) as Record<Probe, ReturnType<typeof answer>>;
}

const NOT_CONSULTED = {
  status: 'unavailable',
  reason: 'no_reference_data_for_country',
  register: null,
  authoritative: false,
};

describe('Turkey: the TCMB participants list, after the TBB keys (private overlay)', () => {
  it('without any overlay member: every Turkish answer is "not consulted", nothing named', () => {
    state(false, false);
    const none = all();
    for (const name of Object.keys(PROBES) as Probe[]) {
      expect(none[name].bank_code_check, name).toMatchObject(NOT_CONSULTED);
      expect(none[name].bank_code_holder, name).toBe('unknown');
      expect(none[name].bic, name).toBeNull();
    }
  });

  it('with the TBB keys only (production until the private chain builds the list): the answers of before', () => {
    state(true, false);
    const asOf = getReferenceAsOf();
    for (const name of ['both', 'tbbOnly'] as const) {
      const a = answer(PROBES[name]);
      expect(a.bank_code_check, name).toEqual({
        value: name === 'both' ? '99101' : '99102',
        status: 'verified',
        match: 'register',
        register: COMPOSITE_REGISTER,
        authoritative: false,
        as_of: asOf,
      });
      expect(a.bank_code_holder, name).toBe('inferred');
      expect(a.bic?.code, name).toBe(name === 'both' ? 'XMPZTR31XXX' : 'XMPZTR32XXX');
      expect(a.bic?.source, name).toContain('compiled from Türkiye Bankalar Birliği');
      expect(a.bic?.basis, name).toBe('curated_map');
    }
    for (const name of ['tcmbOnly', 'neither'] as const) {
      const r = check(PROBES[name]);
      expect(r.bank_code_check, name).toMatchObject({
        status: 'not_in_register',
        reason: 'absent_from_reference_data',
        register: COMPOSITE_REGISTER,
        authoritative: false,
      });
      expect(r.bank_code_holder, name).toBe('unknown');
      // « ne nommait pas » : aucun autre bloc de la réponse ne nomme d'établissement.
      expect(r.bank_code_check?.institution, name).toBeUndefined();
      expect(r.bic, name).toBeNull();
      expect(r.official_identity ?? null, name).toBeNull();
      expect(JSON.stringify(r), name).not.toMatch(/ÖRNEK|TCMB/);
    }
  });

  it('with both members: a TBB code keeps its answer, a TCMB-only code is named, a code in neither keeps its answer', () => {
    state(true, false);
    const before = all();
    state(true, true);
    const after = all();
    // (a) La clé de la TBB gagne, même là où la TCMB écrit un autre nom.
    expect(after.both).toEqual(before.both);
    expect(after.tbbOnly).toEqual(before.tbbOnly);
    expect(JSON.stringify(after.both)).not.toContain('ÖRNEK YENİ UNVAN');
    // (c) Absent des deux : la réponse d'avant, jamais un refus.
    expect(after.neither).toEqual(before.neither);
    expect(after.neither.bank_code_check?.reason).not.toBe('not_allocated');
    // (b) La TCMB seule nomme : vérifié, sans autorité, sans BIC.
    expect(after.tcmbOnly.bank_code_check).toEqual({
      value: '99103',
      status: 'verified',
      match: 'register',
      register: trRegisterName(SOURCE, READ_ON),
      authoritative: false,
      institution: {
        name: 'ÖRNEK KATILIM BANKASI A.Ş.',
        street: null,
        post_code: null,
        town: null,
        country: 'TR',
      },
      as_of: '2099-01',
    });
    expect(after.tcmbOnly.bank_code_holder).toBe('confirmed');
    expect(after.tcmbOnly.bic).toBeNull();
    const register = after.tcmbOnly.bank_code_check?.register ?? '';
    expect(register).toMatch(/^Source: Central Bank of the Republic of Türkiye \(TCMB\)/);
    expect(register).toContain(`(read by IBANforge on ${READ_ON})`);
    expect(register).toContain('Partial list:');
    expect(register).toContain('so an absence is not a non-allocation');
    expect(register).toContain('the list gives no BIC');
    expect(register).not.toMatch(/national register|official|complete/i);
    expect(check(PROBES.tcmbOnly).checks?.bank_code).toBe('pass');
  });

  it('with the TCMB list only (TBB keys withdrawn): the list names its codes, an absence keeps the answer of before', () => {
    state(false, false);
    const none = all();
    state(false, true);
    const listOnly = all();
    for (const name of ['both', 'tcmbOnly'] as const) {
      expect(listOnly[name].bank_code_check?.status, name).toBe('verified');
      expect(listOnly[name].bank_code_check?.authoritative, name).toBe(false);
      expect(listOnly[name].bank_code_holder, name).toBe('confirmed');
      expect(listOnly[name].bic, name).toBeNull();
    }
    expect(listOnly.both.bank_code_check?.institution?.name).toBe('ÖRNEK YENİ UNVAN BANKASI A.Ş.');
    for (const name of ['tbbOnly', 'neither'] as const) {
      expect(listOnly[name], name).toEqual(none[name]);
      expect(listOnly[name].bank_code_check?.reason, name).not.toBe('not_allocated');
    }
  });

  it('when the composite map cannot be read, the list does not answer in its place', () => {
    state(true, true);
    failing.lookup = true;
    const r = check(PROBES.tcmbOnly);
    expect(r.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'lookup_failed',
      authoritative: false,
    });
    expect(r.bank_code_check?.institution).toBeUndefined();
    expect(r.bic).toBeNull();
  });

  // La route payante de conformité recopie la validation. Le code que la TCMB seule nomme,
  // dans les QUATRE états des deux membres, liste chargée ou non (« avant » et « après ») :
  // - clés de la TBB servies : la liste ne répond qu'après elles ; le code passe de « non
  //   confirmé » à « confirmé », `bank_code_unverified` (+10) tombe, comme pour les autres
  //   listes sans BIC (20 → 10, `medium` → `low`) ;
  // - aucune clé de la TBB servie (membre absent ou retiré) : la liste répond seule, et le
  //   plancher `bank_code_data_unavailable` reste (décision du 18/11/2026, relecture de la
  //   PR 645) : score et niveau ne bougent pas (50, `elevated`).
  // Sans BIC, l'établissement n'est jamais confronté aux listes de sanctions
  // (`bank_screened: false`, `no_bank_resolved`). Les autres codes ne bougent pas.
  it('on the compliance check, in the four states: the TBB keys decide whether the floor stays', () => {
    type Compliance = ReturnType<typeof buildComplianceResponse>['compliance'];
    const seen = (tbb: boolean, tcmb: boolean) => {
      state(tbb, tcmb);
      return Object.fromEntries(
        (Object.keys(PROBES) as Probe[]).map((name) => [
          name,
          buildComplianceResponse(PROBES[name]).compliance,
        ]),
      ) as Record<Probe, Compliance>;
    };
    const summary = (c: Compliance) => ({
      risk_score: c.risk_score,
      risk_level: c.risk_level,
      flags: c.flags,
      bank_screened: c.sanctions.bank_screened,
      institution_listed: c.sanctions.institution_listed,
    });
    const none = seen(false, false);
    const listOnly = seen(false, true);
    const mapOnly = seen(true, false);
    const both = seen(true, true);

    // Sans les clés de la TBB : avant (liste absente) et après (liste chargée).
    expect(summary(none.tcmbOnly)).toEqual({
      risk_score: 50,
      risk_level: 'elevated',
      flags: [
        'elevated_risk_country',
        'bank_code_unverified',
        'no_bank_resolved',
        'bank_code_data_unavailable',
      ],
      bank_screened: false,
      institution_listed: null,
    });
    expect(summary(listOnly.tcmbOnly)).toEqual({
      risk_score: 50,
      risk_level: 'elevated',
      flags: ['elevated_risk_country', 'no_bank_resolved', 'bank_code_data_unavailable'],
      bank_screened: false,
      institution_listed: null,
    });
    // Le code des deux sources, que la liste nomme seule quand la TBB est retirée : de même.
    expect(summary(listOnly.both)).toEqual(summary(listOnly.tcmbOnly));

    // Avec les clés de la TBB : avant (liste absente) et après (liste chargée).
    expect(summary(mapOnly.tcmbOnly)).toEqual({
      risk_score: 20,
      risk_level: 'medium',
      flags: ['elevated_risk_country', 'bank_code_unverified', 'no_bank_resolved'],
      bank_screened: false,
      institution_listed: null,
    });
    expect(summary(both.tcmbOnly)).toEqual({
      risk_score: 10,
      risk_level: 'low',
      flags: ['elevated_risk_country', 'no_bank_resolved'],
      bank_screened: false,
      institution_listed: null,
    });

    // Les codes que la liste ne nomme pas ne bougent dans aucun état.
    for (const name of ['tbbOnly', 'neither'] as const) {
      expect(listOnly[name], name).toEqual(none[name]);
      expect(both[name], name).toEqual(mapOnly[name]);
    }
    expect(both.both).toEqual(mapOnly.both);
    state(false, false);
  });

  it('leaves Turkey out of the registers the public texts describe, and never settles a negative', () => {
    state(true, true);
    expect(registerCoverage('TR')).toEqual({ basis: 'none', register: null });
    expect(registerCountries().authoritative).not.toContain('TR');
    expect(registerCountries().partial).not.toContain('TR');
    expect(nationalRegisterIsExhaustive('TR')).toBe(false);
    state(false, false);
  });
});
