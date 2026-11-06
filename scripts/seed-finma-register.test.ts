import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFinmaRegisterRows,
  fetchFinmaLicences,
  fetchLeiUids,
  parseLicenceFeed,
  refreshFinmaRegister,
  type ClearingLine,
  type FinmaLicence,
} from './seed-finma-register.js';

/**
 * Le rapprochement du registre FINMA : par identifiants seulement, jamais par un
 * nom. Toutes les banques ici sont inventées ; un nom ne sert qu'à ÉCARTER une
 * ligne, jamais à en rattacher une.
 */

const LICENCE: Omit<FinmaLicence, 'uid'> = {
  licence_type: 'Bank',
  licence_type_de: 'Bank',
  licence_type_fr: 'Banque',
  licence_type_it: 'Banca',
};
const UID_A = 'CHE-111.111.111';
const UID_B = 'CHE-222.222.222';

function line(iid: string, name: string, bic: string | null, hq?: string): ClearingLine {
  return { iid, name, bic, headquarters_iid: hq ?? iid };
}

function build(options: {
  lines: ClearingLine[];
  bicLei?: Record<string, string[]>;
  leiUid?: Record<string, string>;
  licences?: FinmaLicence[];
}) {
  return buildFinmaRegisterRows({
    lines: options.lines,
    bicLei: new Map(Object.entries(options.bicLei ?? {}).map(([k, v]) => [k, new Set(v)])),
    leiUid: new Map(Object.entries(options.leiUid ?? {})),
    licences: options.licences ?? [{ uid: UID_A, ...LICENCE }],
    asOf: '2026-11-04',
  });
}

describe('buildFinmaRegisterRows', () => {
  it('suit la chaîne IID, BIC, LEI, IDE et garde le libellé officiel tel quel', () => {
    const rows = build({
      lines: [line('00100', 'Société Alpha', 'ALPHCHZZXXX')],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA'] },
      leiUid: { LEIALPHA: UID_A },
    });
    expect(rows).toEqual([
      {
        iid: '00100',
        uid: UID_A,
        licence_type: 'Bank',
        licence_type_de: 'Bank',
        licence_type_fr: 'Banque',
        licence_type_it: 'Banca',
        matched_by: 'lei_to_uid',
        as_of: '2026-11-04',
      },
    ]);
  });

  it('porte une ligne par autorisation du même établissement', () => {
    const rows = build({
      lines: [line('00100', 'Société Alpha', 'ALPHCHZZXXX')],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA'] },
      leiUid: { LEIALPHA: UID_A },
      licences: [
        { uid: UID_A, ...LICENCE },
        { uid: UID_A, ...LICENCE, licence_type: 'Custodian bank' },
      ],
    });
    expect(rows.map((r) => r.licence_type).sort()).toEqual(['Bank', 'Custodian bank']);
  });

  it('ne rattache jamais par le nom, même strictement identique', () => {
    const rows = build({
      lines: [line('00100', 'Société Alpha', 'ALPHCHZZXXX')],
      licences: [{ uid: UID_A, ...LICENCE }],
    });
    expect(rows).toEqual([]);
  });

  it('s’arrête quand un BIC porte plusieurs LEI', () => {
    const rows = build({
      lines: [line('00100', 'Société Alpha', 'ALPHCHZZXXX')],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA', 'LEIBETA'] },
      leiUid: { LEIALPHA: UID_A, LEIBETA: UID_A },
    });
    expect(rows).toEqual([]);
  });

  it('s’arrête quand un même BIC est porté par plusieurs noms', () => {
    const rows = build({
      lines: [
        line('00100', 'Société Alpha', 'ALPHCHZZXXX'),
        line('00200', 'Société Beta', 'ALPHCHZZXXX'),
      ],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA'] },
      leiUid: { LEIALPHA: UID_A },
    });
    expect(rows).toEqual([]);
  });

  it('écarte tout un IDE que plusieurs noms différents revendiquent', () => {
    const rows = build({
      lines: [
        line('00100', 'Société Alpha', 'ALPHCHZZXXX'),
        line('00200', 'Société Beta', 'BETACHZZXXX'),
      ],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA'], BETACHZZXXX: ['LEIBETA'] },
      leiUid: { LEIALPHA: UID_A, LEIBETA: UID_A },
    });
    expect(rows).toEqual([]);
  });

  it('tolère une différence de casse ou de ponctuation sur un même IDE', () => {
    const rows = build({
      lines: [
        line('00100', 'Société Alpha & Co', 'ALPHCHZZXXX'),
        line('00200', 'SOCIÉTÉ ALPHA & CO.', 'ALPHCHZZ01A'),
      ],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA'], ALPHCHZZ01A: ['LEIALPHA'] },
      leiUid: { LEIALPHA: UID_A },
    });
    expect(rows.map((r) => r.iid).sort()).toEqual(['00100', '00200']);
  });

  it('rattache au siège une succursale sans LEI, seulement sous le même nom', () => {
    const rows = build({
      lines: [
        line('00100', 'Société Alpha', 'ALPHCHZZXXX'),
        line('00101', 'Société Alpha', 'ALPHCHZZ01A', '00100'),
        line('00102', 'Société Gamma', 'GAMMCHZZ02A', '00100'),
        line('00103', 'Société Alpha', null, '00100'),
      ],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA'] },
      leiUid: { LEIALPHA: UID_A },
    });
    expect(rows.map((r) => [r.iid, r.matched_by])).toEqual([
      ['00100', 'lei_to_uid'],
      ['00101', 'head_office_lei_to_uid'],
    ]);
  });

  it('ne dit rien d’un IDE que le flux ne porte pas', () => {
    const rows = build({
      lines: [line('00100', 'Société Alpha', 'ALPHCHZZXXX')],
      bicLei: { ALPHCHZZXXX: ['LEIALPHA'] },
      leiUid: { LEIALPHA: UID_B },
    });
    expect(rows).toEqual([]);
  });
});

