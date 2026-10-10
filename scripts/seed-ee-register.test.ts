import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EE_BIC_PAGE,
  EE_BIC_SOURCE,
  EE_CREDIT_PAGE,
  EE_PAYMENT_PAGE,
  eeRegisterSchema,
} from '../src/lib/ee-register.js';
import {
  buildEeRegister,
  diffEeRegisters,
  formatEeRegister,
  parseFiEdited,
  parseFiPage,
  parsePangaliit,
  writeEeRegister,
} from './seed-ee-register.js';

/**
 * L'import du registre estonien, sur des CITATIONS de test : quelques lignes des
 * trois pages publiques lues le 08/10/2026 (scripts/fixtures/registers/), pas la
 * table. Elles portent les pièges de ces pages : Luminor a deux codes dans une
 * cellule, « 01 » garde son zéro, une ligne vide termine un tableau, un nom de
 * lien est enveloppé dans un <span>, et Pangaliit remplit ses cellules d'espaces
 * insécables et liste deux codes (83, 99) que l'autorité ne porte pas.
 */

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/registers/${name}-2026-10-08.html`, import.meta.url), 'utf8');
const CREDIT = fixture('ee-fi-credit-institutions');
const PAYMENT = fixture('ee-fi-payment-institutions');
const PANGALIIT = fixture('ee-pangaliit-bank-codes');

/** Les citations sont courtes : les planchers de la vraie lecture ne s'y appliquent pas. */
const FLOORS = { credit_institutions: 3, payment_institutions: 3, bic: 3 };

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('parseFiEdited', () => {
  it('lit la date de dernière modification de la page', () => {
    expect(parseFiEdited(CREDIT)).toBe('2025-08-25');
    expect(parseFiEdited(PAYMENT)).toBe('2026-09-09');
  });

  it('refuse une page sans date ou à la date impossible, sans horloge de secours', () => {
    expect(() => parseFiEdited('<p>rien</p>')).toThrow(/Page last edited/);
    expect(() => parseFiEdited('Page last edited on 31/02/2026')).toThrow(/invalide/);
  });
});

describe('parseFiPage', () => {
  it('lit les établissements de crédit et leur succursale, les deux codes de Luminor compris', () => {
    const { edited, entries } = parseFiPage(CREDIT, 'credit_institutions', 3);
    expect(edited).toBe('2025-08-25');
    const byCode = new Map(entries.map((e) => [e.code, e]));
    expect(entries.map((e) => e.code).sort()).toEqual(['12', '17', '22', '96']);
    expect(byCode.get('96')).toEqual({
      code: '96',
      name: 'Luminor Bank AS',
      kind: 'credit_institution',
    });
    expect(byCode.get('17')?.name).toBe('Luminor Bank AS');
    expect(byCode.get('12')).toMatchObject({
      name: 'AS Citadele banka Eesti filiaal',
      kind: 'foreign_credit_institution_branch',
    });
    // La dernière ligne du tableau est vide (deux &nbsp;) : elle ne crée rien.
    expect(entries.every((e) => e.name !== '')).toBe(true);
  });

  it('lit les établissements de paiement : zéros de tête gardés, nom dans un <span>', () => {
    const { entries } = parseFiPage(PAYMENT, 'payment_institutions', 3);
    const byCode = new Map(entries.map((e) => [e.code, e]));
    expect(entries.map((e) => e.code).sort()).toEqual(['01', '15', '72', '88']);
    expect(byCode.get('01')).toEqual({
      code: '01',
      name: 'Lightspark Payments Europe AS',
      kind: 'payment_or_e_money_institution',
    });
    expect(byCode.get('72')).toMatchObject({ kind: 'foreign_payment_institution_branch' });
  });

  it('applique les planchers de la vraie lecture quand on ne les baisse pas', () => {
    expect(() => parseFiPage(CREDIT, 'credit_institutions')).toThrow(/plancher/);
  });

  it('refuse la page de l’autre autorité : ses tableaux ne sont pas ceux attendus', () => {
    expect(() => parseFiPage(PAYMENT, 'credit_institutions', 3)).toThrow(/tableau inconnu/);
  });

  it('refuse un code illisible, un doublon, une ligne sans code et une page sans date', () => {
    const page = (html: string) => parseFiPage(html, 'credit_institutions', 3);
    expect(() => page(CREDIT.replace('<td>22</td>', '<td>2</td>'))).toThrow(/illisible/);
    expect(() => page(CREDIT.replace('<td>22</td>', '<td>12</td>'))).toThrow(/deux fois/);
    expect(() => page(CREDIT.replace('<td>22</td>', '<td>&nbsp;</td>'))).toThrow(/incomplète/);
    expect(() => page(CREDIT.replace(/Page last edited on[^<]*/, ''))).toThrow(/Page last edited/);
  });

  it('refuse une page dont le tableau principal a disparu', () => {
    expect(() =>
      parseFiPage(CREDIT.replace(/<table[\s\S]*?<\/table>/, ''), 'credit_institutions', 1),
    ).toThrow(/tableau\(x\) principal/);
  });
});

describe('parsePangaliit', () => {
  it('lit un code par ligne, deux pour « 96 / 17 », et les BIC remplis d’espaces insécables', () => {
    const rows = parsePangaliit(PANGALIIT, 3);
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get('96')).toMatchObject({ name: 'Luminor Bank AS', bic: 'RIKOEE22' });
    expect(byCode.get('17')).toMatchObject({ name: 'Luminor Bank AS', bic: 'RIKOEE22' });
    expect(byCode.get('88')).toMatchObject({ name: 'Wallester AS', bic: 'WALLEE22' });
    expect(byCode.get('99')).toMatchObject({ name: 'AS Pocopay', bic: 'AKELEE21' });
    // Une ligne sans BIC reste sans BIC : rien n'est deviné.
    expect(byCode.get('15')).toMatchObject({ name: 'inHouse Pay AS', bic: null });
  });

  it('refuse un BIC d’un autre pays, un tableau disparu et une liste trop pauvre en BIC', () => {
    expect(() => parsePangaliit(PANGALIIT.replace('HABAEE2X', 'HABALV2X'), 3)).toThrow(
      /BIC illisible/,
    );
    expect(() => parsePangaliit('<table><tr><th>Autre</th></tr></table>')).toThrow(/disparu/);
    expect(() => parsePangaliit(PANGALIIT)).toThrow(/plancher/);
  });
});

describe('buildEeRegister', () => {
  const build = (
    overrides: Partial<Record<'creditHtml' | 'paymentHtml' | 'pangaliitHtml', string>> = {},
  ) =>
    buildEeRegister({
      creditHtml: CREDIT,
      paymentHtml: PAYMENT,
      pangaliitHtml: PANGALIIT,
      readOn: '2026-10-08',
      floors: FLOORS,
      ...overrides,
    });

  it('prend les codes de l’autorité et joint le BIC par le code', () => {
    const { register } = build();
    expect(eeRegisterSchema.safeParse(register).success).toBe(true);
    expect(register).toMatchObject({
      source: 'Source: Finantsinspektsioon',
      read_on: '2026-10-08',
      pages: {
        credit_institutions: { url: EE_CREDIT_PAGE, edited: '2025-08-25' },
        payment_institutions: { url: EE_PAYMENT_PAGE, edited: '2026-09-09' },
      },
      bic_source: { name: EE_BIC_SOURCE, url: EE_BIC_PAGE },
    });
    const byCode = new Map(register.entries.map((e) => [e.code, e]));
    expect(register.entries).toHaveLength(8);
    expect(byCode.get('22')).toMatchObject({ name: 'Swedbank AS', bic: 'HABAEE2X' });
    expect(byCode.get('17')?.bic).toBe('RIKOEE22');
    expect(byCode.get('88')).toMatchObject({ name: 'Wallester AS', bic: 'WALLEE22' });
  });

  it('n’importe aucun code que Pangaliit liste seule, et le dit', () => {
    const { register, notes } = build();
    const codes = new Set(register.entries.map((e) => e.code));
    for (const only of ['83', '99']) {
      expect(codes.has(only), only).toBe(false);
      expect(
        notes.some((n) => n.startsWith(`code ${only} :`) && /non importé/.test(n)),
        only,
      ).toBe(true);
    }
  });

  it('laisse `bic: null` quand Pangaliit n’a pas ce code, sans rien déduire d’un nom', () => {
    const { register } = build();
    const byCode = new Map(register.entries.map((e) => [e.code, e]));
    // inHouse Pay est chez Pangaliit sans BIC ; Citadele, Lightspark et Unifiedpost n'y sont pas.
    for (const code of ['15', '12', '01', '72']) expect(byCode.get(code)?.bic, code).toBeNull();
  });

  it('refuse de joindre un BIC quand le nom diffère des deux côtés', () => {
    const { register, notes } = build({
      pangaliitHtml: PANGALIIT.replace('Wallester AS', 'Autre Banque AS'),
    });
    expect(register.entries.find((e) => e.code === '88')?.bic).toBeNull();
    expect(notes.some((n) => n.startsWith('code 88') && /diffèrent/.test(n))).toBe(true);
  });

  it('refuse un code listé sur les deux pages de l’autorité', () => {
    expect(() => build({ paymentHtml: PAYMENT.replace('<td>88</td>', '<td>22</td>') })).toThrow(
      /les deux pages/,
    );
  });
});

describe('formatEeRegister, diffEeRegisters et writeEeRegister', () => {
  const { register } = buildEeRegister({
    creditHtml: CREDIT,
    paymentHtml: PAYMENT,
    pangaliitHtml: PANGALIIT,
    readOn: '2026-10-08',
    floors: FLOORS,
  });

  it('écrit un établissement par ligne, et le fichier relu est identique', () => {
    const text = formatEeRegister(register);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(register);
    expect(text.split('\n').filter((l) => l.startsWith('    {"code"'))).toHaveLength(8);
  });

  it('décrit ce qui change, hors le jour de lecture', () => {
    expect(diffEeRegisters(register, { ...register, read_on: '2026-11-01' })).toEqual([]);
    const changed = {
      ...register,
      pages: {
        ...register.pages,
        credit_institutions: { ...register.pages.credit_institutions, edited: '2026-10-01' },
      },
      entries: [
        ...register.entries
          .filter((e) => e.code !== '12')
          .map((e) => (e.code === '22' ? { ...e, bic: null } : e)),
        { code: '33', name: 'Banque Exemple AS', kind: 'credit_institution' as const, bic: null },
      ],
    };
    const out = diffEeRegisters(register, changed);
    expect(out.some((l) => l.startsWith('page credit_institutions'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 33 ajouté'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 12 retiré'))).toBe(true);
    expect(out.some((l) => l.startsWith('code 22 modifié'))).toBe(true);
  });

  it('écrit un fichier privé (0600) sans fichier temporaire, refuse un recul et la disparition d’un code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-ee-seed-'));
    directories.push(dir);
    const path = join(dir, 'ee-register.json');
    writeEeRegister(path, register);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(register);
    expect(existsSync(`${path}.tmp`)).toBe(false);

    expect(() => writeEeRegister(path, { ...register, read_on: '2026-10-07' })).toThrow(/recule/);
    const fewer = { ...register, entries: register.entries.filter((e) => e.code !== '12') };
    expect(() => writeEeRegister(path, fewer)).toThrow(/disparaissent \(12\)/);
    writeEeRegister(path, fewer, { acceptLoss: true });
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(7);
  });

  it('refuse un chemin relatif et un chemin que git suivrait : la table n’entre pas dans le dépôt', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const tracked = resolve(here, '../src/db/ee-register.json');
    expect(() => writeEeRegister('ee.json', register)).toThrow(/absolu/);
    expect(() => writeEeRegister(tracked, register)).toThrow(/\.gitignore/);
    expect(existsSync(tracked)).toBe(false);
  });

  it('refuse d’écrire un fichier que le schéma refuse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibf-ee-seed-'));
    directories.push(dir);
    const path = join(dir, 'ee-register.json');
    writeFileSync(path, 'ne sera pas lu');
    const bad = { ...register, entries: [{ ...register.entries[0]!, bic: 'EKRDLV22' }] };
    expect(() => writeEeRegister(path, bad)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('ne sera pas lu');
  });
});
