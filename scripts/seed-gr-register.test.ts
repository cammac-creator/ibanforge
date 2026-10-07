import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGrRegister, parseGrBanks, parseGrPage, writeGrRegister } from './seed-gr-register.js';

/**
 * L'import privé HEBIC. Toutes les lignes sont INVENTÉES, mais dans la forme
 * exacte du fichier de la HBA (ligne de titre, apostrophes d'Excel, adresse en
 * une ligne, Windows-1253) : ce dépôt public ne porte aucune ligne HEBIC.
 */

const PAGE = `<div class="col-md-12">
                Ευρετήριο HEBIC - Έκδοση 2099 B&#39; τρίμηνο
            </div>`;

const CSV = [
  'ΠΙΝΑΚΑΣ ΠΙΣΤΩΤΙΚΩΝ ΙΔΡΥΜΑΤΩΝ ΠΑΡΑΔΕΙΓΜΑΤΟΣ;;;;;',
  'Κωδικός Αριθμός;Όνομα Πιστωτικού Ιδρύματος;Διεύθυνση;Τηλέφωνο;Fax;URL',
  "'011';ΤΡΑΠΕΖΑ ΑΛΦΑ Α.Ε.;ΟΔΟΣ ΑΛΦΑ 1, 100 00 ΑΘΗΝΑ;;;https://alpha.example.net;",
  "'012';ΤΡΑΠΕΖΑ ΒΗΤΑ Α.Ε.;ΛΕΩΦΟΡΟΣ ΒΗΤΑ 2,1ος ΟΡΟΦΟΣ,152 31 ΧΑΛΑΝΔΡΙ,ΑΤΤΙΚΗ;;;;",
  "'13';ΤΡΑΠΕΖΑ ΓΑΜΜΑ Α.Ε. *;ΟΔΟΣ ΓΑΜΜΑ 3, 45 221 ΙΩΑΝΝΙΝΑ;;;;",
  "'014';ΤΡΑΠΕΖΑ ΔΕΛΤΑ Α.Ε.;ΟΔΟΣ ΔΕΛΤΑ 4 ΑΘΗΝΑ;;;;",
  "'1234';Κωδικός πολύ μακρύς;ΟΔΟΣ 5, 100 00 ΑΘΗΝΑ;;;;",
].join('\r\n');

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('parseGrPage', () => {
  it('lit l’édition écrite avec un B latin ou un Β grec', () => {
    expect(parseGrPage(PAGE)).toBe('2099 Q2');
    expect(parseGrPage(PAGE.replace('2099 B&#39;', '2099 Β’'))).toBe('2099 Q2');
    expect(parseGrPage(PAGE.replace('2099 B&#39;', '2100 Δ&#39;'))).toBe('2100 Q4');
  });

  it('refuse une page qui ne nomme plus d’édition, sans horloge de secours', () => {
    expect(() => parseGrPage('<div>Ευρετήριο HEBIC</div>')).toThrow(/édition/);
  });
});

describe('parseGrBanks', () => {
  it('trouve l’en-tête sous la ligne de titre, retire les apostrophes et complète à trois chiffres', () => {
    expect(parseGrBanks(CSV).map((e) => e.code)).toEqual(['011', '012', '013', '014']);
  });

  it('découpe l’adresse sur le code postal, et garde entière une ligne qu’il ne reconnaît pas', () => {
    const byCode = new Map(parseGrBanks(CSV).map((e) => [e.code, e]));
    expect(byCode.get('011')).toEqual({
      code: '011',
      name: 'ΤΡΑΠΕΖΑ ΑΛΦΑ Α.Ε.',
      street: 'ΟΔΟΣ ΑΛΦΑ 1',
      post_code: '10000',
      town: 'ΑΘΗΝΑ',
    });
    expect(byCode.get('012')).toMatchObject({
      street: 'ΛΕΩΦΟΡΟΣ ΒΗΤΑ 2,1ος ΟΡΟΦΟΣ',
      post_code: '15231',
      town: 'ΧΑΛΑΝΔΡΙ,ΑΤΤΙΚΗ',
    });
    expect(byCode.get('013')).toMatchObject({ name: 'ΤΡΑΠΕΖΑ ΓΑΜΜΑ Α.Ε. *', post_code: '45221' });
    expect(byCode.get('014')).toMatchObject({
      street: 'ΟΔΟΣ ΔΕΛΤΑ 4 ΑΘΗΝΑ',
      post_code: null,
      town: null,
    });
  });

  it('refuse un fichier sans en-tête ou dont le séparateur a changé', () => {
    expect(() =>
      parseGrBanks(
        CSV.split('\r\n')
          .filter((l) => !l.startsWith('Κωδικός'))
          .join('\r\n'),
      ),
    ).toThrow(/Κωδικός/);
    expect(() => parseGrBanks(CSV.replace(/;/g, ','))).toThrow(/séparateur/);
  });
});

