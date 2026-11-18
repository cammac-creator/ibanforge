import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  DK_FALLBACK_URL,
  DK_PAGE,
  DK_SOURCE,
  MAX_PAGE_BYTES,
  MAX_RANGE,
  MAX_SHEET_ROWS,
  MAX_XLSX_UNZIPPED_BYTES,
  buildDkRegister,
  dkBic,
  dkListLink,
  editionFromUrl,
  measureDkWorkbook,
  readDenmarkLive,
  readDkWorkbook,
  type DkRow,
} from './seed-national-dk.js';
import { failureCause } from './seed-report.js';

/**
 * 🔒 Des banques INVENTÉES, jamais une ligne de la vraie liste : la source est de la
 * case 2 (règle du 28/10/2026), elle n'entre pas dans ce dépôt public. Seule la mise
 * en page est reproduite : une ligne de mode d'emploi, l'en-tête des six colonnes, un
 * titre de section par pays (« From », « To », le pays), puis une plage par ligne,
 * codes écrits en nombres comme Excel les garde.
 */
const HEADER = [
  'Bank Identifier (Range from)\nPosition 5-8 within the DK/FO/GL IBAN format',
  'Bank Identifier (Range to)\nPosition 5-8 within the DK/FO/GL IBAN format',
  'Bank or Institution',
  'Country\nPosition 1-2\nDK = Denmark\nFO = Faroe Islands\nGL = Greenland',
  'City',
  'BIC Code\nBank Identifier Code',
];

function workbook(
  body: unknown[][],
  options: { header?: unknown[]; modified?: Date; sheets?: number } = {},
): Buffer {
  const wb = XLSX.utils.book_new();
  const aoa = [
    ['The Bank Identifiers Range is shown in Column B (from) and Column C (to)'],
    options.header ?? HEADER,
    [],
    ...body,
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'BIC_IBAN oversigt');
  for (let i = 1; i < (options.sheets ?? 1); i++)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), `Sheet${i + 1}`);
  if (options.modified) wb.Props = { ModifiedDate: options.modified };
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const DENMARK = ['From', 'To', 'DENMARK'];
const FAROE = ['From', 'To', 'FOROYA'];
const GREENLAND = ['From', 'To', 'GREENLAND\nPlease note'];

/** Une liste inventée qui porte chaque cas que la vraie liste a montré, et quelques autres. */
const SAMPLE = [
  DENMARK,
  [40, 42, 'Alpha Bank A/S', 'DK', 'ALPHABY', 'ZZALDKKK'],
  [9001, 9001, '  Beta   Sparekasse ', 'DK', 'BETABY', 'ZZBEDK21'],
  // Une ligne féroïenne dans la section danoise, répétée plus bas à l'identique.
  [9500, 9500, 'Gamma Banki P/F', 'FO', 'GAMMAVIK', 'ZZGAFOTX'],
  // Le même code à deux titulaires : ambigu, avec un BIC mal formé sur l'une des lignes.
  [9100, 9100, 'Delta Bank', 'DK', 'DELTABY', 'ZZDEDK2DKK'],
  [9100, 9101, 'Epsilon Sparekasse', 'DK', 'EPSILONBY', 'ZZEPDK22'],
  // Le même titulaire avec deux BIC : servi sans BIC.
  [9200, 9200, 'Zeta Bank', 'DK', 'ZETABY', 'ZZZEDKKK'],
  [9200, 9200, 'ZETA BANK', 'DK', 'ZETABY', 'ZZZYDKKK'],
  // Un BIC d'un autre pays : la ligne est gardée, sans BIC.
  [9300, 9300, 'Eta Bank, filial', 'DK', 'ETABY', 'ZZETDEFF'],
  // Des lignes fautives : écartées et comptées.
  [9402, 9401, 'Theta Bank', 'DK', 'THETABY', 'ZZTHDKKK'],
  [0, MAX_RANGE, 'Iota Bank', 'DK', 'IOTABY', 'ZZIODKKK'],
  ['94x0', 9410, 'Kappa Bank', 'DK', 'KAPPABY', 'ZZKADKKK'],
  [9420, 9420, 'Lambda Bank', 'SE', 'LAMBDABY', 'ZZLASESS'],
  [9430, 9430, '', 'DK', 'MUBY', 'ZZMUDKKK'],
  FAROE,
  [9500, 9500, 'Gamma Banki P/F', 'FO', 'GAMMAVIK', 'ZZGAFOTX'],
  [9501, 9501, 'Nu Sparikassi', 'FO', 'NUVAGUR', 'ZZNUFOT1'],
  GREENLAND,
  [9600, 9600, 'Xi Bank A/S', 'GL', 'NUUK', 'ZZXIGLGX'],
];

