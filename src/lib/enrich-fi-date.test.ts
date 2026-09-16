import { describe, expect, it } from 'vitest';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { FI_REGISTER_AS_OF } from './fi-register.js';

/**
 * Audit du 16/09/2026, I1, puis décision de Claude-Alain le même soir : la
 * liste finlandaise est une transcription datée d'octobre 2025 que rien ne
 * rafraîchit. Un résultat confirme ce que la liste sait, daté de la liste ;
 * une absence ne refuse rien (le pays garde la réponse composite qu'il avait
 * avant la liste). Retour au régime autoritatif quand la liste aura été relue.
 */
describe('Finland: a prudent register, dated from the transcribed list', () => {
  it('confirms an allocated code with the date of the list, without claiming authority', () => {
    const result = validateIBAN('FI2112345600000785');
    enrichResult(result);
    expect(result.bank_code_check?.status).toBe('verified');
    expect(result.bank_code_check?.authoritative).toBe(false);
    expect(result.bank_code_check?.register).toMatch(/Finance Finland/);
    expect(result.bank_code_check?.as_of).toBe(FI_REGISTER_AS_OF.slice(0, 7));
  });

  it('never turns a code the list does not carry into a denial', () => {
    // 9 falls in no allocated range of the Finance Finland list.
    const result = validateIBAN('FI1490000000000012');
    enrichResult(result);
    // The composite answer for an unknown code is `not_in_register` with the soft
    // reason `absent_from_reference_data`; the strong `not_allocated` never comes back.
    expect(result.bank_code_check?.reason).not.toBe('not_allocated');
    expect(result.bank_code_check?.authoritative).toBe(false);
    expect(result.next_steps?.map((s) => s.code) ?? []).not.toContain('bank_code_not_allocated');
  });
});
