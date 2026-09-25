import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  REGISTRY_FILES,
  SCHWIFTY_INDEX_URL,
  curatedRowsFromMap,
  parseFiList,
  parseRegistry,
  pickWheel,
  seedCuratedMap,
  type CuratedFetch,
} from './seed-curated-map.js';
import { SEED_REPORT_ENV, readSeedReport } from './seed-report.js';
import { RESTRICTED_FLOORS } from '../src/lib/restricted-family.js';

/**
 * Le seeder des membres venus après la première surcouche, sans réseau : une
 * fausse roue schwifty (archive ZIP construite ici, registres INVENTÉS, BIC
 * `XMP…`) servie par une doublure de `fetch`, avec l'index PyPI qui l'annonce.
 */

/** Une archive ZIP minimale (entrées compressées en deflate). */
function buildZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const compressed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/** Un registre schwifty inventé : n codes, un BIC `XMP…` par pays. */
function registry(cc: 'PL' | 'FI' | 'LU', n: number): string {
  const entries = Array.from({ length: n }, (_, i) => ({
    country_code: cc,
    primary: true,
    bic: `XMP${cc}${cc === 'FI' ? 'FIH1' : cc === 'PL' ? 'PLPW' : 'LULL'}`.slice(0, 8),
    bank_code: cc === 'PL' ? String(99900000 + i) : String(100 + i).padStart(3, '0'),
    name: `Remplissage ${cc} ${i}`,
    short_name: `Remplissage ${cc}`,
  }));
  return JSON.stringify(entries);
}

const WHEEL_URL = 'https://files.example.invalid/schwifty-2099.1.0-py3-none-any.whl';

