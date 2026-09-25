import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOutsideRepository, OVERLAY_FILE_NAMES, runCommand } from './restricted-overlay.js';
import { sha256File } from '../src/lib/restricted-overlay.js';
import {
  installRestrictedFixture,
  type RestrictedFixture,
} from '../src/test-support/restricted-fixtures.js';
import { completeRestrictedFamily } from '../src/test-support/restricted-overlay-fixtures.js';

/**
 * La ligne de commande de la surcouche : jamais d'écriture dans le dépôt public,
 * et les commandes du Geste 4 (extract, check) sur une famille inventée. `seed`
 * télécharge : elle n'est éprouvée ici que sur son refus d'écrire dans le dépôt.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('assertOutsideRepository', () => {
  it('refuse le dépôt, data/ compris, et les chemins relatifs', () => {
    expect(() => assertOutsideRepository(join(ROOT, 'data', 'restricted-bic.sqlite'))).toThrow(
      /dépôt public/,
    );
    expect(() => assertOutsideRepository(join(ROOT, 'x', 'y', 'z.sqlite'))).toThrow(/dépôt public/);
    expect(() => assertOutsideRepository('prive/restricted-bic.sqlite')).toThrow(/absolu/);
  });
});

describe('restricted-overlay.ts, commandes', () => {
  let fixture: RestrictedFixture;
  let out: string;

  beforeAll(() => {
    fixture = installRestrictedFixture();
    completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    out = join(fixture.dir, 'prive');
    mkdirSync(out);
  }, 120_000);

  afterAll(() => fixture.restore());

  it('extract écrit les deux surcouches sans toucher aux bases lues', () => {
    const before = [sha256File(fixture.bicPath), sha256File(fixture.compliancePath)];
    const { code, output } = runCommand([
      'extract',
      '--bic',
      fixture.bicPath,
      '--compliance',
      fixture.compliancePath,
      '--out-dir',
      out,
    ]);
    expect(code).toBe(0);
    expect((output as Array<{ path: string }>).map((o) => o.path)).toEqual([
      join(out, OVERLAY_FILE_NAMES.bic),
      join(out, OVERLAY_FILE_NAMES.compliance),
    ]);
    expect([sha256File(fixture.bicPath), sha256File(fixture.compliancePath)]).toEqual(before);
    // Les copies lues vivaient dans un dossier temporaire : aucun compagnon WAL
    // à côté des bases d'origine.
    expect(readdirSync(dirname(fixture.bicPath)).filter((f) => f.endsWith('-shm'))).toEqual([]);
  });

  it('check répond 0 sur une surcouche saine, 1 sur un fichier refusé', () => {
    expect(
      runCommand(['check', '--kind', 'bic', '--overlay', join(out, OVERLAY_FILE_NAMES.bic)]).code,
    ).toBe(0);
    const bad = join(out, 'abimee.sqlite');
    writeFileSync(bad, 'rien');
    expect(runCommand(['check', '--kind', 'bic', '--overlay', bad]).code).toBe(1);
  });

  it('strip puis merge reconstruisent une base servable', () => {
    const pub = join(out, 'publique.sqlite');
    expect(
      runCommand(['strip', '--kind', 'compliance', '--in', fixture.compliancePath, '--out', pub])
        .code,
    ).toBe(0);
    const merged = join(out, 'fusion.sqlite');
    const { code, output } = runCommand([
      'merge',
      '--kind',
      'compliance',
      '--public',
      pub,
      '--overlay',
      join(out, OVERLAY_FILE_NAMES.compliance),
      '--out',
      merged,
    ]);
    expect(code).toBe(0);
    expect((output as { state: string }).state).toBe('applied');
    expect(existsSync(merged)).toBe(true);
  });

  it('refuse toute sortie dans le dépôt, avant le moindre travail', () => {
    expect(() =>
      runCommand(['extract', '--bic', fixture.bicPath, '--out-dir', join(ROOT, 'data')]),
    ).toThrow(/dépôt public/);
    expect(() =>
      runCommand(['seed', '--kind', 'bic', '--out', join(ROOT, 'data', 'restricted-bic.sqlite')]),
    ).toThrow(/dépôt public/);
    expect(() => runCommand(['inconnue'])).toThrow(/Commande/);
  });
});
