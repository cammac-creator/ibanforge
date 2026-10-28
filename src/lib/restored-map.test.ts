import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Les clés de la carte composite retirées le 29/09/2026, de retour depuis la
 * surcouche privée seulement (règle de Claude-Alain du 28/10/2026, « go pour
 * B » : membres `supplement` de src/lib/restricted-family.ts).
 *
 * Ce qui doit tenir : une clé rétablie s'ajoute là où le fichier public n'en a
 * aucune pour le code, jamais à la place d'une clé publique ; elle nomme sa
 * compilation et l'origine compilée dans `bic.source` ; la recherche par préfixe
 * ne répond toujours pas à la place de la carte dans les huit pays retirés ; un
 * pays dont la surcouche n'apporte aucune clé reste « non consulté » ; et en
 * Estonie, la liste de l'autorité gagne partout où elle répond.
 *
 * Tout est inventé (codes hors de la carte publique, BIC `XMP…`), sauf une clé
 * espagnole de src/db/bic_data.json choisie à l'exécution, jamais écrite ici.
 */

const { fixture, publicEs } = await vi.hoisted(async () => {
  const { installRestrictedFixture } = await import('../test-support/restricted-fixtures.js');
  const { restrictedTable } = await import('./restricted-family.js');
  const { createRequire } = await import('node:module');
  const { readFileSync: read } = await import('node:fs');
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const fixture = installRestrictedFixture();
  const map = JSON.parse(read(new URL('../db/bic_data.json', import.meta.url), 'utf8')) as Record<
    string,
    { bic: string }
  >;
  const esKey = Object.keys(map).find((k) => k.startsWith('ES:'))!;
  const publicEs = { code: esKey.slice(3), bic: map[esKey]!.bic };
  const db = new Database(fixture.bicPath);
  for (const sql of restrictedTable('bic', 'curated_bank_codes').ddl) db.prepare(sql).run();
  const insert = db.prepare(
    `INSERT INTO curated_bank_codes (country, code, bic, source, as_of) VALUES (?, ?, ?, ?, '2099-01-02')`,
  );
  const credit = (from: string) => `mdomke/schwifty 2099.1.0 (MIT), compiled from ${from}`;
  insert.run(
    'TR',
    '99001',
    'XMPZTR22XXX',
    credit('Türkiye Bankalar Birliği (The Banks Association of Türkiye)'),
  );
  insert.run('GE', 'QQ', 'XMPZGE22XXX', credit('ibancalculator.com'));
  insert.run('ES', publicEs.code, 'XMPZESMMXXX', credit('iban.es'));
  insert.run('ES', '9899', 'XMPZESMMXXX', credit('iban.es'));
  // Estonie : un code que la liste inventée nomme avec un BIC (22), un qu'elle
  // nomme sans BIC (15), un qu'elle ne porte pas (71).
  insert.run('EE', '22', 'XMPZEE22XXX', credit('ibancalculator.com'));
  insert.run('EE', '15', 'XMPZEE15XXX', credit('ibancalculator.com'));
  insert.run('EE', '71', 'XMPZEE71XXX', credit('ibancalculator.com'));
  db.close();
  return { fixture, publicEs };
});

import {
  countryHasReferenceData,
  curatedMapSource,
  lookupByCountryBank,
  restoredMapKeysLoaded,
} from './bic-lookup.js';
import { getBicDB } from './db.js';
import { EXAMPLE_IBANS } from './countries.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { buildComplianceResponse } from './compliance-response.js';
import { uncoveredCountries } from './positioning.js';
import { EE_FIXTURE, writePrivateFixture } from '../test-support/ee-me-fixtures.js';

afterAll(() => fixture.restore());

const removers: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  removers.splice(0).forEach((remove) => remove());
});

