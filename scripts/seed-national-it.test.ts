import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IT_FLOORS,
  ItalianSourceNotLoaded,
  buildItalianRegister,
  ensureRetiredTable,
  giavaDownload,
  giavaDownloadUrl,
  italianSource,
  parseEvents,
  parseGiavaCsv,
  parseIntermediaries,
  readGiavaZip,
  reportItalianStatus,
  seedItalianLive,
  writeItalian,
  type EventRow,
  type IntermediaryRow,
  type ItalianRegister,
} from './seed-national-it.js';
import { ensureNationalTables } from './seed-national.js';

/**
 * Le chargeur du registre italien, tenu sur des fichiers reproduits petits.
 *
 * Tout ce qui est ici a été mesuré sur les vrais fichiers de l'édition du
 * 23/09/2026 : l'en-tête qui s'ouvre sur un BOM et une espace (« \uFEFF ID_INT »),
 * les champs rembourrés d'une espace, les guillemets littéraux d'un intitulé de
 * registre, `COD_MECC` écrit sans zéro de tête, les dates `9999-12-31` des
 * périodes ouvertes. Les historiques de la section « buildItalianRegister »
 * reproduisent des cas réels (réattribution, changement de code, chaîne de
 * fusions, cession) avec des identifiants inventés.
 */

const HEADER = [
  ' ID_INT',
  'COD_MECC',
  'TIPO_ALBO',
  'DES_TIPO_ALBO',
  'DEN_INT',
  'INDIRIZZO_SL',
  'CAP_SL',
  'DES_COM_ITA_SL',
  'COD_LEI',
  'DATA_I_VAL',
  'DATA_F_VAL',
].join(';');

/** Une ligne de l'historique, champs rembourrés d'une espace comme la source les écrit. */
function line(
  id: string,
  code: string,
  register: string,
  name: string,
  from: string,
  to: string,
  extra: { street?: string; cap?: string; town?: string; lei?: string; kind?: string } = {},
): string {
  return [
    id,
    code || ' ',
    register,
    extra.kind ?? 'ALBO DELLE BANCHE',
    name,
    extra.street ?? 'VIA DI ESEMPIO, 1',
    extra.cap ?? '00100',
    extra.town ?? 'ROMA',
    extra.lei ?? ' ',
    from,
    to,
  ].join(';');
}

const INTERMEDIARIES = [
  `\uFEFF${HEADER}`,
  // Une ligne de 1936 sans code mécanographique : écartée, jamais un code.
  line('1', '', '001', 'CREDITO DI ESEMPIO', '1936-12-31', '1960-12-30'),
  // En vigueur, LEI publié.
  line('10', '3069', '001', 'INTESA SANPAOLO S.P.A.', '2008-08-01', '9999-12-31', {
    street: 'PIAZZA SAN CARLO, 156',
    cap: '10121',
    town: 'TORINO',
    lei: '2W8N8UU78PMDQKZENC08',
  }),
  // Un établissement de monnaie électronique (registre 016).
  line('11', '36081', '016', 'POSTEPAY S.P.A.', '2018-11-19', '9999-12-31', {
    kind: 'ALBO DEGLI ISTITUTI DI MONETA ELETTRONICA',
  }),
  // Un registre qui ne porte aucun code d'IBAN (art. 106), guillemets littéraux compris.
  line('12', '19565', '027', 'SOCIETA DI ESEMPIO SPA', '2020-07-01', '9999-12-31', {
    kind: 'ALBO DEGLI INTERMEDIARI FINANZIARI EX ART. 106 TUB (C.D. "ALBO UNICO")',
  }),
  // 03111 : deux titulaires, le dernier radié et incorporé par 03069.
  line('20', '3111', '001', 'BANCA LOMBARDA SOCIETA PER AZIONI', '1998-12-31', '2007-04-01'),
  line('21', '3111', '001', 'UNIONE DI BANCHE ITALIANE S.C.P.A.', '2008-01-01', '2015-10-11'),
  line('21', '3111', '001', 'UNIONE DI BANCHE ITALIANE S.P.A.', '2015-10-12', '2021-04-11'),
  // 05428 : absorbée par 21 (UBI) en 2017, qui l'est par 10 en 2021.
  line('22', '5428', '001', 'BANCA POPOLARE DI BERGAMO S.P.A.', '2003-01-01', '2017-02-19'),
  // 03268 : radiée puis réinscrite le lendemain sous le même code, en vigueur.
  line('30', '3268', '001', 'BANCA SELLA S.P.A.', '1991-11-30', '2005-12-31'),
  line('31', '3268', '001', 'BANCA SELLA - S.P.A.', '2006-01-01', '9999-12-31'),
  // 03181 puis 03479 : la même entité a changé de code.
  line('40', '3181', '001', 'BNP PARIBAS SA', '2001-06-30', '2022-09-30'),
  line('40', '3479', '001', 'BNP PARIBAS SA', '2022-10-01', '9999-12-31'),
  // 05728 : liquidée, actifs cédés à 10 (une cession, pas une incorporation).
  line('50', '5728', '001', 'BANCA POPOLARE DI VICENZA IN LCA', '1990-01-01', '2017-07-19'),
  '',
].join('\n');

