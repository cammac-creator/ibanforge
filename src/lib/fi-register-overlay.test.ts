import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * La liste finlandaise et les clés PL, FI et LU de la carte composite quand la
 * surcouche les porte ET que ce dépôt les porte encore (25/09/2026, avant l'étape
 * du retrait) : la règle de fraîcheur de la fusion choisit, liste par liste et
 * pays par pays (src/lib/fi-register.ts ; `addCuratedRows` dans
 * src/lib/bic-lookup.ts). Lignes INVENTÉES écrites dans la copie de la base
 * d'essai avant son ouverture : codes de un à quatre caractères, BIC `XMP…`, noms
 * « Remplissage ». Aucune ligne de la vraie liste.
 */
const { fixture, ibanFor, Database } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  const family = await import('./restricted-family.js');
  const { createRequire } = await import('node:module');
  const fixture = m.installRestrictedFixture();
  const Database = createRequire(import.meta.url)('better-sqlite3');
  const db = new Database(fixture.bicPath);
  for (const table of ['curated_bank_codes', 'fi_monetary_codes'])
    for (const sql of family.RESTRICTED_TABLES.bic.find((t) => t.name === table)!.ddl)
      db.prepare(sql).run();
  const list = db.prepare(
    `INSERT INTO fi_monetary_codes (code, bic, institution, source, as_of)
     VALUES (?, ?, ?, 'Remplissage', '2099-01-15')`,
  );
  list.run('1', 'XMPAFIH1', 'Groupe Remplissage Un');
  list.run('47', 'XMPBFIH1', 'Groupe Remplissage Quarante-sept');
  list.run('405', 'XMPCFIH1', 'Remplissage Quatre-cent-cinq');
  const key = db.prepare(
    `INSERT INTO curated_bank_codes (country, code, bic, source, as_of)
     VALUES (?, ?, ?, 'Remplissage', '2099-01-02')`,
  );
  key.run('PL', '99900000', 'XMPPPLPW');
  key.run('LU', '800', 'XMPMLULL');
  key.run('FI', '310', 'XMPEFIH1');
  db.close();
  return { fixture, ibanFor: m.ibanFor, Database };
});
afterAll(() => fixture.restore());

const { validateIBAN } = await import('./iban.js');
const { enrichResult } = await import('./enrich.js');
const { FI_REGISTER_AS_OF, allocatedFiCodes, fiRegisterAsOf, lookupFiInstitution } =
  await import('./fi-register.js');
const { curatedKeysMissing, resetStatements } = await import('./bic-lookup.js');

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} doit être un IBAN valide`).toBe(true);
  enrichResult(r);
  return r;
}

/** Redate la liste de la surcouche, puis oublie ce que la base servait (un rechargement). */
function redate(asOf: string): void {
  const db = new Database(fixture.bicPath);
  db.prepare('UPDATE fi_monetary_codes SET as_of = ?').run(asOf);
  db.close();
  resetStatements();
}

describe('la liste finlandaise : la plus récente sert, jamais un mélange des deux', () => {
  it('la liste de la surcouche, strictement plus récente, remplace celle de ce dépôt', () => {
    expect(fiRegisterAsOf()).toBe('2099-01-15');
    expect([...allocatedFiCodes()].sort()).toEqual(['1', '405', '47']);
    expect(lookupFiInstitution('12345600000785')).toMatchObject({
      status: 'allocated',
      code: '1',
      bic: 'XMPAFIH1',
    });
    const r = check(ibanFor('FI', '12345600000785'));
    expect(r.bank_code_check).toMatchObject({
      value: '1',
      status: 'verified',
      authoritative: false,
      as_of: '2099-01',
      institution: { name: 'Groupe Remplissage Un', country: 'FI' },
    });
  });

  it.each([
    ['à date égale', FI_REGISTER_AS_OF],
    ['plus ancienne', '2020-01-01'],
  ])('%s, la liste de ce dépôt est gardée', (_label, asOf) => {
    redate(asOf);
    expect(fiRegisterAsOf()).toBe(FI_REGISTER_AS_OF);
    expect([...allocatedFiCodes()].sort()).not.toEqual(['1', '405', '47']);
    expect(lookupFiInstitution('12345600000785')?.bic).not.toBe('XMPAFIH1');
    const r = check(ibanFor('FI', '12345600000785'));
    expect(r.bank_code_check?.as_of).toBe(FI_REGISTER_AS_OF.slice(0, 7));
    expect(r.bank_code_check?.institution?.name ?? '').not.toMatch(/Remplissage/);
  });
});

describe('les clés PL, FI et LU de la surcouche, tant que la carte publique porte ces pays', () => {
  it('ne servent pas : le fichier public, non daté, est gardé pays par pays', () => {
    for (const [cc, bban] of [
      ['PL', '999000000000000000000001'],
      ['LU', '8000000123456789'],
      ['FI', '31000000000123'],
    ] as const) {
      expect(curatedKeysMissing(cc), cc).toBe(false);
      const r = check(ibanFor(cc, bban));
      expect(r.bic?.code ?? '', cc).not.toMatch(/^XMP/);
    }
  });
});
