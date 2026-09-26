import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripFamily } from '../src/lib/restricted-overlay.js';
import {
  installRestrictedFixture,
  type RestrictedFixture,
} from '../src/test-support/restricted-fixtures.js';

/**
 * Les robots PUBLICS ne demandent jamais une source de la famille sous conditions.
 *
 * ## Pourquoi ce fichier existe
 *
 * Depuis l'étape du retrait (25/09/2026), la base de ce dépôt ne porte plus la
 * famille (src/lib/restricted-family.ts) : la liste STEP2, les annuaires de
 * l'OeNB et de la NBP, les registres autrichien, belge et saint-marinais, la
 * liste PRA, la liste de l'ONU et les registres EPC. Les robots publics
 * (refresh-bic.yml, refresh-compliance.yml, les relectures tchèque et italienne)
 * lancent les MÊMES seeders que la chaîne privée ; seule la variable
 * `SEED_FAMILY` les sépare, et son absence veut dire « le public seul ». Un
 * workflow qui oublie la variable doit donc rester sûr : ce fichier le prouve
 * sur les vrais scripts, pas sur une lecture du code.
 *
 * ## Comment
 *
 * Même montage que scripts/restricted-seeders-offline.test.ts : chaque seeder
 * tourne dans un processus ENFANT, sans SEED_FAMILY, sur une copie de la base
 * d'essai sans la famille ; un module chargé par `NODE_OPTIONS=--import`
 * remplace `fetch`, note chaque adresse demandée et répond 503 ; un faux `git`
 * en tête du PATH remplace le clonage de SwiftCodes. Aucune requête ne sort.
 * Réseau en panne, les seeders publics échouent (c'est attendu) : ce qui compte
 * ici, c'est la liste des adresses qu'ils ont tenté de lire.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

/** Les hôtes des sources de la famille, qu'un robot public ne doit jamais demander. */
const FAMILY_HOSTS = [
  'oenb.at',
  'nbp.pl',
  'ebaclearing.eu',
  'nbb.be',
  'bcsm.sm',
  'bankofengland.co.uk',
  'un.org',
  'europeanpaymentscouncil.eu',
];

const OFFLINE_FETCH = `
import { appendFileSync } from 'node:fs';
const journal = process.env.RESEAU_EN_PANNE_JOURNAL;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (journal) appendFileSync(journal, url + '\\n');
  return new Response('indisponible', { status: 503, statusText: 'Service Unavailable' });
};
`;

/** Un clone vide : le seeder SwiftCodes n'y trouve aucun fichier, sans réseau. */
const FAKE_GIT = `#!/bin/sh
for last; do :; done
mkdir -p "$last/AllCountries"
`;

