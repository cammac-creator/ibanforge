import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Le plancher par source sur le VRAI script de rafraîchissement, réseau simulé.
 *
 * ## Ce que ce fichier prouve
 *
 * Du 12.07 au 04.10.2026, la liste SECO n'a jamais pu être lue, rien n'était à
 * reprendre, et le robot publiait chaque dimanche une base sans la liste suisse,
 * en vert. Ici, le script tourne dans un processus ENFANT (comme dans le
 * workflow), sans SEED_FAMILY, avec un `fetch` remplacé par un module chargé
 * par `NODE_OPTIONS=--import` qui sert des fichiers inventés par adresse :
 * - toutes les listes lisibles : la base part, avec SECO et la taille de chaque
 *   liste dans `metadata` ;
 * - SECO en panne et rien à reprendre : le script échoue et la base en place
 *   ne bouge pas d'un octet ;
 * - SECO réduite d'un tiers, UE sans plus aucun BIC, base précédente récente :
 *   les deux sont reprises, et la mesure de référence reste la bonne.
 * Aucune requête ne sort.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

const FAKE_FETCH = `
import { readFileSync } from 'node:fs';
const routes = JSON.parse(readFileSync(process.env.FAUX_RESEAU, 'utf8'));
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  for (const [needle, answer] of Object.entries(routes)) {
    if (!url.includes(needle)) continue;
    if (typeof answer === 'number') return new Response('erreur', { status: answer });
    return new Response(readFileSync(answer));
  }
  return new Response('indisponible', { status: 503 });
};
`;

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Un BIC inventé et valide par indice : O + trois lettres + IR + TH. */
const bicFor = (prefix: string, i: number) =>
  `${prefix}${A[Math.floor(i / 676) % 26]}${A[Math.floor(i / 26) % 26]}${A[i % 26]}IRTH`;

/** Un fichier SDN : `rows` lignes, dont `banks` portent un « SWIFT/BIC ». */
function sdnCsv(rows: number, banks: number): string {
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const remarks = i < banks ? `SWIFT/BIC ${bicFor('O', i)}` : '-0-';
    out.push(
      `${i + 1},"ENTITY ${i}","-0-","IRAN","-0-","-0-","-0-","-0-","-0-","-0-","-0-","${remarks}"`,
    );
  }
  return out.join('\n') + '\n';
}

/** Le fichier consolidé de l'UE : `rows` lignes, dont `banks` portent un code. */
function euCsv(rows: number, banks: number): string {
  const out = ['fileGenerationDate;Entity_LogicalId;Entity_Remark'];
  for (let i = 1; i < rows; i++) {
    out.push(`2026-10-07;${i};${i <= banks ? `SWIFT/BIC ${bicFor('E', i)}` : 'none'}`);
  }
  return out.join('\n') + '\n';
}

/** La liste SECO complète : `listed` cibles en vigueur, dont deux banques. */
function secoXml(listed: number): string {
  const mod = '<modification modification-type="listed" effective-date="2022-02-28"/>';
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?><swiss-sanctions-list list-type="whole-list" date="2026-09-28">',
  ];
  const bank = (ssid: number, name: string, info: string) =>
    `<target ssid="${ssid}"><sanctions-set-id>1</sanctions-set-id><entity><identity ssid="${ssid}0" main="true"><name><name-part order="1"><value>${name}</value></name-part></name></identity>` +
    `<other-information ssid="${ssid}1">${info}</other-information></entity>${mod}</target>`;
  parts.push(bank(1, 'Alpha Bank Co Ltd', 'SWIFT/BIC code: ALFASDKH and 5040942458'));
  parts.push(bank(2, 'Beta Trust Bankers', 'SWIFT codes: BETAIRTHKSH (Kish), GAMAAEA1 (Dubai)'));
  for (let i = 3; i <= listed; i++) {
    parts.push(
      `<target ssid="${i}"><sanctions-set-id>1</sanctions-set-id><individual><identity ssid="${i}0" main="true"><name><name-part order="1"><value>Person ${i}</value></name-part></name></identity></individual>${mod}</target>`,
    );
  }
  parts.push('</swiss-sanctions-list>');
  return parts.join('');
}

