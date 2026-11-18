import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  DutchListNotLoaded,
  PUBLICATION_PAGE,
  findDutchPspWorkbook,
  parseDutchPspWorkbook,
  refreshDutchPsp,
  reportDutchStatus,
} from './refresh-nl-psp.js';

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

/**
 * Le robot mensuel (refresh-bic.yml, 18/11/2026) : une source en panne laisse le
 * fichier en place et le dit au workflow ; un changement de forme lève. Réseau simulé,
 * fichier dans un dossier temporaire, jamais src/db/nl-psp.json.
 */
describe('liste néerlandaise dans le robot mensuel', () => {
  const FILE = 'https://www.betaalvereniging.nl/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx';
  const PAGE = `<a href="${FILE}">BIC-lijst</a>`;
  const dir = mkdtempSync(join(tmpdir(), 'ibf-liste-nl-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const served = join(dir, 'nl-psp.json');
  writeFileSync(served, JSON.stringify({ source: 'x', as_of: '2026-06-19', providers: {} }));
  const before = readFileSync(served, 'utf8');

  function server(page: string | number | Error, file: Buffer | number | Error): typeof fetch {
    return (async (input: string | URL | Request) => {
      const answer = String(input) === PUBLICATION_PAGE ? page : file;
      if (answer instanceof Error) throw answer;
      if (typeof answer === 'number') return new Response('indisponible', { status: answer });
      return new Response(typeof answer === 'string' ? answer : new Uint8Array(answer), {
        status: 200,
      });
    }) as typeof fetch;
  }

  it.each([
    ['la page refuse', server(503, workbook()), /HTTP 503/],
    ['le réseau tombe', server(new TypeError('fetch failed'), workbook()), /network/],
    ['le délai expire', server(new DOMException('timeout', 'TimeoutError'), workbook()), /timeout/],
    ['le classeur refuse', server(PAGE, 404), /HTTP 404/],
    ['une page de refus à la place du classeur', server(PAGE, Buffer.from('<html>')), /XLSX/],
    ['une édition plus ancienne', server(PAGE, workbook('18-06-2026')), /plus ancienne/],
  ])('%s : non relue, le fichier en place intact', async (_label, fetchImpl, why) => {
    const error = await refreshDutchPsp(served, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(DutchListNotLoaded);
    expect(String(error.message)).toMatch(why);
    expect(readFileSync(served, 'utf8')).toBe(before);
  });

  it('une page sans le lien, ou un classeur qui a changé de forme, lève pour un humain', async () => {
    for (const fetchImpl of [
      server('<p>Indisponible</p>', workbook()),
      server(PAGE, workbook('31-02-2026')),
    ]) {
      const error = await refreshDutchPsp(served, fetchImpl).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DutchListNotLoaded);
      expect(readFileSync(served, 'utf8')).toBe(before);
    }
  });

  it('une édition nouvelle est écrite entière, avec son adresse et sa date', async () => {
    const out = join(dir, 'ecrite.json');
    writeFileSync(out, before);
    const result = await refreshDutchPsp(out, server(PAGE, workbook()));
    expect(result).toEqual({ source: FILE, as_of: '2026-11-03', count: 70 });
    const written = JSON.parse(readFileSync(out, 'utf8'));
    expect(written.source).toBe(FILE);
    expect(written.as_of).toBe('2026-11-03');
    expect(Object.keys(written.providers)).toHaveLength(70);
  });

  it('le dit au workflow, sur une ligne, sans changer le code de sortie', () => {
    const output = join(dir, 'github-output');
    const lines: string[] = [];
    reportDutchStatus('not_loaded', 'HTTP 503\nencore', { GITHUB_OUTPUT: output }, (l) =>
      lines.push(l),
    );
    expect(lines).toEqual([
      '::warning title=Dutch PSP list not loaded::HTTP 503%0Aencore; src/db/nl-psp.json stays as it was',
    ]);
    expect(readFileSync(output, 'utf8')).toBe('nl_psp=not_loaded\n');
  });
});
