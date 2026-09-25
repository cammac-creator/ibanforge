/**
 * Le créneau de règlement x402 d'une requête, et la référence de son paiement.
 *
 * Sortis de `src/middleware/x402.ts` et de `src/routes/credits-buy.ts` (lot B1
 * du chantier « clé unique », 25.09.2026) pour une seule raison : la route qui
 * VEND un pack doit désormais savoir qu'elle tourne dans un règlement en cours,
 * et y inscrire l'achat qu'elle vient d'ouvrir, pour que l'enrobage x402 le
 * confirme ou l'échoue une fois le règlement connu. `x402.ts` importait déjà
 * `settlementRef` depuis la route : l'import inverse aurait fermé une boucle.
 * Les deux modules lisent donc ici, et aucun ne lit l'autre.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { ConfirmOutcome } from './key-purchases.js';

/** L'achat qu'une route de vente a ouvert pendant ce règlement. */
export interface PendingPurchaseMark {
  /** `key_purchases.id` de la ligne `pending`. */
  id: number;
  /** `x402:<référence>` : la référence d'idempotence de la ligne. */
  paymentRef: string;
  /** `topup` : recharge de la clé présentée ; `mint` : clé neuve, active à la confirmation. */
  kind: 'topup' | 'mint';
}

/**
 * Ce que le facilitateur a répondu au règlement de CETTE requête, tel que
 * l'enrobage (`boundFacilitator`, x402.ts) l'a lu (relecture de sécurité de la
 * PR 259, D1). Trois issues, jamais deux :
 *
 *  - `settled` : `success: true` ;
 *  - `refused` : un REFUS TERMINAL, une réponse `success: false` de statut
 *    inférieur à 500, avec un motif explicite, sans transaction diffusée, et
 *    dont le motif n'est ni `settlement_pending` ni `unexpected_*` ;
 *  - `unknown` : tout le reste (délai, erreur réseau, page d'une passerelle,
 *    5xx, réponse illisible, `settlement_pending`, échec qui porte un hash de
 *    transaction). L'argent a pu partir.
 */
export interface SettleObservation {
  state: 'settled' | 'refused' | 'unknown';
  /** Le motif rendu (`errorReason`), ou la nature de l'erreur. */
  reason: string | null;
  /** Le hash de transaction rendu, réglé ou diffusé ; null s'il n'y en a pas. */
  transaction: string | null;
  /** L'adresse qui paie (réponse du facilitateur, sinon l'autorisation signée). */
  payer: string | null;
  /** Le nonce de l'autorisation signée. Jamais la signature. */
  nonce: string | null;
}

export interface SettlementSlot {
  /**
   * Le règlement dont l'issue est INCONNUE : posé par l'enrobage du
   * facilitateur (`boundFacilitator`, x402.ts) pour un délai dépassé comme pour
   * toute issue `unknown` (D1), et effacé si la relance du SDK finit réglée.
   * Non nul, la réponse devient un 502 qui dit de ne pas payer deux fois.
   */
  unconfirmed: Error | null;
  /** Ce que le facilitateur a répondu au règlement ; null tant qu'il n'a pas été appelé. */
  settle: SettleObservation | null;
  /**
   * Le prix que le paywall a COTÉ pour cette requête, en dollars. null =
   * inconnu, et le journal n'écrit alors RIEN : la référence de paiement est
   * unique, donc une ligne à zéro consommerait la référence à jamais et
   * rendrait silencieusement inopérante toute écriture correcte ultérieure.
   * Une ligne absente se rattrape, une ligne fausse non.
   */
  quotedUsd: number | null;
  /** L'achat ouvert par la route de vente, que l'enrobage confirme ou échoue. */
  purchase: PendingPurchaseMark | null;
  /**
   * Ce que la route de vente veut faire une fois le règlement CONFIRMÉ et
   * l'achat inscrit (le mail de la clé ou de la recharge) : jamais avant, car
   * un mail parti avant un règlement refusé annoncerait une clé morte.
   */
  afterConfirm: ((confirmed: ConfirmOutcome) => void) | null;
}

const store = new AsyncLocalStorage<SettlementSlot>();

export function newSettlementSlot(): SettlementSlot {
  return { unconfirmed: null, settle: null, quotedUsd: null, purchase: null, afterConfirm: null };
}

/** Exécute `fn` dans ce créneau : tout `await` en aval y lit le même objet. */
export function runInSlot<T>(slot: SettlementSlot, fn: () => T): T {
  return store.run(slot, fn);
}

/**
 * Le créneau de la requête en cours, s'il y en a un. `undefined` hors du
 * chemin payant : contournement de développement, mode gratuit, portefeuille
 * absent hors production, route que le paywall ne cote pas. C'est ce qui dit à
 * la route de vente qu'aucun règlement ne suivra sa réponse.
 */
export function currentSettlementSlot(): SettlementSlot | undefined {
  return store.getStore();
}

/**
 * Une poignée stable sur CE règlement, tirée du paiement que l'acheteur a
 * signé et envoyé.
 *
 * Elle doit être recalculable par l'acheteur sans nous : si la réponse qui
 * portait sa clé est perdue, la seule chose qu'il garde est la requête qu'il a
 * faite. La référence est donc le SHA-256 de l'en-tête de paiement lui-même,
 * sans analyse de dialecte (v1 `X-PAYMENT` et v2 `PAYMENT-SIGNATURE` marchent
 * tous deux), rien à convenir au-delà de « hacher ce qu'on a envoyé ».
 *
 * Tronquée à 32 caractères hexadécimaux : 128 bits, assez court pour voyager
 * dans une URL. L'en-tête n'est jamais stocké, seulement ce condensé :
 * l'autorisation signée n'arrive jamais en base.
 */
export function settlementRef(c: {
  req: { header(name: string): string | undefined };
}): string | null {
  const header = c.req.header('payment-signature') ?? c.req.header('x-payment');
  if (!header) return null;
  return createHash('sha256').update(header).digest('hex').slice(0, 32);
}
