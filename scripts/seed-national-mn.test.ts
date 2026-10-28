import { describe, expect, it } from 'vitest';
import {
  MN_SOURCE,
  buildMongoliaRegister,
  mongoliaPdfUrl,
  parseMongoliaText,
  readMongoliaLive,
} from './seed-national-mn.js';

/**
 * 🔒 Des participants INVENTÉS, jamais une ligne du vrai registre : la source est de
 * la case 2 (règle du 28/10/2026), elle n'entre pas dans ce dépôt public. Seule la
 * mise en page est reproduite : les colonnes du texte de `pdftotext -layout`, où
 * chaque BIC commence deux caractères avant l'en-tête de sa colonne, et où un
 * participant non bancaire n'a que le BIC de la colonne ACH+.
 */
const HEADER =
  '№'.padEnd(5) +
  'Банк код'.padEnd(12) +
  'Оролцогч'.padEnd(59) +
  'Данс'.padEnd(13) +
  'RTGS БИК'.padEnd(13) +
  'ACH+ БИК'.padEnd(12) +
  'SWIFT БИК';
const COL = {
  rtgs: HEADER.indexOf('RTGS БИК'),
  ach: HEADER.indexOf('ACH+ БИК'),
  swift: HEADER.indexOf('SWIFT БИК'),
};

function row(
  n: number,
  code: string,
  name: string,
  bics: Partial<Record<keyof typeof COL, string>>,
  account = '',
  drift = -2,
): string {
  let line = `${String(n).padStart(2)}     ${code}      ${name}`;
  if (account) line = line.padEnd(COL.rtgs - 14) + account;
  for (const column of ['rtgs', 'ach', 'swift'] as const) {
    const bic = bics[column];
    if (bic) line = line.padEnd(COL[column] + drift) + bic;
  }
  return line;
}

const TITLE = '                       Төлбөрийн системийн оролцогчдын нэгдсэн бүртгэл';
const LEGEND = [
  '      RTGS      Банксүлжээ буюу их дүнтэй төлбөрийн системийн оролцогч',
  '      ACH+      Бага дүнтэй төлбөрийн системийн оролцогч',
  '      SWIFT     ОУ-ын гадаад гүйлгээний Свифт сүлжээний гишүүн',
];

function sheet(rows: string[]): string {
  return [TITLE, HEADER, ...rows, ...LEGEND].join('\n');
}

const SAMPLE = sheet([
  row(
    1,
    '0901',
    'Туршилтын банк',
    { rtgs: 'ZZTSMNUB', ach: 'ZZTSMNUB', swift: 'ZZTSMNUB' },
    '3509901',
  ),
  // Une banque dont le BIC SWIFT diffère de celui des systèmes nationaux.
  row(2, '0902', 'Жишээ банк', { rtgs: 'ZZJSMNUB', ach: 'ZZJSMNUB', swift: 'ZZJXMNUB' }, '3509902'),
  // Un BIC SWIFT qui ne tombe pas pile sous sa colonne, comme le texte en produit parfois.
  row(3, '0903', 'Гурав банк', { rtgs: 'ZZGRMNUB', ach: 'ZZGRMNUB' }, '3509903') +
    ' '.repeat(3) +
    'ZZGRMNUB',
  // Une banque en liquidation (ЭХА) : écartée.
  row(4, '0904', 'Хуучин банк ЭХА', { rtgs: 'ZZHUMNUB', ach: 'ZZHUMNUB' }, '3509904'),
  // Un participant public : les BIC des systèmes nationaux seuls, aucun SWIFT.
  row(5, '0905', 'Төрийн сан (туршилт)', { rtgs: 'ZZTRMNUB', ach: 'ZZTRMNUB' }, '3409905'),
  // Un participant non bancaire : la colonne ACH+ seule, sans compte.
  row(6, '0906', '360 Альфа ББСБ', { ach: 'ZZALMNUB' }),
  // Un participant sans aucun BIC.
  row(7, '0907', 'Бета процессор', {}),
]);

