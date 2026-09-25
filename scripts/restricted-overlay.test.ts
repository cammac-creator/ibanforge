import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

/** git sans configuration héritée, avec une identité inventée (CI comprise). */
function git(dir: string, ...args: string[]): void {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  const r = spawnSync(
    'git',
    ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=acme@example.com', ...args],
    { env, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`);
}

describe('assertOutsideRepository', () => {
  let scratch: string;
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'ibf-garde-'));
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('refuse le dépôt, data/ compris, et les chemins relatifs', () => {
    expect(() => assertOutsideRepository(join(ROOT, 'data', 'restricted-bic.sqlite'))).toThrow(
      /dépôt public/,
    );
    expect(() => assertOutsideRepository(join(ROOT, 'x', 'y', 'z.sqlite'))).toThrow(/dépôt public/);
    expect(() => assertOutsideRepository('prive/restricted-bic.sqlite')).toThrow(/absolu/);
    // Hors de tout dépôt : accepté.
    expect(() => assertOutsideRepository(join(scratch, 'a', 'b.sqlite'))).not.toThrow();
  });

  it("refuse le dépôt écrit dans une autre casse, sur un disque qui l'ignore (R20)", () => {
    const upper = ROOT.toUpperCase();
    // Sur un disque sensible à la casse, ce chemin n'existe pas : rien à prouver.
    if (upper === ROOT || !existsSync(upper)) return;
    expect(() => assertOutsideRepository(join(upper, 'data', 'fusion.sqlite'))).toThrow(
      /dépôt public/,
    );
    expect(() => assertOutsideRepository(join(ROOT, 'data', 'fusion.sqlite'), upper)).toThrow(
      /dépôt public/,
    );
  });

  it('refuse tout dépôt git et toute copie de travail, même voisine (R21)', () => {
    const repo = join(scratch, 'depot');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'premier');
    git(repo, 'worktree', 'add', '-q', join(scratch, 'copie-voisine'));
    for (const target of [
      join(repo, 'data', 'fusion.sqlite'),
      join(repo, '.git', 'x.sqlite'),
      join(scratch, 'copie-voisine', 'data', 'restricted-bic.sqlite'),
    ])
      expect(() => assertOutsideRepository(target), target).toThrow(/dépôt git/);
  });

  it('refuse une sortie qui est un lien, un lien dur ou un dossier, et un lien pendant (R19)', () => {
    const target = join(scratch, 'cible.sqlite');
    writeFileSync(target, 'x');
    const symlink = join(scratch, 'lien.sqlite');
    symlinkSync(target, symlink);
    const hardlink = join(scratch, 'dur.sqlite');
    linkSync(target, hardlink);
    const folder = join(scratch, 'dossier.sqlite');
    mkdirSync(folder);
    const dangling = join(scratch, 'pendant');
    symlinkSync(join(scratch, 'nulle-part'), dangling);
    for (const out of [symlink, hardlink, folder])
      expect(() => assertOutsideRepository(out), out).toThrow(/fichier ordinaire/);
    expect(() => assertOutsideRepository(join(dangling, 'x.sqlite'))).toThrow(/pendant/);
    expect(existsSync(join(scratch, 'nulle-part'))).toBe(false);
  });
});

describe('restricted-overlay.ts, commandes', () => {
  let fixture: RestrictedFixture;
  let out: string;

  beforeAll(() => {
    fixture = installRestrictedFixture();
    completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    // Pas de mkdir : extract crée son dossier de sortie (R14).
    out = join(fixture.dir, 'prive');
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
    expect(statSync(out).mode & 0o777).toBe(0o700);
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

  it("strip remplace la sortie par renommage, sans jamais écrire au travers d'elle", () => {
    const pub = join(out, 'publique-2.sqlite');
    copyFileSync(fixture.bicPath, pub);
    const inode = statSync(pub).ino;
    expect(runCommand(['strip', '--kind', 'bic', '--in', fixture.bicPath, '--out', pub]).code).toBe(
      0,
    );
    expect(statSync(pub).ino).not.toBe(inode);
    expect(readdirSync(out).filter((f) => f.includes('.tmp-'))).toEqual([]);
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
