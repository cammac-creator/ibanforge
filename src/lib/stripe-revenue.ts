/**
 * L'argent encaissé, lu chez Stripe : la source, pas une copie dérivée.
 *
 * POURQUOI
 *
 * Le tableau de bord additionnait ce que les clés API gardent de leurs achats.
 * Trois sortes de paiements lui échappaient par construction : le premier
 * paiement d'un abonnement (écrit sur une clé à quota mensuel, que la lecture
 * des packs ignore), chaque renouvellement (qui ne frappe aucune clé) et les
 * audits de fichier (qui n'en frappent pas non plus). Stripe les a tous. Ce
 * module l'interroge en LECTURE SEULE et rend des agrégats : jamais une
 * adresse, un identifiant de paiement ou des chiffres de carte.
 *
 * CLASSER UN PAIEMENT
 *
 * Depuis la version d'API 2025-03-31.basil (le SDK installé épingle une
 * version plus récente), une charge ne porte plus `invoice`. Le lien entre une
 * facture et son paiement passe par les `invoice_payments` : on les liste une
 * fois, facture développée, et une charge payée par une facture d'abonnement
 * est un abonnement. L'ancien champ `charge.invoice` est encore lu s'il est
 * présent (un client épinglé sur une version antérieure), jamais supposé.
 *
 * Une charge sans facture d'abonnement est classée par les métadonnées de sa
 * session Checkout, les mêmes que lit le webhook : `audit_job` = audit,
 * `plan` (pro, oem) = abonnement, `bundle` = pack. Les sessions terminées sont
 * listées UNE fois et rangées par paiement, plutôt qu'une requête par charge
 * (`checkout.sessions.list({ payment_intent })`) : le résultat est le même, et
 * le nombre d'appels suit le nombre de pages et non le nombre de paiements.
 * Tout le reste est « autre », montré à part, jamais fondu dans un total : le
 * compte Stripe porte encore des traces d'un autre projet.
 *
 * CE QUI FAIT FOI
 *
 *  - Brut : ce que l'acheteur a payé, dans la devise du paiement. Les devises
 *    ne s'additionnent jamais entre elles.
 *  - Net et frais : la transaction de solde de chaque charge, dans la devise
 *    de règlement du compte, AVANT remboursements. Les remboursements sont
 *    rendus à part (`refunded`), pour qu'un remboursement se voie au lieu de
 *    se dissoudre dans un net.
 *  - Viré : les virements payés. En attente : virements en route, plus le
 *    solde disponible et le solde en attente — tout ce qui n'est pas encore
 *    arrivé sur le compte bancaire.
 *
 * DÉGRADATION
 *
 * Sans les charges, il n'y a rien à dire : la lecture échoue entière. Les
 * lectures de classement, de virements et de solde peuvent échouer seules :
 * le total brut reste juste, et la lecture le dit (`classification`,
 * `payouts: null`, `balance: null`).
 *
 * UN SEUL APPEL À LA FOIS
 *
 * Chaque page est attendue avant la suivante, chaque lecture avant la suivante
 * (jamais de Promise.all), et le cache sert une lecture unique à toutes les
 * requêtes simultanées (StripeRevenueCache).
 */
import type Stripe from 'stripe';

export type RevenueKind = 'pack' | 'abonnement' | 'audit' | 'autre';
export const REVENUE_KINDS: readonly RevenueKind[] = ['pack', 'abonnement', 'audit', 'autre'];

/** Montants en unités mineures, par devise ISO en minuscules. */
export type MinorByCurrency = Record<string, number>;

export interface KindTotals {
  /** Paiements réussis et encaissés. */
  count: number;
  /** Ce que l'acheteur a payé, dans la devise du paiement. */
  gross: MinorByCurrency;
  /** Remboursé sur ces paiements, dans la devise du paiement. Non déduit de `gross`. */
  refunded: MinorByCurrency;
  /** Frais Stripe, dans la devise de règlement. */
  fees: MinorByCurrency;
  /** Crédité au solde, dans la devise de règlement, avant remboursements. */
  net: MinorByCurrency;
  /** Paiements sans transaction de solde lisible : leur net et leurs frais manquent. */
  net_unknown: number;
  last_payment_at: string | null;
}

export interface StripeRevenueSnapshot {
  version: 1;
  read_at: string;
  /** false : une clé de test, des montants fictifs. null : aucun paiement lu. */
  livemode: boolean | null;
  by_kind: Record<RevenueKind, KindTotals>;
  total: KindTotals;
  classification: {
    /** false : la lecture des factures a échoué, des abonnements peuvent être dans « autre ». */
    invoices: boolean;
    /** false : la lecture des sessions a échoué, des packs et audits peuvent être dans « autre ». */
    sessions: boolean;
  };
  payouts: {
    paid: { count: number; amount: MinorByCurrency; last_arrival_at: string | null };
    in_transit: { count: number; amount: MinorByCurrency };
  } | null;
  balance: { available: MinorByCurrency; pending: MinorByCurrency } | null;
  /** Pas encore sur le compte bancaire. null si les virements ou le solde manquent. */
  awaiting_payout: MinorByCurrency | null;
}