describe('parseMongoliaText', () => {
  it('reads each BIC by the column it sits under, never by its order on the line', () => {
    const rows = parseMongoliaText(SAMPLE);
    expect(rows.map((r) => r.code)).toEqual([
      '0901',
      '0902',
      '0903',
      '0904',
      '0905',
      '0906',
      '0907',
    ]);
    expect(rows[0].bics).toEqual({ rtgs: 'ZZTSMNUB', ach: 'ZZTSMNUB', swift: 'ZZTSMNUB' });
    expect(rows[1].bics.swift).toBe('ZZJXMNUB');
    expect(rows[2].bics.swift).toBe('ZZGRMNUB');
    // La seule colonne d'un non-bancaire est ACH+, pas SWIFT : le piège de « dernier BIC = SWIFT ».
    expect(rows[5].bics).toEqual({ ach: 'ZZALMNUB' });
    expect(rows[5].name).toBe('360 Альфа ББСБ');
    expect(rows[4].name).toBe('Төрийн сан (туршилт)');
    expect(rows[6].bics).toEqual({});
  });

  it('refuses a table whose row numbers do not follow', () => {
    const broken = sheet([
      row(1, '0901', 'Туршилтын банк', { rtgs: 'ZZTSMNUB' }, '3509901'),
      row(3, '0903', 'Гурав банк', { rtgs: 'ZZGRMNUB' }, '3509903'),
    ]);
    expect(() => parseMongoliaText(broken)).toThrow(/row 2 expected/);
  });

  it('refuses a BIC that sits under no BIC column', () => {
    const line = row(1, '0901', 'Туршилтын банк', {}, '3509901').padEnd(COL.ach + 6) + 'ZZTSMNUB';
    expect(() => parseMongoliaText(sheet([line]))).toThrow(/outside every BIC column/);
  });

  it('refuses an unknown word after the name, and a header that changed', () => {
    const line = row(1, '0901', 'Туршилтын банк', { rtgs: 'ZZTSMNUB' }, '3509901') + '   ZZTSGB22';
    expect(() => parseMongoliaText(sheet([line]))).toThrow(/unknown word after the name/);
    expect(() => parseMongoliaText(SAMPLE.replace('SWIFT БИК', 'SWIFT'))).toThrow(
      /header not found/,
    );
  });

  it('refuses a code listed twice', () => {
    const twice = sheet([
      row(1, '0901', 'Туршилтын банк', {}, '3509901'),
      row(2, '0901', 'Жишээ банк', {}, '3509902'),
    ]);
    expect(() => parseMongoliaText(twice)).toThrow(/listed twice/);
  });
});

describe('buildMongoliaRegister', () => {
  it('serves the SWIFT column only, null elsewhere, and leaves out banks in liquidation', () => {
    const { entries, notes } = buildMongoliaRegister(parseMongoliaText(SAMPLE), '2026-10-28');
    expect(entries.map((e) => [e.code, e.bic])).toEqual([
      ['0901', 'ZZTSMNUB'],
      ['0902', 'ZZJXMNUB'],
      ['0903', 'ZZGRMNUB'],
      ['0905', null],
      ['0906', null],
      ['0907', null],
    ]);
    expect(notes).toEqual(['0904: in liquidation (ЭХА), left out']);
    expect(entries.every((e) => e.source === MN_SOURCE && e.as_of === '2026-10-28')).toBe(true);
  });
});

describe('mongoliaPdfUrl', () => {
  it('finds the one participants PDF of the page, linked and embedded', () => {
    const hash = 'a'.repeat(32);
    const html = `<a href="/file/${hash}/files/list.pdf">татах</a><iframe src="/file/${hash}/files/list.pdf"></iframe>`;
    expect(mongoliaPdfUrl(html)).toBe(`https://www.mongolbank.mn/file/${hash}/files/list.pdf`);
  });

  it('refuses a page with no PDF or with two', () => {
    expect(() => mongoliaPdfUrl('<p>nothing</p>')).toThrow(/found 0/);
    const two = `<a href="/file/${'a'.repeat(32)}/files/a.pdf"></a><a href="/file/${'b'.repeat(32)}/files/b.pdf"></a>`;
    expect(() => mongoliaPdfUrl(two)).toThrow(/found 2/);
  });
});

describe('readMongoliaLive', () => {
  it('refuses a link that does not serve a PDF', async () => {
    const hash = 'c'.repeat(32);
    const get = async (url: string) =>
      Buffer.from(
        url.endsWith('.pdf') ? '<html>moved</html>' : `<a href="/file/${hash}/files/x.pdf">`,
      );
    await expect(readMongoliaLive(get, '2026-10-28')).rejects.toThrow(/did not serve a PDF/);
  });
});
