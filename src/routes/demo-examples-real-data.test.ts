import { describe, expect, it } from 'vitest';
import { OFFICIAL_EXAMPLE_IBANS } from './demo.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { nationalRegisterAvailable } from '../lib/national-registers.js';
import { DEMO_REFUSED_EXAMPLES } from '../lib/restricted-data-audit.js';

/**
 * Les exemples officiels de la démo, contre les VRAIS registres.
 *
 * demo.test.ts tourne sur des registres autrichien et belge inventés, où tout
 * code absent des lignes inventées est refusé d'office : il ne verrait pas le
 * jour où l'OeNB ou la BNB attribuerait 19043 ou 539.
 *
 * Depuis l'étape du retrait (25/09/2026), les registres autrichien et belge ne
 * sont plus dans la base de ce dépôt : ils vivent dans la surcouche privée. Le
 * contrôle est donc parti, comme ce fichier le prévoyait, dans la porte de
 * qualité privée : `npm run overlay -- check` (auditOverlayData,
 * src/lib/restricted-data-audit.ts) annote chaque reconstruction de la surcouche
 * BIC d'un avertissement si l'un de ces codes y est attribué. Ce fichier garde
 * les deux moitiés qui restent vraies ici :
 *
 * - la Suisse, dont le registre (SIX BankMaster) est public et reste dans la
 *   base : son exemple est vérifié contre le vrai registre, comme avant ;
 * - la liste que la porte privée surveille est bien celle de la démo.
 */
describe('the official examples of the demo, against the registers actually served', () => {
  it('checks the Swiss example against the SIX register this repository still carries', () => {
    const swiss = OFFICIAL_EXAMPLE_IBANS.filter((e) => e.iban.startsWith('CH'));
    expect(swiss.length).toBeGreaterThan(0);
    for (const { iban } of swiss) {
      const r = validateIBAN(iban);
      expect(r.valid).toBe(true);
      enrichResult(r);
      expect(r.bank_code_check).toMatchObject({
        status: 'not_in_register',
        reason: 'not_allocated',
        authoritative: true,
      });
    }
  });

  it('hands every other example to the private gate, which reads the registers that decide it', () => {
    const others = OFFICIAL_EXAMPLE_IBANS.filter((e) => !e.iban.startsWith('CH')).map(
      (e) => e.iban,
    );
    expect(DEMO_REFUSED_EXAMPLES.map((e) => e.iban).sort()).toEqual(others.sort());
    // Et ces registres ne sont plus dans la base de ce dépôt : si l'un y
    // revenait, ce test le dirait, et le contrôle devrait revenir ici avec lui.
    for (const example of DEMO_REFUSED_EXAMPLES)
      expect(nationalRegisterAvailable(example.country), example.country).toBe(false);
  });
});
