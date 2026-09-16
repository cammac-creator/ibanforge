import { describe, expect, it } from 'vitest';
import { lensResponse } from './response';

describe('Données éclairées par la lentille', () => {
  it('ne transforme pas un format valide sans registre en banque confirmée', () => {
    const r = lensResponse({ valid: true, bic: { code: 'ALPHCHZZ', bank_name: 'Société Alpha' } });
    expect(r.bankName).toBeNull();
    expect(r.verdict.bankStatus).toBe('unknown');
    expect(r.states).toEqual(['ok', 'absent', 'ok']);
  });
  it('ne présente pas un code absent d’une source partielle comme un refus', () => {
    const r = lensResponse({
      valid: true,
      bank_code_check: { status: 'not_in_register', authoritative: false, reason: 'not_allocated' },
    });
    expect(r.verdict.bankStatus).toBe('unknown');
    expect(r.states).toEqual(['ok', 'absent', 'absent']);
  });
  it('retire les enrichissements lorsque le format est invalide', () => {
    const r = lensResponse({
      valid: false,
      bic: { code: 'ALPHCHZZ' },
      bank_code_check: { status: 'verified', institution: { name: 'Société Alpha' } },
    });
    expect(r.bankName).toBeNull();
    expect(r.bic).toBeNull();
    expect(r.states).toEqual(['erreur', 'absent', 'absent']);
  });
  it('signale le refus autoritatif et le contrôle national négatif', () => {
    expect(
      lensResponse({
        valid: true,
        bic: { code: 'ALPHCHZZ' },
        bank_code_check: {
          status: 'not_in_register',
          authoritative: true,
          reason: 'not_allocated',
        },
      }).states,
    ).toEqual(['ok', 'erreur', 'absent']);
    expect(
      lensResponse({
        valid: true,
        bank_code_check: { status: 'verified', check_digit: { valid: false } },
      }).states[1],
    ).toBe('erreur');
  });
  it('conserve intégralement les crédits et réserves imbriqués', () => {
    const r = lensResponse({
      valid: true,
      bank_code_check: {
        attribution: 'Crédit de la source',
        disclaimer: 'Réserve complète de la source.',
      },
      nested: [{ notice: 'Information de licence.' }],
      attribution: { text: 'Powered by IBANforge' },
    });
    expect(r.notices).toEqual([
      'Crédit de la source',
      'Réserve complète de la source.',
      'Information de licence.',
      'Powered by IBANforge',
    ]);
  });
});
