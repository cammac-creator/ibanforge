/**
 * Les paiements d'abonnement : le premier, porté par la clé, et les
 * renouvellements, que rien ne portait.
 *
 * POURQUOI
 *
 * Un abonnement (Pro, Éditeur/OEM) paie une première fois au Checkout : le
 * webhook frappe alors une clé à quota mensuel et écrit le montant sur cette
 * clé (`amount_paid_minor`, voir recordAmountPaid dans stripe-webhook.ts). Les
 * mois suivants, Stripe prélève à nouveau et n'annonce plus que des factures :
 * aucune clé n'est frappée, aucun montant n'était écrit nulle part. Les lectures
 * de revenus, elles, ne regardaient que les clés à crédits. Un abonné restait
 * donc invisible dans l'argent encaissé, même pour son premier mois.
 *
 * Ce module fait deux choses :
 *
 *  1. `recordSubscriptionInvoice` range un renouvellement (`invoice.paid`) dans
 *     la table `subscription_payments` ;
 *  2. `subscriptionsSold` additionne premiers paiements (sur les clés) et
 *     renouvellements (dans la table), pour les lectures qui n'interrogent pas
 *     Stripe.
 *
 * 🚨 LA PREMIÈRE FACTURE N'ENTRE PAS DANS LA TABLE. Elle porte
 * `billing_reason = 'subscription_create'` et son montant est déjà sur la clé
 * frappée par `checkout.session.completed` : l'enregistrer ici la compterait
 * deux fois. Seules les factures `subscription_cycle` sont des
 * renouvellements. Une autre facture d'abonnement (changement de formule au
 * prorata, seuil de consommation) est reçue et ignorée en le disant : la
 * lecture directe de Stripe (stripe-revenue.ts) la compte, ce registre ne
 * prétend pas la connaître.
 *
 * 🚨 LA FORME DE L'ÉVÈNEMENT SUIT LA VERSION D'API DU POINT D'ÉCOUTE, pas celle
 * du SDK. Depuis la version 2025-03-31.basil, l'abonnement d'une facture se lit
 * dans `parent.subscription_details.subscription` ; avant, dans
 * `invoice.subscription`. Les deux sont lus, le plus récent d'abord.
 */
import type Stripe from 'stripe';
import { getStatsDB } from './db.js';

type Db = ReturnType<typeof getStatsDB>;

/**
 * LA règle qui reconnaît une clé d'abonnement, écrite une seule fois pour tout
 * le dépôt : src/lib/activation.ts s'en sert pour le drapeau `subscriber` (le
 * CRM et l'entonnoir), et readSubscriptionRows ci-dessous pour l'argent. Un
 * identifiant d'abonnement Stripe, ou à défaut la forme que toute clé
 * d'abonnement a et qu'aucune clé à crédits ne peut avoir : payée par Checkout,
 * sans crédits. Deux règles auraient pu désigner deux populations d'abonnés.
 *
 * Fragment SQL sur `api_keys`, à mettre entre parenthèses dans un WHERE.
 */
export const SUBSCRIPTION_KEY_SQL =
  'stripe_subscription_id IS NOT NULL OR (stripe_session_id IS NOT NULL AND credits_total IS NULL)';

/**
 * « Abonné AUJOURD'HUI » (chantier « clé unique », lot B2, 25.09.2026). Depuis
 * ce lot, une résiliation ne désactive plus la clé : elle pose
 * `subscription_ended_at` et garde l'identifiant (qui retrouve la clé d'un
 * renouvellement et la garde hors du rayon du radar). SUBSCRIPTION_KEY_SQL dit
 * donc « abonné un jour », et cette règle-ci « abonnement vivant » : la même
 * population, moins les abonnements terminés. Le drapeau `subscriber`, la
 * formule d'une clé du compte, l'avertissement de `/revoke` et le compte des
 * abonnements actifs la lisent ; l'argent lit l'autre, un paiement passé ne
 * disparaît pas avec l'abonnement.
 *
 * Fragment SQL sur `api_keys`, à mettre entre parenthèses dans un WHERE.
 */
export const ACTIVE_SUBSCRIPTION_SQL = `(${SUBSCRIPTION_KEY_SQL}) AND subscription_ended_at IS NULL`;