describe('buildGrRegister', () => {
  it('décode le Windows-1253, date par l’édition et le jour de lecture, et prend l’empreinte du fichier', () => {
    const rows = Array.from(
      { length: 30 },
      (_, i) => `'${200 + i}';ΤΡΑΠΕΖΑ ΠΑΡΑΔΕΙΓΜΑ ${i};ΟΔΟΣ ${i}, 100 00 ΑΘΗΝΑ;;;;`,
    );
    const bytes = encode1253([CSV, ...rows].join('\r\n'));
    const register = buildGrRegister(bytes, '2099 Q2', '2099-03-04');
    expect(register.entries).toHaveLength(34);
    expect(register.entries[0]!.name).toBe('ΤΡΑΠΕΖΑ ΑΛΦΑ Α.Ε.');
    expect(register).toMatchObject({
      source: 'Source: Hellenic Bank Association (HEBIC)',
      edition: '2099 Q2',
      read_on: '2099-03-04',
    });
    expect(register.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuse un fichier tronqué, sous le plancher', () => {
    expect(() => buildGrRegister(encode1253(CSV), '2099 Q2', '2099-03-04')).toThrow(/plancher/);
  });
});

describe('writeGrRegister', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('refuse un chemin relatif et un chemin dans un dépôt git', () => {
    const register = fakeRegister(30);
    expect(() => writeGrRegister('gr.json', register)).toThrow(/absolu/);
    expect(() => writeGrRegister(resolve(here, '../data/gr-register.json'), register)).toThrow(
      /dépôt git/,
    );
    expect(existsSync(resolve(here, '../data/gr-register.json'))).toBe(false);
  });

  it('écrit un fichier privé (0600) et refuse un recul d’édition', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-gr-seed-'));
    directories.push(dir);
    const path = join(dir, 'gr-register.json');
    writeGrRegister(path, fakeRegister(30, '2099 Q2'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(30);
    expect(() => writeGrRegister(path, fakeRegister(30, '2099 Q1'))).toThrow(/Recul/);
    expect(() => writeGrRegister(path, fakeRegister(20, '2099 Q3'))).toThrow(/baisse/);
  });
});

/** Le CSV inventé, encodé comme la HBA l'encode. */
function encode1253(text: string): Buffer {
  const decoder = new TextDecoder('windows-1253');
  const table = new Map<string, number>();
  for (let b = 0; b < 256; b++) table.set(decoder.decode(new Uint8Array([b])), b);
  return Buffer.from([...text].map((c) => table.get(c) ?? 0x3f));
}

function fakeRegister(count: number, edition = '2099 Q2') {
  return {
    schema: 1 as const,
    source: 'Source: Hellenic Bank Association (HEBIC)' as const,
    publication: 'https://www.hba.gr/info/hebicmap' as const,
    edition,
    read_on: '2099-03-04',
    sha256: 'b'.repeat(64),
    entries: Array.from({ length: count }, (_, i) => ({
      code: String(100 + i),
      name: `ΤΡΑΠΕΖΑ ΠΑΡΑΔΕΙΓΜΑ ${i}`,
      street: null,
      post_code: null,
      town: null,
    })),
  };
}
