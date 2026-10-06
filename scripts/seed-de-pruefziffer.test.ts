import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTable, parseCheckMethods } from './seed-de-pruefziffer.js';
import {
  DE_TABLE_ATTRIBUTION,
  DE_TABLE_MIN_ENTRIES,
  isDeMethodTable,
} from '../src/lib/national-check/de/table.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The header of the public Bundesbank CSV, as published. */
const HEADER =
  'Bankleitzahl;Merkmal;Bezeichnung;PLZ;Ort;Kurzbezeichnung;PAN;BIC;Prüfzifferberechnungsmethode;Datensatznummer;Änderungskennzeichen;Bankleitzahllöschung;Nachfolge-Bankleitzahl';

/** One CSV row in the Bundesbank's quoting. Invented banks, public layout. */
function row(blz: string, merkmal: string, method: string, retired = '0'): string {
  return [
    blz,
    merkmal,
    'Bank Alpha',
    '10115',
    'Berlin',
    'Bank Alpha Berlin',
    '',
    '',
    method,
    '000001',
    'U',
    retired,
    '00000000',
  ]
    .map((f) => `"${f}"`)
    .join(';');
}

describe('parseCheckMethods: field 9 of the Bankleitzahlendatei', () => {
  it('reads the method of each BLZ from its Merkmal 1 row, keeps retired codes, sorts the keys', () => {
    const text = [
      HEADER,
      row('20000000', '1', '63'),
      row('20000000', '2', '63'),
      row('10000000', '1', '09'),
      row('30000000', '1', 'a2', '1'),
    ].join('\r\n');
    const { methods, problems, warnings } = parseCheckMethods(text);
    expect(methods).toEqual({ '10000000': '09', '20000000': '63', '30000000': 'A2' });
    expect(Object.keys(methods)).toEqual(['10000000', '20000000', '30000000']);
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reports a code of the wrong shape, and a BLZ without a Merkmal 1 row', () => {
    const { methods, problems } = parseCheckMethods(
      [HEADER, row('10000000', '1', 'O1'), row('20000000', '2', '00')].join('\n'),
    );
    // « O » n'est jamais une lettre de méthode (Merkblatt, champ 9).
    expect(problems.some((p) => p.startsWith('10000000'))).toBe(true);
    expect(problems.some((p) => p.startsWith('20000000'))).toBe(true);
    expect(methods).toEqual({});
  });

  it('warns, and keeps the Merkmal 1 code, when secondary rows disagree', () => {
    const { methods, problems, warnings } = parseCheckMethods(
      [HEADER, row('20000000', '1', '06'), row('20000000', '2', '10')].join('\n'),
    );
    expect(methods).toEqual({ '20000000': '06' });
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe('the table the API reads', () => {
  it('buildTable gives the shape isDeMethodTable accepts, with the credit line', () => {
    const methods = Object.fromEntries(
      Array.from({ length: DE_TABLE_MIN_ENTRIES }, (_, i) => [String(10000000 + i), '00']),
    );
    const table = buildTable(methods, '2026-10-06');
    expect(isDeMethodTable(table)).toBe(true);
    expect(table.attribution).toBe(DE_TABLE_ATTRIBUTION);
    // Une table tronquée n'est pas une table.
    expect(isDeMethodTable(buildTable({ '10000000': '00' }, '2026-10-06'))).toBe(false);
  });

  it('data/de-pruefziffer.json, as committed, is a table the API accepts', () => {
    const table: unknown = JSON.parse(
      readFileSync(resolve(ROOT, 'data/de-pruefziffer.json'), 'utf8'),
    );
    expect(isDeMethodTable(table)).toBe(true);
  });

  it('the image copies the table outside the volume, and the monthly workflow commits it', () => {
    // Le volume Railway recouvre data/ : sans cette copie, la production n'aurait
    // jamais la table, et l'Allemagne répondrait not_checked sans bruit.
    const docker = readFileSync(resolve(ROOT, 'Dockerfile'), 'utf8');
    expect(docker).toContain('COPY data/de-pruefziffer.json reference/de-pruefziffer.json');
    expect(docker).toContain('ENV DE_PRUEFZIFFER_PATH=/app/reference/de-pruefziffer.json');
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/refresh-bic.yml'), 'utf8');
    expect(workflow).toContain('npm run db:seed-de-pruefziffer');
    expect(workflow).toMatch(/git add [^\n]*data\/de-pruefziffer\.json/);
  });
});
