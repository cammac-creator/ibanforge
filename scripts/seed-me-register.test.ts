import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meRegisterSchema } from '../src/lib/me-register.js';
import {
  ME_HEADING,
  buildMeRegister,
  diffMeRegisters,
  formatMeRegister,
  parseMeBanks,
  writeMeRegister,
} from './seed-me-register.js';

/**
 * L'import du registre monténégrin, sur une CITATION de test : trois lignes du
 * tableau des participants du RTGS (sans BIC, qu'on ne lit pas) puis quatre du
 * tableau des codes d'identification bancaires (qu'on lit), de la page de la
 * Banque centrale lue le 08/10/2026 (scripts/fixtures/registers/). Les deux ont une
 * colonne « Fixed no. » : c'est le piège. Ce n'est pas la table.
 */

const PAGE = readFileSync(
  new URL('./fixtures/registers/me-cbcg-rtgs-2026-10-08.html', import.meta.url),
  'utf8',
);

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('parseMeBanks', () => {
  it('lit les banques du tableau des codes d’identification, pas celui des participants', () => {
    const entries = parseMeBanks(PAGE, 3);
    const byCode = new Map(entries.map((e) => [e.code, e]));
    expect(entries.map((e) => e.code)).toEqual(['907', '510', '530', '535']);
    expect(byCode.get('510')).toEqual({
      code: '510',
      name: 'Crnogorska komercijalna banka AD',
      bic: 'CKBCMEPG',
    });
    expect(byCode.get('907')).toMatchObject({ name: 'Centralna banka Crne Gore', bic: 'CBCGMEPG' });
    // Le tableau voisin porte la Trésorerie, les douanes et deux banques en faillite : aucun BIC, non lu.
    for (const code of ['830', '832', '805', '714', '715'])
      expect(byCode.has(code), code).toBe(false);
  });

  it('garde les noms tels que la banque centrale les publie', () => {
    const byCode = new Map(parseMeBanks(PAGE, 3).map((e) => [e.code, e]));
    expect(byCode.get('535')?.name).toBe('Prva banka Crne Gore AD - Osnovana 1901. godine');
    expect(byCode.get('530')?.name).toBe('NLB Banka AD');
  });

  it('refuse une page sans le titre, un tableau aux colonnes changées, un code ou un BIC illisible, un doublon', () => {
    expect(() => parseMeBanks(PAGE.replace(ME_HEADING, 'Autre titre'), 3)).toThrow(/titre/);
    expect(() =>
      parseMeBanks(PAGE.replace('<th>BIC code<br></th>', '<th>Code BIC<br></th>'), 3),
    ).toThrow(/colonnes/);
    expect(() => parseMeBanks(PAGE.replaceAll('<p>510</p>', '<p>51</p>'), 3)).toThrow(/illisible/);
    expect(() => parseMeBanks(PAGE.replaceAll('CKBCMEPG', 'CKBCRSBG'), 3)).toThrow(/BIC illisible/);
    expect(() => parseMeBanks(PAGE.replaceAll('<p>530</p>', '<p>510</p>'), 3)).toThrow(/deux fois/);
  });

  it('applique le plancher de la vraie lecture quand on ne le baisse pas', () => {
    expect(() => parseMeBanks(PAGE)).toThrow(/plancher/);
  });
});

describe('buildMeRegister', () => {
  it('date par le jour de lecture, jamais par une publication, et suit le schéma', () => {
    const register = buildMeRegister(PAGE, '2026-10-08', 3);
    expect(meRegisterSchema.safeParse(register).success).toBe(true);
    expect(register).toMatchObject({
      source: 'Source: Central Bank of Montenegro',
      publication:
        'https://www.cbcg.me/en/core-functions/payment-system/cbcg-payment-system/rtgs-system',
      read_on: '2026-10-08',
    });
    expect(Object.keys(register)).not.toContain('published');
  });
});

describe('formatMeRegister, diffMeRegisters et writeMeRegister', () => {
  const register = buildMeRegister(PAGE, '2026-10-08', 3);

  it('écrit une banque par ligne, et le fichier relu est identique', () => {
    const text = formatMeRegister(register);
    expect(JSON.parse(text)).toEqual(register);
    expect(text.split('\n').filter((l) => l.startsWith('    {"code"'))).toHaveLength(4);
  });

  it('décrit ce qui change, hors le jour de lecture', () => {
    expect(diffMeRegisters(register, { ...register, read_on: '2026-11-01' })).toEqual([]);
    const out = diffMeRegisters(register, {
      ...register,
      entries: [
        ...register.entries
          .filter((e) => e.code !== '535')
          .map((e) => (e.code === '530' ? { ...e, bic: 'MNBAMEP2' } : e)),
        { code: '590', name: 'Banque Exemple AD', bic: 'EXPLMEPG' },
      ],
    });
    expect(out.some((l) => l.startsWith('code 590 ajouté'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 535 retiré'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 530 modifié'))).toBe(true);
  });

  it('écrit un fichier privé (0600) sans fichier temporaire, refuse un recul et la disparition de codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-me-seed-'));
    directories.push(dir);
    const path = join(dir, 'me-register.json');
    writeMeRegister(path, register);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(register);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(() => writeMeRegister(path, { ...register, read_on: '2026-10-07' })).toThrow(/recule/);
    const fewer = { ...register, entries: register.entries.filter((e) => e.code !== '535') };
    expect(() => writeMeRegister(path, fewer)).toThrow(/disparaissent \(535\)/);
    writeMeRegister(path, fewer, { acceptLoss: true });
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(3);
  });

  it('refuse un chemin relatif et un chemin que git suivrait : la table n’entre pas dans le dépôt', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const tracked = resolve(here, '../src/db/me-register.json');
    expect(() => writeMeRegister('me.json', register)).toThrow(/absolu/);
    expect(() => writeMeRegister(tracked, register)).toThrow(/\.gitignore/);
    expect(existsSync(tracked)).toBe(false);
  });
});