const EVENTS = [
  '\uFEFF ID_EVENTO;DATA_EFFICACIA;TIPO_EVENTO;DES_TIPO_EVENTO;ID_INT_ATT;COD_MECC_INT_ATT;DEN_INT_ATT;ID_INT_PAS;COD_MECC_INT_PAS;DEN_INT_PAS',
  '1;2017-02-20;003;INCORPORAZIONE;21;3111;UBI;22;5428;BP BERGAMO',
  '2;2021-04-12;003;INCORPORAZIONE;10;3069;INTESA;21;3111;UBI',
  '3;2017-06-26;001;CESSIONE ATTIVITA/PASSIVITA;10;3069;INTESA;50;5728;BPVI',
  '4;2021-02-22;007;CESSIONE SEDI TRA INTERMEDIARI;60;5387;BPER;21;3111;UBI',
  '',
].join('\n');

const byCode = (reg: ItalianRegister) => ({
  inForce: new Map(reg.inForce.map((c) => [c.code, c])),
  retired: new Map(reg.retired.map((c) => [c.code, c])),
});

describe('parseGiavaCsv', () => {
  it('reads the header through the BOM and the padding, and trims every field', () => {
    const rows = parseGiavaCsv(INTERMEDIARIES, ['ID_INT', 'COD_MECC'], 'intermediaries');
    expect(rows[1].ID_INT).toBe('10');
    expect(rows[1].COD_MECC).toBe('3069');
    expect(rows[0].COD_MECC).toBe('');
  });

  it('keeps literal quotes: they are not delimiters in these files', () => {
    const rows = parseGiavaCsv(INTERMEDIARIES, ['DES_TIPO_ALBO'], 'intermediaries');
    expect(rows[3].DES_TIPO_ALBO).toBe(
      'ALBO DEGLI INTERMEDIARI FINANZIARI EX ART. 106 TUB (C.D. "ALBO UNICO")',
    );
  });

  it('refuses a file whose header lost a column it needs', () => {
    expect(() => parseGiavaCsv('A;B\n1;2\n', ['ID_INT'], 'intermediaries')).toThrow(
      /lacks ID_INT: format changed/,
    );
  });

  it('refuses a line whose field count moved, instead of shifting every column', () => {
    const broken = `${HEADER}\n10;3069;001;ALBO;NAME;VIA X; 1;00100;ROMA; ;2008-08-01;9999-12-31\n`;
    expect(() => parseGiavaCsv(broken, ['ID_INT'], 'intermediaries')).toThrow(
      /line 2 of the intermediaries file has 12 fields where the header has 11/,
    );
  });
});

