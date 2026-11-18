import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  DutchListNotLoaded,
  MAX_PAGE_BYTES,
  MAX_XLSX_BYTES,
  MAX_XLSX_UNZIPPED_BYTES,
  PUBLICATION_PAGE,
  findDutchPspWorkbook,
  parseDutchPspWorkbook,
  refreshDutchPsp,
  reportDutchStatus,
} from './refresh-nl-psp.js';
import { runScriptOffline } from '../src/test-support/fake-network.js';

/** Le n-ième identifiant inventé : AAAA, AAAB, … */
const idOf = (i: number) => 'AA' + String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26));

function workbook(date = '03-11-2026', extra: string[][] = [], count = 70) {
  const rows: string[][] = [
    ['Liste fictive ' + date],
    ...Array.from({ length: count }, (_, i) => ['ALPHNL2A', idOf(i), 'Banque Alpha fictive ' + i]),
    ...extra,
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Liste');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Une archive d'une partie comprimée, qui se décompresse au-delà de la borne. */
function inflatingArchive(size: number): Buffer {
  const content = Buffer.alloc(size);
  const data = deflateRawSync(content);
  const name = Buffer.from('xl/padding.bin');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

describe('liste néerlandaise courante', () => {
  it('suit le lien courant et ignore un autre hébergeur', () => {
    expect(
      findDutchPspWorkbook(
        '<a href="/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx">Liste</a><a href="https://alpha.example.net/BIC-lijst-NL.xlsx">Autre</a>',
      ),
    ).toBe('https://www.betaalvereniging.nl/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx');
  });

  // Relecture de la PR 640 : un seul `href` que `new URL` refuse faisait lever la
  // lecture entière, et perdre le passage mensuel.
  it('saute un href illisible', () => {
    const unreadable = 'https://[alpha/BIC-lijst-NL.xlsx';
    expect(() => new URL(unreadable, PUBLICATION_PAGE)).toThrow();
    expect(
      findDutchPspWorkbook(
        `<a href="${unreadable}">x</a><a href="/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx">Liste</a>`,
      ),
    ).toBe('https://www.betaalvereniging.nl/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx');
  });

  it('un lien absent ou deux éditions possibles : la liste n’est pas chargée', () => {
    expect(() => findDutchPspWorkbook('<p>Indisponible</p>')).toThrow(DutchListNotLoaded);
    expect(() =>
      findDutchPspWorkbook(
        '<a href="/BIC-lijst-NL-1.xlsx">1</a><a href="/BIC-lijst-NL-2.xlsx">2</a>',
      ),
    ).toThrow(DutchListNotLoaded);
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

  it('mesure le classeur avant de le lire, et refuse celui qui dépasse ses bornes', () => {
    const blownUp = inflatingArchive(MAX_XLSX_UNZIPPED_BYTES + 1);
    expect(blownUp.length).toBeLessThan(MAX_XLSX_BYTES);
    expect(() => parseDutchPspWorkbook(blownUp)).toThrow(DutchListNotLoaded);
    expect(() => parseDutchPspWorkbook(blownUp)).toThrow(/expands to more than/);
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

  /** Un fichier servi qui porte les `count` premiers identifiants inventés. */
  function servedWith(name: string, count: number): string {
    const path = join(dir, name);
    const providers = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [idOf(i), { bic: 'ALPHNL2A', name: `Alpha ${i}` }]),
    );
    writeFileSync(path, JSON.stringify({ source: 'x', as_of: '2026-06-19', providers }));
    return path;
  }

  function server(
    page: string | number | Error | Response,
    file: Buffer | number | Error | Response,
  ): typeof fetch {
    return (async (input: string | URL | Request) => {
      const answer = String(input) === PUBLICATION_PAGE ? page : file;
      if (answer instanceof Error) throw answer;
      if (answer instanceof Response) return answer;
      if (typeof answer === 'number') return new Response('indisponible', { status: answer });
      return new Response(typeof answer === 'string' ? answer : new Uint8Array(answer), {
        status: 200,
      });
    }) as typeof fetch;
  }

  /** Un corps envoyé en morceaux, sans taille annoncée. */
  const streamed = (bytes: number) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (let sent = 0; sent < bytes; sent += 1024 * 1024)
            controller.enqueue(new Uint8Array(Math.min(1024 * 1024, bytes - sent)));
          controller.close();
        },
      }),
      { status: 200 },
    );

  it.each([
    ['la page refuse', () => server(503, workbook()), /HTTP 503/],
    ['le réseau tombe', () => server(new TypeError('fetch failed'), workbook()), /network/],
    [
      'le délai expire',
      () => server(new DOMException('timeout', 'TimeoutError'), workbook()),
      /timeout/,
    ],
    ['la page répond sans le lien', () => server('<p>Indisponible</p>', workbook()), /0 lien/],
    [
      'la page dépasse son plafond, en flux',
      () => server(streamed(MAX_PAGE_BYTES + 1), workbook()),
      /larger than/,
    ],
    ['le classeur refuse', () => server(PAGE, 404), /HTTP 404/],
    [
      'le classeur annonce plus que son plafond',
      () =>
        server(
          PAGE,
          new Response('x', {
            status: 200,
            headers: { 'content-length': String(MAX_XLSX_BYTES + 1) },
          }),
        ),
      /larger than/,
    ],
    ['une page de refus à la place du classeur', () => server(PAGE, Buffer.from('<html>')), /XLSX/],
    [
      'un classeur qui se décompresse au-delà de sa borne',
      () => server(PAGE, inflatingArchive(MAX_XLSX_UNZIPPED_BYTES + 1)),
      /expands to more than/,
    ],
    ['une édition plus ancienne', () => server(PAGE, workbook('18-06-2026')), /plus ancienne/],
    [
      'une liste sous le plancher',
      () => server(PAGE, workbook('03-11-2026', [], 69)),
      /sous le plancher/,
    ],
  ])('%s : non relue, le fichier en place intact', async (_label, fetchImpl, why) => {
    const error = await refreshDutchPsp(served, fetchImpl()).catch((e) => e);
    expect(error).toBeInstanceOf(DutchListNotLoaded);
    expect(String(error.message)).toMatch(why);
    expect(readFileSync(served, 'utf8')).toBe(before);
  });

  // Relecture de la PR 640 : le plancher seul laissait passer une liste qui perdait un
  // quart de ses lignes. La garde se mesure sur le fichier en place, identifiant par
  // identifiant : une liste qui remplace des prestataires par d'autres garde son compte.
  it('une édition qui perd plus d’un dixième des prestataires servis n’est pas écrite, sauf à la main', async () => {
    const path = servedWith('perte.json', 80);
    const kept = readFileSync(path, 'utf8');
    // 9 perdus sur 80 : plus d'un dixième.
    const error = await refreshDutchPsp(path, server(PAGE, workbook('03-11-2026', [], 71))).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(DutchListNotLoaded);
    expect(String(error.message)).toMatch(/perd 9 des 80 prestataires servis/);
    expect(readFileSync(path, 'utf8')).toBe(kept);
    // 9 identifiants remplacés par 9 autres : le même compte, la même perte.
    const swapped = workbook(
      '03-11-2026',
      Array.from({ length: 9 }, (_, i) => ['ALPHNL2A', `ZZ${idOf(i).slice(2)}`, `Zeta ${i}`]),
      71,
    );
    const again = await refreshDutchPsp(path, server(PAGE, swapped)).catch((e) => e);
    expect(again).toBeInstanceOf(DutchListNotLoaded);
    expect(readFileSync(path, 'utf8')).toBe(kept);
    // Un dixième tout juste : écrit, et les départs sont nommés.
    const tenth = await refreshDutchPsp(path, server(PAGE, workbook('03-11-2026', [], 72)));
    expect(tenth.count).toBe(72);
    expect(tenth.lost).toEqual(Array.from({ length: 8 }, (_, i) => idOf(72 + i)));
    // À la main, après lecture de l'édition : écrit.
    const manual = servedWith('perte-acceptee.json', 80);
    const accepted = await refreshDutchPsp(manual, server(PAGE, workbook('03-11-2026', [], 71)), {
      acceptLoss: true,
    });
    expect(accepted.lost).toHaveLength(9);
    expect(Object.keys(JSON.parse(readFileSync(manual, 'utf8')).providers)).toHaveLength(71);
  });

  it('un classeur qui a changé de forme lève pour un humain', async () => {
    for (const fetchImpl of [
      server(PAGE, workbook('31-02-2026')),
      server(PAGE, workbook('03-11-2026', [['BETANL2A', 'AAAA', 'Banque Beta fictive']])),
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
    expect(result).toEqual({ source: FILE, as_of: '2026-11-03', count: 70, lost: [] });
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

/**
 * Le script tel que le robot le lance (`npm run db:refresh-nl-psp`, donc `main`), dans un
 * processus à part, réseau simulé (relecture de la PR 640) : sortie 0 et `nl_psp=not_loaded`
 * quand la source ne répond pas, sortie 1 sans rien écrire sur un changement de forme,
 * sortie 0 et `nl_psp=loaded` sur une édition nouvelle. Le fichier écrit est toujours
 * dans un dossier temporaire (NL_PSP_PATH), jamais src/db/nl-psp.json.
 */
describe('le script lancé comme le robot le lance', () => {
  const FILE = 'https://www.betaalvereniging.nl/wp-content/uploads/2026/11/BIC-lijst-NL-3.xlsx';
  const dir = mkdtempSync(join(tmpdir(), 'ibf-liste-nl-main-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const good = join(dir, 'bonne.xlsx');
  writeFileSync(good, workbook());
  const broken = join(dir, 'forme-changee.xlsx');
  writeFileSync(broken, workbook('31-02-2026'));
  const page = { text: `<a href="${FILE}">BIC-lijst</a>` };

  function run(name: string, answers: Parameters<typeof runScriptOffline>[1]) {
    const out = join(dir, `${name}.json`);
    writeFileSync(out, JSON.stringify({ source: 'x', as_of: '2026-06-19', providers: {} }));
    const output = join(dir, `${name}.github-output`);
    const result = runScriptOffline(
      'refresh-nl-psp.ts',
      answers,
      { NL_PSP_PATH: out, GITHUB_OUTPUT: output },
      dir,
    );
    return {
      result,
      written: readFileSync(out, 'utf8'),
      output: existsSync(output) ? readFileSync(output, 'utf8') : null,
    };
  }

  it('une source en panne : sortie 0, nl_psp=not_loaded, le fichier intact', () => {
    const { result, written, output } = run('panne', {});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('::warning title=Dutch PSP list not loaded::');
    expect(output).toBe('nl_psp=not_loaded\n');
    expect(JSON.parse(written).as_of).toBe('2026-06-19');
  }, 120_000);

  it('un classeur qui a changé de forme : sortie 1, aucune sortie de workflow, le fichier intact', () => {
    const { result, written, output } = run('forme', {
      [PUBLICATION_PAGE]: page,
      [FILE]: { file: broken },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Date de publication néerlandaise/);
    expect(output).toBeNull();
    expect(JSON.parse(written).as_of).toBe('2026-06-19');
  }, 120_000);

  it('une édition nouvelle : sortie 0, nl_psp=loaded, le fichier écrit', () => {
    const { result, written, output } = run('nouvelle', {
      [PUBLICATION_PAGE]: page,
      [FILE]: { file: good },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(output).toBe('nl_psp=loaded\n');
    expect(JSON.parse(written).as_of).toBe('2026-11-03');
  }, 120_000);
});
