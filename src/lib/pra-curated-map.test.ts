import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { getBicDB } from './db.js';
import { praAuthorisationByLei } from './pra-banks.js';

/**
 * La carte composite vérifiée contre la VRAIE liste de la Bank of England, là
 * où elle est chargée.
 *
 * Séparé de pra-banks.test.ts le 25/09/2026, quand ce fichier est passé sur une
 * liste inventée : celui-ci porte sur une vraie erreur de saisie, qui ne peut se
 * vérifier que contre la vraie liste. Sa première moitié (la clé de la carte)
 * est une donnée publique et tourne toujours ; la seconde mord là où la liste
 * est chargée, comme elle l'a toujours fait.
 */
describe('curated map vs PRA register', () => {
  /**
   * The PRA join made a curation error VISIBLE: GB:BUKB was curated as
   * "Bank of Scotland" while BUKB resolves (via LEI) to Barclays Bank UK PLC
   * on the PRA list. Fixed 26/08/2026; this test pins the one key measured
   * wrong. Deliberately NOT a generic name-match guard: of 5,177 curated GB
   * keys only 4 diverge from the PRA name, and 3 of those are legitimate
   * trading names (NatWest, Halifax, Wise) a generic rule would break.
   */
  it('GB:BUKB names the same institution as the PRA register', () => {
    const curated = JSON.parse(
      readFileSync(new URL('../db/bic_data.json', import.meta.url), 'utf8'),
    ) as Record<string, { bic: string; bank_name: string }>;
    const entry = curated['GB:BUKB']!;
    expect(entry.bic).toBe('BUKBGB22');
    expect(entry.bank_name).toContain('Barclays');
    const row = getBicDB()
      .prepare('SELECT lei FROM bic_entries WHERE bic8 = ? AND lei IS NOT NULL LIMIT 1')
      .get('BUKBGB22') as { lei: string } | undefined;
    if (row?.lei) {
      const pra = praAuthorisationByLei(row.lei, 'GB');
      if (pra) expect(pra.firm_name).toContain('Barclays');
    }
  });
});
