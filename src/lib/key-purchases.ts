/**
 * Le registre des achats et la recharge de la même clé (chantier « clé unique »,
 * lot B1, 25.09.2026 ; décision de Claude-Alain du 24.09.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE GARANTIT
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Une ligne par paiement, `payment_ref` unique (`stripe:<session>` ou
 *    `x402:<référence>`). Chaque crédit s'écrit dans la MÊME transaction que sa
 *    ligne : une session Stripe rejouée, ou `async_payment_succeeded` après
 *    `completed` (même session, autre évènement), ne crédite qu'une fois.
 * 2. La référence de recharge (`ifr_` + 128 bits) est tirée au hasard, jamais
 *    dérivée de la clé, rattachée à la LIGNÉE (elle survit à la rotation) et
 *    servie seulement à qui s'est authentifié. Elle ne donne qu'un droit :
 *    payer pour cette clé. Ni lecture, ni solde, ni identité.
 * 3. Jamais un paiement perdu : une référence inconnue, une clé révoquée ou
 *    inactive, deux clés actives sur une lignée, tout cas non nominal frappe
 *    une clé NEUVE comme avant ce lot, et l'appelant alerte. Jamais de
 *    réactivation d'une clé inactive.
 * 4. Sur le rail USDC, rien n'est crédité avant un règlement CONFIRMÉ : la
 *    route ouvre une ligne `pending`, l'enrobage x402 la confirme ou l'échoue
 *    une fois le règlement connu (le SDK exécute la route AVANT de régler).
 *
 * Aucun appel à Stripe ici, ni sur le chemin d'une requête : le lien de
 * paiement existant porte la référence (`?client_reference_id=`), et Stripe la
 * rend dans `checkout.session.completed`.
 */
import { randomBytes } from 'node:crypto';
import type DatabaseType from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { TOPUP_REF_PATTERN } from './payment-links.js';
import {
  activatePendingCreditKeyInTx,
  applyFirstPurchaseInTx,
  clawbackCreditsInTx,
  creditKeyInTx,
  failPendingCreditKeyInTx,
  findKeyByStripeSession,
  generateCreditKey,
  generateStripeKey,
  type AllowancePhoto,
} from './api-keys.js';
import { markLineagePurchase } from './lineage-facts.js';
import { recordCreditsPurchase } from './stats.js';

type Db = DatabaseType.Database;

export type PurchaseRail = 'card' | 'usdc';
export type PurchaseKind = 'pack' | 'subscription';
export type PurchaseOutcome =
  | 'pending'
  | 'credited'
  | 'minted'
  | 'minted_fallback'
  | 'attached'
  | 'failed'
  | 'refunded'
  | 'disputed';

/**
 * Les issues qui font d'une ligne une VENTE d'un pack : l'argent est arrivé et
 * les crédits sont sur une clé. `pending` et `failed` n'en sont pas, un pack
 * remboursé ou disputé non plus. Fragment SQL, à mettre derrière `outcome IN`.
 */
export const SALE_OUTCOMES_SQL = "('credited', 'minted', 'minted_fallback')";

/** Les issues qui disent qu'une lignée a payé au moins une fois. */
const PAID_OUTCOMES_SQL = "('credited', 'minted', 'minted_fallback', 'attached')";

export interface PurchaseRow {
  id: number;
  payment_ref: string;
  rail: PurchaseRail;
  kind: PurchaseKind;
  outcome: PurchaseOutcome;
  lineage_hash: string;
  key_hash: string;
  key_prefix: string;
  bundle: string | null;
  credits: number | null;
  balance_after: number | null;
  amount_minor: number | null;
  currency: string | null;
  quoted_amount_usd: number | null;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  stripe_subscription_id: string | null;
  topup_ref: string | null;
  payer_email: string | null;
  prev_tier: string | null;
  prev_monthly_limit: number | null;
  prev_no_recredit: number | null;
  clawback_credits: number | null;
  issued_by_us: number;
  backfilled: number;
  created_at: string;
  settled_at: string | null;
  ended_at: string | null;
  /** Rail USDC (relecture de la PR 259, D10) : l'adresse qui paie, jamais la signature. */
  payer_address: string | null;
  /** Le nonce de l'autorisation signée. */
  auth_nonce: string | null;
  /** Le hash de transaction rendu par le facilitateur, réglé ou diffusé. */
  tx_hash: string | null;
}

/** Une ligne dont l'argent est arrivé et les crédits sont sur une clé. */
export function isSaleOutcome(outcome: PurchaseOutcome): boolean {
  return outcome === 'credited' || outcome === 'minted' || outcome === 'minted_fallback';
}

// ─── La lignée et la référence de recharge ───────────────────────────────────

/**
 * La lignée d'une clé. `COALESCE` : une clé importée après le démarrage n'a pas
 * encore sa lignée écrite, elle est alors sa propre origine.
 */
