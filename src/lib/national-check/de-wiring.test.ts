/**
 * L'Allemagne dans les réponses (06.10.2026) : le bloc `national_check_digits`
 * de bout en bout (validation, enrichissement, conformité), sur la vraie table
 * des méthodes (data/de-pruefziffer.json) et de vrais codes banque.
 *
 * Ce que ce fichier tient :
 *
 * 1. Un numéro de test officiel, placé sous un code banque de sa méthode, passe ;
 *    le bloc nomme la méthode et porte la source avec la mention de la Bundesbank.
 * 2. Le même compte rendu faux (chiffres ISO recalculés, donc `valid: true`)
 *    échoue, et seul `next_steps` bouge : exactement une étape bloquante de plus,
 *    moins les étapes d'offre. Rien d'autre ne change.
 * 3. Une méthode non vérifiée ne donne JAMAIS `fail` : `not_checked`, sans étape
 *    bloquante. La méthode 09 donne `not_applicable`, un code banque absent du
 *    fichier `not_checked`.
 * 4. Sans table, aucun bloc : `checks.national_check_digits` dit `not_checked`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { validateIBAN } from '../iban.js';
import { enrichResult } from '../enrich.js';
import { buildComplianceResponse } from '../compliance-response.js';
import { DE_METHODS } from './de/methods.js';
import { DE_TABLE_SOURCE, loadDeMethodTable, resetDeMethodTable } from './de/table.js';
import { DE_OFFICIAL_VECTORS } from './de/vectors.js';
import { DE_VERIFIED_METHODS } from './de/verified.js';

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

const STEP = 'national_check_digits_failed';
const OFFERS = new Set(['screen_compliance', 'generate_payment_qr']);
const hasStep = (r: { next_steps?: Array<{ code: string }> }) =>
  (r.next_steps ?? []).some((s) => s.code === STEP);

const table = loadDeMethodTable();
if (!table) throw new Error('data/de-pruefziffer.json must be present for these tests');
const methods = table.methods;

/** Les codes banque de chaque méthode, dans l'ordre du fichier. */
const blzByMethod = new Map<string, string[]>();
for (const [blz, m] of Object.entries(methods)) {
  if (!blzByMethod.has(m)) blzByMethod.set(m, []);
  blzByMethod.get(m)!.push(blz);
}

/**
 * Pour chaque méthode vérifiée qu'une banque utilise : un code banque de cette
 * méthode et un numéro de test officiel juste (celui du jeu, avec son code
 * banque, quand la méthode lit le code banque).
 */
const CASES: Array<{ method: string; blz: string; account: string }> = [];
for (const method of [...DE_VERIFIED_METHODS].sort()) {
  const blzs = blzByMethod.get(method);
  if (!blzs) continue;
  for (const set of DE_OFFICIAL_VECTORS[method] ?? []) {
    const blz = set.blz ? (methods[set.blz] === method ? set.blz : null) : blzs[0];
    const n = set.pass?.[0];
    if (blz && n) {
      CASES.push({ method, blz, account: n.padStart(10, '0') });
      break;
    }
  }
}

/** Le même numéro avec un seul chiffre changé, que la méthode refuse. */
function failingTwin(method: string, blz: string, account: string): string {
  for (let pos = 9; pos >= 0; pos--) {
    for (let d = 0; d <= 9; d++) {
      const alt = account.slice(0, pos) + d + account.slice(pos + 1);
      if (alt !== account && DE_METHODS[method](alt, blz) === 'fail') return alt;
    }
  }
  throw new Error(`no failing twin for ${method} ${account}`);
}

