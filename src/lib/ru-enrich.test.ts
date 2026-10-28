import Database from 'better-sqlite3';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Russie (28/10/2026, décision « Nommer seulement ») : le répertoire des BIK de la
 * Banque de Russie, registre PARTIEL servi par la surcouche privée (membres
 * `register_ru` et `register_ru_licences`, src/lib/restricted-family.ts), et le
 * contrôle des sanctions de l'établissement entier (src/lib/ru-institution.ts,
 * `bankKeys` dans src/lib/compliance.ts).
 *
 * 🔒 Les lignes sont INVENTÉES : le répertoire passe par le fichier privé et n'entre
 * pas dans ce dépôt public. BIK 0499999xx et BIC en `ZZ` vérifiés absents du vrai
 * répertoire, de l'annuaire et des listes le 28/10/2026.
 */
// La lecture de l'établissement peut lever (base illisible) : le test le provoque.
const ruFault = vi.hoisted(() => ({ on: false }));
vi.mock('./ru-institution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ru-institution.js')>();
  const guarded =
    <T>(fn: (code: string) => T) =>
    (code: string): T => {
      if (ruFault.on) throw new Error('establishment unreadable (test)');
      return fn(code);
    };
  return {
    ruInstitutionBics: guarded(actual.ruInstitutionBics),
    ruInstitutionBicsForBic: guarded(actual.ruInstitutionBicsForBic),
  };
});

const { fixture, ibanFor } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  const installed = m.installRestrictedFixture();
  const { default: Db } = await import('better-sqlite3');
  const { restrictedTable } = await import('./restricted-family.js');
  const SOURCE =
    'Bank of Russia, BIC directory of the Bank of Russia payment system (ED807), https://www.cbr.ru';
  const bic = new Db(installed.bicPath);
  const insert = bic.prepare(
    "INSERT INTO national_bank_codes (country, code, name, bic, source, as_of) VALUES ('RU', ?, ?, ?, ?, '2026-10-29')",
  );
  // Un siège listé sous un AUTRE BIC que le sien (ZZALRUM1 sur la liste, ZZALRUMM au
  // répertoire), une seconde ligne de siège de la même licence sans BIC SWIFT, une
  // succursale sans BIC SWIFT, une succursale avec le sien.
  insert.run('049999901', 'АО «Альфа-Тест»', 'ZZALRUMMXXX', SOURCE);
  insert.run('049999904', 'АО «АЛЬФА-ТЕСТ»', null, SOURCE);
  insert.run('049999902', 'Филиал АО «Альфа-Тест» в г. Тестовске', null, SOURCE);
  insert.run('049999903', 'Филиал № 2 АО «Альфа-Тест»', 'ZZALRUM2SP3', SOURCE);
  // Une banque qu'aucune liste ne porte.
  insert.run('049999911', 'ООО «Бета-Тест»', 'ZZBERUMM', SOURCE);
  // Un établissement sans aucun BIC SWIFT, siège et succursale.
  insert.run('049999921', 'ПАО «Гамма-Тест»', null, SOURCE);
  insert.run('049999922', 'Филиал ПАО «Гамма-Тест»', null, SOURCE);
  for (const statement of restrictedTable('bic', 'ru_bik_licences').ddl)
    bic.prepare(statement).run();
  const licence = bic.prepare(
    "INSERT INTO ru_bik_licences (code, licence, source, as_of) VALUES (?, ?, ?, '2026-10-29')",
  );
  for (const code of ['049999901', '049999904', '049999902', '049999903'])
    licence.run(code, '9001', SOURCE);
  licence.run('049999911', '9002', SOURCE);
  licence.run('049999921', '9003', SOURCE);
  licence.run('049999922', '9003', SOURCE);
  bic.close();
  const compliance = new Db(installed.compliancePath);
  const listed = compliance.prepare(
    "INSERT INTO sanctioned_entities (bic8, entity_name, source_list, country_code, directory_match) VALUES (?, ?, 'OFAC', ?, 0)",
  );
  listed.run('ZZALRUM1', 'ALFA-TEST BANK JSC', 'RU');
  // Une liste qui désigne Beta sous un BIC secondaire d'un autre préfixe, que le
  // répertoire ne marque pas par défaut et qui n'est donc pas servi : limite connue.
  listed.run('ZZQQRUMM', 'BETA-TEST LLC', 'RU');
  // Hors de Russie, la règle d'avant : le BIC8 exact, rien d'autre.
  listed.run('ZZDEDEF1', 'DELTA TEST BANK AG', 'DE');
  compliance.close();
  return { fixture: installed, ibanFor: m.ibanFor };
});
afterAll(() => fixture.restore());