describe('parseIntermediaries', () => {
  const { rows, total, skipped } = parseIntermediaries(INTERMEDIARIES);

  it('keeps the four IBAN registers only, and pads the code to five digits', () => {
    expect(new Set(rows.map((r) => r.register))).toEqual(new Set(['001', '016']));
    expect(rows.find((r) => r.id === '10')?.code).toBe('03069');
    expect(rows.some((r) => r.code === '19565')).toBe(false);
    expect(total).toBe(13);
  });

  it('leaves out a period with no code, and counts it', () => {
    expect(skipped).toBe(1);
    expect(rows.some((r) => r.name === 'CREDITO DI ESEMPIO')).toBe(false);
  });

  it('reads the registered office in Italy and the LEI, null where blank', () => {
    const intesa = rows.find((r) => r.code === '03069')!;
    expect(intesa).toMatchObject({
      street: 'PIAZZA SAN CARLO, 156',
      post_code: '10121',
      town: 'TORINO',
      lei: '2W8N8UU78PMDQKZENC08',
    });
    expect(rows.find((r) => r.code === '36081')!.lei).toBeNull();
  });
});

describe('parseEvents', () => {
  it('keeps every event with its type, date and the two entities', () => {
    const events = parseEvents(EVENTS);
    expect(events).toHaveLength(4);
    expect(events[1]).toEqual({
      type: '003',
      effective: '2021-04-12',
      active_id: '10',
      passive_id: '21',
    });
  });
});

describe('buildItalianRegister', () => {
  const reg = buildItalianRegister(parseIntermediaries(INTERMEDIARIES).rows, parseEvents(EVENTS));
  const { inForce, retired } = byCode(reg);

  it('puts a code with a holder in force in the table in force, whatever its past', () => {
    expect([...inForce.keys()].sort()).toEqual(['03069', '03268', '03479', '36081']);
    // 03268 was struck off in 2005 and re-registered the next day.
    expect(retired.has('03268')).toBe(false);
    expect(inForce.get('03268')!.name).toBe('BANCA SELLA - S.P.A.');
  });

  it('reads a reassigned code by date: its LAST holder decides', () => {
    // 03111 belonged to Banca Lombarda, then to UBI: the retirement, its date
    // and its successor are UBI's, never Banca Lombarda's.
    expect(retired.get('03111')).toEqual({
      code: '03111',
      name: 'UNIONE DI BANCHE ITALIANE S.P.A.',
      retired_on: '2021-04-11',
      successor_code: '03069',
      successor_name: 'INTESA SANPAOLO S.P.A.',
    });
  });

  it('follows the legal successor by entity, through two incorporations', () => {
    expect(retired.get('05428')!.successor_code).toBe('03069');
  });

  it('points a code an entity left for another at that entity’s new code', () => {
    expect(retired.get('03181')).toMatchObject({
      retired_on: '2022-09-30',
      successor_code: '03479',
      successor_name: 'BNP PARIBAS SA',
    });
  });

  it('names no successor after a transfer of assets or of branches', () => {
    // A cession moves accounts, not the legal person: 05728's assets went to
    // Intesa and UBI's branches partly to BPER, and neither is a legal successor.
    expect(retired.get('05728')!.successor_code).toBeNull();
    expect(retired.get('03111')!.successor_code).not.toBe('05387');
  });

  it('never follows a succession loop forever', () => {
    const rows: IntermediaryRow[] = [
      {
        id: 'a',
        code: '01111',
        register: '001',
        name: 'A',
        street: null,
        post_code: null,
        town: null,
        lei: null,
        valid_from: '2000-01-01',
        valid_to: '2010-01-01',
      },
      {
        id: 'b',
        code: '02222',
        register: '001',
        name: 'B',
        street: null,
        post_code: null,
        town: null,
        lei: null,
        valid_from: '2000-01-01',
        valid_to: '2010-01-01',
      },
    ];
    const loop: EventRow[] = [
      { type: '003', effective: '2010-01-02', active_id: 'b', passive_id: 'a' },
      { type: '002', effective: '2010-01-02', active_id: 'a', passive_id: 'b' },
    ];
    const r = byCode(buildItalianRegister(rows, loop));
    expect(r.retired.get('01111')!.successor_code).toBeNull();
    expect(r.retired.get('02222')!.successor_code).toBeNull();
  });

  it('leaves out a code with two holders in force at once rather than pick one', () => {
    const rows = parseIntermediaries(
      [
        HEADER,
        line('70', '7777', '001', 'BANCA UNO', '2000-01-01', '9999-12-31'),
        line('71', '7777', '012', 'ISTITUTO DUE', '2001-01-01', '9999-12-31'),
      ].join('\n'),
    ).rows;
    const r = buildItalianRegister(rows, []);
    expect(r.ambiguous).toEqual(['07777']);
    expect(r.inForce).toHaveLength(0);
    expect(r.retired).toHaveLength(0);
  });
});