describe('les robots publics ne demandent jamais une source de la famille', () => {
  let fixture: RestrictedFixture;
  let dir: string;
  let preload: string;
  let fakeBin: string;

  beforeAll(() => {
    fixture = installRestrictedFixture();
    dir = mkdtempSync(join(tmpdir(), 'ibf-robots-publics-'));
    preload = join(dir, 'reseau-en-panne.mjs');
    writeFileSync(preload, OFFLINE_FETCH);
    fakeBin = join(dir, 'bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'git'), FAKE_GIT);
    chmodSync(join(fakeBin, 'git'), 0o755);
  }, 120_000);

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await fixture.restore();
  });

  /** La base publique de demain : la base d'essai sans la famille. */
  function workCopy(name: string, kind: 'bic' | 'compliance'): string {
    const work = join(dir, `${name}.sqlite`);
    copyFileSync(kind === 'bic' ? fixture.bicPath : fixture.compliancePath, work);
    stripFamily(work, kind);
    return work;
  }

  /** L'environnement d'un robot public : ni SEED_FAMILY, ni base de la CI, un réseau en panne. */
  function childEnv(journal: string, extra: Record<string, string>): NodeJS.ProcessEnv {
    const base = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) =>
          !k.startsWith('GITHUB_') &&
          !k.startsWith('SEED_') &&
          !['NODE_OPTIONS', 'BIC_DB_PATH', 'COMPLIANCE_DB_PATH'].includes(k),
      ),
    );
    return {
      ...base,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      RESEAU_EN_PANNE_JOURNAL: journal,
      SEED_TMP_DIR: join(dir, 'tmp'),
      ...extra,
    };
  }

  function run(script: string, args: string[], env: NodeJS.ProcessEnv) {
    return spawnSync(TSX, [join(ROOT, 'scripts', script), ...args], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });
  }

  function requested(journal: string): string[] {
    return existsSync(journal)
      ? readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean)
      : [];
  }

  function familyRequests(urls: string[]): string[] {
    return urls.filter((u) => FAMILY_HOSTS.some((host) => u.includes(host)));
  }

  it('la liste PRA refuse de tourner sans la chaîne privée, avant toute requête', () => {
    const journal = join(dir, 'pra.log');
    const result = run(
      'seed-pra-banks.ts',
      [],
      childEnv(journal, { BIC_DB_PATH: workCopy('pra', 'bic') }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/SEED_FAMILY=restricted/);
    expect(requested(journal)).toEqual([]);
  }, 120_000);

  it.each(['AT', 'BE', 'SM'])(
    'le seeder national refuse %s sans la chaîne privée, avant toute requête',
    (cc) => {
      const journal = join(dir, `national-${cc}.log`);
      const result = run(
        'seed-national.ts',
        [cc],
        childEnv(journal, { BIC_DB_PATH: workCopy(`national-${cc}`, 'bic') }),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/famille sous conditions/);
      expect(requested(journal)).toEqual([]);
    },
    120_000,
  );

  it('le seeder national, sans pays nommé, ne lit que les registres publics', () => {
    const journal = join(dir, 'national.log');
    run('seed-national.ts', [], childEnv(journal, { BIC_DB_PATH: workCopy('national', 'bic') }));
    const urls = requested(journal);
    // La Slovaquie est tentée (et échoue, réseau en panne) ; aucune source de la famille.
    expect(urls.some((u) => u.includes('nbs.sk'))).toBe(true);
    expect(familyRequests(urls)).toEqual([]);
  }, 120_000);

  it("l'enrichissement de l'annuaire ne lit ni l'OeNB, ni la NBP, ni EBA STEP2", () => {
    const journal = join(dir, 'enrich.log');
    run(
      'enrich-bic-database.ts',
      [],
      childEnv(journal, { BIC_DB_PATH: workCopy('enrich', 'bic') }),
    );
    const urls = requested(journal);
    // La Bundesbank est tentée après le faux clonage de SwiftCodes ; rien de la famille.
    expect(urls.some((u) => u.includes('bundesbank.de'))).toBe(true);
    expect(familyRequests(urls)).toEqual([]);
  }, 120_000);

  it("la conformité ne lit ni l'ONU ni l'EPC, et n'écrit rien sous le plancher", () => {
    const journal = join(dir, 'conformite.log');
    const out = workCopy('conformite', 'compliance');
    const before = readFileSync(out);
    const result = run(
      'refresh-compliance.ts',
      [],
      childEnv(journal, { COMPLIANCE_DB_PATH: out, BIC_DB_PATH: workCopy('annuaire', 'bic') }),
    );
    const urls = requested(journal);
    expect(urls.some((u) => u.includes('treasury.gov'))).toBe(true);
    expect(familyRequests(urls)).toEqual([]);
    // Réseau en panne : sous le plancher des sanctions, la base en place reste.
    expect(result.status).toBe(1);
    expect(readFileSync(out).equals(before)).toBe(true);
  }, 120_000);

  it('la même conformité, avec SEED_FAMILY=restricted, lit bien l’ONU et l’EPC (témoin)', () => {
    const journal = join(dir, 'conformite-privee.log');
    run(
      'refresh-compliance.ts',
      [],
      childEnv(journal, {
        COMPLIANCE_DB_PATH: workCopy('conformite-privee', 'compliance'),
        BIC_DB_PATH: workCopy('annuaire-prive', 'bic'),
        SEED_FAMILY: 'restricted',
      }),
    );
    const urls = requested(journal);
    expect(urls.some((u) => u.includes('un.org'))).toBe(true);
    expect(urls.some((u) => u.includes('europeanpaymentscouncil.eu'))).toBe(true);
  }, 120_000);
});
