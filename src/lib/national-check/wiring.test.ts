/**
 * Le branchement des clés nationales dans les réponses (25/09/2026).
 *
 * Ce que ce fichier tient, de bout en bout (validation, enrichissement,
 * conformité), là où les tests du module ne voient que le calcul :
 *
 * 1. Le bloc `national_check_digits` est servi tel quel sur un IBAN valide des
 *    six pays, et `checks.national_check_digits` en reprend le statut.
 * 2. Strictement additif : une clé nationale faussée (chiffres ISO recalculés,
 *    donc toujours `valid: true`) ne change ni `bank_code_holder`, ni
 *    `bank_code_check`, ni `next_steps`, ni le score de risque. Le témoin est
 *    le même compte avec la bonne clé, même code banque.
 * 3. Aucun bloc ailleurs, aucun sur un IBAN invalide.
 * 4. Sur un IBAN valide, le statut n'est jamais `not_applicable` : iban-core
 *    refuse d'abord tout BBAN qui n'a pas la forme nationale.
 * 5. Les textes servis nomment chaque pays et chaque algorithme de la table.
 */
import { describe, expect, it } from 'vitest';
import { BBAN_SPECS, EXAMPLE_IBANS } from 'iban-core';
import { validateIBAN } from '../iban.js';
import { enrichResult } from '../enrich.js';
import { buildComplianceResponse } from '../compliance-response.js';
import { CHECKS_NOTE, NATIONAL_CHECK_DIGITS_NOTE, VALIDATE_TRUTH_RETURNS } from '../field-notes.js';
import { NOT_WHAT_IT_IS } from '../positioning.js';
import {
  NATIONAL_CHECK_COUNTRIES,
  NATIONAL_CHECK_SCHEMES,
  NATIONAL_CHECK_SCHEME_NAMES,
  checkNationalKey,
} from './index.js';

/** Chiffres de contrôle ISO 13616 recalculés pour un BBAN donné. */
function iso(cc: string, bban: string): string {
  let rem = 0n;
  for (const ch of bban + cc + '00') {
    for (const d of parseInt(ch, 36).toString()) rem = (rem * 10n + BigInt(d)) % 97n;
  }
  return cc + String(98n - rem).padStart(2, '0') + bban;
}

function enriched(iban: string) {
  const r = validateIBAN(iban);
  enrichResult(r);
  return r;
}

/**
 * L'exemple du registre avec sa clé nationale faussée, chiffres ISO
 * recalculés : le même compte, le même code banque, une autre clé.
 */
function withWrongKey(iban: string): string {
  const cc = iban.slice(0, 2);
  const bban = iban.slice(4);
  let altered: string;
  if (cc === 'IT' || cc === 'SM') {
    altered = (bban[0] === 'A' ? 'B' : 'A') + bban.slice(1);
  } else if (cc === 'ES') {
    const dc = bban.slice(8, 10);
    altered = bban.slice(0, 8) + (dc === '00' ? '01' : '00') + bban.slice(10);
  } else {
    // FR, MC, BE : les deux derniers chiffres.
    const key = bban.slice(-2);
    altered = bban.slice(0, -2) + (key === '00' ? '01' : '00');
  }
  return iso(cc, altered);
}

const EXAMPLES = NATIONAL_CHECK_COUNTRIES.map((cc) => EXAMPLE_IBANS[cc] as string);

