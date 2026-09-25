/**
 * Les codes d'établissement finlandais (Finance Finland), lus dans la base servie.
 *
 * ## D'où vient la liste
 *
 * « Finnish monetary institution codes and BICs », Finanssiala ry (Finance
 * Finland). Jusqu'au 25/09/2026, une transcription à la main de la liste du
 * 15.10.2025 vivait dans ce fichier. Ses conditions de réutilisation ne sont pas
 * établies : elle a quitté le dépôt public avec le reste de la famille sous
 * conditions (src/lib/restricted-family.ts, membre `register_fi`, table
 * `fi_monetary_codes`) et l'API la lit désormais dans la surcouche privée. Sans
 * surcouche, la table est vide ou absente : `lookupFiInstitution` répond `null`
 * (non consulté), jamais « non attribué ».
 *
 * ## Ce que vaut une attribution
 *
 * La Finlande attribue des PRÉFIXES à des groupes bancaires, pas à des
 * établissements, et de longueur variable (un à quatre caractères). Un résultat
 * confirme le groupe et son BIC ; il ne désigne pas une banque précise comme un
 * IID suisse ou une BLZ allemande. La lecture se fait donc par préfixe le plus
 * long : un code à trois chiffres peut être attribué alors que son premier
 * chiffre seul ne l'est à personne, et une lecture plus courte inventerait un
 * titulaire.
 *
 * Les requêtes sont mémorisées avec la connexion : `resetFiRegister()` est
 * appelé à chaque fermeture de la base BIC (src/lib/bic-lookup.ts,
 * resetStatements), donc à chaque rechargement de la surcouche.
 */
import { getBicDB } from './db.js';

export interface FiHit {
  status: 'allocated' | 'not_allocated' | 'unknown';
  code?: string;
  bic?: string;
  institution?: string;
}

interface FiList {
  byCode: Map<string, { bic: string; institution: string }>;
  /** Date de la liste (AAAA-MM-JJ), la plus récente des lignes. */
  asOf: string | null;
}

/** `undefined` : pas encore lue ; `null` : absente ou vide dans la base servie. */
let cache: FiList | null | undefined;

function load(): FiList | null {
  if (cache !== undefined) return cache;
  let rows: Array<{ code: string; bic: string; institution: string; as_of: string | null }>;
  try {
    rows = getBicDB()
      .prepare('SELECT code, bic, institution, as_of FROM fi_monetary_codes ORDER BY code')
      .all() as typeof rows;
  } catch {
    // Pas de table : la base publique seule, ou une surcouche qui ne la porte pas.
    cache = null;
    return cache;
  }
  if (rows.length === 0) {
    cache = null;
    return cache;
  }
  const byCode = new Map<string, { bic: string; institution: string }>();
  let asOf: string | null = null;
  for (const row of rows) {
    if (!/^\d{1,4}$/.test(row.code)) continue;
    byCode.set(row.code, { bic: row.bic, institution: row.institution });
    if (row.as_of && (!asOf || row.as_of > asOf)) asOf = row.as_of;
  }
  cache = byCode.size > 0 ? { byCode, asOf } : null;
  return cache;
}

/** La liste est-elle servie (surcouche chargée et membre `register_fi` présent) ? */
export function fiRegisterLoaded(): boolean {
  return load() !== null;
}

/** La date de la liste servie (AAAA-MM-JJ), ou null. */
export function fiRegisterAsOf(): string | null {
  return load()?.asOf ?? null;
}

/**
 * La bande que la liste définit sans la peupler : « from the beginning of the
 * year 2024 codes with '72-78' are four characters long ». L'absence d'un
 * titulaire n'y prouve pas que la bande est libre : répondre « non attribué »
 * dirait plus que la source.
 */
function inReservedBand(bban: string): boolean {
  const two = Number(bban.slice(0, 2));
  return two >= 72 && two <= 78;
}

/**
 * L'établissement d'un BBAN finlandais, par préfixe attribué le plus long (quatre
 * caractères, puis trois, deux, un). `null` quand la liste n'est pas servie ou
 * que le BBAN n'a pas la forme attendue.
 */
export function lookupFiInstitution(bban: string): FiHit | null {
  const list = load();
  if (!list) return null;
  if (!/^\d{4,}$/.test(bban)) return null;
  for (let len = 4; len >= 1; len--) {
    const candidate = bban.slice(0, len);
    const hit = list.byCode.get(candidate);
    if (hit)
      return { status: 'allocated', code: candidate, bic: hit.bic, institution: hit.institution };
  }
  if (inReservedBand(bban)) return { status: 'unknown' };
  return { status: 'not_allocated' };
}

/** Chaque code attribué, pour élaguer les clés de la carte composite qui la contredisent. */
export function allocatedFiCodes(): ReadonlySet<string> {
  return new Set(load()?.byCode.keys() ?? []);
}

/** Oublie la liste lue : appelé à chaque fermeture de la base BIC. */
export function resetFiRegister(): void {
  cache = undefined;
}