/** Une archive ZIP d'un seul membre, construite comme la Banca d'Italia la sert (deflate). */
function zip(name: string, text: string, comment = ''): Buffer {
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
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBuf.length + compressed.length;
  const commentBuf = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  // La vraie archive annonce un commentaire plus long que celui qu'elle porte
  // (« zipfile comment truncated ») : le lecteur cherche la fin à rebours.
  end.writeUInt16LE(commentBuf.length + 40, 20);
  return Buffer.concat([local, nameBuf, compressed, central, nameBuf, end, commentBuf]);
}

describe('readGiavaZip', () => {
  it('reads the CSV and its edition out of the member name, through a truncated comment', () => {
    const f = readGiavaZip(
      zip('2026-09-23_INTERMEDIARI.csv', INTERMEDIARIES, 'GIAVA Archiv'),
      /^(\d{4}-\d{2}-\d{2})_INTERMEDIARI\.csv$/,
    );
    expect(f.edition).toBe('2026-09-23');
    expect(f.member).toBe('2026-09-23_INTERMEDIARI.csv');
    // Le BOM est retiré par le décodage, le reste est rendu tel quel.
    expect(f.text).toBe(INTERMEDIARIES.replace(/^\uFEFF/, ''));
  });

  it('takes a page served in place of the file for a refusal, not for a format', () => {
    const page = Buffer.from('<html><head><title>Oracle Access Manager</title></head></html>');
    expect(() => readGiavaZip(page, /x/)).toThrow(ItalianSourceNotLoaded);
  });

  it('fails the run on an archive that no longer holds the expected file', () => {
    expect(() =>
      readGiavaZip(zip('export.csv', 'a;b'), /^(\d{4}-\d{2}-\d{2})_INTERMEDIARI\.csv$/),
    ).toThrow(/not a file named like/);
  });

  it('refuses a member name whose date does not exist', () => {
    expect(() =>
      readGiavaZip(
        zip('2026-02-31_INTERMEDIARI.csv', 'a'),
        /^(\d{4}-\d{2}-\d{2})_INTERMEDIARI\.csv$/,
      ),
    ).toThrow(/does not name a real edition date/);
  });
});