describe('readDkWorkbook', () => {
  it('reads the rows under the header, section titles skipped, codes as Excel keeps them', () => {
    const { rows, modified } = readDkWorkbook(
      workbook(SAMPLE, { modified: new Date('2026-01-15T08:00:00Z') }),
    );
    expect(rows).toHaveLength(SAMPLE.length - 3);
    expect(rows[0]).toMatchObject({ from: 40, to: 42, name: 'Alpha Bank A/S', country: 'DK' });
    expect(modified).toBe('2026-01-15');
  });

  it('refuses a file that is not an XLSX, a changed header, a new column, a second sheet', () => {
    expect(() => readDkWorkbook(Buffer.from('<html>moved</html>'))).toThrow(
      /did not serve an XLSX/,
    );
    expect(() =>
      readDkWorkbook(workbook(SAMPLE, { header: ['From', 'To', 'Bank', 'Country', 'City'] })),
    ).toThrow(/header not found/);
    expect(() =>
      readDkWorkbook(workbook([DENMARK, [40, 40, 'Alpha Bank A/S', 'DK', 'X', 'ZZALDKKK', 'new']])),
    ).toThrow(/beyond the BIC/);
    expect(() => readDkWorkbook(workbook(SAMPLE, { sheets: 2 }))).toThrow(/one sheet/);
    expect(() => readDkWorkbook(workbook([DENMARK]))).toThrow(/no row under the table header/);
  });

  // Relecture de la PR 638, point 4b : SheetJS décompresse toutes les parties avant de
  // lire une cellule. L'archive est donc mesurée d'abord, dans un budget, et la
  // hauteur de la feuille lue sans construire les lignes au-delà de la borne.
  it('measures the archive before reading it, and refuses one that expands beyond the budget', () => {
    const plain = measureDkWorkbook(workbook(SAMPLE));
    expect(plain).toBeGreaterThan(0);
    expect(plain).toBeLessThan(MAX_XLSX_UNZIPPED_BYTES);
    const blownUp = zipOf({ 'xl/padding.bin': Buffer.alloc(MAX_XLSX_UNZIPPED_BYTES + 1) });
    // Quelques dizaines de kilo-octets compressés, plus que le budget une fois décompressés.
    expect(blownUp.length).toBeLessThan(MAX_XLSX_UNZIPPED_BYTES / 100);
    expect(() => measureDkWorkbook(blownUp)).toThrow(/expands to more than/);
    expect(() => readDkWorkbook(blownUp)).toThrow(/expands to more than/);
    expect(() =>
      readDkWorkbook(Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64)])),
    ).toThrow(/not a readable XLSX archive/);
  });

  it('refuses a sheet higher than any edition, without building its rows', () => {
    const tall = Array.from({ length: MAX_SHEET_ROWS + 5 }, (_, i) => [
      9000 + (i % 900),
      9000 + (i % 900),
      'Alpha Bank A/S',
      'DK',
      'ALPHABY',
      'ZZALDKKK',
    ]);
    expect(() => readDkWorkbook(workbook([DENMARK, ...tall]))).toThrow(
      /larger than any edition of the list/,
    );
  });
});

