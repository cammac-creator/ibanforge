import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RS_PUBLICATION, rsRegisterSchema } from '../src/lib/rs-register.js';
import {
  RS_MIN_ENTRIES,
  buildRsRegister,
  diffRsRegisters,
  extractPdfText,
  formatRsRegister,
  nbsAccountCheck,
  parseNbsDate,
  parseNbsRows,
  writeRsRegister,
} from './seed-rs-register.js';

/**
 * L'import du registre serbe, sur une CITATION de test : quelques lignes du texte que
 * `pdftotext -raw` tire du PDF de la Banque nationale de Serbie lu le 10/10/2026
 * (scripts/fixtures/registers/), pas la table. Elle porte les pièges du document : un
 * nom coulé sur plusieurs lignes (9, 19), un saut de page avec son en-tête recopié (15
 * puis 16), un séparateur de compte qui change de tiret (19), et la ligne d'Euroclear,
 * dont le BIC est belge.
 */

const TEXT = readFileSync(
  new URL('./fixtures/registers/rs-nbs-participants-2026-10-10.txt', import.meta.url),
  'utf8',
);

/** La citation est courte : le plancher de la vraie lecture ne s'y applique pas. */
const MIN = 5;

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('nbsAccountCheck', () => {
  it('calcule la clé ISO 7064 mod 97-10 des comptes que la NBS publie', () => {
    expect(nbsAccountCheck('10501')).toBe('97');
    expect(nbsAccountCheck('16001')).toBe('87');
    expect(nbsAccountCheck('26501')).toBe('15');
    expect(nbsAccountCheck('99001')).toBe('86');
  });
});

describe('parseNbsDate', () => {
  it('lit « 1/9/2026 » comme jour/mois/année : le 1er septembre 2026', () => {
    expect(parseNbsDate(TEXT)).toBe('2026-09-01');
  });

  it('refuse un document sans titre ou sans date, ou à la date impossible, sans horloge de secours', () => {
    expect(() => parseNbsDate('Autre document\n1/9/2026')).toThrow(/introuvables/);
    expect(() => parseNbsDate(TEXT.replace('1/9/2026', ''))).toThrow(/introuvables/);
    expect(() => parseNbsDate(TEXT.replace('1/9/2026', '31/2/2026'))).toThrow(/invalide/);
  });
});

describe('parseNbsRows', () => {
  it('lit les lignes, noms coulés sur plusieurs lignes recollés, code pris au groupe central du compte', () => {
    const rows = parseNbsRows(TEXT);
    expect(rows.map((r) => r.code)).toEqual([
      '105',
      '160',
      '200',
      '265',
      '340',
      '370',
      '385',
      '990',
    ]);
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get('105')).toMatchObject({
      n: 1,
      name: 'AIKBANK AKCIONARSKO DRUŠTVO, BEOGRAD',
      bic: 'AIKBRS22XXX',
      registration_number: '06876366',
    });
    expect(byCode.get('200')?.name).toBe('BANKA POŠTANSKA ŠTEDIONICA AKCIONARSKO DRUŠTVO, BEOGRAD');
    // Le séparateur « - » de la ligne 19 n'est pas le tiret long des autres.
    expect(byCode.get('385')?.name).toBe('BANK OF CHINA SRBIJA A.D. BEOGRAD – NOVI BEOGRAD');
    // Le saut de page recopie l'en-tête : il ne rentre dans aucun nom.
    expect(byCode.get('340')?.name).toBe('ERSTE BANK AKCIONARSKO DRUŠTVO NOVI SAD');
    expect(byCode.get('370')?.name).toBe('3 BANKA A.D. NOVI SAD');
  });

  it('refuse une clé de contrôle fausse, un compte sans ligne lue, deux comptes dans une ligne', () => {
    expect(() => parseNbsRows(TEXT.replace('10501 – 97', '10501 – 98'))).toThrow(/clé de contrôle/);
    // Une ligne dont le BIC manque est sautée par le motif : le décompte des comptes la trahit.
    expect(() => parseNbsRows(TEXT.replace('AIKBRS22XXX', ''))).toThrow(/comptes/);
  });

  it('refuse une numérotation hors ordre', () => {
    expect(() => parseNbsRows(TEXT.replace('5. BANCA', '1. BANCA'))).toThrow(/hors ordre/);
  });
});

