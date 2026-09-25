import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type DatabaseType from 'better-sqlite3';
import { extractOverlay } from './restricted-overlay.js';
import {
  DEMO_REFUSED_EXAMPLES,
  PRA_CREDIT_SURFACES,
  auditOverlayData,
  praCreditMonths,
} from './restricted-data-audit.js';
import { SEPA_MEMBERS_EXTRA } from './countries.js';
import { OFFICIAL_EXAMPLE_IBANS } from '../routes/demo.js';
import { validateIBAN } from './iban.js';
import {
  FIXTURE,
  installRestrictedFixture,
  type RestrictedFixture,
} from '../test-support/restricted-fixtures.js';
import { completeRestrictedFamily } from '../test-support/restricted-overlay-fixtures.js';

/**
 * Les contrôles de la porte privée, sur une famille entièrement inventée.
 *
 * La surcouche est extraite d'une copie des bases dont la famille est inventée
 * (restricted-fixtures.ts, complétée jusqu'aux planchers), puis retouchée AVANT
 * l'extraction pour chaque cas : un exemple de la démo devenu attribué, des pays
 * SEPA conformes à la table. Les crédits PRA sont lus dans une copie des
 * surfaces du dépôt, réécrite au mois voulu. Aucune vraie ligne sous conditions.
 */

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function openDb(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path);
}

describe('les contrôles de données de la porte privée', () => {
  let fixture: RestrictedFixture;
  let dir: string;
  let bicOverlay: string;
  let complianceOverlay: string;
  /** Une copie des surfaces du dépôt, que chaque cas réécrit à son mois. */
  let surfaces: string;

  function extract(kind: 'bic' | 'compliance', source: string, name: string): string {
    return extractOverlay({
      kind,
      sourcePath: source,
      outPath: join(dir, 'prive', `${name}.sqlite`),
      generator: 'test',
    }).path;
  }

  /** Réécrit chaque crédit PRA des surfaces copiées au mois donné. */
  function creditsAt(month: string): void {
    for (const relative of PRA_CREDIT_SURFACES) {
      const path = join(surfaces, relative);
      const text = readFileSync(path, 'utf8').replace(
        /Bank of England \(List of Banks, \d{4}-\d{2}\)/g,
        `Bank of England (List of Banks, ${month})`,
      );
      writeFileSync(path, text);
    }
  }

  beforeAll(() => {
    fixture = installRestrictedFixture();
    completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    // Le remplissage belge inventé prend les codes à partir de 000 jusqu'au
    // plancher, et passe donc par 539, le code de l'exemple de la démo : il est
    // déplacé sur un code que personne ne nomme, pour que le cas « rien à
    // signaler » en soit un.
    const db = openDb(fixture.bicPath);
    db.prepare(
      "UPDATE national_bank_codes SET code = '900' WHERE country = 'BE' AND code = '539'",
    ).run();
    db.close();
    dir = mkdtempSync(join(tmpdir(), 'ibf-audit-'));
    mkdirSync(join(dir, 'prive'));
    bicOverlay = extract('bic', fixture.bicPath, 'bic');
    complianceOverlay = extract('compliance', fixture.compliancePath, 'compliance');
    surfaces = join(dir, 'surfaces');
    for (const relative of PRA_CREDIT_SURFACES) {
      mkdirSync(dirname(join(surfaces, relative)), { recursive: true });
      cpSync(join(ROOT, relative), join(surfaces, relative));
    }
  }, 120_000);

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await fixture.restore();
  });

  it('chaque surface du dépôt porte un crédit PRA daté', () => {
    for (const relative of PRA_CREDIT_SURFACES)
      expect(praCreditMonths(ROOT, relative).length, relative).toBeGreaterThan(0);
  });

  it('se tait quand chaque crédit nomme le mois de la liste servie', () => {
    creditsAt(FIXTURE.PRA.month);
    expect(auditOverlayData('bic', bicOverlay, surfaces)).toEqual([]);
  });

  it('signale chaque surface qui nomme un autre mois que la liste servie', () => {
    creditsAt('1999-01');
    const warnings = auditOverlayData('bic', bicOverlay, surfaces);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`celle de ${FIXTURE.PRA.month}`);
    for (const relative of PRA_CREDIT_SURFACES) expect(warnings[0]).toContain(relative);
  });

  it('suit les exemples que la démo publie comme refusés', () => {
    // La liste du module est écrite en clair (il tourne sans l'application) :
    // elle doit rester celle de la démo, pays et code lus dans l'IBAN.
    const fromDemo = OFFICIAL_EXAMPLE_IBANS.map((e) => e.iban).filter(
      (iban) => !iban.startsWith('CH'),
    );
    expect(DEMO_REFUSED_EXAMPLES.map((e) => e.iban).sort()).toEqual(fromDemo.sort());
    for (const example of DEMO_REFUSED_EXAMPLES) {
      const parsed = validateIBAN(example.iban);
      expect(parsed.country?.code).toBe(example.country);
      expect(parsed.bban?.bank_code).toBe(example.code);
    }
  });

  it('signale un exemple de la démo que son registre attribue désormais', () => {
    creditsAt(FIXTURE.PRA.month);
    const copy = join(dir, 'bic-exemple-attribue.sqlite');
    cpSync(fixture.bicPath, copy);
    const db = openDb(copy);
    db.prepare(
      "INSERT INTO national_bank_codes (country, code, name) VALUES ('AT', '19043', 'Beispielbank Neu AG')",
    ).run();
    db.close();
    const warnings = auditOverlayData('bic', extract('bic', copy, 'bic-exemple'), surfaces);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('AT611904300234573201');
  });

  it('signale les pays SEPA dont la table ne suit plus le registre servi', () => {
    // Le registre EPC inventé ne porte aucune banque de ces pays.
    const warnings = auditOverlayData('compliance', complianceOverlay, surfaces);
    expect(warnings.map((w) => w.slice(7, 9)).sort()).toEqual(
      Object.keys(SEPA_MEMBERS_EXTRA).sort(),
    );
  });

  it('se tait quand le registre servi porte exactement les schémas de la table', () => {
    const copy = join(dir, 'conformite-conforme.sqlite');
    cpSync(fixture.compliancePath, copy);
    const db = openDb(copy);
    const insert = db.prepare(
      "INSERT INTO sepa_participants (bic8, scheme, status) VALUES (?, ?, 'active')",
    );
    for (const [cc, schemes] of Object.entries(SEPA_MEMBERS_EXTRA))
      for (const scheme of schemes) insert.run(`XMPL${cc}2X`, scheme);
    db.close();
    expect(
      auditOverlayData('compliance', extract('compliance', copy, 'conformite'), surfaces),
    ).toEqual([]);
  });
});
