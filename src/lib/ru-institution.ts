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
 * siège et ses succursales portent le même numéro de licence de la Banque de Russie
 * (`RegN`, table `ru_bik_licences` de la surcouche) : l'établissement, ce sont toutes
 * les lignes de sa licence (le répertoire publie deux lignes de siège pour
 * Sovcombank), et ce sont tous leurs BIC SWIFT que la conformité passe aux listes
 * (src/lib/compliance.ts, `checkSanctions`).
 *
 * Seuls les BIC que le répertoire marque par défaut, ceux que `national_bank_codes`
 * porte : jamais un BIC secondaire, qui peut appartenir à une autre banque.
 *
 * Sans le registre (surcouche absente, membre retiré), aucun BIC : l'axe banque dit
 * « non contrôlé ». Le registre servi SANS la table des licences (membre en échec ou
 * retiré seul) : `null`, l'établissement ne se lit pas en entier et l'axe banque dit
 * « non contrôlé », jamais un « non » sur le seul BIC de la ligne. Un BIK que la table
 * ne porte pas (sans numéro de licence au répertoire) : le seul BIC de la ligne, qui est
 * alors tout l'établissement. Une lecture qui
 * échoue lève : l'appelant en fait « non contrôlé », jamais un « non ».
 */

function licencesLoaded(): boolean {
  return !!getBicDB()
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'ru_bik_licences'")
    .get();
}

/**
 * Les BIC SWIFT par défaut (tels que publiés) de toutes les lignes de la licence qui
 * détient ce BIK ; `null` quand la table des licences manque au registre servi.
 */
export function ruInstitutionBics(bik: string): string[] | null {
  if (!nationalRegisterAvailable('RU')) return [];
  const code = normaliseCode('RU', bik);
  if (!code) return [];
  const db = getBicDB();
  if (!licencesLoaded()) return null;
  const licence =
    (
      db.prepare('SELECT licence FROM ru_bik_licences WHERE code = ?').get(code) as
        { licence: string } | undefined
    )?.licence ?? null;
  return (
    db
      .prepare(
        `SELECT DISTINCT bic FROM national_bank_codes
          WHERE country = 'RU' AND bic IS NOT NULL
            AND (code = ? OR code IN (SELECT code FROM ru_bik_licences WHERE licence = ?))
          ORDER BY bic`,
      )
      .all(code, licence) as Array<{ bic: string }>
  ).map((r) => r.bic);
}

/**
 * Les BIC SWIFT de l'établissement auquel le répertoire donne ce BIC (huit premiers
 * caractères), pour le chemin BIC. Un BIC que le répertoire ne porte pas, ou un
 * registre servi sans ses licences : aucun, et le chemin BIC compare le seul BIC
 * demandé sur ses six premiers caractères, comme sans la surcouche.
 */
export function ruInstitutionBicsForBic(bic8: string): string[] {
  if (!nationalRegisterAvailable('RU')) return [];
  const codes = getBicDB()
    .prepare(
      "SELECT code FROM national_bank_codes WHERE country = 'RU' AND substr(bic, 1, 8) = ? ORDER BY code",
    )
    .all(bic8) as Array<{ code: string }>;
  return [...new Set(codes.flatMap((c) => ruInstitutionBics(c.code) ?? []))].sort();
}