function fakeNetwork(
  wheel: Buffer,
  options: { sha256?: string; indexStatus?: number } = {},
): {
  fetchImpl: CuratedFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const index = {
    info: { version: '2099.1.0' },
    urls: [
      {
        packagetype: 'sdist',
        filename: 'schwifty-2099.1.0.tar.gz',
        url: 'https://files.example.invalid/schwifty-2099.1.0.tar.gz',
        digests: { sha256: '0'.repeat(64) },
        upload_time_iso_8601: '2099-01-02T03:04:05.000000Z',
      },
      {
        packagetype: 'bdist_wheel',
        filename: 'schwifty-2099.1.0-py3-none-any.whl',
        url: WHEEL_URL,
        digests: { sha256: options.sha256 ?? createHash('sha256').update(wheel).digest('hex') },
        upload_time_iso_8601: '2099-01-02T03:04:05.000000Z',
      },
    ],
  };
  const fetchImpl: CuratedFetch = async (url) => {
    urls.push(url);
    if (url === SCHWIFTY_INDEX_URL) {
      const status = options.indexStatus ?? 200;
      return {
        ok: status === 200,
        status,
        json: async () => index,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    if (url === WHEEL_URL)
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () =>
          wheel.buffer.slice(wheel.byteOffset, wheel.byteOffset + wheel.byteLength) as ArrayBuffer,
      };
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  return { fetchImpl, urls };
}

describe('seed-curated-map : clés PL, FI, LU et liste finlandaise, sans réseau', () => {
  let dir: string;
  let db: Database.Database;
  let report: string;
  const savedReport = process.env[SEED_REPORT_ENV];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ibf-carte-'));
    db = new Database(join(dir, 'travail.sqlite'));
    report = join(dir, 'rapport.jsonl');
    process.env[SEED_REPORT_ENV] = report;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    if (savedReport === undefined) delete process.env[SEED_REPORT_ENV];
    else process.env[SEED_REPORT_ENV] = savedReport;
  });

  const states = (): Record<string, string> =>
    Object.fromEntries(
      [...readSeedReport(report).values()].map((r) => [
        r.member,
        `${r.state}:${r.cause ?? r.processed}`,
      ]),
    );

  it('roue vérifiée : une clé par code, datée de la publication, créditée ; la liste statique dite', async () => {
    const wheel = buildZip({
      [REGISTRY_FILES.PL[0]!]: registry('PL', RESTRICTED_FLOORS.map_pl + 3),
      [REGISTRY_FILES.FI[0]!]: registry('FI', RESTRICTED_FLOORS.map_fi + 3),
      [REGISTRY_FILES.LU[1]!]: registry('LU', RESTRICTED_FLOORS.map_lu + 3),
      'schwifty/__init__.py': '',
    });
    const net = fakeNetwork(wheel);
    const result = await seedCuratedMap({ db, fetchImpl: net.fetchImpl, log: () => {} });
    expect(result.release).toMatchObject({ version: '2099.1.0', published: '2099-01-02' });
    expect(states()).toEqual({
      map_pl: `loaded:${RESTRICTED_FLOORS.map_pl + 3}`,
      map_fi: `loaded:${RESTRICTED_FLOORS.map_fi + 3}`,
      map_lu: `loaded:${RESTRICTED_FLOORS.map_lu + 3}`,
      register_fi: 'failed:static_list',
    });
    const rows = db
      .prepare(
        'SELECT country, COUNT(*) AS n, MIN(as_of) AS d, MIN(source) AS s FROM curated_bank_codes GROUP BY country',
      )
      .all() as Array<{ country: string; n: number; d: string; s: string }>;
    expect(rows.map((r) => [r.country, r.n, r.d])).toEqual([
      ['FI', RESTRICTED_FLOORS.map_fi + 3, '2099-01-02'],
      ['LU', RESTRICTED_FLOORS.map_lu + 3, '2099-01-02'],
      ['PL', RESTRICTED_FLOORS.map_pl + 3, '2099-01-02'],
    ]);
    expect(rows.find((r) => r.country === 'PL')!.s).toBe(
      'mdomke/schwifty 2099.1.0 (MIT), compiled from Narodowy Bank Polski, EWIB',
    );
    // Les BIC finlandais sous leur forme à onze caractères, comme la carte d'avant ;
    // les autres tels que la compilation les donne.
    const lengths = (cc: string) =>
      db
        .prepare('SELECT DISTINCT length(bic) AS n FROM curated_bank_codes WHERE country = ?')
        .all(cc);
    expect(lengths('FI')).toEqual([{ n: 11 }]);
    expect(lengths('LU')).toEqual([{ n: 8 }]);
    // La liste finlandaise n'est jamais tirée de la roue : aucune table.
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'fi_monetary_codes'").get(),
    ).toBeUndefined();
    expect(net.urls).toEqual([SCHWIFTY_INDEX_URL, WHEEL_URL]);
  });

  it('empreinte différente de celle de l’index : rien n’est écrit, chaque membre en panne', async () => {
    const wheel = buildZip({ [REGISTRY_FILES.PL[0]!]: registry('PL', RESTRICTED_FLOORS.map_pl) });
    const net = fakeNetwork(wheel, { sha256: 'f'.repeat(64) });
    await seedCuratedMap({ db, fetchImpl: net.fetchImpl, log: () => {} });
    expect(states()).toEqual({
      map_pl: 'failed:download_failed',
      map_fi: 'failed:download_failed',
      map_lu: 'failed:download_failed',
      register_fi: 'failed:static_list',
    });
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'curated_bank_codes'").get(),
    ).toBeUndefined();
  });

  it('index indisponible : cause http_<statut>, et la roue n’est pas demandée', async () => {
    const net = fakeNetwork(buildZip({}), { indexStatus: 503 });
    await seedCuratedMap({ db, fetchImpl: net.fetchImpl, log: () => {} });
    expect(states().map_pl).toBe('failed:http_503');
    expect(net.urls).toEqual([SCHWIFTY_INDEX_URL]);
  });

  it('un registre sous son plancher ou absent de la roue : ce membre seul en panne', async () => {
    const wheel = buildZip({
      [REGISTRY_FILES.PL[0]!]: registry('PL', RESTRICTED_FLOORS.map_pl + 1),
      [REGISTRY_FILES.FI[0]!]: registry('FI', 5),
    });
    await seedCuratedMap({ db, fetchImpl: fakeNetwork(wheel).fetchImpl, log: () => {} });
    expect(states()).toMatchObject({
      map_pl: `loaded:${RESTRICTED_FLOORS.map_pl + 1}`,
      map_fi: 'failed:below_floor',
      map_lu: 'failed:missing_file',
    });
  });

  it('FI_LIST_PATH : la liste finlandaise est chargée du fichier, contrôlée', async () => {
    const list = join(dir, 'liste-fi.json');
    writeFileSync(
      list,
      JSON.stringify({
        as_of: '2099-01-15',
        source: 'Remplissage',
        codes: Array.from({ length: RESTRICTED_FLOORS.register_fi + 1 }, (_, i) => ({
          code: String(9000 + i),
          bic: 'XMPRFIH1',
          institution: `Remplissage FI ${i}`,
        })),
      }),
    );
    const net = fakeNetwork(buildZip({}), { indexStatus: 503 });
    await seedCuratedMap({ db, fetchImpl: net.fetchImpl, fiListPath: list, log: () => {} });
    expect(states().register_fi).toBe(`loaded:${RESTRICTED_FLOORS.register_fi + 1}`);
    const row = db
      .prepare('SELECT COUNT(*) AS n, MIN(as_of) AS d FROM fi_monetary_codes')
      .get() as { n: number; d: string };
    expect(row).toEqual({ n: RESTRICTED_FLOORS.register_fi + 1, d: '2099-01-15' });
  });
});