describe('parseLicenceFeed', () => {
  const row = {
    uid: UID_A,
    entity_type: 'bank',
    ...LICENCE,
  };
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...row,
      uid: `CHE-${String(100 + i)}.111.111`,
    }));

  it('ne garde que les champs attendus des catégories retenues', () => {
    const feed = parseLicenceFeed(
      {
        collected_on: '2026-11-04',
        rows: [
          ...many(300),
          // Rien d'autre que l'IDE et le libellé n'entre, même si le flux le portait.
          { ...row, uid: 'CHE-999.999.999', is_warning_listed: true, name: 'Société Alpha' },
          { ...row, uid: 'CHE-888.888.888', entity_type: 'asset_manager_individual' },
          { ...row, uid: 'CHE-777.777.777', entity_type: 'supervisory_org' },
        ],
      },
      new Date('2026-11-06T00:00:00Z'),
    );
    expect(feed.asOf).toBe('2026-11-04');
    const kept = feed.licences.find((l) => l.uid === 'CHE-999.999.999');
    expect(kept).toEqual({ uid: 'CHE-999.999.999', ...LICENCE });
    expect(feed.licences.some((l) => l.uid === 'CHE-888.888.888')).toBe(false);
    expect(feed.licences.some((l) => l.uid === 'CHE-777.777.777')).toBe(false);
  });

  it.each([
    ['sans date', { rows: many(300) }],
    ['date illisible', { collected_on: 'hier', rows: many(300) }],
    ['date trop ancienne', { collected_on: '2026-01-01', rows: many(300) }],
    ['date à venir', { collected_on: '2026-12-01', rows: many(300) }],
    ['flux tronqué', { collected_on: '2026-11-04', rows: many(20) }],
    ['pas de lignes', { collected_on: '2026-11-04' }],
    ['ni objet ni liste', 'bonjour'],
  ])('refuse un flux : %s', (_name, payload) => {
    expect(() => parseLicenceFeed(payload, new Date('2026-11-06T00:00:00Z'))).toThrow();
  });

  it('écarte une ligne dont l’IDE ou le libellé est illisible', () => {
    const feed = parseLicenceFeed(
      {
        collected_on: '2026-11-04',
        rows: [...many(300), { ...row, uid: 'pas-un-ide' }, { ...row, licence_type: '' }],
      },
      new Date('2026-11-06T00:00:00Z'),
    );
    expect(feed.licences).toHaveLength(300);
  });
});

describe('fetchFinmaLicences', () => {
  const ok = { collected_on: '2026-11-04', rows: [] };

  it('envoie le jeton seulement s’il est posé', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ok)));
    await fetchFinmaLicences({ url: 'https://example.net/f', token: 'secret', fetchImpl });
    const headers = (fetchImpl.mock.calls[0] as unknown[])[1] as { headers: Headers };
    expect(new Headers(headers.headers).get('authorization')).toBe('Bearer secret');

    fetchImpl.mockClear();
    await fetchFinmaLicences({ url: 'https://example.net/f', fetchImpl });
    const bare = (fetchImpl.mock.calls[0] as unknown[])[1] as { headers: Headers };
    expect(new Headers(bare.headers).has('authorization')).toBe(false);
  });

  it('lève sur une réponse en erreur', async () => {
    const fetchImpl = vi.fn(async () => new Response('non', { status: 404 }));
    await expect(fetchFinmaLicences({ url: 'https://example.net/f', fetchImpl })).rejects.toThrow(
      /404/,
    );
  });
});

