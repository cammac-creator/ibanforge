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
