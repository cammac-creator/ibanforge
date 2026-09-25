/**
 * Les phrases qui expliquent les champs de vérité ajoutés le 25/09/2026, écrites
 * une fois pour les surfaces qui les servent : l'OpenAPI, les schémas de sortie
 * MCP (src/mcp/output-schemas.ts) et les descriptions d'outils des deux
 * transports internes (src/mcp/server.ts, src/routes/mcp-http.ts).
 *
 * Le paquet npm `ibanforge-mcp` n'est PAS relié à ce fichier : il est figé
 * jusqu'à sa prochaine version, qui reprendra ces phrases.
 *
 * Aucun mois écrit à la main : celui de la copie figée est lu dans les comptes
 * servis (frozenBicShare), comme toutes les surfaces qui le nomment. Aucune
 * liste de sanctions nommée ici : src/routes/sanctions-claims.test.ts veille à
 * ce qu'aucune surface ne nomme une liste que la base ne porte pas.
 */
import { frozenBicShare } from './positioning.js';

/**
 * Ce que disent `source`, `source_name`, `source_as_of` et `listed_in_current_source`
 * d'une fiche BIC.
 *
 * `withMonth` lit le mois de la copie figée dans la base : réservé aux
 * descriptions construites avec le serveur, jamais à un module évalué à
 * l'import (les schémas de sortie), qui ouvrirait la base à son chargement.
 */
export function bicSourceNote(options: { withMonth?: boolean } = {}): string {
  let month: string | null = null;
  if (options.withMonth) {
    try {
      month = frozenBicShare().month;
    } catch {
      month = null;
    }
  }
  return (
    'source names the dataset of this row and source_name spells it out; source_as_of is present only when that dataset is a copy frozen at that month' +
    (month ? ` (the public copy of the SWIFT directory, frozen in ${month})` : '') +
    '. listed_in_current_source says whether this BIC8 still appears in a list refreshed this cycle (GLEIF, a national register, the EPC scheme registers, the EBA STEP2 list); null when one of those could not be read, never false by default. It does not prove the bank still exists under this name.'
  );
}

/** `listed_in_current_source` sur le bloc `bic` d'une validation. */
export const LISTED_IN_CURRENT_SOURCE_NOTE =
  'Whether this BIC8 still appears in a list refreshed this cycle: GLEIF, the directory sources that carry no vintage, a national register, the EPC scheme registers. null when one of those could not be read on this deployment (not consulted, never false by default). It does NOT prove the bank still exists under this name: a clearing list can keep the name of a bank that was absorbed.';

/** `source_as_of` sur le bloc `bic` d'une validation, élargi à la carte composite. */
export const BIC_SOURCE_AS_OF_NOTE =
  "Year-month the source DATA is from, present ONLY when it differs from as_of. On a curated_map or directory_prefix answer it dates the directory row that supplied the name, the city, the LEI or the address when that row comes from a frozen public copy; never present on a national_register answer, whose name comes from the register and is dated by as_of. Absent means no gap has been established, never 'this is current'.";