describe('fetchLeiUids', () => {
  it('ne garde que les IDE suisses des enregistrements valables', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              record('LEIA', 'CHE-111.111.111', 'ISSUED'),
              record('LEIB', 'CHE222222222', 'LAPSED'),
              record('LEIC', 'HRB 1234', 'ISSUED'),
              record('LEID', 'CHE-444.444.444', 'ANNULLED'),
              record('LEIE', 'CHE-555', 'ISSUED'),
            ],
          }),
        ),
    );
    const uids = await fetchLeiUids(['LEIA', 'LEIB', 'LEIC', 'LEID', 'LEIE'], {
      fetchImpl,
      pauseMs: 0,
    });
    expect([...uids.entries()]).toEqual([
      ['LEIA', 'CHE-111.111.111'],
      ['LEIB', 'CHE-222.222.222'],
    ]);
  });

  it('lit par paquets et lève si un paquet échoue', async () => {
    const leis = Array.from({ length: 150 }, (_, i) => `LEI${i}`);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(new Response('panne', { status: 500 }));
    await expect(fetchLeiUids(leis, { fetchImpl, pauseMs: 0 })).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  function record(lei: string, registeredAs: string, status: string) {
    return {
      id: lei,
      attributes: { entity: { registeredAs }, registration: { status } },
    };
  }
});

describe('refreshFinmaRegister', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Un annuaire, une base de travail et une base précédente dans un dossier jetable. */
  function setup(rowsInPrevious = 0) {
    const dir = mkdtempSync(join(tmpdir(), 'ibanforge-finma-'));
    dirs.push(dir);
    const bicPath = join(dir, 'bic.sqlite');
    const bic = new Database(bicPath);
    bic.exec(`CREATE TABLE ch_clearing (iid TEXT, name TEXT, bic TEXT, headquarters_iid TEXT);
              CREATE TABLE bic_entries (bic11 TEXT, lei TEXT);`);
    bic
      .prepare('INSERT INTO ch_clearing VALUES (?, ?, ?, ?)')
      .run('00100', 'Société Alpha', 'ALPHCHZZXXX', '00100');
    bic.prepare('INSERT INTO bic_entries VALUES (?, ?)').run('ALPHCHZZXXX', 'LEIALPHA');
    bic.close();

    const previousPath = join(dir, 'previous.sqlite');
    const previous = new Database(previousPath);
    previous.exec(`CREATE TABLE finma_register (
      iid TEXT, uid TEXT, licence_type TEXT, licence_type_de TEXT, licence_type_fr TEXT,
      licence_type_it TEXT, matched_by TEXT, as_of TEXT)`);
    for (let i = 0; i < rowsInPrevious; i++) {
      previous
        .prepare('INSERT INTO finma_register VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`9${i}`, UID_A, 'Bank', 'Bank', 'Banque', 'Banca', 'lei_to_uid', '2026-10-20');
    }
    previous.close();

    const target = new Database(join(dir, 'work.sqlite'));
    target.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    return { target, bicPath, previousPath };
  }

  it('écrit les lignes quand tout répond', async () => {
    const { target, bicPath, previousPath } = setup();
    const outcome = await refreshFinmaRegister(target, {
      bicDbPath: bicPath,
      previousDbPath: previousPath,
      minRows: 1,
      loadFeed: async () => ({ asOf: '2026-11-04', licences: [{ uid: UID_A, ...LICENCE }] }),
      loadLeiUids: async () => new Map([['LEIALPHA', UID_A]]),
    });
    expect(outcome).toEqual({ state: 'fresh', rows: 1, as_of: '2026-11-04' });
    const row = target.prepare('SELECT * FROM finma_register').get() as Record<string, unknown>;
    expect(row).toMatchObject({ iid: '00100', uid: UID_A, as_of: '2026-11-04' });
    target.close();
  });

  it('reprend la copie précédente, sa date d’origine gardée, quand la source tombe', async () => {
    const { target, bicPath, previousPath } = setup(3);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = await refreshFinmaRegister(target, {
      bicDbPath: bicPath,
      previousDbPath: previousPath,
      loadFeed: async () => {
        throw new Error('HTTP 404');
      },
      loadLeiUids: async () => new Map(),
    });
    expect(outcome).toEqual({ state: 'carried_over', rows: 3, as_of: '2026-10-20' });
    const dates = target.prepare('SELECT DISTINCT as_of FROM finma_register').all();
    expect(dates).toEqual([{ as_of: '2026-10-20' }]);
    target.close();
  });

  it('reprend aussi quand le rapprochement passe sous son plancher', async () => {
    const { target, bicPath, previousPath } = setup(2);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = await refreshFinmaRegister(target, {
      bicDbPath: bicPath,
      previousDbPath: previousPath,
      minRows: 100,
      loadFeed: async () => ({ asOf: '2026-11-04', licences: [{ uid: UID_A, ...LICENCE }] }),
      loadLeiUids: async () => new Map([['LEIALPHA', UID_A]]),
    });
    expect(outcome.state).toBe('carried_over');
    target.close();
  });

  it('n’écrit rien, sans lever, sans source ni copie précédente', async () => {
    const { target, bicPath } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = await refreshFinmaRegister(target, {
      bicDbPath: bicPath,
      previousDbPath: join(tmpdir(), 'absente-finma.sqlite'),
      loadFeed: async () => {
        throw new Error('HTTP 404');
      },
      loadLeiUids: async () => new Map(),
    });
    expect(outcome).toEqual({ state: 'absent', rows: 0, as_of: null });
    const table = target
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'finma_register'")
      .get();
    expect(table).toBeUndefined();
    target.close();
  });
});