/** L'identifiant d'un objet Stripe, qu'il arrive en chaîne ou développé. */
export function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/** L'abonnement d'une facture, dans la forme actuelle de l'API ou l'ancienne. */
export function invoiceSubscriptionId(invoice: unknown): string | null {
  if (!invoice || typeof invoice !== 'object') return null;
  const inv = invoice as {
    parent?: { subscription_details?: { subscription?: unknown } | null } | null;
    subscription?: unknown;
  };
  return stripeId(inv.parent?.subscription_details?.subscription) ?? stripeId(inv.subscription);
}

/** Horodatage Stripe (secondes) au format que SQLite écrit avec datetime('now'). */
export function sqliteUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

export type IgnoredInvoice =
  /** Une facture sans abonnement : un achat ponctuel facturé, pas un abonnement. */
  | 'not_a_subscription_invoice'
  /** La première facture : déjà portée par la clé frappée au Checkout. */
  | 'first_invoice_on_checkout'
  /** Une facture d'abonnement qui n'est pas un renouvellement (prorata, seuil). */
  | 'not_a_renewal'
  /** La même facture, déjà enregistrée sous un autre évènement. */
  | 'invoice_already_recorded'
  | 'invoice_without_id';

export type InvoiceOutcome =
  | {
      recorded: true;
      subscription: string;
      billing_reason: string;
      amount_paid_minor: number | null;
      amount_paid_currency: string | null;
      key_resolved: boolean;
    }
  | {
      recorded: false;
      ignored: IgnoredInvoice;
      subscription: string | null;
      billing_reason: string | null;
    };

export const RENEWAL_REASON = 'subscription_cycle';
export const FIRST_INVOICE_REASON = 'subscription_create';

/**
 * Range un renouvellement payé. À appeler depuis la transaction du webhook qui
 * inscrit aussi l'évènement dans processed_webhooks : les deux écritures
 * réussissent ensemble ou pas du tout.
 *
 * La clé est retrouvée par son abonnement, la clé active d'abord puis la plus
 * récente : une rotation recopie `stripe_subscription_id` sur la nouvelle
 * ligne et désactive l'ancienne. Une clé introuvable laisse `key_hash` à NULL ;
 * le paiement, lui, est réel et s'enregistre quand même.
 */
