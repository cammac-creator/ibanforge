import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEADER, TERMS, parseLocalitiesCsv, serializeTable } from './seed-ch-localities.js';
import { isChLocalitiesTable, type ChLocalitiesTable } from '../src/lib/ch-localities.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Quatre lignes du fichier de swisstopo du 01.10.2026, recopiées telles quelles (BOM, CRLF). */
const SAMPLE =
  '\uFEFF' +
  [
    HEADER.join(';'),
    'Moutier;2740;00;1533;Moutier;6831;JU;99.669 %;7.369108086890357;47.27735898338859;fr;2008-07-01',
    'Moutier;2740;00;1533;Roches (BE);704;BE;0.331 %;7.34488978143766;47.295501509506664;fr;2008-07-01',
    'Biel/Bienne;2502;00;1428;Biel/Bienne;371;BE;100 %;7.24809474467711;47.142049067614586;multiple;2008-07-01',
    'Vaduz;9490;00;5393;Vaduz;7001;;100 %;9.517532561031839;47.14313943072252;de;2008-07-01',
  ].join('\r\n') +
  '\r\n';

describe('seed-ch-localities', () => {
  it('keeps six columns, in code-point order, and drops coordinates, address share and municipality number', () => {
    const { rows, problems, duplicates } = parseLocalitiesCsv(SAMPLE);
    expect(problems).toEqual([]);
    expect(duplicates).toBe(0);
    expect(rows).toEqual([
      ['2502', '00', 'Biel/Bienne', 'Biel/Bienne', 'BE', 'multiple'],
      ['2740', '00', 'Moutier', 'Moutier', 'JU', 'fr'],
      ['2740', '00', 'Moutier', 'Roches (BE)', 'BE', 'fr'],
      ['9490', '00', 'Vaduz', 'Vaduz', '', 'de'],
    ]);
  });

  it('stops on a changed format rather than writing a wrong table', () => {
    expect(parseLocalitiesCsv(SAMPLE.replace('Kantonskürzel', 'Kanton')).problems[0]).toContain(
      'unexpected header',
    );
    // Une ligne sans canton hors des communes du Liechtenstein.
    const noCanton = SAMPLE.replace(';6831;JU;', ';6831;;');
    expect(parseLocalitiesCsv(noCanton).problems.join(' ')).toContain('no canton outside');
    expect(parseLocalitiesCsv(SAMPLE.replace(';2740;', ';274;')).problems.join(' ')).toContain(
      'postcode',
    );
    expect(parseLocalitiesCsv(SAMPLE.replace(';JU;', ';XX;')).problems.join(' ')).toContain(
      'canton',
    );
  });

  it('writes one row per line and reads back as the same table', () => {
    const table = JSON.parse(
      readFileSync(resolve(ROOT, 'data/ch-localities.json'), 'utf8'),
    ) as ChLocalitiesTable;
    const text = serializeTable(table);
    expect(JSON.parse(text)).toEqual(table);
    expect(text.split('\n').filter((l) => l.startsWith('    ["')).length).toBe(table.rows.length);
    // Le fichier suivi est exactement ce que le script écrit.
    expect(readFileSync(resolve(ROOT, 'data/ch-localities.json'), 'utf8')).toBe(text);
    expect(isChLocalitiesTable(table)).toBe(true);
    expect(table.terms).toBe(TERMS);
  });

  it('the image copies the table outside the volume and names it', () => {
    // Le volume Railway recouvre data/ : sans cette copie, la production
    // répondrait directory_unavailable, sans un mot.
    const docker = readFileSync(resolve(ROOT, 'Dockerfile'), 'utf8');
    expect(docker).toContain('COPY data/ch-localities.json reference/ch-localities.json');
    expect(docker).toContain('ENV CH_LOCALITIES_PATH=/app/reference/ch-localities.json');
    const ignored = readFileSync(resolve(ROOT, '.dockerignore'), 'utf8');
    expect(ignored).not.toMatch(/^data\/?$|^data\/\*\.json|ch-localities/m);
  });
});
