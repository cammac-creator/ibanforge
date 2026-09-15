/** Valeurs communes aux paliers ; ce module ne dépend d'aucun service. */
export type KeyTier = 'anonymous' | 'email' | 'claimed' | 'paid';

export const ANONYMOUS_MONTHLY_LIMIT = 25;
export const FREE_TIER_MONTHLY_LIMIT = 200;
export const SHIELD_MONTHLY_LIMIT = 5;
export const UNIT_PRICE_USD = 0.005;
export const CLAIM_MIN_PAID_USD = Number((FREE_TIER_MONTHLY_LIMIT * UNIT_PRICE_USD).toFixed(2));

/** Sentinelle technique, sans adresse ni fiche de prospect associée. */
export const ANONYMOUS_CONTACT = 'anonymous';
export const KEY_GENERATE_URL = 'https://api.ibanforge.com/v1/keys/generate';
export const KEY_CLAIM_URL = 'https://api.ibanforge.com/v1/keys/claim';
export const KEY_CHECKOUT_URL = 'https://api.ibanforge.com/v1/keys/checkout';

/**
 * `POST /v1/keys/claim` accepte-t-il déjà une clé RÉVOQUÉE POUR RAFALE ?
 *
 * C'est un PRÉALABLE à la révocation automatique, pas un souhait. Tant que ce
 * drapeau vaut `false`, le radar de cohortes rapporte
 * `skipped_reason: 'claim_repair_missing'` et ne coupe rien, même avec
 * `IBANFORGE_REVOCATION_ENABLED=1`.
 *
 * Pourquoi c'est bloquant, en une phrase : le rayon d'une rafale est étroit en
 * clés mais PERMANENT dans le temps. Faire tomber la clé d'un inconnu coûte à un
 * attaquant deux clés plantées sous une chaîne générique (`curl/8.x`,
 * `python-requests/2.x`), renouvelables à chaque tick. Sans réparation, la
 * victime reprend une clé neuve et celle-ci meurt à la rafale suivante : un
 * texte qui l'envoie dans cette boucle est pire qu'un texte muet. Avec la
 * réparation, le même dommage coûte à la victime un code à six chiffres, et à
 * une ferme autant de boîtes réelles que de clés.
 *
 * 🚨 Ce drapeau vit ici, dans le fichier qui possède la route de réclamation, et
 * non dans le radar : il décrit ce que `/v1/keys/claim` fait, pas ce que le
 * radar veut. Il est gardé par un test à DEUX SENS
 * (`src/lib/cohort-radar-anon.test.ts`, en `it.todo` jusqu'au lot 3) : levé trop
 * tôt, le test échoue parce que la route refuse encore ; oublié trop tard, il
 * échoue parce que la route accepte déjà. Il n'y a pas de position confortable,
 * et c'est ce qui empêche le drapeau et la route de diverger d'un commit.
 *
 * Ce que ce garde ne peut pas faire, et il faut le dire : il ne détecte pas une
 * route livrée PUIS bridée par un autre chemin.
 */
export const CLAIM_REPAIR_LANDED = false;
