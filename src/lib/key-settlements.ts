import { getStatsDB } from './db.js';
import { CLAIM_MIN_PAID_USD } from './tiers.js';
import { claimKey } from './api-keys.js';
import { recordLineageSettlement } from './lineage-facts.js';

/**
 * Ce qui a été payé, sur quelle clé (spec 01 §3.5).
 *
 * Une ligne par règlement, `payment_ref UNIQUE` et `INSERT OR IGNORE` : une
 * requête rejouée avec le même en-tête de paiement n'écrit rien deux fois,
 * ce qui rend le crochet sûr à appeler depuis un middleware.
 *
 * `quoted_amount_usd` dit ce que la ligne contient : le montant que le paywall
 * a COTÉ pour cette requête, pas un reçu du facilitateur. Aucun montant
 * confirmé n'atteint notre code au point d'accroche.
 *
 * 🚨 Une cotation inconnue n'écrit AUCUNE ligne, jamais une ligne à 0 : comme
 * la référence est unique, une ligne à 0 consommerait la référence et rendrait
 * toute écriture correcte ultérieure silencieusement inopérante. Une ligne
 * absente se rattrape, une ligne fausse non.
 */
export function recordKeySettlement(p: {
  keyHash: string;
  keyPrefix: string;
  paymentRef: string;
  route: string;
  quotedAmountUsd: number;
}): boolean {
  if (!Number.isFinite(p.quotedAmountUsd) || p.quotedAmountUsd <= 0) return false;
  const info = getStatsDB()
    .prepare(
      'INSERT OR IGNORE INTO key_settlements (key_hash, key_prefix, payment_ref, quoted_amount_usd, route) VALUES (?, ?, ?, ?, ?)',
    )
    .run(p.keyHash, p.keyPrefix, p.paymentRef, p.quotedAmountUsd, p.route);
  // Le fait de mesure seulement quand l'INSERT a RÉELLEMENT inséré : une
  // requête rejouée avec la même référence ne doit pas faire monter le compteur
  // de règlements de la lignée (lot M).
  if (info.changes > 0) recordLineageSettlement(p.keyHash);
  return info.changes > 0;
}

/** Cumul coté sur cette clé, 0 si aucune ligne. Par hash : la rotation déplace ces lignes. */
export function paidSoFarUsd(keyHash: string): number {
  const row = getStatsDB()
    .prepare(
      'SELECT COALESCE(SUM(quoted_amount_usd), 0) AS total FROM key_settlements WHERE key_hash = ?',
    )
    .get(keyHash) as { total: number };
  return row.total;
}

/**
 * Promotion par paiement : rien tant que le cumul reste sous
 * `CLAIM_MIN_PAID_USD`, puis `claimKey` une seule fois, idempotente par son
 * `WHERE tier = 'anonymous'`. Un paiement donne 200 UNE FOIS (no_recredit) :
 * en récurrent, une ferme se rachèterait le quota à perpétuité pour 1 $.
 */
export function claimIfPaidEnough(keyHash: string, method: 'x402' | 'credits'): boolean {
  if (paidSoFarUsd(keyHash) < CLAIM_MIN_PAID_USD) return false;
  return claimKey(keyHash, method);
}

/**
 * Le geste que le crochet x402 appelle : l'écriture de la ligne et la
 * promotion éventuelle dans la MÊME transaction. Une clé qui a réellement
 * réglé mais dont la promotion aurait échoué garderait `claimed_at IS NULL` et
 * serait révocable par le radar : c'est la panne que la transaction ferme.
 */
export function settleAndMaybeClaim(p: {
  keyHash: string;
  keyPrefix: string;
  paymentRef: string;
  route: string;
  quotedAmountUsd: number;
  method: 'x402' | 'credits';
}): { recorded: boolean; claimed: boolean } {
  const tx = getStatsDB().transaction(() => {
    const recorded = recordKeySettlement(p);
    const claimed = claimIfPaidEnough(p.keyHash, p.method);
    return { recorded, claimed };
  });
  return tx();
}
