import { afterAll, describe, it, expect, vi } from 'vitest';

/**
 * Le BIC du registre l'emporte sur une carte composite périmée, en Autriche et
 * en Belgique.
 *
 * Jusqu'au 29/08/2026, le BIC servi venait de la carte composite même quand le
 * registre en publiait un autre : des appariements retirés servis comme vrais
 * (un code belge repris par une autre banque, un code autrichien passé à un
 * autre établissement). Sur des registres inventés, la carte ne porte aucun
 * code et ne répond jamais : at-be-enrich.test.ts ne peut donc plus tenir
 * cette priorité. Ce fichier simule une carte qui répond un autre BIC pour les
 * codes inventés, et vérifie que le registre gagne quand même.
 *
 * Fichier à part pour que la simulation ne touche aucune autre vérification.
 */
const { fixture, FX } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  return { fixture: m.installRestrictedFixture(), FX: m.FIXTURE };
});
afterAll(() => fixture.restore());

/** Les BIC périmés que la carte simulée répond pour les deux codes inventés. */
const STALE = { AT: 'XMPLATW9XXX', BE: 'XMPLBEB9' } as const;

vi.mock('./bic-lookup.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./bic-lookup.js')>();
  return {
    ...real,
    lookupByCountryBank: (cc: string, code: string) =>
      (cc === 'BE' && code === FX.BE.bank.code) || (cc === 'AT' && code === FX.AT.bank.code)
        ? {
            code: cc === 'BE' ? STALE.BE : STALE.AT,
            bank_name: 'Carte périmée (simulée)',
            city: null,
            match: 'register' as const,
            source: 'curated',
            as_of: null,
          }
        : real.lookupByCountryBank(cc, code),
  };
});

const { validateIBAN } = await import('./iban.js');
const { enrichResult } = await import('./enrich.js');

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

describe('the register BIC wins over a stale composite map', () => {
  it('in Belgium', () => {
    const r = check(FX.BE.iban(FX.BE.bank.code));
    expect(r.bic?.code).toBe(FX.BE.bank.bic);
    expect(r.bic?.code).not.toBe(STALE.BE);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });

  it('in Austria', () => {
    const r = check(FX.AT.iban(FX.AT.bank.code));
    expect(r.bic?.code).toBe(FX.AT.bank.bic);
    expect(r.bic?.code).not.toBe(STALE.AT);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });
});