describe('the national_check_digits block, served on every validation path', () => {
  it.each(EXAMPLES)('%s: the registry example passes, block and checks agree', (iban) => {
    const r = enriched(iban);
    const cc = iban.slice(0, 2);
    expect(r.valid).toBe(true);
    expect(r.national_check_digits).toEqual({
      country: cc,
      scheme: NATIONAL_CHECK_SCHEMES[cc],
      status: 'pass',
    });
    expect(r.checks?.national_check_digits).toBe('pass');
  });

  it.each(EXAMPLES)('%s: a wrong national key fails, and nothing else moves', (example) => {
    const good = enriched(example);
    const badIban = withWrongKey(example);
    const bad = enriched(badIban);

    expect(bad.valid, badIban).toBe(true);
    expect(bad.national_check_digits?.status).toBe('fail');
    expect(bad.national_check_digits?.detail).toMatch(/cannot have been issued as written/);
    expect(bad.checks?.national_check_digits).toBe('fail');

    // Même code banque, même compte hors clé : tout le reste est identique.
    for (const field of [
      'bank_code_holder',
      'bank_code_check',
      'bic',
      'sepa',
      'issuer',
      'risk_indicators',
      'official_identity',
      'psd_registration',
      'next_steps',
    ] as const) {
      expect(bad[field], `${badIban} ${field}`).toEqual(good[field]);
    }
    expect({ ...bad.checks, national_check_digits: 'x' }).toEqual({
      ...good.checks,
      national_check_digits: 'x',
    });
    // Aucune étape nouvelle (décision du 24/09/2026 : ajout strictement additif) ;
    // l'égalité ci-dessus le prouve déjà, ce test le dit en clair.
    for (const step of bad.next_steps ?? []) {
      expect(step.code, badIban).not.toMatch(/national_check|check_digits/);
    }

    const goodCompliance = buildComplianceResponse(example);
    const badCompliance = buildComplianceResponse(badIban);
    if (!('compliance' in goodCompliance) || !('compliance' in badCompliance)) {
      throw new Error('compliance answer expected');
    }
    expect(badCompliance.compliance, badIban).toEqual(goodCompliance.compliance);
    expect(badCompliance.national_check_digits?.status).toBe('fail');
    expect(badCompliance.checks?.national_check_digits).toBe('fail');
  });

  it('serves no block where no algorithm is coded, and none on an invalid IBAN', () => {
    for (const cc of ['DE', 'CH', 'AT', 'NL', 'PL', 'LI', 'LU', 'PT', 'GB']) {
      const r = enriched(EXAMPLE_IBANS[cc] as string);
      expect(r.valid, cc).toBe(true);
      expect(r, cc).not.toHaveProperty('national_check_digits');
      if (cc === 'GB') {
        // Toujours dérivé de modulus_check, présent ou non selon la table chargée.
        const m = r.modulus_check;
        const expected = !m
          ? 'not_checked'
          : !m.checked
            ? 'not_applicable'
            : m.passed
              ? 'pass'
              : 'fail';
        expect(r.checks?.national_check_digits).toBe(expected);
      } else {
        expect(r.checks?.national_check_digits, cc).toBe('not_checked');
      }
    }
    for (const iban of ['FR1420041010050500013M02607', iso('FR', '2004A010050500013M02606')]) {
      const r = enriched(iban);
      expect(r.valid, iban).toBe(false);
      expect(r, iban).not.toHaveProperty('national_check_digits');
      expect(r, iban).not.toHaveProperty('checks');
    }
  });
});

describe('a valid IBAN never gets not_applicable', () => {
  // Générateur à graine fixe : un échec se rejoue à l'identique.
  let seed = 20260925;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const CLASS: Record<string, () => string> = {
    n: () => String(Math.floor(rnd() * 10)),
    a: () => String.fromCharCode(65 + Math.floor(rnd() * 26)),
    c: () =>
      rnd() < 0.3
        ? String.fromCharCode(65 + Math.floor(rnd() * 26))
        : String(Math.floor(rnd() * 10)),
  };
  function randomBban(spec: string): string {
    let out = '';
    for (const m of spec.matchAll(/(\d+)!([nac])/g)) {
      for (let i = 0; i < Number(m[1]); i++) out += CLASS[m[2]]();
    }
    return out;
  }

  it.each(NATIONAL_CHECK_COUNTRIES)(
    '%s: 500 random BBANs of the registry layout give pass or fail, never not_applicable',
    (cc) => {
      const statuses = new Set<string>();
      for (let i = 0; i < 500; i++) {
        const iban = iso(cc, randomBban(BBAN_SPECS[cc] as string));
        expect(validateIBAN(iban).valid, iban).toBe(true);
        const status = checkNationalKey(iban)?.status;
        expect(['pass', 'fail'], iban).toContain(status);
        statuses.add(status as string);
      }
      expect(statuses.has('fail')).toBe(true);
    },
  );

  it.each(NATIONAL_CHECK_COUNTRIES)(
    '%s: through the enrichment, the block and checks never disagree',
    (cc) => {
      for (let i = 0; i < 25; i++) {
        const r = enriched(iso(cc, randomBban(BBAN_SPECS[cc] as string)));
        expect(r.national_check_digits?.status).toBe(r.checks?.national_check_digits);
      }
    },
  );
});

describe('the served texts say what is checked, country by country', () => {
  const NAMES: Record<string, string> = {
    FR: 'France',
    MC: 'Monaco',
    BE: 'Belgium',
    IT: 'Italy',
    SM: 'San Marino',
    ES: 'Spain',
  };

  it('names every country and every scheme of the table', () => {
    for (const cc of NATIONAL_CHECK_COUNTRIES) {
      expect(CHECKS_NOTE, cc).toContain(cc);
      expect(NATIONAL_CHECK_DIGITS_NOTE, cc).toContain(cc);
      expect(VALIDATE_TRUTH_RETURNS, cc).toContain(cc);
      // Un pays ajouté à la table sans être nommé ici fait échouer ce test.
      expect(NAMES[cc], `${cc}: add its name to NOT_WHAT_IT_IS and here`).toBeDefined();
      expect(NOT_WHAT_IT_IS, cc).toContain(NAMES[cc]);
    }
    for (const scheme of NATIONAL_CHECK_SCHEME_NAMES) {
      expect(NATIONAL_CHECK_DIGITS_NOTE, scheme).toContain(scheme);
    }
  });

  it('no longer says the national check digits are not checked', () => {
    expect(NOT_WHAT_IT_IS).toContain('checks.national_check_digits');
    expect(NOT_WHAT_IT_IS).not.toMatch(/not checked yet \(the French RIB key/);
    expect(CHECKS_NOTE).not.toMatch(/other countries are being added/);
    expect(NOT_WHAT_IT_IS).not.toContain('—');
  });
});