const DAY = 86_400_000;

describe('refresh-compliance : le plancher par source', () => {
  let dir: string;
  let preload: string;
  let bicPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ibf-plancher-'));
    preload = join(dir, 'faux-reseau.mjs');
    writeFileSync(preload, FAKE_FETCH);
    // L'annuaire : la table que le script consulte, vide (tout BIC est « non nommé »).
    bicPath = join(dir, 'bic.sqlite');
    const bic = new Database(bicPath);
    bic.exec('CREATE TABLE bic_entries (bic8 TEXT, institution TEXT)');
    bic.close();
    writeFileSync(join(dir, 'sdn.csv'), sdnCsv(12_000, 60));
    writeFileSync(join(dir, 'eu.csv'), euCsv(25_000, 2));
    writeFileSync(join(dir, 'eu-sans-bic.csv'), euCsv(25_000, 0));
    writeFileSync(join(dir, 'seco.xml'), secoXml(8_000));
    writeFileSync(join(dir, 'seco-reduite.xml'), secoXml(5_000));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** La base « en service » avant le passage. */
  function previousDb(
    name: string,
    opts: { secoRows: boolean; records?: Record<string, number>; ageDays?: number },
  ): string {
    const path = join(dir, `${name}.sqlite`);
    const db = new Database(path);
    db.exec(`
      CREATE TABLE sanctioned_entities (bic8 TEXT NOT NULL, entity_name TEXT, source_list TEXT NOT NULL,
        country_code TEXT, directory_match INTEGER NOT NULL DEFAULT 1, UNIQUE(bic8, source_list));
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO sanctioned_entities VALUES ('OLDAIRTH', 'x', 'OFAC', '', 0),
        ('EUAAIRTH', 'EU-listed entity', 'EU', '', 0), ('EUABIRTH', 'EU-listed entity', 'EU', '', 0);
    `);
    if (opts.secoRows) {
      db.exec(`INSERT INTO sanctioned_entities VALUES ('PREVSDKH', 'Previous Bank', 'SECO', '', 0);
               INSERT INTO metadata VALUES ('seco_list_date', '2026-08-31');`);
    }
    const refreshed = new Date(Date.now() - (opts.ageDays ?? 2) * DAY).toISOString();
    db.prepare(`INSERT INTO metadata VALUES ('last_refresh', ?)`).run(refreshed);
    if (opts.records) {
      db.prepare(`INSERT INTO metadata VALUES ('source_records', ?)`).run(
        JSON.stringify(opts.records),
      );
    }
    db.close();
    return path;
  }

  function run(target: string, routes: Record<string, string | number>) {
    const routesPath = join(dir, `routes-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(routesPath, JSON.stringify(routes));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) =>
          !k.startsWith('GITHUB_') &&
          !k.startsWith('SEED_') &&
          !['NODE_OPTIONS', 'BIC_DB_PATH', 'COMPLIANCE_DB_PATH'].includes(k),
      ),
    );
    return spawnSync(TSX, [join(ROOT, 'scripts', 'refresh-compliance.ts')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...env,
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        FAUX_RESEAU: routesPath,
        COMPLIANCE_DB_PATH: target,
        BIC_DB_PATH: bicPath,
        SEED_TMP_DIR: join(dir, `tmp-${Math.random().toString(36).slice(2)}`),
      },
    });
  }

  const ALL = () => ({
    'ofac/downloads/sdn.csv': join(dir, 'sdn.csv'),
    'ofac/downloads/add.csv': 503,
    'webgate.ec.europa.eu': join(dir, 'eu.csv'),
    'sesam.search.admin.ch': join(dir, 'seco.xml'),
  });

  function read(path: string) {
    const db = new Database(path, { readonly: true });
    const lists = Object.fromEntries(
      (
        db
          .prepare(
            'SELECT source_list, COUNT(*) AS n FROM sanctioned_entities GROUP BY source_list',
          )
          .all() as Array<{ source_list: string; n: number }>
      ).map((r) => [r.source_list, r.n]),
    );
    const meta = Object.fromEntries(
      (
        db.prepare('SELECT key, value FROM metadata').all() as Array<{ key: string; value: string }>
      ).map((r) => [r.key, r.value]),
    );
    const seco = (
      db
        .prepare("SELECT bic8 FROM sanctioned_entities WHERE source_list = 'SECO' ORDER BY bic8")
        .all() as Array<{ bic8: string }>
    ).map((r) => r.bic8);
    db.close();
    return { lists, meta, seco };
  }

  it('toutes les listes lisibles : la base part avec SECO et la taille de chaque liste', () => {
    const target = previousDb('premier-passage', { secoRows: false });
    const result = run(target, ALL());
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const { lists, meta, seco } = read(target);
    expect(lists).toEqual({ OFAC: 60, EU: 2, SECO: 3 });
    expect(seco).toEqual(['ALFASDKH', 'BETAIRTH', 'GAMAAEA1']);
    expect(JSON.parse(meta.source_records)).toEqual({ EU: 25_000, OFAC: 12_000, SECO: 8_000 });
    expect(meta.seco_list_date).toBe('2026-09-28');
    expect(meta.sources.split(',')).toEqual(['EU', 'OFAC', 'SECO', 'FATF']);
    expect(meta.carried_over).toBeUndefined();
  }, 120_000);

  it('SECO en panne et rien à reprendre : échec, et la base en place ne bouge pas', () => {
    const target = previousDb('panne-seco', { secoRows: false });
    const before = readFileSync(target);
    const result = run(target, { ...ALL(), 'sesam.search.admin.ch': 500 });
    expect(result.status).toBe(1);
    const log = result.stdout + result.stderr;
    expect(log).toMatch(/SECO refused: HTTP 500/);
    expect(log).toMatch(
      /Refusing to ship compliance\.sqlite without every public sanctions list: SECO/,
    );
    expect(readFileSync(target).equals(before)).toBe(true);
  }, 120_000);

  it('SECO réduite d’un tiers, UE sans BIC : reprises de la base récente, référence gardée', () => {
    const target = previousDb('reprise', {
      secoRows: true,
      records: { EU: 25_000, OFAC: 12_000, SECO: 8_000 },
    });
    const result = run(target, {
      ...ALL(),
      'webgate.ec.europa.eu': join(dir, 'eu-sans-bic.csv'),
      'sesam.search.admin.ch': join(dir, 'seco-reduite.xml'),
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const log = result.stdout + result.stderr;
    expect(log).toMatch(/SECO refused: 5000 listed targets against 8000/);
    expect(log).toMatch(/EU refused: no bank BIC read/);
    const { lists, meta, seco } = read(target);
    // Les lignes reprises sont celles de la base précédente, pas celles du fichier réduit.
    expect(seco).toEqual(['PREVSDKH']);
    expect(lists.EU).toBe(2);
    expect(meta.carried_over).toMatch(/^EU@.+,SECO@.+$/);
    // La référence de la semaine suivante reste la dernière bonne mesure.
    expect(JSON.parse(meta.source_records)).toEqual({ EU: 25_000, OFAC: 12_000, SECO: 8_000 });
    expect(meta.seco_list_date).toBe('2026-08-31');
  }, 120_000);

  it('SECO refusée et base précédente trop vieille : échec', () => {
    const target = previousDb('trop-vieille', {
      secoRows: true,
      records: { EU: 25_000, OFAC: 12_000, SECO: 8_000 },
      ageDays: 30,
    });
    const before = readFileSync(target);
    const result = run(target, {
      ...ALL(),
      'sesam.search.admin.ch': join(dir, 'seco-reduite.xml'),
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(
      /SECO \(.*nothing carried over: previous_too_old\)/,
    );
    expect(readFileSync(target).equals(before)).toBe(true);
  }, 120_000);
});