export function recordSubscriptionInvoice(
  eventId: string,
  invoice: Stripe.Invoice,
  eventCreated: number | null,
  db: Db = getStatsDB(),
): InvoiceOutcome {
  const subscription = invoiceSubscriptionId(invoice);
  const billingReason = typeof invoice.billing_reason === 'string' ? invoice.billing_reason : null;
  if (!subscription) {
    return {
      recorded: false,
      ignored: 'not_a_subscription_invoice',
      subscription: null,
      billing_reason: billingReason,
    };
  }
  if (billingReason === FIRST_INVOICE_REASON) {
    return {
      recorded: false,
      ignored: 'first_invoice_on_checkout',
      subscription,
      billing_reason: billingReason,
    };
  }
  if (billingReason !== RENEWAL_REASON) {
    return {
      recorded: false,
      ignored: 'not_a_renewal',
      subscription,
      billing_reason: billingReason,
    };
  }
  const invoiceId = typeof invoice.id === 'string' && invoice.id ? invoice.id : null;
  if (!invoiceId) {
    return {
      recorded: false,
      ignored: 'invoice_without_id',
      subscription,
      billing_reason: billingReason,
    };
  }

  // Ce que Stripe dit avoir encaissé, en unités mineures, tel quel. Absent :
  // NULL, jamais 0 (même règle que recordAmountPaid).
  const rawAmount: unknown = invoice.amount_paid;
  const amount =
    typeof rawAmount === 'number' && Number.isSafeInteger(rawAmount) && rawAmount >= 0
      ? rawAmount
      : null;
  const currency =
    typeof invoice.currency === 'string' && invoice.currency.trim()
      ? invoice.currency.trim().toLowerCase()
      : null;
  const paidAtUnix = invoice.status_transitions?.paid_at ?? eventCreated ?? null;

  const key = db
    .prepare(
      `SELECT key_hash FROM api_keys WHERE stripe_subscription_id = ?
        ORDER BY active DESC, id DESC LIMIT 1`,
    )
    .get(subscription) as { key_hash: string } | undefined;

  const info = db
    .prepare(
      `INSERT OR IGNORE INTO subscription_payments
         (stripe_event_id, invoice_id, subscription_id, key_hash,
          amount_paid_minor, amount_paid_currency, billing_reason, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    )
    .run(
      eventId,
      invoiceId,
      subscription,
      key?.key_hash ?? null,
      amount,
      currency,
      billingReason,
      typeof paidAtUnix === 'number' ? sqliteUtc(paidAtUnix) : null,
    );
  if (info.changes === 0) {
    return {
      recorded: false,
      ignored: 'invoice_already_recorded',
      subscription,
      billing_reason: billingReason,
    };
  }
  return {
    recorded: true,
    subscription,
    billing_reason: billingReason,
    amount_paid_minor: amount,
    amount_paid_currency: currency,
    key_resolved: !!key,
  };
}

// ---------------------------------------------------------------------------
// Ce qui a été vendu en abonnements, sans interroger Stripe
// ---------------------------------------------------------------------------

/** Une clé d'abonnement : frappée au Checkout, ou recopiée par une rotation. */
export interface SubscriptionKeyRow {
  email: string;
  /**
   * Une clé à crédits n'apporte jamais de premier paiement d'abonnement : son
   * montant est celui d'un pack, déjà compté par la lecture des packs.
   */
  credits_total?: number | null;
  /**
   * Ce que le registre des achats dit de la session de la clé (lot B1) :
   * `pack` ou `subscription`, NULL quand il n'en a pas de ligne. Depuis que la
   * même clé peut être rechargée, une clé Pro porte des crédits ET la session
   * de son abonnement : c'est la session, pas la présence de crédits, qui dit
   * à qui appartient ce montant.
   */
  session_kind?: string | null;
  stripe_session_id: string | null;
  stripe_subscription_id: string | null;
  amount_paid_minor: number | null;
  amount_paid_currency: string | null;
  issued_by_us: number | null;
  active: number | null;
  created_at: string | null;
  /**
   * La fin de l'abonnement sur cette clé (lot B2) ; NULL tant qu'il vit. Une clé
   * active dont l'abonnement est terminé ne compte plus comme abonnement actif.
   */
  subscription_ended_at?: string | null;
}

/**
 * Le premier paiement d'un abonnement posé sur une clé EXISTANTE (lot B2) : la
 * clé ne porte pas la session de cet abonnement (elle garde « l'achat qui l'a
 * frappée »), donc ce paiement ne vit qu'au registre des achats, en ligne
 * `attached`. Lu là, et seulement là : jamais compté deux fois.
 */
export interface AttachedSubscriptionRow {
  payment_ref: string;
  stripe_subscription_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  created_at: string | null;
  /** L'adresse de la clé servie à l'achat, pour la règle « compte interne ». */
  email: string | null;
  issued_by_us: number | null;
}

/** Une ligne de `subscription_payments`, avec l'adresse de la clé de son abonnement. */
export interface SubscriptionPaymentRow {
  subscription_id: string | null;
  amount_paid_minor: number | null;
  amount_paid_currency: string | null;
  billing_reason: string | null;
  paid_at: string | null;
  /** NULL quand aucune clé ne porte cet abonnement. */
  email: string | null;
}

export interface SubscriptionsSold {
  /** Checkouts distincts ayant frappé une clé d'abonnement : un premier paiement chacun. */
  first_payments: number;
  first_payments_usd_minor: number;
  /** Premiers paiements dont le montant n'a jamais été écrit : hors total, jamais déduits d'un tarif. */
  first_payments_amount_missing: number;
  /** Factures `subscription_cycle` enregistrées. */
  renewals: number;
  renewals_usd_minor: number;
  renewals_amount_missing: number;
  /** Paiements connus dans une autre devise : jamais convertis, hors total. */
  other_currency_payments: number;
  /** Premiers paiements et renouvellements en USD, en unités mineures. */
  usd_minor: number;
  /** Le même total en dollars, pour les lectures qui parlent en `*_usd`. */
  usd: number;
  /** Abonnements distincts vus (clés ou renouvellements). */
  subscriptions: number;
  /** Abonnements dont une clé est active. */
  active_subscriptions: number;
  /** Abonnements écartés parce qu'internes ou offerts. */
  excluded_subscriptions: number;
  /** Au format SQLite UTC, comme les autres dates de ces lectures. */
  last_payment_at: string | null;
}

function usableAmount(minor: number | null): minor is number {
  return typeof minor === 'number' && Number.isSafeInteger(minor) && minor >= 0;
}

function currencyOf(raw: string | null): string | null {
  const c = raw?.trim().toLowerCase() ?? '';
  return /^[a-z]{3}$/.test(c) ? c : null;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

/**
 * Additionne les paiements d'abonnement.
 *
 * `isExcluded` est la règle « compte interne » du lecteur appelant : la même
 * que celle qu'il applique déjà aux packs, pour que ses deux totaux parlent de
 * la même population. Un abonnement dont UNE clé est interne ou offerte est
 * écarté entier, premier paiement et renouvellements compris.
 *
 * Premiers paiements regroupés par session Checkout : une rotation ne recopie
 * ni la session ni le montant, mais une copie éventuelle ne doit pas compter
 * deux fois un même paiement (même règle que pack-sales.ts).
 */
export function subscriptionsSold(
  input: {
    keys: SubscriptionKeyRow[];
    payments: SubscriptionPaymentRow[];
    /** Les premiers paiements des abonnements posés sur une clé existante (lot B2). */
    attached?: AttachedSubscriptionRow[];
  },
  isExcluded: (email: string) => boolean,
): SubscriptionsSold {
  const out: SubscriptionsSold = {
    first_payments: 0,
    first_payments_usd_minor: 0,
    first_payments_amount_missing: 0,
    renewals: 0,
    renewals_usd_minor: 0,
    renewals_amount_missing: 0,
    other_currency_payments: 0,
    usd_minor: 0,
    usd: 0,
    subscriptions: 0,
    active_subscriptions: 0,
    excluded_subscriptions: 0,
    last_payment_at: null,
  };

  const excludedSubs = new Set<string>();
  const excludedSessions = new Set<string>();
  for (const k of input.keys) {
    if (!isExcluded(k.email) && !k.issued_by_us) continue;
    if (k.stripe_subscription_id) excludedSubs.add(k.stripe_subscription_id);
    if (k.stripe_session_id) excludedSessions.add(k.stripe_session_id);
  }
  // Une session dont une copie porte un abonnement écarté est écartée aussi.
  for (const k of input.keys) {
    if (
      k.stripe_session_id &&
      k.stripe_subscription_id &&
      excludedSubs.has(k.stripe_subscription_id)
    ) {
      excludedSessions.add(k.stripe_session_id);
    }
  }

  // Un abonnement posé sur une clé existante (lot B2) est écarté comme les
  // autres quand la clé servie à l'achat est interne ou offerte.
  for (const a of input.attached ?? []) {
    if (!a.stripe_subscription_id) continue;
    if ((a.email && isExcluded(a.email)) || a.issued_by_us) {
      excludedSubs.add(a.stripe_subscription_id);
    }
  }

  const seen = new Set<string>();
  const active = new Set<string>();
  const sessions = new Map<string, SubscriptionKeyRow[]>();
  for (const k of input.keys) {
    const sub = k.stripe_subscription_id;
    if (sub && !excludedSubs.has(sub)) {
      seen.add(sub);
      // Actif = une clé active ET un abonnement qui n'est pas terminé (lot B2 :
      // la clé survit à son abonnement, l'identifiant reste sur elle).
      if (k.active && !k.subscription_ended_at) active.add(sub);
    }
    const session = k.stripe_session_id?.trim();
    if (!session || excludedSessions.has(session)) continue;
    // Jamais deux fois le même argent : le montant d'une session de PACK
    // appartient aux packs. Le registre le dit (lot B1) ; à défaut de ligne, la
    // règle d'avant (une clé à crédits est un pack). Une clé Pro RECHARGÉE porte
    // des crédits, mais sa session reste celle de l'abonnement : sans cette
    // lecture, son premier paiement disparaissait.
    if (k.session_kind === 'pack') continue;
    if (k.session_kind == null && (k.credits_total ?? 0) > 0) continue;
    const group = sessions.get(session) ?? [];
    group.push(k);
    sessions.set(session, group);
  }

  for (const group of sessions.values()) {
    out.first_payments++;
    const dated = group
      .map((k) => k.created_at)
      .filter((d): d is string => !!d)
      .sort()[0];
    out.last_payment_at = later(out.last_payment_at, dated ?? null);
    const priced = group.find(
      (k) => usableAmount(k.amount_paid_minor) && currencyOf(k.amount_paid_currency),
    );
    if (!priced) {
      out.first_payments_amount_missing++;
      continue;
    }
    if (currencyOf(priced.amount_paid_currency) !== 'usd') {
      out.other_currency_payments++;
      continue;
    }
    out.first_payments_usd_minor += priced.amount_paid_minor as number;
  }

  // Les premiers paiements des abonnements posés sur une clé existante : au
  // registre seulement (la clé ne porte pas leur session), une ligne chacun.
  for (const a of input.attached ?? []) {
    if (a.stripe_subscription_id && excludedSubs.has(a.stripe_subscription_id)) continue;
    if (a.stripe_subscription_id) seen.add(a.stripe_subscription_id);
    out.first_payments++;
    out.last_payment_at = later(out.last_payment_at, a.created_at);
    const currency = currencyOf(a.currency);
    if (!usableAmount(a.amount_minor) || !currency) {
      out.first_payments_amount_missing++;
      continue;
    }
    if (currency !== 'usd') {
      out.other_currency_payments++;
      continue;
    }
    out.first_payments_usd_minor += a.amount_minor;
  }

  for (const p of input.payments) {
    if (p.billing_reason !== RENEWAL_REASON) continue;
    if (p.subscription_id && excludedSubs.has(p.subscription_id)) continue;
    // Une adresse interne écarte aussi un renouvellement que la clé ne relie plus
    // à son abonnement ; une adresse absente ne l'écarte pas : l'argent est réel.
    if (p.email && isExcluded(p.email)) continue;
    if (p.subscription_id) seen.add(p.subscription_id);
    out.renewals++;
    out.last_payment_at = later(out.last_payment_at, p.paid_at);
    const currency = currencyOf(p.amount_paid_currency);
    if (!usableAmount(p.amount_paid_minor) || !currency) {
      out.renewals_amount_missing++;
      continue;
    }
    if (currency !== 'usd') {
      out.other_currency_payments++;
      continue;
    }
    out.renewals_usd_minor += p.amount_paid_minor;
  }

  out.usd_minor = out.first_payments_usd_minor + out.renewals_usd_minor;
  if (!Number.isSafeInteger(out.usd_minor)) {
    throw new RangeError('Subscription USD total exceeds safe integer range');
  }
  out.usd = out.usd_minor / 100;
  out.subscriptions = seen.size;
  out.active_subscriptions = active.size;
  out.excluded_subscriptions = excludedSubs.size;
  return out;
}

/** Les lignes que `subscriptionsSold` additionne, lues dans la base des clés. */
export function readSubscriptionRows(db: Db = getStatsDB()): {
  keys: SubscriptionKeyRow[];
  payments: SubscriptionPaymentRow[];
  attached: AttachedSubscriptionRow[];
} {
  // La règle partagée avec activation.ts ; les clés inactives restent (une
  // rotation ou une résiliation n'efface pas le paiement d'origine).
  const keys = db
    .prepare(
      `SELECT email, credits_total, stripe_session_id, stripe_subscription_id, amount_paid_minor,
              amount_paid_currency, issued_by_us, active, created_at, subscription_ended_at,
              (SELECT kp.kind FROM key_purchases kp
                WHERE kp.payment_ref = 'stripe:' || api_keys.stripe_session_id) AS session_kind
         FROM api_keys
        WHERE (${SUBSCRIPTION_KEY_SQL})`,
    )
    .all() as SubscriptionKeyRow[];
  const payments = db
    .prepare(
      `SELECT p.subscription_id, p.amount_paid_minor, p.amount_paid_currency,
              p.billing_reason, p.paid_at,
              (SELECT k.email FROM api_keys k
                WHERE k.stripe_subscription_id = p.subscription_id
                ORDER BY k.active DESC, k.id DESC LIMIT 1) AS email
         FROM subscription_payments p`,
    )
    .all() as SubscriptionPaymentRow[];
  // Seulement `attached` : une frappe (`minted`, `minted_fallback`) porte déjà
  // son premier paiement sur la clé qu'elle a frappée, lu plus haut.
  const attached = db
    .prepare(
      `SELECT p.payment_ref, p.stripe_subscription_id, p.amount_minor, p.currency, p.created_at,
              k.email, MAX(p.issued_by_us, COALESCE(k.issued_by_us, 0)) AS issued_by_us
         FROM key_purchases p
         LEFT JOIN api_keys k ON k.key_hash = p.key_hash
        WHERE p.kind = 'subscription' AND p.outcome = 'attached'`,
    )
    .all() as AttachedSubscriptionRow[];
  return { keys, payments, attached };
}