/** Une page de liste Stripe, réduite à ce que la pagination lit. */
export interface StripePage<T> {
  data: T[];
  has_more: boolean;
}

/**
 * Le sous-ensemble du client Stripe que cette lecture appelle. Un vrai
 * `Stripe` le satisfait tel quel ; les tests en fournissent un faux.
 */
export interface StripeRevenueClient {
  charges: { list(params: Stripe.ChargeListParams): Promise<StripePage<Stripe.Charge>> };
  invoicePayments: {
    list(params: Stripe.InvoicePaymentListParams): Promise<StripePage<Stripe.InvoicePayment>>;
  };
  checkout: {
    sessions: {
      list(params: Stripe.Checkout.SessionListParams): Promise<StripePage<Stripe.Checkout.Session>>;
    };
  };
  payouts: { list(params: Stripe.PayoutListParams): Promise<StripePage<Stripe.Payout>> };
  balance: { retrieve(): Promise<Stripe.Balance> };
}

export const PAGE_SIZE = 100;
/** Un filet contre une pagination qui ne finirait pas, pas une limite d'usage. */
export const MAX_PAGES = 500;
/** Au-delà, la lecture abandonne : un Stripe qui traîne ne doit pas occuper l'API. */
export const READ_DEADLINE_MS = 45_000;

export class StripeReadDeadline extends Error {
  constructor() {
    super('stripe_read_deadline');
  }
}

interface ReadClock {
  now: () => number;
  deadline: number;
}

function checkDeadline(clock: ReadClock): void {
  if (clock.now() > clock.deadline) throw new StripeReadDeadline();
}