export function lineageOf(keyHash: string, db: Db = getStatsDB()): string | null {
  const row = db
    .prepare('SELECT COALESCE(lineage_hash, key_hash) AS lineage FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { lineage: string } | undefined;
  return row?.lineage ?? null;
}

/** La référence de recharge d'une clé, si elle en a déjà une. Lecture seule. */
export function topupRefFor(keyHash: string, db: Db = getStatsDB()): string | null {
  const row = db
    .prepare(
      `SELECT r.ref FROM key_topup_refs r
         JOIN api_keys k ON r.lineage_hash = COALESCE(k.lineage_hash, k.key_hash)
        WHERE k.key_hash = ?`,
    )
    .get(keyHash) as { ref: string } | undefined;
  return row?.ref ?? null;
}

/**
 * La référence de recharge d'une clé, créée à la première demande : une ligne
 * par lignée au plus (`lineage_hash UNIQUE`), jamais une par requête. La
 * lecture passe d'abord, pour qu'une référence existante ne coûte aucun verrou
 * d'écriture.
 *
 * Jamais régénérée, même à la rotation : un lien d'un ancien mail doit continuer
 * de recharger la clé courante de la lignée.
 *
 * 🚨 Appelée sur des chemins de lecture et sur le 402 : une base qui refuse
 * l'écriture rend `null`, et l'appelant retombe sur l'offre d'une clé neuve.
 * Un verrou ne transforme jamais un 402 en 500.
 */
export function ensureTopupRef(keyHash: string): string | null {
  try {
    const existing = topupRefFor(keyHash);
    if (existing) return existing;
    const db = getStatsDB();
    const lineage = lineageOf(keyHash, db);
    if (!lineage) return null;
    const ref = `ifr_${randomBytes(16).toString('hex')}`;
    db.prepare('INSERT OR IGNORE INTO key_topup_refs (ref, lineage_hash) VALUES (?, ?)').run(
      ref,
      lineage,
    );
    return topupRefFor(keyHash, db);
  } catch (err) {
    console.error(
      '[topup] reference unavailable:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export type RefResolution =
  | { ok: true; keyHash: string; keyPrefix: string; lineageHash: string }
  | { ok: false; reason: 'malformed_ref' | 'unknown_ref' | 'no_active_key' | 'ambiguous' };

/**
 * La clé ACTIVE que vise une référence. Une rotation désactive l'ancienne clé
 * dans sa propre transaction : il y a donc au plus une clé active par lignée,
 * et zéro ou deux se replient (clé neuve, alerte), jamais un crédit deviné.
 */
export function resolveTopupRef(ref: string, db: Db = getStatsDB()): RefResolution {
  if (!TOPUP_REF_PATTERN.test(ref)) return { ok: false, reason: 'malformed_ref' };
  const known = db.prepare('SELECT lineage_hash FROM key_topup_refs WHERE ref = ?').get(ref) as
    { lineage_hash: string } | undefined;
  if (!known) return { ok: false, reason: 'unknown_ref' };
  const keys = db
    .prepare(
      `SELECT key_hash, key_prefix FROM api_keys
        WHERE COALESCE(lineage_hash, key_hash) = ? AND active = 1
        LIMIT 2`,
    )
    .all(known.lineage_hash) as Array<{ key_hash: string; key_prefix: string }>;
  if (keys.length === 0) return { ok: false, reason: 'no_active_key' };
  if (keys.length > 1) return { ok: false, reason: 'ambiguous' };
  return {
    ok: true,
    keyHash: keys[0].key_hash,
    keyPrefix: keys[0].key_prefix,
    lineageHash: known.lineage_hash,
  };
}

// ─── Lectures du registre ────────────────────────────────────────────────────

export function findPurchaseByRef(paymentRef: string, db: Db = getStatsDB()): PurchaseRow | null {
  const row = db.prepare('SELECT * FROM key_purchases WHERE payment_ref = ?').get(paymentRef) as
    PurchaseRow | undefined;
  return row ?? null;
}

export function findPurchaseById(id: number, db: Db = getStatsDB()): PurchaseRow | null {
  const row = db.prepare('SELECT * FROM key_purchases WHERE id = ?').get(id) as
    PurchaseRow | undefined;
  return row ?? null;
}

/** Vrai quand la lignée a payé au moins une fois (pack ou abonnement réglé). */
export function lineageHasPurchase(lineageHash: string, db: Db = getStatsDB()): boolean {
  return !!db
    .prepare(
      `SELECT 1 AS one FROM key_purchases
        WHERE lineage_hash = ? AND outcome IN ${PAID_OUTCOMES_SQL} LIMIT 1`,
    )
    .get(lineageHash);
}

/** Même question, posée depuis une clé. */
export function keyHasPurchase(keyHash: string, db: Db = getStatsDB()): boolean {
  const lineage = lineageOf(keyHash, db);
  return lineage !== null && lineageHasPurchase(lineage, db);
}

/** Les achats d'une lignée en attente de règlement, ou tous (administration). */
export function listPurchases(
  filter: { outcome?: PurchaseOutcome; limit?: number } = {},
  db: Db = getStatsDB(),
): PurchaseRow[] {
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 500);
  if (filter.outcome) {
    return db
      .prepare('SELECT * FROM key_purchases WHERE outcome = ? ORDER BY id DESC LIMIT ?')
      .all(filter.outcome, limit) as PurchaseRow[];
  }
  return db
    .prepare('SELECT * FROM key_purchases ORDER BY id DESC LIMIT ?')
    .all(limit) as PurchaseRow[];
}

// ─── Écriture d'une ligne ────────────────────────────────────────────────────

interface NewPurchase {
  paymentRef: string;
  rail: PurchaseRail;
  kind: PurchaseKind;
  outcome: PurchaseOutcome;
  lineageHash: string;
  keyHash: string;
  keyPrefix: string;
  bundle?: string | null;
  credits?: number | null;
  balanceAfter?: number | null;
  amountMinor?: number | null;
  currency?: string | null;
  quotedAmountUsd?: number | null;
  stripeSessionId?: string | null;
  stripePaymentIntent?: string | null;
  stripeSubscriptionId?: string | null;
  topupRef?: string | null;
  payerEmail?: string | null;
  photo?: AllowancePhoto | null;
  settled?: boolean;
}

/** `INSERT OR IGNORE` : rend l'identifiant de la ligne insérée, ou null si la référence existait. */
function insertPurchase(db: Db, p: NewPurchase): number | null {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO key_purchases
         (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix, bundle, credits,
          balance_after, amount_minor, currency, quoted_amount_usd, stripe_session_id,
          stripe_payment_intent, stripe_subscription_id, topup_ref, payer_email, prev_tier,
          prev_monthly_limit, prev_no_recredit, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               CASE WHEN ? = 1 THEN datetime('now') END)`,
    )
    .run(
      p.paymentRef,
      p.rail,
      p.kind,
      p.outcome,
      p.lineageHash,
      p.keyHash,
      p.keyPrefix,
      p.bundle ?? null,
      p.credits ?? null,
      p.balanceAfter ?? null,
      p.amountMinor ?? null,
      p.currency ?? null,
      p.quotedAmountUsd ?? null,
      p.stripeSessionId ?? null,
      p.stripePaymentIntent ?? null,
      p.stripeSubscriptionId ?? null,
      p.topupRef ?? null,
      p.payerEmail ?? null,
      p.photo?.tier ?? null,
      p.photo?.monthlyLimit ?? null,
      p.photo?.noRecredit ?? null,
      p.settled === false ? 0 : 1,
    );
  return res.changes > 0 ? Number(res.lastInsertRowid) : null;
}

/**
 * Crédite une clé existante et écrit sa ligne, dans la transaction de
 * l'appelant. La photo de l'allocation propre n'est prise qu'au PREMIER achat
 * de la lignée (règle A : c'est à elle que la clé revient). Rend null si la clé
 * n'est plus active : l'appelant se replie, rien n'a été écrit.
 */
function creditExistingKeyInTx(
  db: Db,
  target: { keyHash: string; keyPrefix: string; lineageHash: string },
  purchase: Omit<NewPurchase, 'outcome' | 'lineageHash' | 'keyHash' | 'keyPrefix' | 'photo'> & {
    credits: number;
  },
  method: 'stripe' | 'credits',
): { purchaseId: number; balanceAfter: number } | null {
  const first = !lineageHasPurchase(target.lineageHash, db);
  // Le crédit d'abord : s'il ne trouve aucune clé active, rien d'autre ne
  // s'écrit et l'appelant se replie. La photo ne lit ni ne touche les colonnes
  // du solde, elle se prend donc juste après sans rien perdre.
  const balanceAfter = creditKeyInTx(db, target.keyHash, purchase.credits);
  if (balanceAfter === null) return null;
  const photo = first ? applyFirstPurchaseInTx(db, target.keyHash, method) : null;
  const purchaseId = insertPurchase(db, {
    ...purchase,
    outcome: 'credited',
    lineageHash: target.lineageHash,
    keyHash: target.keyHash,
    keyPrefix: target.keyPrefix,
    balanceAfter,
    photo,
  });
  if (purchaseId === null) {
    // La référence existait : l'appelant a vérifié avant, dans la même
    // transaction. Jeter annule le crédit plutôt que de l'écrire deux fois.
    throw new Error(`key purchase ${purchase.paymentRef} already recorded`);
  }
  markLineagePurchase(db, target.lineageHash, target.keyHash);
  return { purchaseId, balanceAfter };
}

// ─── Le rail carte (webhook Stripe) ──────────────────────────────────────────

export interface CardPackPayment {
  sessionId: string;
  bundle: string;
  credits: number;
  amountMinor: number | null;
  currency: string | null;
  paymentIntent: string | null;
  /** L'adresse saisie chez Stripe : contact de service, jamais l'identité de la clé. */
  payerEmail: string | null;
  /** `client_reference_id` de la session, tel quel. */
  clientReferenceId: string | null;
}

export type CardPackOutcome =
  | { kind: 'idempotent'; purchase: PurchaseRow }
  | {
      kind: 'credited';
      purchaseId: number;
      keyHash: string;
      keyPrefix: string;
      creditsAdded: number;
      balanceAfter: number;
    }
  | {
      kind: 'minted';
      purchaseId: number | null;
      keyHash: string | null;
      keyPrefix: string;
      /** La clé brute, seulement sur une frappe NEUVE (null sur un rejeu). */
      rawKey: string | null;
      /** Pourquoi la référence n'a pas servi, quand il y en avait une. */
      fallback: Exclude<RefResolution, { ok: true }>['reason'] | 'key_inactive' | null;
    };

/**
 * Un pack payé par carte, à appeler DANS la transaction du webhook (qui y
 * écrit aussi `processed_webhooks`). Trois issues :
 *
 *  - `idempotent` : cette session a déjà sa ligne. Rien d'autre ne s'écrit ;
 *  - `credited` : la référence mène à exactement une clé active de sa lignée,
 *    créditée sur place ;
 *  - `minted` : pas de référence (page publique, ancien lien, paramètre retiré),
 *    ou une référence qui ne mène pas à une clé active : une clé NEUVE, comme
 *    avant ce lot. `fallback` dit pourquoi, pour l'alerte de l'appelant.
 */
export function applyCardPackPaymentInTx(db: Db, p: CardPackPayment): CardPackOutcome {
  const paymentRef = `stripe:${p.sessionId}`;
  const existing = findPurchaseByRef(paymentRef, db);
  if (existing) return { kind: 'idempotent', purchase: existing };

  let fallback: Exclude<CardPackOutcome, { kind: 'idempotent' | 'credited' }>['fallback'] = null;
  // Une référence qui n'a pas la forme d'une référence de recharge est traitée
  // comme ABSENTE (spec §4.2 ; relecture de la PR 259, D8) : n'importe quel
  // payeur peut retoucher l'URL d'un lien de paiement, et ce n'est pas un
  // paiement perdu. Un journal, jamais une alerte ; la valeur n'est ni gardée
  // ni journalisée.
  const raw = p.clientReferenceId?.trim() || null;
  const ref = raw && TOPUP_REF_PATTERN.test(raw) ? raw : null;
  if (raw && !ref) {
    console.warn(
      `[key-purchases] a card pack carried a client_reference_id that is not a recharge reference (${raw.length} characters): treated as absent, a new key is minted.`,
    );
  }
  if (ref) {
    const target = resolveTopupRef(ref, db);
    if (target.ok) {
      const credited = creditExistingKeyInTx(
        db,
        target,
        {
          paymentRef,
          rail: 'card',
          kind: 'pack',
          bundle: p.bundle,
          credits: p.credits,
          amountMinor: p.amountMinor,
          currency: p.currency,
          stripeSessionId: p.sessionId,
          stripePaymentIntent: p.paymentIntent,
          topupRef: ref,
          payerEmail: p.payerEmail,
        },
        'stripe',
      );
      if (credited) {
        return {
          kind: 'credited',
          purchaseId: credited.purchaseId,
          keyHash: target.keyHash,
          keyPrefix: target.keyPrefix,
          creditsAdded: p.credits,
          balanceAfter: credited.balanceAfter,
        };
      }
      fallback = 'key_inactive';
    } else {
      fallback = target.reason;
    }
  }

  // Une clé neuve, par le chemin d'avant ce lot. `generateStripeKey` est
  // idempotente sur la session : un rejeu ne frappe rien de plus.
  const mint = generateStripeKey(p.payerEmail, p.credits, p.sessionId);
  const minted = findKeyByStripeSession(p.sessionId, db);
  // Ce que Stripe a réellement encaissé, sur la clé que cette session a frappée
  // (premier écrit gagnant, comme avant ce lot).
  if (p.amountMinor != null && p.currency != null) {
    db.prepare(
      `UPDATE api_keys SET amount_paid_minor = ?, amount_paid_currency = ?
        WHERE stripe_session_id = ? AND amount_paid_minor IS NULL`,
    ).run(p.amountMinor, p.currency, p.sessionId);
  }
  let purchaseId: number | null = null;
  if (minted) {
    purchaseId = insertPurchase(db, {
      paymentRef,
      rail: 'card',
      kind: 'pack',
      outcome: fallback ? 'minted_fallback' : 'minted',
      lineageHash: minted.lineage_hash,
      keyHash: minted.key_hash,
      keyPrefix: minted.key_prefix,
      bundle: p.bundle,
      credits: p.credits,
      balanceAfter: p.credits,
      amountMinor: p.amountMinor,
      currency: p.currency,
      stripeSessionId: p.sessionId,
      stripePaymentIntent: p.paymentIntent,
      topupRef: ref,
      payerEmail: p.payerEmail,
      // Née d'un achat : aucune allocation propre à rendre.
      photo: { tier: 'paid', monthlyLimit: 0, noRecredit: 0 },
    });
  }
  return {
    kind: 'minted',
    purchaseId,
    keyHash: minted?.key_hash ?? null,
    keyPrefix: mint.key_prefix,
    rawKey: mint.api_key,
    fallback,
  };
}

/**
 * La ligne d'un abonnement frappé par le webhook (Pro, éditeur). Le lot B1 ne
 * change rien à l'abonnement lui-même (le rattachement à une clé existante est
 * le lot B2) : il l'inscrit au registre, pour que les lecteurs d'argent y
 * distinguent un premier paiement d'abonnement d'une recharge de pack.
 */
export function recordSubscriptionMintInTx(
  db: Db,
  p: {
    sessionId: string;
    plan: string;
    subscriptionId: string | null;
    amountMinor: number | null;
    currency: string | null;
    paymentIntent: string | null;
    payerEmail: string | null;
  },
): number | null {
  const key = findKeyByStripeSession(p.sessionId, db);
  if (!key) return null;
  return insertPurchase(db, {
    paymentRef: `stripe:${p.sessionId}`,
    rail: 'card',
    kind: 'subscription',
    outcome: 'minted',
    lineageHash: key.lineage_hash,
    keyHash: key.key_hash,
    keyPrefix: key.key_prefix,
    bundle: p.plan,
    amountMinor: p.amountMinor,
    currency: p.currency,
    stripeSessionId: p.sessionId,
    stripePaymentIntent: p.paymentIntent,
    stripeSubscriptionId: p.subscriptionId,
    payerEmail: p.payerEmail,
    photo: { tier: 'paid', monthlyLimit: 0, noRecredit: 0 },
  });
}

// ─── Le rail USDC, en deux temps ─────────────────────────────────────────────

/**
 * Ce qu'il faut pour rapprocher un achat USDC à la main (relecture de sécurité
 * de la PR 259, D10) : l'adresse qui paie, le nonce de l'autorisation et le
 * hash de transaction que le facilitateur a rendu. Jamais la signature :
 * l'enrobage x402 ne lit que ces trois champs, chacun à sa forme. Un champ déjà
 * écrit n'est pas effacé ; le hash le plus récent l'emporte (une relance du
 * SDK rend la même transaction).
 */
export function notePurchaseSettlement(
  id: number,
  facts: { payer: string | null; nonce: string | null; transaction: string | null },
): void {
  getStatsDB()
    .prepare(
      `UPDATE key_purchases
          SET payer_address = COALESCE(payer_address, ?),
              auth_nonce    = COALESCE(auth_nonce, ?),
              tx_hash       = COALESCE(?, tx_hash)
        WHERE id = ? AND rail = 'usdc'`,
    )
    .run(facts.payer, facts.nonce, facts.transaction, id);
}

export interface UsdcPackRequest {
  /** `x402:<référence>` */
  paymentRef: string;
  bundle: string;
  credits: number;
  quotedUsd: number;
  /** Le champ `email` du corps : contact de service seulement (ZG8). */
  payerEmail: string | null;
}

/**
 * Premier temps d'une recharge USDC de la clé PRÉSENTÉE : la ligne `pending`,
 * rien d'autre. Rend l'identifiant de la ligne ouverte, ou la ligne existante
 * quand ce paiement a déjà été vu (requête rejouée).
 */
export function openUsdcTopup(
  target: { keyHash: string; keyPrefix: string },
  p: UsdcPackRequest,
): { opened: number } | { existing: PurchaseRow } {
  const db = getStatsDB();
  return db
    .transaction((): { opened: number } | { existing: PurchaseRow } => {
      const existing = findPurchaseByRef(p.paymentRef, db);
      if (existing) return { existing };
      const lineage = lineageOf(target.keyHash, db) ?? target.keyHash;
      const id = insertPurchase(db, {
        paymentRef: p.paymentRef,
        rail: 'usdc',
        kind: 'pack',
        outcome: 'pending',
        lineageHash: lineage,
        keyHash: target.keyHash,
        keyPrefix: target.keyPrefix,
        bundle: p.bundle,
        credits: p.credits,
        quotedAmountUsd: p.quotedUsd,
        payerEmail: p.payerEmail,
        settled: false,
      });
      return { opened: id as number };
    })
    .immediate();
}

/**
 * Premier temps d'un pack USDC SANS clé présentée : la clé neuve naît
 * INACTIVE, sa clé brute gardée pour une récupération unique, et la ligne
 * `pending`. La confirmation l'active ; un refus la laisse morte.
 */
export function openUsdcMint(
  email: string | null,
  p: UsdcPackRequest & { ref: string },
):
  | { opened: number; mint: { api_key: string; key_prefix: string; key_hash: string } }
  | { existing: PurchaseRow } {
  const db = getStatsDB();
  return db
    .transaction(() => {
      const existing = findPurchaseByRef(p.paymentRef, db);
      if (existing) return { existing };
      const mint = generateCreditKey(email, p.credits, p.ref, 'x402-pack', { pending: true });
      const id = insertPurchase(db, {
        paymentRef: p.paymentRef,
        rail: 'usdc',
        kind: 'pack',
        outcome: 'pending',
        lineageHash: mint.key_hash,
        keyHash: mint.key_hash,
        keyPrefix: mint.key_prefix,
        bundle: p.bundle,
        credits: p.credits,
        balanceAfter: p.credits,
        quotedAmountUsd: p.quotedUsd,
        payerEmail: p.payerEmail,
        photo: { tier: 'paid', monthlyLimit: 0, noRecredit: 0 },
        settled: false,
      });
      return { opened: id as number, mint };
    })
    .immediate();
}

export type ConfirmOutcome =
  | { status: 'credited'; keyPrefix: string; balanceAfter: number; purchase: PurchaseRow }
  | { status: 'minted'; keyPrefix: string; purchase: PurchaseRow }
  | {
      status: 'minted_fallback';
      keyPrefix: string;
      purchase: PurchaseRow;
      /** La clé brute d'une frappe de repli, récupérable une fois par la référence. */
      rawKey: string;
    }
  | { status: 'unchanged'; purchase: PurchaseRow }
  | { status: 'not_found' };

/** La clé que CE paiement a frappée, si c'est une frappe en attente. */
function mintedByThisPayment(db: Db, row: PurchaseRow): boolean {
  const ref = row.payment_ref.startsWith('x402:') ? row.payment_ref.slice(5) : null;
  if (!ref) return false;
  return !!db
    .prepare('SELECT 1 AS one FROM api_keys WHERE key_hash = ? AND x402_payment_ref = ?')
    .get(row.key_hash, ref);
}

/**
 * Second temps : le règlement est CONFIRMÉ. Une transaction, et la condition
 * `outcome = 'pending'` en tête : un second appel (rejeu, rapprochement à la
 * main après coup) ne crédite rien de plus.
 *
 *  - frappe : la clé neuve s'active ;
 *  - recharge : la clé ACTIVE de la lignée est créditée (celle d'aujourd'hui si
 *    le porteur a tourné sa clé entre-temps). Plus aucune clé active : une clé
 *    neuve de repli, récupérable une fois par la référence du paiement, et
 *    l'appelant alerte. Jamais de réactivation.
 *
 * Le revenu du jour (`daily_stats`) ne s'inscrit qu'ici : un pack dont le
 * règlement a été refusé n'est pas une vente.
 */
export function confirmPurchase(id: number): ConfirmOutcome {
  const db = getStatsDB();
  return db
    .transaction((): ConfirmOutcome => {
      const row = findPurchaseById(id, db);
      if (!row) return { status: 'not_found' };
      if (row.outcome !== 'pending') return { status: 'unchanged', purchase: row };
      const credits = row.credits ?? 0;

      if (mintedByThisPayment(db, row)) {
        activatePendingCreditKeyInTx(db, row.key_hash);
        db.prepare(
          `UPDATE key_purchases SET outcome = 'minted', settled_at = datetime('now')
            WHERE id = ? AND outcome = 'pending'`,
        ).run(id);
        bookUsdcSale(row);
        return {
          status: 'minted',
          keyPrefix: row.key_prefix,
          purchase: findPurchaseById(id, db) as PurchaseRow,
        };
      }

      const keys = db
        .prepare(
          `SELECT key_hash, key_prefix FROM api_keys
            WHERE COALESCE(lineage_hash, key_hash) = ? AND active = 1 LIMIT 2`,
        )
        .all(row.lineage_hash) as Array<{ key_hash: string; key_prefix: string }>;
      if (keys.length === 1) {
        const first = !lineageHasPurchase(row.lineage_hash, db);
        const balanceAfter = creditKeyInTx(db, keys[0].key_hash, credits);
        if (balanceAfter !== null) {
          const photo = first ? applyFirstPurchaseInTx(db, keys[0].key_hash, 'credits') : null;
          db.prepare(
            `UPDATE key_purchases
                SET outcome = 'credited', settled_at = datetime('now'), balance_after = ?,
                    prev_tier = COALESCE(prev_tier, ?),
                    prev_monthly_limit = COALESCE(prev_monthly_limit, ?),
                    prev_no_recredit = COALESCE(prev_no_recredit, ?)
              WHERE id = ? AND outcome = 'pending'`,
          ).run(
            balanceAfter,
            photo?.tier ?? null,
            photo?.monthlyLimit ?? null,
            photo?.noRecredit ?? null,
            id,
          );
          markLineagePurchase(db, row.lineage_hash, keys[0].key_hash);
          bookUsdcSale(row);
          return {
            status: 'credited',
            keyPrefix: keys[0].key_prefix,
            balanceAfter,
            purchase: findPurchaseById(id, db) as PurchaseRow,
          };
        }
      }

      // Repli : la clé visée n'est plus active (révoquée entre la requête et la
      // confirmation, ou lignée ambiguë). Une clé neuve, récupérable une fois
      // par la référence de ce paiement, comme un pack acheté sans clé.
      const ref = row.payment_ref.slice(5);
      const mint = generateCreditKey(row.payer_email, credits, ref, 'x402-pack');
      db.prepare(
        `UPDATE key_purchases
            SET outcome = 'minted_fallback', settled_at = datetime('now'), key_hash = ?,
                key_prefix = ?, lineage_hash = ?, balance_after = ?,
                prev_tier = 'paid', prev_monthly_limit = 0, prev_no_recredit = 0
          WHERE id = ? AND outcome = 'pending'`,
      ).run(mint.key_hash, mint.key_prefix, mint.key_hash, credits, id);
      bookUsdcSale(row);
      return {
        status: 'minted_fallback',
        keyPrefix: mint.key_prefix,
        rawKey: mint.api_key,
        purchase: findPurchaseById(id, db) as PurchaseRow,
      };
    })
    .immediate();
}

/**
 * Le revenu du jour d'un pack USDC réglé, au prix que le paywall a coté. Même
 * écriture qu'avant ce lot, déplacée de la route à la confirmation.
 */
function bookUsdcSale(row: PurchaseRow): void {
  if (row.rail !== 'usdc' || row.quoted_amount_usd == null) return;
  recordCreditsPurchase(row.bundle ?? 'unknown', row.quoted_amount_usd, true);
}

/**
 * Le règlement a été REFUSÉ : la ligne passe `failed`, rien n'est crédité, et
 * une clé frappée en attente reste morte, sans sa clé brute.
 */
export function failPurchase(id: number): { status: 'failed' | 'unchanged' | 'not_found' } {
  const db = getStatsDB();
  return db
    .transaction((): { status: 'failed' | 'unchanged' | 'not_found' } => {
      const row = findPurchaseById(id, db);
      if (!row) return { status: 'not_found' };
      if (row.outcome !== 'pending') return { status: 'unchanged' };
      if (mintedByThisPayment(db, row)) failPendingCreditKeyInTx(db, row.key_hash);
      db.prepare(
        `UPDATE key_purchases SET outcome = 'failed', ended_at = datetime('now')
          WHERE id = ? AND outcome = 'pending'`,
      ).run(id);
      return { status: 'failed' };
    })
    .immediate();
}

// ─── La reprise sur remboursement ou litige ──────────────────────────────────

export type ReversalReason = 'refunded' | 'disputed';

export type ClawbackOutcome =
  | {
      status: 'clawed_back';
      removed: number;
      keyPrefix: string | null;
      purchase: PurchaseRow;
    }
  | { status: 'unchanged'; purchase: PurchaseRow }
  | { status: 'not_found' }
  | { status: 'not_a_pack'; purchase: PurchaseRow }
  | { status: 'not_settled'; purchase: PurchaseRow };

/**
 * Reprend les crédits d'un pack remboursé ou disputé (spec §9), dans la
 * transaction de l'appelant. Deux appelants, un seul code :
 *
 *  - la route d'administration (`POST /v1/admin/purchases/:id/clawback`), par
 *    `clawbackPurchase` ci-dessous ;
 *  - le webhook Stripe, sur `charge.refunded` (remboursement TOTAL) et
 *    `charge.dispute.created` (décision de Claude-Alain du 25.09.2026 : retrait
 *    automatique après la mise en ligne de la recharge), par
 *    `reverseCardPurchaseInTx`, dans la même transaction que
 *    `processed_webhooks`.
 *
 * Bornée aux crédits DE CET ACHAT et au solde présent : jamais sous zéro,
 * jamais `active = 0`. Une carte volée utilisée sur la référence d'une
 * victime, puis rétrofacturée, ne peut donc lui retirer que ce pack-là.
 * Idempotente : l'issue de la ligne (`refunded`, `disputed`) est la barrière,
 * un second appel sur la même ligne ne reprend rien de plus, quelle que soit
 * sa raison. Un remboursement PARTIEL n'est pas une reprise : il se négocie
 * et se consigne à la main, aucun des deux appelants ne le fait.
 */
export function clawbackPurchaseInTx(db: Db, id: number, reason: ReversalReason): ClawbackOutcome {
  const row = findPurchaseById(id, db);
  if (!row) return { status: 'not_found' };
  if (row.outcome === 'refunded' || row.outcome === 'disputed') {
    return { status: 'unchanged', purchase: row };
  }
  if (row.kind !== 'pack') return { status: 'not_a_pack', purchase: row };
  if (!isSaleOutcome(row.outcome)) return { status: 'not_settled', purchase: row };
  const active = db
    .prepare(
      `SELECT key_hash, key_prefix FROM api_keys
        WHERE COALESCE(lineage_hash, key_hash) = ? AND active = 1 LIMIT 2`,
    )
    .all(row.lineage_hash) as Array<{ key_hash: string; key_prefix: string }>;
  const target = active.length === 1 ? active[0] : null;
  const removed = target ? clawbackCreditsInTx(db, target.key_hash, row.credits ?? 0) : 0;
  db.prepare(
    `UPDATE key_purchases SET outcome = ?, clawback_credits = ?, ended_at = datetime('now')
      WHERE id = ?`,
  ).run(reason, removed, id);
  return {
    status: 'clawed_back',
    removed,
    keyPrefix: target?.key_prefix ?? null,
    purchase: findPurchaseById(id, db) as PurchaseRow,
  };
}

/** La reprise, dans sa propre transaction (route d'administration). */
export function clawbackPurchase(id: number, reason: ReversalReason): ClawbackOutcome {
  const db = getStatsDB();
  return db.transaction((): ClawbackOutcome => clawbackPurchaseInTx(db, id, reason)).immediate();
}

/**
 * Les achats qu'une intention de paiement Stripe a réglés. Au plus deux lus :
 * un seul est attendu (une session de Checkout, une intention), deux disent
 * une anomalie que le webhook ne tranche pas.
 *
 * 🚨 Seuls les achats écrits par le webhook depuis le lot B1 portent leur
 * intention : les lignes rattrapées depuis `api_keys` (packs d'avant le lot)
 * n'en ont pas, et ne sont donc jamais retrouvées ici. Leur reprise passe par
 * la route d'administration.
 */
export function findPurchasesByPaymentIntent(
  paymentIntent: string,
  db: Db = getStatsDB(),
): PurchaseRow[] {
  return db
    .prepare('SELECT * FROM key_purchases WHERE stripe_payment_intent = ? ORDER BY id LIMIT 2')
    .all(paymentIntent) as PurchaseRow[];
}

export type CardReversal =
  | { kind: 'no_payment_intent' }
  | { kind: 'unknown' }
  | { kind: 'ambiguous'; purchases: PurchaseRow[] }
  | { kind: 'partial_refund'; purchase: PurchaseRow }
  | { kind: 'reversed'; outcome: Exclude<ClawbackOutcome, { status: 'not_found' }> };

/**
 * Un remboursement ou un litige Stripe, à appeler DANS la transaction du
 * webhook (qui y écrit aussi `processed_webhooks`). Rien n'y alerte ni n'y
 * journalise : l'appelant le fait hors de la transaction, d'après l'issue.
 *
 *  - pas d'intention de paiement, ou aucune ligne qui la porte : `no_payment_intent`
 *    ou `unknown`, rien d'écrit. Le compte Stripe porte aussi les paiements
 *    d'un autre projet et les audits de fichier : ce n'est pas une anomalie ;
 *  - deux lignes : `ambiguous`, rien d'écrit, jamais une reprise devinée ;
 *  - remboursement partiel : `partial_refund`, rien d'écrit (spec §9) ;
 *  - sinon la reprise commune (`clawbackPurchaseInTx`).
 */
export function reverseCardPurchaseInTx(
  db: Db,
  p: { paymentIntent: string | null; reason: ReversalReason; partial: boolean },
): CardReversal {
  if (!p.paymentIntent) return { kind: 'no_payment_intent' };
  const purchases = findPurchasesByPaymentIntent(p.paymentIntent, db);
  if (purchases.length === 0) return { kind: 'unknown' };
  if (purchases.length > 1) return { kind: 'ambiguous', purchases };
  const purchase = purchases[0];
  if (p.partial) return { kind: 'partial_refund', purchase };
  const outcome = clawbackPurchaseInTx(db, purchase.id, p.reason);
  // La ligne vient d'être lue dans cette transaction : elle existe.
  if (outcome.status === 'not_found') return { kind: 'unknown' };
  return { kind: 'reversed', outcome };
}
