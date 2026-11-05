/**
 * La page « IBAN-API für Deutschland » montre deux réponses de l'API. La première
 * se lit dans l'export du registre ; la seconde, celle d'un code que personne ne
 * porte, ne peut venir d'aucun export : elle tient dans un petit fichier JSON à
 * côté de la page. Le site ne peut pas importer le code de l'API (règle 4
 * d'`AGENTS.md`), alors c'est ici, côté API, qu'on la compare à ce que l'API
 * calcule vraiment, avec les champs que le texte de la page nomme.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enrichResult } from '../src/lib/enrich.js';
import { validateIBAN } from '../src/lib/iban.js';
import { DE_EXCLUDED_METHODS } from '../src/lib/national-check/de/verified.js';
import { loadDeMethodTable } from '../src/lib/national-check/de/table.js';

const PAGE = join(import.meta.dirname, '..', 'frontend', 'app', '[locale]', 'iban-api-deutschland');

interface NotAllocated {
  iban: string;
  bank_code_check: Record<string, unknown>;
  next_step: { code: string; do: string };
}

const shown = JSON.parse(readFileSync(join(PAGE, 'not-allocated.json'), 'utf8')) as NotAllocated;

/** Les seuls champs que la page nomme, comme l'API les renvoie. */
interface Answer {
  valid: boolean;
  bic: unknown;
  bank_code_check: { register?: string; status?: string };
  next_steps: unknown;
  national_check_digits: { status: string; method?: unknown; source: string };
  checks: { national_check_digits: string };
  sepa: object;
}

/** Une IBAN allemande aux chiffres de contrôle ISO 13616 justes. */
function iso(bban: string): string {
  let rem = 0n;
  for (const ch of `${bban}DE00`) {
    for (const d of parseInt(ch, 36).toString()) rem = (rem * 10n + BigInt(d)) % 97n;
  }
  return `DE${String(98n - rem).padStart(2, '0')}${bban}`;
}

function answer(iban: string): Answer {
  const result = validateIBAN(iban);
  enrichResult(result);
  return result as unknown as Answer;
}

describe('la page allemande montre ce que l’API répond', () => {
  it('le code non attribué : le fichier de la page est la réponse de l’API', () => {
    const r = answer(shown.iban);
    expect(r.valid).toBe(true);
    expect(r.bic).toBeNull();
    expect(r.bank_code_check).toMatchObject(shown.bank_code_check);
    expect(r.bank_code_check.register).toBe('Deutsche Bundesbank Bankleitzahlendatei');
    expect(r.next_steps).toEqual(
      expect.arrayContaining([expect.objectContaining(shown.next_step)]),
    );
  });

  it('l’IBAN modèle : registre, BIC et méthode, avec les champs que la page nomme', () => {
    const r = answer('DE89370400440532013000');
    expect(r.valid).toBe(true);
    expect(r.bank_code_check).toMatchObject({
      value: '37040044',
      status: 'verified',
      match: 'register',
      authoritative: true,
    });
    expect(r.bic).toMatchObject({
      source: 'Deutsche Bundesbank Bankleitzahlendatei',
      basis: 'national_register',
      authoritative: true,
    });
    expect(r.national_check_digits).toMatchObject({ country: 'DE', status: 'pass' });
    expect(r.national_check_digits.method).toEqual(expect.any(String));
    expect(r.national_check_digits.source).toContain('Quelle: Deutsche Bundesbank');
    expect(r.sepa).toHaveProperty('vop_participant');
    expect(r.sepa).toHaveProperty('vop_register_status');
  });

  it('un code absent du registre n’a pas de méthode : la clé du compte reste not_checked', () => {
    const r = answer(shown.iban);
    expect(r.national_check_digits.status).toBe('not_checked');
    expect(r.checks.national_check_digits).toBe('not_checked');
  });

  it('un code du registre dont on ne peut pas appliquer la méthode reste not_checked, jamais un refus', () => {
    const table = loadDeMethodTable();
    if (!table) throw new Error('data/de-pruefziffer.json must be present for this test');
    const excluded = Object.entries(table.methods).filter(([, m]) => DE_EXCLUDED_METHODS.has(m));
    expect(excluded.length).toBeGreaterThan(0);
    const [blz] = excluded[0];
    const r = answer(iso(`${blz}0000012345`));
    expect(r.valid).toBe(true);
    expect(r.bank_code_check.status).toBe('verified');
    expect(r.national_check_digits.status).toBe('not_checked');
    expect(r.checks.national_check_digits).toBe('not_checked');
  });
});