const { validateIBAN } = await import('./iban.js');
const { enrichResult, registerCoverage } = await import('./enrich.js');
const { buildComplianceResponse, buildBicComplianceResponse } =
  await import('./compliance-response.js');
const { screenBicSanctions } = await import('./compliance.js');
const { nationalRegisterIsExhaustive, resetNationalRegisterStatements } =
  await import('./national-registers.js');
const { closeBicDB } = await import('./db.js');

const ru = (bik: string) => ibanFor('RU', `${bik}40702810412345678901`);

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

function screened(iban: string) {
  const r = buildComplianceResponse(iban);
  expect(r.valid, iban).toBe(true);
  return r;
}

describe('Russia: the Bank of Russia directory names the holder of a BIK', () => {
  it('serves the institution, its default SWIFT BIC and the dated credit', () => {
    const r = check(ru('049999901'));
    expect(r.bank_code_check?.value).toBe('049999901');
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.match).toBe('register');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bank_code_check?.register).toBe(
      'Source: Bank of Russia, BIC directory of the Bank of Russia payment system (ED807), https://www.cbr.ru, business day 2026-10-29. ' +
        'Partial register: IBANforge serves the credit institutions and branches the directory lists as active and unrestricted, not its other participants, so an absence is not a non-allocation',
    );
    expect(r.bank_code_check?.institution?.name).toBe('АО «Альфа-Тест»');
    expect(r.bank_code_check?.institution?.street).toBeNull();
    expect(r.bank_code_check?.as_of).toBe('2026-10');
    expect(r.bic?.code).toBe('ZZALRUMMXXX');
    expect(r.bic?.source).toBe(
      'Source: Bank of Russia, BIC directory of the Bank of Russia payment system (ED807), https://www.cbr.ru, business day 2026-10-29',
    );
    expect(r.bic?.basis).toBe('national_register');
  });

  it('names a branch without a SWIFT BIC and never lends it the head office BIC', () => {
    const r = check(ru('049999902'));
    expect(r.bank_code_check?.institution?.name).toBe('Филиал АО «Альфа-Тест» в г. Тестовске');
    expect(r.bic).toBeNull();
  });

  it('keeps a BIK the table does not carry off any refusal', () => {
    const r = check(ru('049999999'));
    expect(r.bank_code_check?.reason).toBe('absent_from_reference_data');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });

  it('is partial', () => {
    expect(nationalRegisterIsExhaustive('RU')).toBe(false);
    expect(registerCoverage('RU').basis).toBe('partial');
  });
});

