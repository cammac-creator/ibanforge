import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import { getBicDB } from './db.js';
import {
  lookupNationalCode,
  nationalRegisterAvailable,
  nationalRegisterCredit,
  nationalRegisterEdition,
  retiredNationalCodes,
} from './national-registers.js';

/**
 * L'Italie sur la base que ce dépôt LIVRE : seulement ce qui doit tenir quelle
 * que soit l'édition que le rafraîchissement hebdomadaire vient de charger
 * (refresh-it-register.yml relance la suite avant de commiter). Les faits d'une
 * édition vivent dans it-register.test.ts, sur une copie fixe. Rien n'est sauté
 * quand les tables manquent : une base livrée sans le registre italien doit
 * faire rougir ce fichier.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const CIN_ODD = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

/** Un IBAN italien valide pour un code ABI, CIN compris, sur un compte inventé. */
function itIban(abi: string): string {
  const body = `${abi}01600000000123456`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const v = Number(body[i]);
    sum += i % 2 === 0 ? CIN_ODD[v] : v;
  }
  const bban = `${String.fromCharCode(65 + (sum % 26))}${body}`;
  const digits = `${bban}IT00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return `IT${(98n - (BigInt(digits) % 97n)).toString().padStart(2, '0')}${bban}`;
}

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

/**
 * Les deux boucles valident tout le registre (plus de deux mille IBAN) ; sous la
 * charge d'une suite parallèle, le délai par défaut de vitest ne suffit pas.
 */
const WHOLE_REGISTER_TIMEOUT_MS = 60_000;

const edition = nationalRegisterEdition('IT');
const inForce = (
  getBicDB()
    .prepare(`SELECT code FROM national_bank_codes WHERE country = 'IT' ORDER BY code`)
    .all() as Array<{ code: string }>
).map((r) => r.code);
const retired = retiredNationalCodes('IT');

describe('the shipped Italian register', () => {
  it('is loaded, dated by its edition and credited as CC BY 4.0 asks', () => {
    expect(nationalRegisterAvailable('IT')).toBe(true);
    expect(inForce.length).toBeGreaterThan(400);
    expect(retired.size).toBeGreaterThan(1_600);
    expect(edition.source).toBe(
      "Banca d'Italia, Albi ed elenchi di vigilanza (open data, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)",
    );
    expect(edition.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nationalRegisterCredit('IT')).toBe(
      `Source: ${edition.source}, edition ${edition.as_of}; normalised and joined by IBANforge`,
    );
  });

  it('never holds a code both in force and retired', () => {
    for (const code of inForce) expect(retired.has(code), code).toBe(false);
  });

  it(
    'names every code in force as the register writes it, without authority',
    () => {
      for (const code of inForce) {
        const reg = lookupNationalCode('IT', code)!;
        const r = check(itIban(code));
        expect(r.bank_code_check?.status, code).toBe('verified');
        expect(r.bank_code_check?.authoritative, code).toBe(false);
        expect(r.bank_code_check?.retired, code).toBeUndefined();
        expect(r.bank_code_check?.institution?.name, code).toBe(reg.name);
        expect(r.bank_code_holder, code).toBe('confirmed');
      }
    },
    WHOLE_REGISTER_TIMEOUT_MS,
  );

  it(
    'answers every retired code as retired, never as a refusal, with no BIC',
    () => {
      for (const code of retired) {
        const r = check(itIban(code));
        const c = r.bank_code_check!;
        expect(c.status, code).toBe('verified');
        expect(c.reason, code).toBeUndefined();
        expect(c.authoritative, code).toBe(false);
        expect(c.retired, code).toBe(true);
        expect(c.retired_on, code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Le successeur est suivi jusqu'à une entité en vigueur : son code l'est.
        if (c.superseded_by) expect(inForce, code).toContain(c.superseded_by);
        expect(r.bank_code_holder, code).toBe('inferred');
        expect(r.bic ?? null, code).toBeNull();
      }
    },
    WHOLE_REGISTER_TIMEOUT_MS,
  );

  it('answers a curated key the register declares retired as retired, with no BIC', () => {
    // Sentinelle pour une reconstruction du fichier : c'est l'élagage au
    // chargement qui protège les réponses, que bic_data.json ait été nettoyé ou
    // non. Une clé qui y revient après une nouvelle radiation est à retirer du
    // fichier, mais ne doit jamais faire servir le nom d'une banque disparue.
    const curated = JSON.parse(
      readFileSync(resolve(__dirname, '../db/bic_data.json'), 'utf8'),
    ) as Record<string, unknown>;
    const back = Object.keys(curated)
      .filter((k) => k.startsWith('IT:'))
      .map((k) => k.slice(3))
      .filter((code) => retired.has(code));
    // Toléré sans échouer : une radiation de la semaine peut précéder la mise à
    // jour du fichier ; la réponse, elle, est déjà juste (vérifié ci-dessus).
    for (const code of back) {
      const r = check(itIban(code));
      expect(r.bank_code_check?.retired, code).toBe(true);
      expect(r.bic ?? null, code).toBeNull();
    }
  });

  it('leaves the codes it never listed to the composite map, never not_allocated', () => {
    const curated = JSON.parse(
      readFileSync(resolve(__dirname, '../db/bic_data.json'), 'utf8'),
    ) as Record<string, unknown>;
    const outside = Object.keys(curated)
      .filter((k) => /^IT:\d{5}$/.test(k))
      .map((k) => k.slice(3))
      .filter((code) => !inForce.includes(code) && !retired.has(code));
    expect(outside.length).toBeGreaterThan(0);
    for (const code of outside) {
      const r = check(itIban(code));
      expect(r.bank_code_check?.register, code).toMatch(/composite/);
      expect(r.bank_code_check?.authoritative, code).toBe(false);
      expect(r.bank_code_holder, code).not.toBe('not_allocated');
    }
  });
});