describe('German account check digits in the validation answer', () => {
  it('covers the verified methods that a bank uses today', () => {
    expect(CASES.length).toBeGreaterThan(10);
  });

  it.each(CASES)('method $method: an official test number passes', ({ method, blz, account }) => {
    const r = enriched(iso('DE', blz + account));
    expect(r.valid).toBe(true);
    expect(r.national_check_digits).toEqual({
      country: 'DE',
      scheme: 'de_pruefziffer',
      status: 'pass',
      method,
      source: DE_TABLE_SOURCE,
      table_fetched_on: table.fetched_on,
    });
    expect(r.national_check_digits?.source).toMatch(/^Quelle: Deutsche Bundesbank/);
    expect(r.checks?.national_check_digits).toBe('pass');
    expect(hasStep(r)).toBe(false);
  });

  it.each(CASES)(
    'method $method: a wrong account fails, next_steps gains the blocking step, nothing else moves',
    ({ method, blz, account }) => {
      const goodIban = iso('DE', blz + account);
      const badIban = iso('DE', blz + failingTwin(method, blz, account));
      const good = enriched(goodIban);
      const bad = enriched(badIban);

      expect(bad.valid, badIban).toBe(true);
      expect(bad.national_check_digits?.status).toBe('fail');
      expect(bad.national_check_digits?.method).toBe(method);
      expect(bad.national_check_digits?.detail).toMatch(/cannot have been issued as written/);
      expect(bad.checks?.national_check_digits).toBe('fail');

      for (const field of [
        'bank_code_holder',
        'bank_code_check',
        'bic',
        'sepa',
        'issuer',
        'risk_indicators',
        'official_identity',
        'psd_registration',
      ] as const) {
        expect(bad[field], `${badIban} ${field}`).toEqual(good[field]);
      }
      expect(hasStep(good), goodIban).toBe(false);
      const extra = (bad.next_steps ?? []).filter((s) => s.code === STEP);
      expect(extra, badIban).toHaveLength(1);
      expect(extra[0]!.because).toBe('national_check_digits.status is fail (de_pruefziffer)');
      expect(
        (bad.next_steps ?? []).filter((s) => s.code !== STEP),
        badIban,
      ).toEqual((good.next_steps ?? []).filter((s) => !OFFERS.has(s.code)));

      const badCompliance = buildComplianceResponse(badIban);
      if (!('compliance' in badCompliance)) throw new Error('compliance answer expected');
      expect(badCompliance.national_check_digits?.status).toBe('fail');
      expect(badCompliance.next_steps, badIban).toEqual(bad.next_steps);
    },
  );

  it('the IBAN registry example (method 13) is not_checked while 13 has no official number', () => {
    const r = enriched('DE89370400440532013000');
    const method = methods['37040044'];
    expect(r.national_check_digits?.method).toBe(method);
    const expected = DE_VERIFIED_METHODS.has(method) ? 'pass' : 'not_checked';
    expect(r.national_check_digits?.status).toBe(expected);
    expect(r.checks?.national_check_digits).toBe(expected);
    expect(hasStep(r)).toBe(false);
  });

  it('a bank without check digits (method 09) is not_applicable, never a verdict', () => {
    const blz = blzByMethod.get('09')![0];
    const r = enriched(iso('DE', blz + '1234567890'));
    expect(r.national_check_digits).toMatchObject({
      country: 'DE',
      scheme: 'de_pruefziffer',
      status: 'not_applicable',
      method: '09',
    });
    expect(r.national_check_digits?.detail).toMatch(/method 09/);
    expect(r.checks?.national_check_digits).toBe('not_applicable');
    expect(hasStep(r)).toBe(false);
  });

  it('a bank code outside the Bundesbank file is not_checked, without a method', () => {
    let blz = '99999999';
    while (Object.hasOwn(methods, blz)) blz = String(Number(blz) - 1);
    const r = enriched(iso('DE', blz + '0000012345'));
    expect(r.valid).toBe(true);
    expect(r.national_check_digits?.status).toBe('not_checked');
    expect(r.national_check_digits).not.toHaveProperty('method');
    expect(r.checks?.national_check_digits).toBe('not_checked');
    expect(hasStep(r)).toBe(false);
  });

  it('an unverified method never fails, on any account number', () => {
    // Générateur à graine fixe : un échec se rejoue à l'identique.
    let seed = 20261006;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const unverified = [...blzByMethod.entries()].filter(
      ([m]) => m !== '09' && !DE_VERIFIED_METHODS.has(m),
    );
    expect(unverified.length).toBeGreaterThan(0);
    for (const [method, blzs] of unverified) {
      for (let i = 0; i < 20; i++) {
        let account = '';
        for (let k = 0; k < 10; k++) account += String(Math.floor(rnd() * 10));
        const r = enriched(iso('DE', blzs[i % blzs.length] + account));
        expect(r.national_check_digits?.status, `${method} ${account}`).toBe('not_checked');
        expect(hasStep(r)).toBe(false);
      }
    }
  });

  it('on random accounts of real bank codes, block, checks and next_steps never disagree', () => {
    let seed = 6102026;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const all = Object.keys(methods);
    for (let i = 0; i < 400; i++) {
      const blz = all[Math.floor(rnd() * all.length)];
      let account = '';
      for (let k = 0; k < 10; k++) account += String(Math.floor(rnd() * 10));
      const r = enriched(iso('DE', blz + account));
      const block = r.national_check_digits!;
      expect(block.status).toBe(r.checks?.national_check_digits);
      expect(hasStep(r), r.iban).toBe(block.status === 'fail');
      if (block.status === 'fail' || block.status === 'pass') {
        expect(DE_VERIFIED_METHODS.has(block.method!), r.iban).toBe(true);
      }
    }
  });
});

describe('without the method table', () => {
  const saved = process.env.DE_PRUEFZIFFER_PATH;
  afterEach(() => {
    if (saved === undefined) delete process.env.DE_PRUEFZIFFER_PATH;
    else process.env.DE_PRUEFZIFFER_PATH = saved;
    resetDeMethodTable();
  });

  it('serves no German block, and checks says not_checked', () => {
    process.env.DE_PRUEFZIFFER_PATH = '/nonexistent/de-pruefziffer.json';
    resetDeMethodTable();
    const r = enriched('DE89370400440532013000');
    expect(r.valid).toBe(true);
    expect(r).not.toHaveProperty('national_check_digits');
    expect(r.checks?.national_check_digits).toBe('not_checked');
    expect(hasStep(r)).toBe(false);
  });
});
