import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { getBicDB } from './db.js';
import { getPraBanksCount, praAuthorisationByLei } from './pra-banks.js';

/** Le LEI que GLEIF publie pour BUKBGB22. */
function bukbLei(): string {
  const row = getBicDB()
    .prepare('SELECT lei FROM bic_entries WHERE bic8 = ? AND lei IS NOT NULL LIMIT 1')
    .get('BUKBGB22') as { lei: string } | undefined;
  return row?.lei ?? '';
}

/**
 * La carte composite vérifiée contre la VRAIE liste de la Bank of England, là
 * où elle est chargée.
 *
 * Séparé de pra-banks.test.ts le 25/09/2026, quand ce fichier est passé sur une
 * liste inventée : celui-ci porte sur une vraie erreur de saisie, qui ne peut se
 * vérifier que contre la vraie liste. Sa première moitié (la clé de la carte)
 * est une donnée publique et tourne toujours ; la seconde se saute, visiblement,
 * là où la liste n'est pas chargée.
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
  it('GB:BUKB names Barclays, on the LEI GLEIF publishes for its BIC', () => {
    // Données publiques seulement (la carte et GLEIF) : tourne toujours.
    const curated = JSON.parse(
      readFileSync(new URL('../db/bic_data.json', import.meta.url), 'utf8'),
    ) as Record<string, { bic: string; bank_name: string }>;
    const entry = curated['GB:BUKB']!;
    expect(entry.bic).toBe('BUKBGB22');
    expect(entry.bank_name).toContain('Barclays');
    expect(bukbLei()).toBeTruthy();
  });

  // Le rapprochement avec la vraie liste, qui ne peut pas se faire sur une liste
  // inventée : sauté, et compté comme tel, là où la liste n'est pas chargée. Il
  // part dans la porte de qualité privée avec la liste.
  it.skipIf(getPraBanksCount() === 0)('the PRA register names the same institution', () => {
    const pra = praAuthorisationByLei(bukbLei(), 'GB');
    expect(pra).not.toBeNull();
    expect(pra!.firm_name).toContain('Barclays');
  });
});
