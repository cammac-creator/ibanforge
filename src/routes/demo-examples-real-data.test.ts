import { describe, expect, it } from 'vitest';
import { OFFICIAL_EXAMPLE_IBANS } from './demo.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { nationalRegisterAvailable } from '../lib/national-registers.js';

/**
 * Les exemples officiels de la démo, contre les VRAIS registres.
 *
 * demo.test.ts tourne sur des registres autrichien et belge inventés, où tout
 * code absent des lignes inventées est refusé d'office : il ne verrait plus le
 * jour où l'OeNB ou la BNB attribuerait 19043 ou 539. Le passage mensuel du
 * rafraîchissement recharge les vrais registres puis lance la suite : c'est
 * ici qu'il rougira, et l'exemple devra alors quitter la démo (src/routes/demo.ts).
 *
 * Ce fichier lit la base servie et ÉCHOUE, au lieu de se sauter, quand un
 * registre manque : le jour où les registres AT et BE quittent le dépôt public,
 * il doit passer consciemment dans la porte de qualité privée, avec eux.
 */
describe('the official examples of the demo, against the registers actually served', () => {
  it.each(OFFICIAL_EXAMPLE_IBANS.map((e) => [e.iban]))(
    '%s is allocated to nobody by its national register',
    (iban) => {
      const cc = iban.slice(0, 2);
      expect(
        nationalRegisterAvailable(cc) || cc === 'CH',
        `${cc}: the register is not loaded; this check belongs where it is`,
      ).toBe(true);
      const r = validateIBAN(iban);
      expect(r.valid).toBe(true);
      enrichResult(r);
      expect(r.bank_code_check).toMatchObject({
        status: 'not_in_register',
        reason: 'not_allocated',
        authoritative: true,
      });
    },
  );
});