/** Toutes les pages d'une liste, l'une après l'autre. */
export async function listAll<T extends { id: string }>(
  fetchPage: (params: { limit: number; starting_after?: string }) => Promise<StripePage<T>>,
  clock: ReadClock,
): Promise<T[]> {
  const out: T[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    checkDeadline(clock);
    const res = await fetchPage(
      startingAfter ? { limit: PAGE_SIZE, starting_after: startingAfter } : { limit: PAGE_SIZE },
    );
    out.push(...res.data);
    const last = res.data[res.data.length - 1];
    if (!res.has_more || !last) return out;
    startingAfter = last.id;
  }
  throw new Error('stripe_pagination_limit');
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

function add(map: MinorByCurrency, currency: string | null | undefined, minor: number): void {
  const c = currency?.trim().toLowerCase();
  if (!c || !Number.isFinite(minor)) return;
  map[c] = (map[c] ?? 0) + minor;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

function emptyTotals(): KindTotals {
  return {
    count: 0,
    gross: {},
    refunded: {},
    fees: {},
    net: {},
    net_unknown: 0,
    last_payment_at: null,
  };
}

/**
 * Une facture est-elle celle d'un abonnement ? Développée, elle le dit par son
 * parent ou son motif. Non développée (une chaîne), on applique la règle
 * historique : une charge portée par une facture est un abonnement, parce
 * qu'aucun pack ni audit n'est facturé aujourd'hui.
 */
function invoiceIsSubscription(invoice: unknown): boolean {
  if (typeof invoice === 'string') return true;
  if (!invoice || typeof invoice !== 'object') return false;
  const inv = invoice as {
    deleted?: boolean;
    parent?: { type?: string; subscription_details?: unknown } | null;
    billing_reason?: string | null;
    subscription?: unknown;
  };
  if (inv.deleted) return true;
  if (inv.parent?.type === 'subscription_details' || inv.parent?.subscription_details) return true;
  if (typeof inv.billing_reason === 'string' && inv.billing_reason.startsWith('subscription')) {
    return true;
  }
  return stripeId(inv.subscription) !== null;
}

/** Les métadonnées d'une session Checkout, lues dans le même ordre que le webhook. */
function kindOfSession(session: Stripe.Checkout.Session): RevenueKind | null {
  const md = session.metadata ?? {};
  if (typeof md.audit_job === 'string' && md.audit_job.trim()) return 'audit';
  if (md.plan === 'pro' || md.plan === 'oem' || session.mode === 'subscription') {
    return 'abonnement';
  }
  if (typeof md.bundle === 'string' && md.bundle.trim()) return 'pack';
  return null;
}

export interface StripeRevenueInput {
  charges: Stripe.Charge[];
  /** null : la lecture a échoué. */
  invoicePayments: Stripe.InvoicePayment[] | null;
  sessions: Stripe.Checkout.Session[] | null;
  payouts: Stripe.Payout[] | null;
  balance: Stripe.Balance | null;
}

/** Résume des objets Stripe déjà lus. Pure : c'est ici que vivent les règles. */
export function summarizeStripeRevenue(
  input: StripeRevenueInput,
  readAt: Date,
): StripeRevenueSnapshot {
  // Paiement (charge ou intention) → facture d'abonnement ou non.
  const invoiceOf = new Map<string, boolean>();
  for (const ip of input.invoicePayments ?? []) {
    if (ip.status && ip.status !== 'paid') continue;
    const subscription = invoiceIsSubscription(ip.invoice);
    for (const ref of [stripeId(ip.payment?.payment_intent), stripeId(ip.payment?.charge)]) {
      if (ref) invoiceOf.set(ref, subscription || invoiceOf.get(ref) === true);
    }
  }
  const sessionOf = new Map<string, RevenueKind>();
  for (const s of input.sessions ?? []) {
    const pi = stripeId(s.payment_intent);
    const kind = kindOfSession(s);
    if (pi && kind) sessionOf.set(pi, kind);
  }

  const kindOf = (ch: Stripe.Charge): RevenueKind => {
    const pi = stripeId(ch.payment_intent);
    const viaInvoice = invoiceOf.get(ch.id) ?? (pi ? invoiceOf.get(pi) : undefined);
    if (viaInvoice === true) return 'abonnement';
    const legacyInvoice = stripeId((ch as unknown as { invoice?: unknown }).invoice);
    if (viaInvoice === undefined && legacyInvoice) return 'abonnement';
    const viaSession = pi ? sessionOf.get(pi) : undefined;
    return viaSession ?? 'autre';
  };

  const byKind = Object.fromEntries(REVENUE_KINDS.map((k) => [k, emptyTotals()])) as Record<
    RevenueKind,
    KindTotals
  >;
  const total = emptyTotals();
  let livemode: boolean | null = null;

  for (const ch of input.charges) {
    // Un paiement refusé, en attente ou seulement autorisé n'est pas de l'argent.
    if (ch.status !== 'succeeded' || ch.captured === false) continue;
    const gross =
      typeof ch.amount_captured === 'number' && ch.amount_captured > 0
        ? ch.amount_captured
        : ch.amount;
    if (typeof gross !== 'number' || !Number.isFinite(gross)) continue;
    livemode = livemode === null ? !!ch.livemode : livemode && !!ch.livemode;
    const at = new Date(ch.created * 1000).toISOString();
    const bt =
      ch.balance_transaction && typeof ch.balance_transaction === 'object'
        ? ch.balance_transaction
        : null;
    for (const t of [byKind[kindOf(ch)], total]) {
      t.count++;
      add(t.gross, ch.currency, gross);
      if (ch.amount_refunded > 0) add(t.refunded, ch.currency, ch.amount_refunded);
      if (bt) {
        add(t.fees, bt.currency, bt.fee);
        add(t.net, bt.currency, bt.net);
      } else {
        t.net_unknown++;
      }
      t.last_payment_at = later(t.last_payment_at, at);
    }
  }

  let payouts: StripeRevenueSnapshot['payouts'] = null;
  if (input.payouts) {
    payouts = {
      paid: { count: 0, amount: {}, last_arrival_at: null },
      in_transit: { count: 0, amount: {} },
    };
    for (const p of input.payouts) {
      if (p.status === 'paid') {
        payouts.paid.count++;
        add(payouts.paid.amount, p.currency, p.amount);
        const arrival = new Date(p.arrival_date * 1000).toISOString();
        payouts.paid.last_arrival_at = later(payouts.paid.last_arrival_at, arrival);
      } else if (p.status === 'pending' || p.status === 'in_transit') {
        payouts.in_transit.count++;
        add(payouts.in_transit.amount, p.currency, p.amount);
      }
      // failed, canceled : l'argent est revenu au solde, il est compté là.
    }
  }

  let balance: StripeRevenueSnapshot['balance'] = null;
  if (input.balance) {
    balance = { available: {}, pending: {} };
    for (const b of input.balance.available ?? []) add(balance.available, b.currency, b.amount);
    for (const b of input.balance.pending ?? []) add(balance.pending, b.currency, b.amount);
  }

  let awaiting: MinorByCurrency | null = null;
  if (payouts && balance) {
    awaiting = {};
    for (const map of [payouts.in_transit.amount, balance.available, balance.pending]) {
      for (const [c, v] of Object.entries(map)) add(awaiting, c, v);
    }
  }

  return {
    version: 1,
    read_at: readAt.toISOString(),
    livemode,
    by_kind: byKind,
    total,
    classification: {
      invoices: input.invoicePayments !== null,
      sessions: input.sessions !== null,
    },
    payouts,
    balance,
    awaiting_payout: awaiting,
  };
}

/**
 * Lit Stripe et résume. Les charges d'abord (sans elles, rien) ; puis chaque
 * lecture secondaire, l'une après l'autre, chacune pouvant manquer seule.
 */
export async function readStripeRevenue(
  client: StripeRevenueClient,
  opts: { now?: () => number; deadlineMs?: number } = {},
): Promise<StripeRevenueSnapshot> {
  const now = opts.now ?? Date.now;
  const clock: ReadClock = { now, deadline: now() + (opts.deadlineMs ?? READ_DEADLINE_MS) };

  const charges = await listAll(
    (p) => client.charges.list({ ...p, expand: ['data.balance_transaction'] }),
    clock,
  );

  const optional = async <T>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };
  const invoicePayments = await optional(() =>
    listAll(
      (p) => client.invoicePayments.list({ ...p, status: 'paid', expand: ['data.invoice'] }),
      clock,
    ),
  );
  const sessions = await optional(() =>
    listAll((p) => client.checkout.sessions.list({ ...p, status: 'complete' }), clock),
  );
  const payouts = await optional(() => listAll((p) => client.payouts.list(p), clock));
  const balance = await optional(async () => {
    checkDeadline(clock);
    return client.balance.retrieve();
  });

  return summarizeStripeRevenue(
    { charges, invoicePayments, sessions, payouts, balance },
    new Date(now()),
  );
}

// ---------------------------------------------------------------------------
// Le cache : 15 minutes, une seule lecture en vol
// ---------------------------------------------------------------------------

export type StripeUnavailableReason =
  /** STRIPE_SECRET_KEY absente de l'environnement. */
  | 'stripe_not_configured'
  /** Stripe a refusé ou n'a pas répondu. */
  | 'stripe_unreachable'
  /** La lecture est en cours et dépasse ce qu'une requête attend : le cache se remplira. */
  | 'stripe_slow';

export type StripeRevenueResult =
  { ok: true; snapshot: StripeRevenueSnapshot } | { ok: false; reason: StripeUnavailableReason };

export const CACHE_TTL_MS = 15 * 60_000;
/** Un échec se retient une minute : un tableau de bord rechargé ne martèle pas un Stripe en panne. */
export const FAILURE_TTL_MS = 60_000;
/** Ce qu'une requête attend une lecture en cours avant de répondre sans elle. */
export const REQUEST_WAIT_MS = 8_000;

export interface StripeRevenueCacheOptions {
  /** Rend un client, ou null quand Stripe n'est pas configuré. */
  factory: () => StripeRevenueClient | null;
  now?: () => number;
  ttlMs?: number;
  failureTtlMs?: number;
  waitMs?: number;
  deadlineMs?: number;
}

/**
 * Une lecture Stripe partagée : tant qu'elle est fraîche, elle est servie ;
 * quand il en faut une nouvelle, toutes les requêtes simultanées attendent la
 * MÊME (jamais deux lectures Stripe en parallèle). Une requête n'attend pas
 * plus de `waitMs` : au-delà, elle répond `stripe_slow` et la lecture continue
 * pour la suivante. Ne rejette jamais.
 */
export class StripeRevenueCache {
  private entry: { result: StripeRevenueResult; at: number } | null = null;
  private inflight: Promise<StripeRevenueResult> | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: StripeRevenueCacheOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** L'âge de la lecture servie, pour la réponse. */
  cachedAt(): number | null {
    return this.entry?.at ?? null;
  }

  async get(): Promise<StripeRevenueResult> {
    const entry = this.entry;
    if (entry) {
      const ttl = entry.result.ok
        ? (this.opts.ttlMs ?? CACHE_TTL_MS)
        : (this.opts.failureTtlMs ?? FAILURE_TTL_MS);
      if (this.now() - entry.at < ttl) return entry.result;
    }
    if (!this.inflight) this.inflight = this.refresh();
    const waitMs = this.opts.waitMs ?? REQUEST_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<StripeRevenueResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'stripe_slow' }), waitMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([this.inflight, slow]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async refresh(): Promise<StripeRevenueResult> {
    let result: StripeRevenueResult;
    try {
      const client = this.opts.factory();
      if (!client) {
        result = { ok: false, reason: 'stripe_not_configured' };
      } else {
        const snapshot = await readStripeRevenue(client, {
          now: this.now,
          deadlineMs: this.opts.deadlineMs,
        });
        result = { ok: true, snapshot };
      }
    } catch (err) {
      // Le message de Stripe peut nommer un compte ou une clé : il reste dans
      // le journal du serveur, jamais dans la réponse.
      console.error('[stripe-revenue] read failed:', err instanceof Error ? err.message : err);
      result = { ok: false, reason: 'stripe_unreachable' };
    }
    this.entry = { result, at: this.now() };
    this.inflight = null;
    return result;
  }
}