describe('giavaDownload: the cookie handshake', () => {
  const FILE = giavaDownloadUrl('VFLUSSO_EVENTO');
  const AUTH = 'https://auth.bancaditalia.it:443/oam/server/obrareq.cgi?encquery%3Dabc';
  const BACK = 'https://infostat.bancaditalia.it/obrar.cgi?encreply=xyz';

  /** Le parcours mesuré le 25/09/2026 : trois redirections, le fichier au bout. */
  function network(final: () => Response) {
    const seen: Array<{ url: string; cookie: string | null }> = [];
    // Comparées une fois normalisées : `new URL` retire le « :443 » que le
    // serveur d'authentification écrit dans sa redirection.
    const at = (u: string) => new URL(u).toString();
    const fetchImpl = async (raw: string, init?: RequestInit) => {
      const url = at(raw);
      const cookie = new Headers(init?.headers).get('cookie');
      seen.push({ url, cookie });
      const redirect = (location: string, cookies: string[]) => {
        const headers = new Headers({ location });
        for (const c of cookies) headers.append('set-cookie', c);
        return new Response('<html>redirect</html>', { status: 302, headers });
      };
      if (url === at(FILE) && !cookie?.includes('OAMAuthnCookie')) {
        return redirect(AUTH, [
          'OAMAuthnHintCookie=0@1; httponly; secure; path=/; domain=.bancaditalia.it',
          'OAMRequestContext=ctx; max-age=300; httponly; secure; path=/',
        ]);
      }
      if (url === at(AUTH)) {
        return redirect(BACK, ['OAMAuthnCookie=anon; path=/; domain=.bancaditalia.it']);
      }
      if (url === at(BACK)) return redirect(FILE, []);
      if (url === at(FILE)) return final();
      return new Response('Not Found', { status: 404 });
    };
    return { seen, fetchImpl };
  }

  it('follows the redirects and hands each domain its own cookies', async () => {
    const body = zip('2026-09-23_EVENTI_STRUTTURALI.csv', EVENTS);
    const { seen, fetchImpl } = network(() => new Response(new Uint8Array(body), { status: 200 }));
    const buf = await giavaDownload(fetchImpl, FILE);
    expect(buf.equals(body)).toBe(true);
    expect(seen.map((s) => new URL(s.url).hostname)).toEqual([
      'infostat.bancaditalia.it',
      'auth.bancaditalia.it',
      'infostat.bancaditalia.it',
      'infostat.bancaditalia.it',
    ]);
    // Le cookie sans domaine reste à infostat ; ceux du domaine vont partout.
    expect(seen[1].cookie).toBe('OAMAuthnHintCookie=0@1');
    expect(seen[3].cookie).toContain('OAMAuthnCookie=anon');
    expect(seen[3].cookie).toContain('OAMRequestContext=ctx');
  });

  it('turns a server error, a cut connection or an endless loop into “not loaded”', async () => {
    const error = network(() => new Response('busy', { status: 503 }));
    await expect(giavaDownload(error.fetchImpl, FILE)).rejects.toThrow(ItalianSourceNotLoaded);
    const cut = network(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0x50, 0x4b]));
              controller.error(new TypeError('terminated'));
            },
          }),
          { status: 200 },
        ),
    );
    await expect(giavaDownload(cut.fetchImpl, FILE)).rejects.toThrow(ItalianSourceNotLoaded);
    const loop = async () =>
      new Response('', { status: 302, headers: { location: FILE } }) as Response;
    await expect(giavaDownload(loop, FILE)).rejects.toThrow(/more than \d+ redirects/);
  });
});