describe('buildRsRegister', () => {
  it('date par le document et par le jour de lecture, garde le matični broj, et suit le schéma', () => {
    const { register } = buildRsRegister(TEXT, '2026-10-10', MIN);
    expect(rsRegisterSchema.safeParse(register).success).toBe(true);
    expect(register).toMatchObject({
      source: 'Source: National Bank of Serbia',
      publication: RS_PUBLICATION,
      published: '2026-09-01',
      read_on: '2026-10-10',
    });
    expect(register.entries).toHaveLength(7);
    expect(register.entries.find((e) => e.code === '160')).toEqual({
      code: '160',
      name: 'BANCA INTESA AKCIONARSKO DRUŠTVO BEOGRAD',
      bic: 'DBDBRSBGXXX',
      registration_number: '07759231',
    });
  });

  it('écarte Euroclear, dont le BIC est belge, et le dit', () => {
    const { register, notes } = buildRsRegister(TEXT, '2026-10-10', MIN);
    expect(register.entries.some((e) => e.code === '990')).toBe(false);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/ligne 20.*EUROCLEAR.*MGTCBEBEXXX.*non importée/);
  });

  it('refuse un plancher non atteint, un matični broj illisible et un code en double', () => {
    expect(() => buildRsRegister(TEXT, '2026-10-10')).toThrow(/plancher de 15/);
    expect(RS_MIN_ENTRIES).toBe(15);
    expect(() => buildRsRegister(TEXT.replace('06876366', '0687636'), '2026-10-10', MIN)).toThrow(
      /ligne|matični|comptes/,
    );
    const doubled = TEXT.replace(
      '12. RAIFFEISEN BANKA A.D. BEOGRAD 908 – 26501 – 15',
      '12. RAIFFEISEN BANKA A.D. BEOGRAD 908 – 10501 – 97',
    );
    expect(() => buildRsRegister(doubled, '2026-10-10', MIN)).toThrow(/deux fois/);
  });

  it('refuse un document daté après le jour de lecture', () => {
    expect(() => buildRsRegister(TEXT, '2026-08-01', MIN)).toThrow();
  });
});

describe('extractPdfText', () => {
  it('refuse une réponse qui n’est pas un PDF', () => {
    expect(() => extractPdfText(Buffer.from('<html>déplacé</html>'))).toThrow(/pas un PDF/);
  });
});

describe('formatRsRegister, diffRsRegisters et writeRsRegister', () => {
  const { register } = buildRsRegister(TEXT, '2026-10-10', MIN);

  it('écrit une banque par ligne, et le fichier relu est identique', () => {
    const text = formatRsRegister(register);
    expect(JSON.parse(text)).toEqual(register);
    expect(text.split('\n').filter((l) => l.startsWith('    {"code"'))).toHaveLength(7);
  });

  it('décrit ce qui change, hors le jour de lecture', () => {
    expect(diffRsRegisters(register, { ...register, read_on: '2026-11-01' })).toEqual([]);
    const out = diffRsRegisters(register, {
      ...register,
      published: '2026-10-01',
      entries: [
        ...register.entries
          .filter((e) => e.code !== '265')
          .map((e) => (e.code === '160' ? { ...e, bic: 'DBDBRSB2XXX' } : e)),
        {
          code: '999',
          name: 'BANQUE EXEMPLE AD',
          bic: 'EXMPRSBGXXX',
          registration_number: '12345678',
        },
      ],
    });
    expect(out.some((l) => l.startsWith('document daté du 2026-09-01'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 999 ajouté'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 265 retiré'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 160 modifié'))).toBe(true);
  });

  it('écrit un fichier privé (0600) sans fichier temporaire, refuse un recul et la disparition de codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-rs-seed-'));
    directories.push(dir);
    const path = join(dir, 'rs-register.json');
    writeRsRegister(path, register);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(register);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(() => writeRsRegister(path, { ...register, read_on: '2026-10-09' })).toThrow(/recule/);
    expect(() => writeRsRegister(path, { ...register, published: '2026-08-01' })).toThrow(/recule/);
    const fewer = { ...register, entries: register.entries.filter((e) => e.code !== '265') };
    expect(() => writeRsRegister(path, fewer)).toThrow(/disparaissent \(265\)/);
    writeRsRegister(path, fewer, { acceptLoss: true });
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(6);
  });

  it('refuse un chemin relatif et un chemin que git suivrait : la table n’entre pas dans le dépôt', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const tracked = resolve(here, '../src/db/rs-register.json');
    expect(() => writeRsRegister('rs.json', register)).toThrow(/absolu/);
    expect(() => writeRsRegister(tracked, register)).toThrow(/\.gitignore/);
    expect(existsSync(tracked)).toBe(false);
  });
});
