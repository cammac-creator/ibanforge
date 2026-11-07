import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { findDutchPspWorkbook, parseDutchPspWorkbook } from './refresh-nl-psp.js';

function workbook(date = '03-11-2026', extra: string[][] = []) {
  const rows: string[][] = [
    ['Liste fictive ' + date],
    ...Array.from({ length: 70 }, (_, i) => [
      'ALPHNL2A',
      'AA' + String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
      'Banque Alpha fictive ' + i,
    ]),
    ...extra,
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Liste');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
describe('liste néerlandaise courante', () => {
  it('suit le lien courant et ignore un autre hébergeur', () => {
    expect(
      findDutchPspWorkbook(
        '<a href="/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx">Liste</a><a href="https://alpha.example.net/BIC-lijst-NL.xlsx">Autre</a>',
      ),
    ).toBe('https://www.betaalvereniging.nl/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx');
  });
  it('refuse un lien absent ou deux éditions possibles', () => {
    expect(() => findDutchPspWorkbook('<p>Indisponible</p>')).toThrow();
    expect(() =>
      findDutchPspWorkbook(
        '<a href="/BIC-lijst-NL-1.xlsx">1</a><a href="/BIC-lijst-NL-2.xlsx">2</a>',
      ),
    ).toThrow();
  });
  it('conserve la date publiée et ne lance aucune écriture à l’import', () => {
    const result = parseDutchPspWorkbook(workbook());
    expect(result.as_of).toBe('2026-11-03');
    expect(Object.keys(result.providers)).toHaveLength(70);
    expect(result.providers.AAAA.bic).toBe('ALPHNL2A');
  });
  it('refuse une date impossible et une identité contradictoire', () => {
    expect(() => parseDutchPspWorkbook(workbook('31-02-2026'))).toThrow();
    expect(() =>
      parseDutchPspWorkbook(workbook('03-11-2026', [['BETANL2A', 'AAAA', 'Banque Beta fictive']])),
    ).toThrow();
  });
});