describe('writeItalian', () => {
  const fresh = () => {
    const db = new Database(':memory:');
    ensureNationalTables(db);
    return db;
  };
  /** Un registre au-dessus des planchers, codes inventés. */
  const register = (
    inForce: number = IT_FLOORS.inForce,
    retired: number = IT_FLOORS.retired,
  ): ItalianRegister => ({
    inForce: Array.from({ length: inForce }, (_, i) => ({
      code: String(10000 + i),
      name: `Banca di Esempio ${i}`,
      register: '001',
      street: 'VIA DI ESEMPIO, 1',
      post_code: '00100',
      town: 'ROMA',
      lei: null,
    })),
    retired: Array.from({ length: retired }, (_, i) => ({
      code: String(50000 + i),
      name: `Banca Radiata ${i}`,
      retired_on: '2020-01-31',
      successor_code: i % 2 === 0 ? '10000' : null,
      successor_name: i % 2 === 0 ? 'Banca di Esempio 0' : null,
    })),
    ambiguous: [],
  });
  const count = (db: Database.Database, table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE country = 'IT'`).get() as { n: number })
      .n;
  const quiet = () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  };

  it('writes the codes in force and the retired ones, credited and dated by the edition', () => {
    quiet();
    const db = fresh();
    writeItalian(db, register(), { intermediaries: '2026-09-23', events: '2026-09-23' });
    expect(count(db, 'national_bank_codes')).toBe(IT_FLOORS.inForce);
    expect(count(db, 'national_bank_codes_retired')).toBe(IT_FLOORS.retired);
    const row = db
      .prepare(`SELECT bic, source, as_of FROM national_bank_codes WHERE country = 'IT' LIMIT 1`)
      .get() as { bic: string | null; source: string; as_of: string };
    // The register publishes no BIC: none is invented.
    expect(row).toEqual({ bic: null, source: italianSource(), as_of: '2026-09-23' });
  });

  it('refuses a short register before touching anything, and fails the run', () => {
    quiet();
    const db = fresh();
    writeItalian(db, register(), { intermediaries: '2026-09-23', events: '2026-09-23' });
    expect(() =>
      writeItalian(db, register(IT_FLOORS.inForce - 1), {
        intermediaries: '2026-09-30',
        events: '2026-09-30',
      }),
    ).toThrow(/Refusing to replace the tables/);
    expect(() =>
      writeItalian(db, register(IT_FLOORS.inForce, 10), {
        intermediaries: '2026-09-30',
        events: '2026-09-30',
      }),
    ).toThrow(/retired codes/);
    expect(count(db, 'national_bank_codes')).toBe(IT_FLOORS.inForce);
  });

  it('refuses to go back an edition, and leaves both tables as they were', () => {
    quiet();
    const db = fresh();
    writeItalian(db, register(), { intermediaries: '2026-09-23', events: '2026-09-23' });
    expect(() =>
      writeItalian(db, register(IT_FLOORS.inForce + 5), {
        intermediaries: '2026-09-16',
        events: '2026-09-16',
      }),
    ).toThrow(ItalianSourceNotLoaded);
    expect(count(db, 'national_bank_codes')).toBe(IT_FLOORS.inForce);
  });

  it('leaves the other countries of the shared table alone', () => {
    quiet();
    const db = fresh();
    db.prepare(
      `INSERT INTO national_bank_codes (country, code, name) VALUES ('SM', '03034', 'Banca di Esempio SM')`,
    ).run();
    ensureRetiredTable(db);
    writeItalian(db, register(), { intermediaries: '2026-09-23', events: '2026-09-23' });
    writeItalian(db, register(IT_FLOORS.inForce + 1), {
      intermediaries: '2026-09-30',
      events: '2026-09-30',
    });
    expect(db.prepare(`SELECT name FROM national_bank_codes WHERE country = 'SM'`).get()).toEqual({
      name: 'Banca di Esempio SM',
    });
    expect(count(db, 'national_bank_codes')).toBe(IT_FLOORS.inForce + 1);
  });
});

describe('seedItalianLive', () => {
  it('fails the run on files that parse to fewer rows than the floors', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const archives: Record<string, Buffer> = {
      [giavaDownloadUrl('VFLUSSO_INTERMEDIARIO')]: zip(
        '2026-09-23_INTERMEDIARI.csv',
        INTERMEDIARIES,
      ),
      [giavaDownloadUrl('VFLUSSO_EVENTO')]: zip('2026-09-23_EVENTI_STRUTTURALI.csv', EVENTS),
    };
    const fetchImpl = async (url: string) =>
      archives[url]
        ? new Response(new Uint8Array(archives[url]), { status: 200 })
        : new Response('Not Found', { status: 404 });
    const db = new Database(':memory:');
    ensureNationalTables(db);
    await expect(seedItalianLive(db, { fetchImpl })).rejects.toThrow(/history lines/);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM national_bank_codes`).get() as { n: number }).n,
    ).toBe(0);
  });

  it('says “not loaded” when the Banca d’Italia answers a page instead of the file', async () => {
    const fetchImpl = async () =>
      new Response('<html><title>Servizio non disponibile</title></html>', { status: 200 });
    const db = new Database(':memory:');
    ensureNationalTables(db);
    await expect(seedItalianLive(db, { fetchImpl })).rejects.toThrow(ItalianSourceNotLoaded);
  });
});

describe('reportItalianStatus', () => {
  it('annotates the run and hands `not_loaded` to the workflow', () => {
    const dir = mkdtempSync(join(tmpdir(), 'it-status-'));
    const out = join(dir, 'out');
    const lines: string[] = [];
    reportItalianStatus('not_loaded', 'HTTP 503\nretry', { GITHUB_OUTPUT: out }, (l) =>
      lines.push(l),
    );
    expect(lines[0]).toMatch(/^::warning title=Italian register not loaded::HTTP 503%0Aretry;/);
    expect(readFileSync(out, 'utf8')).toBe('it_register=not_loaded\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('says `loaded` without any annotation when the register was read', () => {
    const lines: string[] = [];
    reportItalianStatus('loaded', '', {}, (l) => lines.push(l));
    expect(lines).toEqual([]);
  });
});
