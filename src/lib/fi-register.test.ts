import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * La liste finlandaise et les clés PL, FI et LU de la carte composite, servies
 * par la surcouche (membres `register_fi`, `map_pl`, `map_fi`, `map_lu`,
 * src/lib/restricted-family.ts), sur des lignes INVENTÉES écrites dans la copie
 * de la base d'essai avant l'ouverture de la base : codes de un à quatre
 * caractères, BIC `XMP…`, noms « Remplissage ». Aucune ligne de la vraie liste.
 *
 * Les propriétés tenues depuis le 16/09/2026 : lecture par préfixe le plus long,
 * la bande 72-78 jamais « non attribuée », une absence jamais `not_allocated`,
 * la date de la liste servie avec le verdict, et les clés de la carte que la
 * liste contredit élaguées au chargement.
 */
const { fixture, ibanFor } = await vi.hoisted(async () => {
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
  key.run('FI', '123', 'XMPAFIH1');
  key.run('FI', '310', 'XMPEFIH1'); // la liste ne l'attribue à personne : élaguée
  key.run('FI', '730', 'XMPFFIH1'); // bande 72-78 : jamais élaguée
  key.run('PL', '99900000', 'XMPPPLPW');
  key.run('LU', '800', 'XMPMLULL');
  db.close();
  return { fixture, ibanFor: m.ibanFor };
});
afterAll(() => fixture.restore());

const { validateIBAN } = await import('./iban.js');
const { enrichResult } = await import('./enrich.js');
const { allocatedFiCodes, fiRegisterAsOf, lookupFiInstitution } = await import('./fi-register.js');

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} doit être un IBAN valide`).toBe(true);
  enrichResult(r);
  return r;
}

describe('la liste finlandaise lue dans la base servie', () => {
  it('par préfixe le plus long, avec la date de la liste', () => {
    expect(fiRegisterAsOf()).toBe('2099-01-15');
    expect([...allocatedFiCodes()].sort()).toEqual(['1', '405', '47']);
    expect(lookupFiInstitution('12345600000785')).toMatchObject({ status: 'allocated', code: '1' });
    expect(lookupFiInstitution('40500000000123')).toMatchObject({
      status: 'allocated',
      code: '405',
    });
    expect(lookupFiInstitution('47100000000123')).toMatchObject({
      status: 'allocated',
      code: '47',
    });
    expect(lookupFiInstitution('31000000000123')).toEqual({ status: 'not_allocated' });
    expect(lookupFiInstitution('73000000000123')).toEqual({ status: 'unknown' });
  });

  it('un code attribué : verified, le groupe nommé, la date de la liste, jamais authoritative', () => {
    const r = check(ibanFor('FI', '12345600000785'));
    expect(r.bank_code_check).toMatchObject({
      value: '1',
      status: 'verified',
      match: 'register',
      authoritative: false,
      as_of: '2099-01',
      institution: { name: 'Groupe Remplissage Un', country: 'FI' },
    });
    expect(r.bank_code_check?.register).toMatch(/^Finance Finland/);
    expect(r.bank_code_holder).toBe('confirmed');
    // Le BIC vient de la clé de la carte que la surcouche apporte.
    expect(r.bic?.code?.slice(0, 8)).toBe('XMPAFIH1');
  });

  it('un code que la liste ne porte pas : jamais not_allocated, et sa clé contradictoire élaguée', () => {
    const r = check(ibanFor('FI', '31000000000123'));
    expect(r.bank_code_check?.reason).not.toBe('not_allocated');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bic?.code ?? null).toBeNull();
  });

  it('la bande 72-78 : la clé de la carte répond, comme avant la liste', () => {
    const r = check(ibanFor('FI', '73000000000123'));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bic?.code?.slice(0, 8)).toBe('XMPFFIH1');
  });
});

describe('les clés polonaises et luxembourgeoises de la carte, servies par la surcouche', () => {
  it('résolvent leur BIC, par la carte composite (jamais un registre national)', () => {
    for (const [iban, bic] of [
      [ibanFor('PL', '999000000000000000000001'), 'XMPPPLPW'],
      [ibanFor('LU', '8000000123456789'), 'XMPMLULL'],
    ] as const) {
      const r = check(iban);
      expect(r.bank_code_check?.status, iban).toBe('verified');
      expect(r.bank_code_check?.authoritative, iban).toBe(false);
      expect(r.bank_code_check?.register, iban).toMatch(/composite bank-code map/);
      expect(r.bic?.code?.slice(0, 8), iban).toBe(bic);
    }
  });
});