/** Une archive zip d'une seule méthode, décompressée par zlib : assez pour mesurer. */
function zipOf(parts: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const data = deflateRawSync(content);
    const file = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(file.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, file, data);
    centrals.push(central, file);
    offset += local.length + file.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('buildDkRegister', () => {
  const rows = readDkWorkbook(workbook(SAMPLE)).rows;
  const built = buildDkRegister(rows, '2026-01-15');
  const codes = (cc: 'DK' | 'FO' | 'GL') => built.entries[cc].map((e) => [e.code, e.name, e.bic]);

  it('expands each range into four-digit codes, the country read from the row', () => {
    expect(codes('DK')).toEqual([
      ['0040', 'Alpha Bank A/S', 'ZZALDKKK'],
      ['0041', 'Alpha Bank A/S', 'ZZALDKKK'],
      ['0042', 'Alpha Bank A/S', 'ZZALDKKK'],
      ['9001', 'Beta Sparekasse', 'ZZBEDK21'],
      // 9100 est ambigu ; 9101 n'appartient qu'à la seconde ligne.
      ['9101', 'Epsilon Sparekasse', 'ZZEPDK22'],
      ['9200', 'Zeta Bank', null],
      ['9300', 'Eta Bank, filial', null],
    ]);
    expect(codes('FO')).toEqual([
      ['9500', 'Gamma Banki P/F', 'ZZGAFOTX'],
      ['9501', 'Nu Sparikassi', 'ZZNUFOT1'],
    ]);
    expect(codes('GL')).toEqual([['9600', 'Xi Bank A/S', 'ZZXIGLGX']]);
    const all = [...built.entries.DK, ...built.entries.FO, ...built.entries.GL];
    expect(all.every((e) => e.source === DK_SOURCE && e.as_of === '2026-01-15')).toBe(true);
    expect(built.entries.DK[0].town).toBe('ALPHABY');
  });

  it('counts what it merged, left out and served without a BIC', () => {
    expect(built.stats).toEqual({
      rows: SAMPLE.length - 3,
      rows_rejected: 5,
      rows_by_country: { DK: 7, FO: 3, GL: 1 },
      codes_expanded: 3 + 1 + 1 + 1 + 2 + 1 + 1 + 1 + 1 + 1 + 1,
      duplicates_merged: 2,
      ambiguous: 1,
      served: { DK: 7, FO: 2, GL: 1 },
      without_bic: 2,
    });
    expect(built.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/published BIC dropped \(malformed\)/),
        expect.stringMatching(/published BIC dropped \(other_country\)/),
        expect.stringMatching(/the range ends before it starts/),
        expect.stringMatching(new RegExp(`more than ${MAX_RANGE} codes`)),
        expect.stringMatching(/not a number from 0 to 9999/),
        expect.stringMatching(/not DK, FO or GL/),
        expect.stringMatching(/no bank name/),
        expect.stringMatching(/^DK, sheet lines \d+ and \d+: the same code given to two holders/),
      ]),
    );
  });

  it('accepts a code written as text, and a range of exactly MAX_RANGE codes', () => {
    const one: DkRow[] = [
      { line: 1, from: '0007', to: '0007', name: 'Omicron', country: 'dk', city: '', bic: '' },
      { line: 2, from: 1, to: MAX_RANGE, name: 'Pi', country: 'GL', city: null, bic: 'zzpiglgx' },
    ];
    const r = buildDkRegister(one, '2026-01-15');
    expect(r.entries.DK).toEqual([
      expect.objectContaining({ code: '0007', name: 'Omicron', bic: null, town: null }),
    ]);
    expect(r.entries.GL).toHaveLength(MAX_RANGE);
    expect(r.entries.GL[0].bic).toBe('ZZPIGLGX');
  });
});

describe('dkBic', () => {
  it('keeps an ISO 9362 BIC of the row country, drops the others with the reason', () => {
    expect(dkBic(' zzal dkkk ', 'DK')).toEqual({ bic: 'ZZALDKKK', dropped: null });
    expect(dkBic('ZZALDKKKXXX', 'DK')).toEqual({ bic: 'ZZALDKKKXXX', dropped: null });
    expect(dkBic('ZZALDK2DKK', 'DK')).toEqual({ bic: null, dropped: 'malformed' });
    expect(dkBic('ZZALFOTX', 'DK')).toEqual({ bic: null, dropped: 'other_country' });
    expect(dkBic(null, 'GL')).toEqual({ bic: null, dropped: null });
  });
});

