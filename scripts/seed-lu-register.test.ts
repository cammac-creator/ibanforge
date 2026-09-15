import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { parseLuPublication, parseLuWorkbook, writeLuRegister } from './seed-lu-register.js';

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function workbook(change?: (rows: unknown[][]) => void): Buffer {
  const rows: unknown[][] = [
    ['Liste de démonstration'],
    ['Credit institution', 'IBAN Code ', 'BICCode'],
    ...Array.from({ length: 100 }, (_, i) => [`Établissement fictif ${i}`, i, 'DEMOLULL']),
  ];
  change?.(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Organizations');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

describe('import privé ABBL', () => {
  it('suit le lien actuel autorisé et la date visible, pas la date technique du site', () => {
    const url =
      'https://office-membernet.abbl.lu/newDocRequest/demo/ABBL_LuxembourgRegisterofIBANBICCodes999.xlsx';
    expect(
      parseLuPublication(`<p>Published on 18 August 2026</p><a href="${url}">Download PDF</a>`),
    ).toEqual({ url, published: '2026-08-18' });
  });
  it('refuse un hôte étranger, une date absente ou un lien ambigu', () => {
    const link =
      '<a href="https://office-membernet.abbl.lu/ABBL_LuxembourgRegisterofIBANBICCodes1.xlsx">fichier</a>';
    expect(() => parseLuPublication(link)).toThrow();
    expect(() =>
      parseLuPublication(
        `Published on 18 August 2026 ${link.replace('office-membernet.abbl.lu', 'example.com')}`,
      ),
    ).toThrow();
    expect(() =>
      parseLuPublication(`Published on 18 August 2026 ${link}${link.replace('Codes1', 'Codes2')}`),
    ).toThrow();
  });
  it('préserve les noms, complète les zéros et garde le crédit daté', () => {
    const register = parseLuWorkbook(workbook(), '2026-08-18');
    expect(register.entries[1]).toEqual({
      code: '001',
      name: 'Établissement fictif 1',
      bic: 'DEMOLULL',
    });
    expect(register.published).toBe('2026-08-18');
    expect(register.source).toBe('Source: ABBL, Luxembourg register of IBAN/BIC codes');
    expect(register.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    [
      'doublon',
      (rows: unknown[][]) => {
        rows[3][1] = rows[2][1];
      },
    ],
    [
      'code non numérique',
      (rows: unknown[][]) => {
        rows[3][1] = 'A01';
      },
    ],
    [
      'BIC étranger',
      (rows: unknown[][]) => {
        rows[3][2] = 'DEMODEFF';
      },
    ],
    [
      'en-tête modifié',
      (rows: unknown[][]) => {
        rows[1][0] = 'Unknown';
      },
    ],
    [
      'fichier tronqué',
      (rows: unknown[][]) => {
        rows.splice(60);
      },
    ],
  ])('refuse %s sans accepter une extraction partielle', (_, change) => {
    expect(() => parseLuWorkbook(workbook(change), '2026-08-18')).toThrow();
  });
  it('écrit en accès privé et conserve la version précédente si la nouvelle est invalide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-lu-'));
    temporary.push(dir);
    const path = join(dir, 'lu-register.json');
    const register = parseLuWorkbook(workbook(), '2026-08-18');
    writeLuRegister(path, register);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const before = readFileSync(path, 'utf8');
    expect(() => writeLuRegister(path, { ...register, entries: [] })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
