import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  ChLocalitiesNotLoaded,
  HEADER,
  ITEM_URL,
  TERMS,
  parseLocalitiesCsv,
  refreshChLocalities,
  reportChLocalitiesStatus,
  serializeTable,
} from './seed-ch-localities.js';
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

/**
 * Le robot mensuel (refresh-bic.yml, 18/11/2026) : une source qui ne répond pas laisse
 * le fichier en place et le dit au workflow, sans faire échouer le passage ; un format
 * qui change lève. Réseau simulé, fichier dans un dossier temporaire.
 */
describe('seed-ch-localities in the monthly robot', () => {
  const ITEM = {
    properties: { datetime: '2026-11-01T00:00:00Z', updated: '2026-11-01T04:00:00Z' },
    assets: {
      'ortschaftenverzeichnis_plz_4326.csv.zip': { href: 'https://alpha.example.net/l.zip' },
    },
  };

  /** Un répertoire inventé de 5 000 localités, au-dessus du plancher de la table. */
  function zipOfLocalities(): Buffer {
    const lines = [HEADER.join(';')];
    for (let i = 0; i < 5000; i++)
      lines.push(
        `Alpha ${i};${1000 + i};00;${i};Commune ${i};${i};VD;100 %;6.6;46.5;fr;2008-07-01`,
      );
    const CFB = XLSX.CFB as unknown as {
      utils: { cfb_new(): unknown; cfb_add(c: unknown, n: string, b: Buffer): void };
      write(c: unknown, o: { type: 'buffer'; fileType: 'zip'; compression: boolean }): Buffer;
    };
    const archive = CFB.utils.cfb_new();
    CFB.utils.cfb_add(archive, 'localities.csv', Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`));
    return CFB.write(archive, { type: 'buffer', fileType: 'zip', compression: true });
  }

  function server(item: unknown, zip: Buffer | number | Error, itemStatus = 200): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === ITEM_URL)
        return new Response(typeof item === 'string' ? item : JSON.stringify(item), {
          status: itemStatus,
        });
      if (zip instanceof Error) throw zip;
      return typeof zip === 'number'
        ? new Response('indisponible', { status: zip })
        : new Response(new Uint8Array(zip), { status: 200 });
    }) as typeof fetch;
  }

  const dir = mkdtempSync(join(tmpdir(), 'ibf-localites-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const served = join(dir, 'ch-localities.json');
  writeFileSync(served, JSON.stringify({ version: '2026-10-01' }));
  const before = readFileSync(served, 'utf8');

  it.each([
    ['the item refuses', server(ITEM, 200, 503), /STAC item: HTTP 503/],
    ['the item is a refusal page', server('<html>blocked</html>', 200), /not JSON/],
    ['the network fails', server(ITEM, new TypeError('fetch failed')), /network/],
    ['the archive refuses', server(ITEM, 404), /HTTP 404/],
    [
      'the archive is a refusal page',
      server(ITEM, Buffer.from('<html>blocked</html>')),
      /not a zip/,
    ],
  ])('%s: not loaded, the file in place untouched', async (_label, fetchImpl, why) => {
    const error = await refreshChLocalities(served, fetchImpl, '2026-11-18').catch((e) => e);
    expect(error).toBeInstanceOf(ChLocalitiesNotLoaded);
    expect(String(error.message)).toMatch(why);
    expect(readFileSync(served, 'utf8')).toBe(before);
  });

  it('an older version than the one served is not written', async () => {
    const older = { ...ITEM, properties: { ...ITEM.properties, datetime: '2026-09-01T00:00:00Z' } };
    const error = await refreshChLocalities(
      served,
      server(older, zipOfLocalities()),
      '2026-11-18',
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ChLocalitiesNotLoaded);
    expect(readFileSync(served, 'utf8')).toBe(before);
  });

  it('a changed format still throws, for a human to read', async () => {
    const error = await refreshChLocalities(
      served,
      server({ properties: {}, assets: {} }, zipOfLocalities()),
      '2026-11-18',
    ).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ChLocalitiesNotLoaded);
    expect(readFileSync(served, 'utf8')).toBe(before);
  });

  it('a newer version is written whole, dated by its item and by the day it was read', async () => {
    const out = join(dir, 'written.json');
    writeFileSync(out, JSON.stringify({ version: '2026-10-01' }));
    const { table } = await refreshChLocalities(out, server(ITEM, zipOfLocalities()), '2026-11-18');
    expect(table.version).toBe('2026-11-01');
    expect(table.fetched_on).toBe('2026-11-18');
    expect(table.rows).toHaveLength(5000);
    expect(readFileSync(out, 'utf8')).toBe(serializeTable(table));
  });

  it('tells the workflow, on one line, and keeps the exit code', () => {
    const output = join(dir, 'github-output');
    const lines: string[] = [];
    reportChLocalitiesStatus(
      'not_loaded',
      'STAC item: HTTP 503\nretry',
      { GITHUB_OUTPUT: output },
      (l) => lines.push(l),
    );
    expect(lines).toEqual([
      '::warning title=Swiss localities not loaded::STAC item: HTTP 503%0Aretry; data/ch-localities.json stays as it was',
    ]);
    expect(readFileSync(output, 'utf8')).toBe('ch_localities=not_loaded\n');
  });
});