describe('seed-curated-map : lectures', () => {
  it('pickWheel refuse une forme inattendue', () => {
    expect(() => pickWheel({})).toThrow(/version/);
    expect(() => pickWheel({ info: { version: '1.0' }, urls: [] })).toThrow(/roue/);
  });

  it('parseRegistry : un code par clé, la ligne primaire l’emporte, les formes fausses écartées', () => {
    const text = JSON.stringify([
      { country_code: 'LU', bank_code: '001', bic: 'XMPLLULL', primary: false },
      { country_code: 'LU', bank_code: '001', bic: 'XMPALULL', primary: true },
      { country_code: 'LU', bank_code: '12', bic: 'XMPBLULL', primary: true },
      { country_code: 'LU', bank_code: '002', bic: 'pas-un-bic', primary: true },
      { country_code: 'BE', bank_code: '003', bic: 'XMPCBEBB', primary: true },
    ]);
    const parsed = parseRegistry('LU', [text]);
    expect(parsed.rows.map((r) => [r.code, r.bic])).toEqual([['001', 'XMPALULL']]);
    expect(parsed.skipped).toBe(3);
  });

  it('curatedRowsFromMap : seules les clés PL, FI, LU, dans leur forme', () => {
    const rows = curatedRowsFromMap(
      JSON.stringify({
        'PL:99900000': { bic: 'XMPPPLPW' },
        'FI:500': { bic: 'XMPMFIH1' },
        'LU:800': { bic: 'XMPMLULL' },
        'DE:10000000': { bic: 'XMPDDEFF' },
      }),
    );
    expect(rows).toEqual({
      PL: [{ code: '99900000', bic: 'XMPPPLPW' }],
      FI: [{ code: '500', bic: 'XMPMFIH1' }],
      LU: [{ code: '800', bic: 'XMPMLULL' }],
    });
    expect(() => curatedRowsFromMap(JSON.stringify({ 'PL:12': { bic: 'XMPPPLPW' } }))).toThrow();
  });

  it('parseFiList refuse un code en double ou une ligne incomplète', () => {
    const ok = {
      as_of: '2099-01-15',
      source: 'x',
      codes: [{ code: '1', bic: 'XMPRFIH1', institution: 'A' }],
    };
    expect(parseFiList(JSON.stringify(ok)).codes).toHaveLength(1);
    expect(() =>
      parseFiList(JSON.stringify({ ...ok, codes: [...ok.codes, ...ok.codes] })),
    ).toThrow();
    expect(() => parseFiList(JSON.stringify({ ...ok, as_of: 'hier' }))).toThrow();
    expect(() =>
      parseFiList(
        JSON.stringify({ ...ok, codes: [{ code: '12345', bic: 'XMPRFIH1', institution: 'A' }] }),
      ),
    ).toThrow();
  });
});