describe('dkListLink and editionFromUrl', () => {
  const file = (date: string) =>
    `https://www.e-nettet.dk/wp-content/uploads/2026/01/IBAN-Denmark-Greenland-and-Faroe-Islands-${date}-v2.0.xlsx`;

  it('dates the edition by the file name, day first', () => {
    expect(editionFromUrl(file('15-01-2026'))).toBe('2026-01-15');
    expect(editionFromUrl(DK_FALLBACK_URL)).toBe('2025-12-11');
    expect(editionFromUrl(file('31-02-2026'))).toBeNull();
    expect(editionFromUrl('https://www.e-nettet.dk/list.xlsx')).toBeNull();
  });

  it('finds the one list of the page, protocol-relative or not, and checks the link text', () => {
    const html =
      `<a href="//www.e-nettet.dk/wp-content/uploads/omgf/font.woff2">x</a>` +
      `<a href="https://elsewhere.example.net/copy.xlsx">copy</a>` +
      `<a class="x" href="${file('15-01-2026').replace('https:', '')}"><span>IBAN Denmark 15 01 2026</span></a>` +
      `<a href="${file('15-01-2026')}">again</a>`;
    expect(dkListLink(html)).toEqual({ url: file('15-01-2026'), edition: '2026-01-15' });
  });

  it('refuses a page with no list, two lists, or a link text dated otherwise', () => {
    expect(() => dkListLink('<p>nothing</p>')).toThrow(/found 0/);
    const two = `<a href="${file('15-01-2026')}">a</a><a href="${file('16-01-2026')}">b</a>`;
    expect(() => dkListLink(two)).toThrow(/found 2/);
    const lying = `<a href="${file('15-01-2026')}">IBAN Denmark 14 01 2026</a>`;
    expect(() => dkListLink(lying)).toThrow(/link text says 2026-01-14/);
  });

  // Relecture de la PR 638, point 4a : l'expression d'avant cherchait la fin de chaque
  // lien jusqu'au bout de la page, et une page piégée de la taille admise (2 Mo) la
  // tenait plusieurs secondes, de plus en plus vite à mesure qu'elle grossit. La
  // lecture d'aujourd'hui est linéaire : chaque forme ci-dessous se lit en quelques
  // millisecondes ; le budget, large, tient sur une machine lente de la CI.
  it.each([
    ['links that never close', `<a href="${file('15-01-2026')}">`],
    ['tags that never end', '<a href="x" '],
    ['text that never closes its tags', `<a href="${file('15-01-2026')}"><b `],
  ])('reads a trapped page of the admitted size in linear time: %s', (_label, unit) => {
    const page = unit.repeat(Math.floor((2 * 1024 * 1024) / unit.length));
    const started = performance.now();
    let outcome: unknown;
    try {
      outcome = dkListLink(page);
    } catch (e) {
      outcome = e;
    }
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(outcome).toBeInstanceOf(Error);
  });

  it('still reads a link whose text holds markup, an entity and a stray chevron', () => {
    const html = `<p>a < b</p><A class="x"\nHREF='${file('15-01-2026')}'><span>IBAN&nbsp;Denmark</span> 15&#46;01&#x2e;2026 &#99999999;</A>`;
    expect(dkListLink(html)).toEqual({ url: file('15-01-2026'), edition: '2026-01-15' });
  });
});

