/**
 * Normalisation et classification des identifiants soumis par des agents.
 *
 * Pourquoi ce module existe : sur 30 jours, 96 % des appels à /v1/bic/:code et
 * à /v1/ch/clearing/:iid repartent en 400. Un assistant IA qui reçoit un 400 ne
 * reformule pas, il déclare à son utilisateur que l'API ne marche pas — chaque
 * rejet est donc une recommandation perdue. Avant de décider quoi tolérer, il
 * faut savoir CE QUI est rejeté : `classify*` produit une catégorie, jamais la
 * valeur soumise (contrainte DPA).
 */

export type RejectReason =
  | 'placeholder_literal'
  | 'normalizable'
  | 'too_short'
  | 'too_long'
  | 'invalid_length'
  | 'invalid_charset'
  | 'not_numeric'
  | 'not_an_identifier';

/** Séparateurs qu'agents et humains recopient depuis un document ou un IBAN. */
const SEPARATORS = /[\s.\-–—_/\\]/g;

/** Raw input carried a separator: a real identifier would already have matched `normalizable`. */
const HAS_SEPARATOR = /[\s.\-–—_/\\]/;

const PLACEHOLDER = /^\{.*\}$/;

/** Forme ISO 9362 stricte, sur une entrée déjà normalisée. */
const BIC_SHAPE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** Garde actuelle de src/routes/bic-lookup.ts — sert de référence « déjà accepté ». */
const BIC_CURRENT_GUARD = /^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/;

/** Garde actuelle de src/routes/ch-clearing.ts. */
const IID_CURRENT_GUARD = /^\d{1,5}$/;

export function normalizeIdentifier(raw: string): string {
  return raw.replace(SEPARATORS, '').toUpperCase();
}

/**
 * Rend null si la route accepte DÉJÀ cette entrée, sinon la raison du rejet.
 * `normalizable` compte exactement les requêtes que la phase 2 convertira.
 */
export function classifyBicInput(raw: string): RejectReason | null {
  if (PLACEHOLDER.test(raw)) return 'placeholder_literal';
  if (BIC_CURRENT_GUARD.test(raw)) return null;

  const n = normalizeIdentifier(raw);
  if (BIC_SHAPE.test(n)) return 'normalizable';
  // Du texte libre, pas un identifiant mal tapé : un vrai BIC écrit avec des
  // séparateurs vient d'être capté par `normalizable` juste au-dessus. Sans ce
  // test, « UBS Switzerland AG » compterait comme `too_long` et ferait conclure
  // « les agents envoient des identifiants trop longs, tronquons » alors que la
  // population réelle est des noms de banques — qui appellent une recherche
  // nom→BIC, pas plus de tolérance.
  if (HAS_SEPARATOR.test(raw)) return 'not_an_identifier';
  if (!/^[A-Z0-9]*$/.test(n)) return 'invalid_charset';
  if (n.length < 8) return 'too_short';
  if (n.length > 11) return 'too_long';
  // Un BIC fait 8 ou 11 caractères : 9 et 10 ne sont ni trop courts ni trop
  // longs. Sans cette catégorie ils tomberaient dans `invalid_charset` alors
  // que leur jeu de caractères est correct, et gonfleraient un compteur qu'on
  // lira pour décider quoi tolérer en phase 2.
  if (n.length !== 8 && n.length !== 11) return 'invalid_length';
  // Reste le cas d'une longueur correcte mais d'un caractère dans une position
  // qui ne l'admet pas (un chiffre dans le code banque ou le code pays).
  return 'invalid_charset';
}

export function classifyIidInput(raw: string): RejectReason | null {
  if (PLACEHOLDER.test(raw)) return 'placeholder_literal';
  if (IID_CURRENT_GUARD.test(raw)) return null;

  // Tolerate only separators and an optional CH prefix: an agent writing
  // "CH-230" or " 230 " means IID 230. An agent writing "account-230-CHF"
  // does not, and answering it with UBS would be a confidently wrong answer.
  const stripped = normalizeIdentifier(raw).replace(/^CH/, '');
  if (/^\d{1,5}$/.test(stripped)) return 'normalizable';

  // Même raison que côté BIC : « account-230-CHF » et « account-230-CHF-2026 »
  // sont le même déchet, mais le second compte 7 chiffres et tombait dans
  // `too_long` — deux seaux différents décidés par un nombre de chiffres
  // accidentel.
  if (HAS_SEPARATOR.test(raw)) return 'not_an_identifier';
  if (!/\d/.test(raw)) return 'not_numeric';
  if (raw.replace(/\D/g, '').length > 5) return 'too_long';
  return 'invalid_charset';
}
