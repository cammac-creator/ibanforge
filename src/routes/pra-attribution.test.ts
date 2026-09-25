import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPraListMonth, getPraBanksCount } from '../lib/pra-banks.js';

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

/** Every static surface that must carry the credit, and must carry it dated. */
const SURFACES = [
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'frontend/messages/en.json',
  'frontend/messages/fr.json',
  'frontend/messages/de.json',
  'frontend/content/en/docs/data-sources.mdx',
  'frontend/content/fr/docs/data-sources.mdx',
  'frontend/content/de/docs/data-sources.mdx',
];

const CREDIT = /Bank of England \(List of Banks, (\d{4}-\d{2})\)/g;

/**
 * Comparé à la liste que porte réellement la base servie, jamais à un jeu
 * d'essai : un mois inventé pour un test correspondrait aux surfaces par
 * construction, ou les ferait rougir pour rien.
 *
 * La liste quitte le dépôt public (décision du 24/09/2026). Sur une base sans
 * elle, la comparaison surface par surface ci-dessous ne peut pas tourner et se
 * déclare sautée ; elle appartient alors à l'endroit où la liste est chargée
 * (le rafraîchissement privé qui l'apporte). Tant que la liste est là, elle
 * tourne ici comme toujours. Le dernier test prouve que la comparaison mord
 * encore, sur toute copie du dépôt.
 */
const loaded = getPraBanksCount() > 0;

/** Les mois de crédit qu'écrit une surface. */
function creditMonths(relative: string): string[] {
  const text = readFileSync(join(ROOT, relative), 'utf8');
  return [...text.matchAll(CREDIT)].map((m) => m[1]!);
}

/** Chaque crédit de surface qui nomme un autre mois que `month`. */
function staleCredits(month: string): string[] {
  return SURFACES.flatMap((relative) =>
    creditMonths(relative)
      .filter((m) => m !== month)
      .map((m) => `${relative}: ${m}`),
  );
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
