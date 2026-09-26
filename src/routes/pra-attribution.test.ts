import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { getPraListMonth, getPraBanksCount } from '../lib/pra-banks.js';
import {
  PRA_CREDIT_SURFACES,
  praCreditMonths,
  stalePraCredits,
} from '../lib/restricted-data-audit.js';

/**
 * The Bank of England's permission to use the "List of PRA-regulated Banks"
 * (25/08/2026) is conditional: attribution to the Bank of England **together
 * with the month of the list**. That makes the month a licence term, not a
 * freshness detail — a public surface still naming 2026-08 after the list has
 * moved on is a breach, and a silent one.
 *
 * The API's own /llms.txt cannot rot: it calls praAttribution() and reads the
 * month out of the serving database. The static surfaces can — a translation
 * string and a text file cannot call a function. This test is what stops them:
 * it pins every written month against the month actually loaded, so the monthly
 * refresh turns a stale credit line into a red build instead of a quiet
 * licence violation.
 *
 * Fixing a failure here means editing the files listed below to the new month,
 * in the same commit as the data. Never by relaxing this assertion.
 */
const ROOT = join(import.meta.dirname, '..', '..');

/**
 * Every static surface that must carry the credit, and must carry it dated.
 * Shared with the private quality gate (src/lib/restricted-data-audit.ts), which
 * compares them to the list the overlay actually serves.
 */
const SURFACES = PRA_CREDIT_SURFACES;

/**
 * Comparé à la liste que porte réellement la base servie, jamais à un jeu
 * d'essai : un mois inventé pour un test correspondrait aux surfaces par
 * construction, ou les ferait rougir pour rien.
 *
 * La liste a quitté le dépôt public à l'étape du retrait (25/09/2026). Sur la
 * base de ce dépôt, la comparaison surface par surface ci-dessous ne peut pas
 * tourner et se déclare sautée : elle est faite là où la liste est chargée, par
 * la porte de qualité privée (`npm run overlay -- check`, qui appelle
 * auditOverlayData de src/lib/restricted-data-audit.ts à chaque reconstruction
 * et annote le passage d'un avertissement par crédit en retard). Sur une base
 * qui porte la liste (une copie fusionnée), elle tourne ici comme toujours. Le
 * dernier test prouve que la comparaison mord encore, sur toute copie du dépôt.
 */
const loaded = getPraBanksCount() > 0;

/** Les mois de crédit qu'écrit une surface. */
function creditMonths(relative: string): string[] {
  return praCreditMonths(ROOT, relative);
}

/** Chaque crédit de surface qui nomme un autre mois que `month`. */
function staleCredits(month: string): string[] {
  return stalePraCredits(ROOT, month);
}

describe('Bank of England attribution', () => {
  it.each(SURFACES)('%s names the Bank of England with a month', (relative) => {
    // Presence first: the credit disappearing is the same breach as the credit
    // being wrong, and a bare "Bank of England" with no month does not satisfy
    // the condition either.
    expect(creditMonths(relative).length).toBeGreaterThan(0);
  });

  it.skipIf(!loaded).each(SURFACES)('%s names the month actually loaded', (relative) => {
    const loadedMonth = getPraListMonth()!;
    expect(staleCredits(loadedMonth).filter((c) => c.startsWith(`${relative}:`))).toEqual([]);
  });

  it('flags every surface once the loaded month moves on', () => {
    // Le rafraîchissement qui apporte un nouveau mois doit faire rougir les
    // crédits jusqu'à ce qu'ils soient corrigés dans le même commit. Un mois
    // qu'aucune surface ne peut porter prouve que la comparaison le ferait :
    // chaque surface est signalée, aucune n'est sautée.
    const flagged = new Set(staleCredits('1999-01').map((c) => c.split(':')[0]));
    expect([...flagged].sort()).toEqual([...SURFACES].sort());
  });
});