describe('Russia: the sanctions screen covers the whole institution', () => {
  it('flags a head office the list names under another BIC of the same institution', () => {
    const c = screened(ru('049999901')).compliance;
    expect(c.sanctions.bank_screened).toBe(true);
    expect(c.sanctions.bank_sanctioned).toBe(true);
    expect(c.sanctions.matched_lists).toEqual(['OFAC']);
    expect(c.sanctions.institution_listed).toBe(true);
    expect(c.flags).toContain('sanctioned_bank');
  });

  it('flags a branch without a SWIFT BIC through its head office', () => {
    const r = screened(ru('049999902'));
    expect(r.bic).toBeNull();
    expect(r.compliance.sanctions.bank_screened).toBe(true);
    expect(r.compliance.sanctions.bank_sanctioned).toBe(true);
    expect(r.checks?.institution_sanctions).toBe('fail');
    expect(r.compliance.flags).not.toContain('no_bank_resolved');
  });

  it('flags a branch whose own SWIFT BIC differs from the listed one', () => {
    expect(screened(ru('049999903')).compliance.sanctions.bank_sanctioned).toBe(true);
  });

  it('flags a second head office line of the same licence, without a SWIFT BIC', () => {
    expect(screened(ru('049999904')).compliance.sanctions.bank_sanctioned).toBe(true);
  });

  it('cannot match a listing under a secondary BIC of another prefix (known limit)', () => {
    const c = screened(ru('049999911')).compliance;
    expect(c.sanctions.bank_screened).toBe(true);
    expect(c.sanctions.bank_sanctioned).toBe(false);
  });

  it('screens and clears an institution no list carries', () => {
    const c = screened(ru('049999911')).compliance;
    expect(c.sanctions.bank_screened).toBe(true);
    expect(c.sanctions.bank_sanctioned).toBe(false);
    expect(c.sanctions.matched_lists).toEqual([]);
  });

  it('says "not screened" for an institution without any SWIFT BIC, never "not listed"', () => {
    const r = screened(ru('049999922'));
    expect(r.compliance.sanctions.bank_screened).toBe(false);
    expect(r.compliance.sanctions.institution_listed).toBeNull();
    expect(r.checks?.institution_sanctions).toBe('unknown');
    // Le pays reste sanctionné : le niveau reste critical.
    expect(r.compliance.sanctions.country_sanctioned).toBe(true);
    expect(r.compliance.risk_level).toBe('critical');
  });

  it('gives the BIC routes the same answer', () => {
    expect(screenBicSanctions('ZZALRUMM').listed).toBe(true);
    // Un BIC de la succursale : l'établissement que le répertoire lui donne.
    expect(screenBicSanctions('ZZALRUM2').listed).toBe(true);
    // Un BIC russe que le répertoire ne porte pas : les six premiers caractères suffisent.
    expect(screenBicSanctions('ZZALRUM5').listed).toBe(true);
    expect(screenBicSanctions('ZZBERUMM').matched_lists).toEqual([]);
    const b = buildBicComplianceResponse('ZZALRUMMXXX');
    expect('error' in b).toBe(false);
    if (!('error' in b)) expect(b.compliance.sanctions.bank_sanctioned).toBe(true);
  });

  it('keeps the exact BIC8 rule outside Russia', () => {
    expect(screenBicSanctions('ZZDEDEF1').listed).toBe(true);
    expect(screenBicSanctions('ZZDEDEFF').matched_lists).toEqual([]);
  });
});

describe('Russia: an institution that cannot be read is "not screened", never "not listed"', () => {
  it('on the IBAN path', () => {
    ruFault.on = true;
    try {
      const c = screened(ru('049999901')).compliance;
      expect(c.sanctions.bank_screened).toBe(false);
      expect(c.sanctions.institution_listed).toBeNull();
      expect(c.flags[0]).toBe('compliance_data_unavailable');
      expect(c.risk_score).toBeGreaterThanOrEqual(50);
    } finally {
      ruFault.on = false;
    }
  });

  it('on the BIC paths', () => {
    ruFault.on = true;
    try {
      expect(screenBicSanctions('ZZALRUMM')).toEqual({
        screened: false,
        listed: null,
        matched_lists: [],
      });
      const b = buildBicComplianceResponse('ZZALRUMMXXX');
      expect('error' in b).toBe(false);
      if (!('error' in b)) {
        expect(b.compliance.sanctions.bank_screened).toBe(false);
        expect(b.compliance.sanctions.institution_listed).toBeNull();
        expect(b.compliance.flags[0]).toBe('compliance_data_unavailable');
      }
    } finally {
      ruFault.on = false;
    }
  });
});

describe('Russia without its overlay members', () => {
  it('says "not screened" without the licences, never "not listed" on the line own BIC', () => {
    const db = new Database(fixture.bicPath);
    db.prepare('DROP TABLE ru_bik_licences').run();
    db.close();
    closeBicDB();
    resetNationalRegisterStatements();
    for (const bik of ['049999901', '049999902', '049999911']) {
      const s = screened(ru(bik)).compliance.sanctions;
      expect(s.bank_screened, bik).toBe(false);
      expect(s.institution_listed, bik).toBeNull();
    }
    // Le chemin BIC compare toujours le BIC demandé sur ses six premiers caractères.
    expect(screenBicSanctions('ZZALRUMM').listed).toBe(true);
  });

  it('says "not consulted" when the overlay does not carry the directory', () => {
    const db = new Database(fixture.bicPath);
    db.prepare("DELETE FROM national_bank_codes WHERE country = 'RU'").run();
    db.close();
    closeBicDB();
    resetNationalRegisterStatements();
    const r = check(ru('049999901'));
    expect(r.bank_code_check?.status).toBe('unavailable');
    expect(r.bank_code_check?.reason).toBe('national_register_unavailable');
    expect(screened(ru('049999901')).compliance.sanctions.bank_screened).toBe(false);
  });
});