describe('readDenmarkLive', () => {
  const linked = (url: string) => `<a href="${url}">IBAN Denmark Greenland And Faroe Islands</a>`;
  const listUrl =
    'https://www.e-nettet.dk/wp-content/uploads/2026/01/IBAN-Denmark-Greenland-and-Faroe-Islands-15-01-2026-v2.0.xlsx';

  function server(responses: Record<string, Buffer | number>) {
    const asked: Array<[string, number]> = [];
    const get = async (url: string, max: number) => {
      asked.push([url, max]);
      const r = responses[url];
      if (r === undefined || typeof r === 'number')
        throw new Error(`DK: ${url} -> HTTP ${r ?? 404}`);
      return r;
    };
    return { get, asked };
  }

  it('reads the list the page links to, dated by its edition, every download capped', async () => {
    const { get, asked } = server({
      [DK_PAGE]: Buffer.from(linked(listUrl)),
      [listUrl]: workbook(SAMPLE, { modified: new Date('2026-01-15T07:00:00Z') }),
    });
    const read = await readDenmarkLive(get, '2026-11-18');
    expect(read.via).toBe('page');
    expect(read.edition).toBe('2026-01-15');
    expect(read.url).toBe(listUrl);
    expect(read.entries.GL.map((e) => e.as_of)).toEqual(['2026-01-15']);
    expect(asked.map(([u]) => u)).toEqual([DK_PAGE, listUrl]);
    for (const [, max] of asked) expect(max).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it('falls back on the known address only when the page does not answer', async () => {
    const down = server({ [DK_PAGE]: 503, [DK_FALLBACK_URL]: workbook(SAMPLE) });
    const read = await readDenmarkLive(down.get, '2026-11-18');
    expect(read.via).toBe('fallback');
    expect(read.edition).toBe('2025-12-11');
    expect(read.notes[0]).toMatch(/unreachable, read the known address/);
  });

  it('does not fall back when the page answers without the link', async () => {
    const { get, asked } = server({
      [DK_PAGE]: Buffer.from('<p>maintenance</p>'),
      [DK_FALLBACK_URL]: workbook(SAMPLE),
    });
    await expect(readDenmarkLive(get, '2026-11-18')).rejects.toThrow(/found 0; layout changed/);
    expect(asked.map(([u]) => u)).toEqual([DK_PAGE]);
  });

  // Relecture de la PR 638, point 4c : le repli est réservé à une page qui ne répond
  // pas (refus HTTP, réseau, délai), jamais à une page qui dépasse son plafond.
  it('falls back on a network failure or a timeout of the page, never on a page over its cap', async () => {
    for (const failure of [
      Object.assign(new TypeError('fetch failed'), {}),
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    ]) {
      const asked: string[] = [];
      const get = async (url: string) => {
        asked.push(url);
        if (url === DK_PAGE) throw failure;
        if (url === DK_FALLBACK_URL) return workbook(SAMPLE);
        throw new Error(`DK: ${url} -> HTTP 404`);
      };
      const read = await readDenmarkLive(get, '2026-11-18');
      expect(read.via, failure.name).toBe('fallback');
      expect(asked).toEqual([DK_PAGE, DK_FALLBACK_URL]);
    }
    const asked: string[] = [];
    const tooBig = async (url: string, max: number) => {
      asked.push(url);
      if (url === DK_PAGE) throw new Error(`DK: ${url} is larger than ${max} bytes; refusing`);
      return workbook(SAMPLE);
    };
    await expect(readDenmarkLive(tooBig, '2026-11-18')).rejects.toThrow(/larger than/);
    expect(asked).toEqual([DK_PAGE]);
  });

  it('reports a source down as http_503, the code the overlay chain carries over', async () => {
    const { get } = server({ [DK_PAGE]: 503, [DK_FALLBACK_URL]: 503 });
    const error = await readDenmarkLive(get, '2026-11-18').catch((e: unknown) => e);
    expect(failureCause(error)).toBe('http_503');
  });

  it('refuses an edition dated after today, and dates by the workbook when the name has no date', async () => {
    const future = server({
      [DK_PAGE]: Buffer.from(linked(listUrl)),
      [listUrl]: workbook(SAMPLE),
    });
    await expect(readDenmarkLive(future.get, '2026-01-14')).rejects.toThrow(/after today/);
    const undated = 'https://www.e-nettet.dk/wp-content/uploads/iban-list.xlsx';
    const plain = server({
      [DK_PAGE]: Buffer.from(linked(undated)),
      [undated]: workbook(SAMPLE, { modified: new Date('2026-02-01T09:00:00Z') }),
    });
    const read = await readDenmarkLive(plain.get, '2026-11-18');
    expect(read.edition).toBe('2026-02-01');
    expect(read.notes[0]).toMatch(/edition dated by the workbook/);
    const none = server({ [DK_PAGE]: Buffer.from(linked(undated)), [undated]: workbook(SAMPLE) });
    await expect(readDenmarkLive(none.get, '2026-11-18')).rejects.toThrow(/edition date/);
  });
});

describe('the capped download', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a file announced or streamed beyond its cap', async () => {
    const page = linked();
    function linked() {
      return `<a href="${DK_FALLBACK_URL}">IBAN Denmark</a>`;
    }
    const big = new Uint8Array(6 * 1024 * 1024);
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input) === DK_PAGE
        ? new Response(page, { status: 200 })
        : new Response(big, { status: 200, headers: { 'content-length': String(big.length) } }),
    );
    await expect(readDenmarkLive()).rejects.toThrow(/larger than/);
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input) === DK_PAGE
        ? new Response(page, { status: 200 })
        : new Response(
            new ReadableStream({
              start(controller) {
                for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1024 * 1024));
                controller.close();
              },
            }),
            { status: 200 },
          ),
    );
    await expect(readDenmarkLive()).rejects.toThrow(/larger than/);
  });

  it('does not fall back when the page itself is over its cap', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      requested.push(String(input));
      return String(input) === DK_PAGE
        ? new Response(new Uint8Array(MAX_PAGE_BYTES + 1), { status: 200 })
        : new Response(new Uint8Array(workbook(SAMPLE)), { status: 200 });
    });
    await expect(readDenmarkLive()).rejects.toThrow(/larger than/);
    expect(requested).toEqual([DK_PAGE]);
  });
});
