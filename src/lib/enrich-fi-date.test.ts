import { describe, expect, it } from 'vitest';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { FI_REGISTER_AS_OF } from './fi-register.js';

/**
 * Audit du 16/09/2026, I1 : la Finlande est autoritative, sa liste est une
 * transcription datée d'octobre 2025, et la réponse portait la date du
 * rafraîchissement BIC (le mois courant) parce que la branche FI ne renvoyait
 * pas d'`as_of`. Un refus qu'un client va suivre doit dire l'âge de la liste
 * qui le fonde.
 */
describe('Finland: the bank-code verdict carries the date of the transcribed list', () => {
  it('on an allocated code', () => {
    const result = validateIBAN('FI2112345600000785');
    enrichResult(result);
    expect(result.bank_code_check?.authoritative).toBe(true);
    expect(result.bank_code_check?.as_of).toBe(FI_REGISTER_AS_OF.slice(0, 7));
  });

  it('on a code the list does not allocate', () => {
    // 9 falls in no allocated range of the Finance Finland list.
    const result = validateIBAN('FI1490000000000012');
    enrichResult(result);
    expect(result.bank_code_check?.authoritative).toBe(true);
    expect(result.bank_code_check?.as_of).toBe(FI_REGISTER_AS_OF.slice(0, 7));
  });
});
