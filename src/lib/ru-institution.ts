import { getBicDB } from './db.js';
import { nationalRegisterAvailable, normaliseCode } from './national-registers.js';

/**
 * Russie (28/10/2026, décision « Nommer seulement ») : les BIC SWIFT de
 * l'ÉTABLISSEMENT qui détient un BIK, pour le contrôle des sanctions.
 *
 * ## Pourquoi pas le seul BIC de la ligne
 *
 * Une succursale russe est la même personne morale que son siège, et la plupart des
 * succursales n'ont pas de BIC SWIFT à elles (le répertoire de la Banque de Russie en
 * publie pour une succursale sur six). Contrôler le seul BIC de la ligne laissait
 * sans réponse, ou pire « non listée », la succursale d'une banque désignée. Le
 * répertoire nomme le siège de chaque succursale (`PrntBIC`, table `ru_branch_heads`
 * de la surcouche) : l'établissement, ce sont le siège et toutes ses succursales, et
 * ce sont tous leurs BIC SWIFT que la conformité passe aux listes
 * (src/lib/compliance.ts, `checkSanctions`).
 *
 * Seuls les BIC que le répertoire marque par défaut, ceux que `national_bank_codes`
 * porte : jamais un BIC secondaire, qui peut appartenir à une autre banque.
 *
 * Sans le registre (surcouche absente, membre retiré), aucun BIC : l'axe banque dit
 * « non contrôlé ». Sans la table des liens, le seul BIC de la ligne. Une lecture qui
 * échoue lève : l'appelant en fait « non contrôlé », jamais un « non ».
 */

function linksLoaded(): boolean {
  return !!getBicDB()
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'ru_branch_heads'")
    .get();
}

/** Les BIC SWIFT (tels que publiés) de l'établissement qui détient ce BIK. */
export function ruInstitutionBics(bik: string): string[] {
  if (!nationalRegisterAvailable('RU')) return [];
  const code = normaliseCode('RU', bik);
  if (!code) return [];
  const db = getBicDB();
  if (!linksLoaded()) {
    const row = db
      .prepare(
        "SELECT bic FROM national_bank_codes WHERE country = 'RU' AND code = ? AND bic IS NOT NULL",
      )
      .get(code) as { bic: string } | undefined;
    return row ? [row.bic] : [];
  }
  const head =
    (
      db.prepare('SELECT head FROM ru_branch_heads WHERE code = ?').get(code) as
        { head: string } | undefined
    )?.head ?? code;
  return (
    db
      .prepare(
        `SELECT DISTINCT bic FROM national_bank_codes
          WHERE country = 'RU' AND bic IS NOT NULL
            AND (code IN (?, ?) OR code IN (SELECT code FROM ru_branch_heads WHERE head = ?))
          ORDER BY bic`,
      )
      .all(code, head, head) as Array<{ bic: string }>
  ).map((r) => r.bic);
}

/**
 * Les BIC SWIFT de l'établissement auquel le répertoire donne ce BIC (huit premiers
 * caractères), pour le chemin BIC. Un BIC que le répertoire ne porte pas : aucun.
 */
export function ruInstitutionBicsForBic(bic8: string): string[] {
  if (!nationalRegisterAvailable('RU')) return [];
  const codes = getBicDB()
    .prepare(
      "SELECT code FROM national_bank_codes WHERE country = 'RU' AND substr(bic, 1, 8) = ? ORDER BY code",
    )
    .all(bic8) as Array<{ code: string }>;
  return [...new Set(codes.flatMap((c) => ruInstitutionBics(c.code)))].sort();
}
