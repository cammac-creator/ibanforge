import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
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
import { SEED_REPORT_ENV, readSeedReport } from './seed-report.js';
import { membersOf } from '../src/lib/restricted-family.js';
import { stripFamily } from '../src/lib/restricted-overlay.js';
import {
  installRestrictedFixture,
  type RestrictedFixture,
} from '../src/test-support/restricted-fixtures.js';

/**
 * Les VRAIS seeders de la famille, lancés comme `overlay seed` les lance
 * (SEED_FAMILY=restricted, SEED_REPORT_PATH), sur une copie de la base d'essai
 * (famille inventée), avec un réseau en panne : un module chargé par
 * `NODE_OPTIONS=--import` dans le processus ENFANT seulement remplace `fetch`,
 * note chaque adresse demandée et répond 503. Aucune requête ne sort.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const SEEDERS = [
  'enrich-bic-database.ts',
  'seed-national.ts',
  'seed-pra-banks.ts',
  'seed-curated-map.ts',
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

describe('les seeders de la famille, source en panne, sans réseau', () => {
  let fixture: RestrictedFixture;
  let dir: string;
  let preload: string;

  beforeAll(() => {
    fixture = installRestrictedFixture();
    dir = mkdtempSync(join(tmpdir(), 'ibf-seeders-en-panne-'));
    preload = join(dir, 'reseau-en-panne.mjs');
    writeFileSync(preload, OFFLINE_FETCH);
  }, 120_000);

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await fixture.restore();
  });

  /** Une base de travail comme celle de `overlay seed` : la base d'essai sans la famille. */
  function workCopy(name: string): string {
    const work = join(dir, `${name}.sqlite`);
    copyFileSync(fixture.bicPath, work);
    stripFamily(work, 'bic');
    return work;
  }

  /** L'environnement de l'enfant : celui du test sans variable de CI ni de base, plus les nôtres. */
  function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
    const base = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) =>
          !k.startsWith('GITHUB_') &&
          !k.startsWith('SEED_') &&
          !['NODE_OPTIONS', 'BIC_DB_PATH', 'COMPLIANCE_DB_PATH'].includes(k),
      ),
    );
    return { ...base, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, ...extra };
  }

  function run(script: string, env: NodeJS.ProcessEnv) {
    return spawnSync(TSX, [join(ROOT, 'scripts', script)], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });
  }

  it('chaque membre est noté en échec avec un code, les pays suivants sont tentés, la Tchéquie n’est pas lue', () => {
    const work = workCopy('travail');
    const report = join(dir, 'rapport.jsonl');
    const journal = join(dir, 'adresses.log');
    const env = childEnv({
      BIC_DB_PATH: work,
      SEED_FAMILY: 'restricted',
      SEED_TMP_DIR: join(dir, 'tmp'),
      [SEED_REPORT_ENV]: report,
      RESEAU_EN_PANNE_JOURNAL: journal,
    });
    for (const script of SEEDERS) {
      const result = run(script, env);
      expect(result.status, `${script}\n${result.stderr}`).toBe(0);
    }

    const states = Object.fromEntries(
      [...readSeedReport(report).values()].map((r) => [r.member, `${r.state}:${r.cause}`]),
    );
    expect(states).toEqual({
      oenb: 'failed:http_503',
      nbp: 'failed:http_503',
      eba_step2: 'failed:download_failed',
      register_at: 'failed:http_503',
      register_be: 'failed:http_503',
      register_sm: 'failed:http_503',
      register_il: 'failed:http_503',
      register_mn: 'failed:http_503',
      // Les licences des BIK russes tombent avec leur répertoire, même cause.
      register_ru: 'failed:http_503',
      register_ru_licences: 'failed:http_503',
      // La liste d'e-nettet : un seul fichier pour les trois pays, une seule cause.
      register_dk: 'failed:http_503',
      register_fo: 'failed:http_503',
      register_gl: 'failed:http_503',
      pra: 'failed:download_failed',
      map_pl: 'failed:http_503',
      map_fi: 'failed:http_503',
      map_lu: 'failed:http_503',
      ...Object.fromEntries(
        ['tr', 'ae', 'ba', 'ge', 'kz', 'md', 'ee', 'rs', 'it', 'es', 'ro'].map((cc) => [
          `map_${cc}`,
          'failed:http_503',
        ]),
      ),
      // La liste finlandaise est statique : jamais téléchargée, recopiée par `seed`.
      register_fi: 'failed:static_list',
    });
    expect(Object.keys(states).sort()).toEqual(
      membersOf('bic')
        .map((m) => m.id)
        .sort(),
    );

    // Chaque requête est passée par le faux réseau ; aucune vers la Tchéquie.
    const urls = readFileSync(journal, 'utf8').trim().split('\n');
    expect(urls.length).toBeGreaterThan(7);
    expect(urls.filter((u) => u.includes('cnb.cz'))).toEqual([]);
    for (const host of [
      'oenb.at',
      'nbp.pl',
      'ebaclearing.eu',
      'nbb.be',
      'bcsm.sm',
      'data.gov.il',
      'mongolbank.mn',
      'cbr.ru',
      // La page d'e-nettet, puis l'adresse connue du fichier quand elle ne répond pas.
      'iban-denmark.com',
      'e-nettet.dk',
      'bankofengland.co.uk',
      'pypi.org',
    ])
      expect(
        urls.some((u) => u.includes(host)),
        host,
      ).toBe(true);

    // La base de travail ne porte aucune ligne de la famille : rien d'inventé.
    const db = new Database(work, { readonly: true });
    try {
      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      expect(
        count("SELECT COUNT(*) AS n FROM bic_entries WHERE source IN ('oenb', 'nbp', 'eba_step2')"),
      ).toBe(0);
      expect(
        count(
          "SELECT COUNT(*) AS n FROM national_bank_codes WHERE country IN ('AT', 'BE', 'SM', 'IL', 'MN', 'RU', 'DK', 'FO', 'GL')",
        ),
      ).toBe(0);
      expect(count('SELECT COUNT(*) AS n FROM pra_banks')).toBe(0);
      // Les membres tardifs : aucune table créée pour rien quand la source est en panne.
      expect(
        count(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('curated_bank_codes', 'fi_monetary_codes', 'ru_bik_licences')",
        ),
      ).toBe(0);
    } finally {
      db.close();
    }
  }, 240_000);

  it('FI_LIST_PATH désigné mais illisible : le seeder de la carte sort en erreur, le passage s’arrête', () => {
    // Relecture de la PR 267, point 5. Le code 1 fait lever `runSeeder`
    // (scripts/restricted-overlay.ts) : `overlay seed` s'arrête avant l'extraction,
    // rien n'est publié, et l'ancienne liste n'est jamais reprise.
    const work = workCopy('liste-fi-illisible');
    const report = join(dir, 'rapport-liste-fi.jsonl');
    const result = run(
      'seed-curated-map.ts',
      childEnv({
        BIC_DB_PATH: work,
        SEED_FAMILY: 'restricted',
        [SEED_REPORT_ENV]: report,
        FI_LIST_PATH: join(dir, 'liste-fi-absente.json'),
      }),
    );
    expect(result.status, result.stderr).toBe(1);
    const reported = [...readSeedReport(report).values()].map((r) => r.member);
    expect(reported).not.toContain('register_fi');
    expect(reported).toContain('map_pl');
  }, 120_000);

  it('sans SEED_REPORT_PATH, le seeder national s’arrête au premier pays en panne, comme avant', () => {
    const work = workCopy('sans-rapport');
    const journal = join(dir, 'adresses-sans-rapport.log');
    const result = run(
      'seed-national.ts',
      childEnv({
        BIC_DB_PATH: work,
        SEED_FAMILY: 'restricted',
        RESEAU_EN_PANNE_JOURNAL: journal,
      }),
    );
    expect(result.status).toBe(1);
    const urls = readFileSync(journal, 'utf8').trim().split('\n');
    // Le premier pays (l'Autriche) échoue et rien d'autre n'est tenté.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('oenb.at');
  }, 120_000);

  // Relecture de la PR 638, point 5 : en mode famille, le seeder national refuse une
  // base située dans un dépôt git (la garde des surcouches, assertOutsideRepository),
  // avant d'ouvrir la base et avant toute requête. Jamais essayé sur le chemin par
  // défaut : si la garde reculait, il ouvrirait la base suivie de ce dépôt.
  it('SEED_FAMILY=restricted : une base dans un dépôt git est refusée, avant toute requête, sans rien créer', () => {
    const repo = join(dir, 'depot-jetable');
    mkdirSync(repo);
    const gitEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
    );
    const init = spawnSync('git', ['init', '-q', repo], { env: gitEnv, encoding: 'utf8' });
    expect(init.status, init.stderr).toBe(0);
    const target = join(repo, 'data', 'bic.sqlite');
    const journal = join(dir, 'adresses-depot-git.log');
    const result = run(
      'seed-national.ts',
      childEnv({
        BIC_DB_PATH: target,
        SEED_FAMILY: 'restricted',
        RESEAU_EN_PANNE_JOURNAL: journal,
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Écriture refusée dans un dépôt git/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(repo, 'data'))).toBe(false);
    expect(existsSync(journal)).toBe(false);
  }, 120_000);
});