/** Un IBAN à clé mod-97 valide pour ce pays et ce BBAN (compte inventé). */
function ibanOf(cc: string, bban: string): string {
  const digits = `${bban}${cc}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `${cc}${String(98 - rest).padStart(2, '0')}${bban}`;
}

function answer(iban: string) {
  const result = validateIBAN(iban);
  expect(result.valid, iban).toBe(true);
  enrichResult(result);
  return result;
}

describe('les clés rétablies par la surcouche (règle du 28/10/2026)', () => {
  it('sont servies avec leur compilation, l’origine compilée et la date de la compilation', () => {
    expect(lookupByCountryBank('TR', '99001')).toMatchObject({
      code: 'XMPZTR22XXX',
      match: 'register',
      source:
        'IBANforge curated bank-code map; mdomke/schwifty 2099.1.0 (MIT), compiled from Türkiye Bankalar Birliği (The Banks Association of Türkiye)',
      as_of: '2099-01',
    });
    const r = answer(ibanOf('TR', '990010' + '0000001234567890'));
    expect(r.bic?.code).toBe('XMPZTR22XXX');
    expect(r.bic?.source).toContain('compiled from Türkiye Bankalar Birliği');
    expect(r.bank_code_check?.reason).not.toBe('no_reference_data_for_country');
  });

  it('font du pays un pays de la carte : un code qu’elles ne portent pas est cherché, pas « non consulté »', () => {
    expect(restoredMapKeysLoaded('TR')).toBe(true);
    expect(countryHasReferenceData('TR')).toBe(true);
    const r = answer(ibanOf('TR', '990020' + '0000001234567890'));
    expect(r.bic ?? null).toBeNull();
    expect(r.bank_code_check?.status).not.toBe('unavailable');
  });

  it('laissent « non consulté » un pays retiré dont la surcouche n’apporte aucune clé', () => {
    expect(restoredMapKeysLoaded('AE')).toBe(false);
    expect(countryHasReferenceData('AE')).toBe(false);
    const r = answer(EXAMPLE_IBANS.AE!);
    expect(r.bank_code_check?.reason).toBe('no_reference_data_for_country');
    expect(buildComplianceResponse(EXAMPLE_IBANS.AE!).compliance.flags).toContain(
      'bank_code_data_unavailable',
    );
    // Les phrases publiques comptent le pays comme couvert : servi par la surcouche.
    expect(uncoveredCountries()).toEqual([]);
  });

  it('ne laissent jamais la recherche par préfixe nommer une banque à la place de la carte', () => {
    expect(lookupByCountryBank('GE', 'QQ')?.code).toBe('XMPZGE22XXX');
    const row = getBicDB()
      .prepare(
        "SELECT substr(bic8, 1, 2) AS p FROM bic_entries WHERE country_code = 'GE' AND substr(bic8, 1, 2) <> 'QQ' LIMIT 1",
      )
      .get() as { p: string } | undefined;
    if (row) expect(lookupByCountryBank('GE', row.p), row.p).toBeNull();
  });

  it('ne remplacent jamais une clé du fichier public : elles complètent, code par code', () => {
    const kept = lookupByCountryBank('ES', publicEs.code);
    expect(kept?.code).toBe(publicEs.bic);
    expect(kept?.source).toBe(curatedMapSource('ES'));
    expect(lookupByCountryBank('ES', '9899')).toMatchObject({
      code: 'XMPZESMMXXX',
      source:
        'IBANforge curated bank-code map; mdomke/schwifty 2099.1.0 (MIT), compiled from iban.es',
    });
  });

  it('cèdent à la liste de l’autorité estonienne partout où elle répond, même sans BIC', () => {
    const file = writePrivateFixture('ee-register.json', EE_FIXTURE);
    removers.push(file.remove);
    vi.stubEnv('EE_REGISTER_PATH', file.path);
    const listed = EE_FIXTURE.entries.find((c) => c.code === '22')!;
    expect(answer(ibanOf('EE', '22' + '00221020145685')).bic?.code).toBe(listed.bic);
    // Nommé par l'autorité sans BIC : aucun BIC compilé à côté de son titulaire.
    expect(answer(ibanOf('EE', '15' + '00221020145685')).bic ?? null).toBeNull();
    // Absent de la liste : la clé rétablie répond.
    expect(answer(ibanOf('EE', '71' + '00221020145685')).bic?.code).toBe('XMPZEE71XXX');
  });

  it('ne sont écrites dans aucun fichier du dépôt', () => {
    const map = readFileSync(new URL('../db/bic_data.json', import.meta.url), 'utf8');
    for (const key of ['"TR:', '"AE:', '"BA:', '"GE:', '"KZ:', '"MD:', '"EE:', '"RS:'])
      expect(map, key).not.toContain(key);
  });
});
