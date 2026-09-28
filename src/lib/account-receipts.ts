/**
 * Les reçus de la page du compte client (28.09.2026).
 *
 * Pourquoi : la page du compte montrait le solde et la consommation, jamais la
 * preuve d'un paiement. Elle liste désormais les packs et abonnements payés par
 * l'adresse, chacun avec son reçu.
 *
 * Deux lectures, toutes deux derrière une session (`src/routes/account.ts`) :
 *  - `buildReceipts` : la liste, sans aucun appel à Stripe ;
 *  - `receiptLinkFor` : le lien du reçu Stripe d'UN achat, demandé au clic.
 *
 * Qui voit quel achat : `listOwnedPurchases` et `findOwnedPurchase`
 * (`src/lib/account.ts`), là où vivent toutes les règles d'appartenance. Un
 * achat n'est désigné que par sa référence opaque (`receiptRefOf`), jamais par
 * l'identifiant de sa ligne, qui est le compteur global des ventes.
 *
 * ── Le lien du reçu ───────────────────────────────────────────────────────────
 * Stripe fait expirer un lien de reçu 30 jours après l'avoir donné (le reçu
 * lui-même reste) : un lien gardé en base serait mort un mois plus tard. Il est
 * donc demandé au moment du clic (la session de paiement, son paiement, sa
 * dernière charge, `receipt_url`), puis gardé UNE heure en mémoire. Jamais écrit
 * en base ni journalisé : il ouvre le reçu à qui le détient.
 *
 * Un seul appel à Stripe, et seulement sur ce clic : aucune autre requête du
 * service n'en fait. Délai borné, un seul nouvel essai (celui du SDK), et une
 * panne rend « indisponible », jamais une erreur qui remonte. Deux clics
 * simultanés sur le même reçu partagent le même appel, et un échec est gardé
 * une minute : un client scripté ne multiplie pas les appels (relecture de
 * sécurité du 28.09.2026, M3).
 *
 * 🚨 Ouvrir la page d'un reçu fait attribuer un numéro de reçu à la charge
 * (`receipt_number`) sans rien envoyer : ce numéro ne prouve donc pas qu'un reçu
 * est parti par mail. Seule `receipt_email` le prouve (constaté le 28.09.2026).
 */
import Stripe from 'stripe';
import { listOwnedPurchases, type OwnedPurchase } from './account.js';
import { PRO_PORTAL_URL } from './payment-links.js';

/** Le seul début d'adresse qu'un lien de reçu peut avoir. */
export const RECEIPT_URL_PREFIX = 'https://pay.stripe.com/receipts/';

/** Durée de vie d'un lien gardé en mémoire : très en deçà des 30 jours de Stripe. */
export const RECEIPT_LINK_CACHE_MS = 60 * 60 * 1000;

/** Durée pendant laquelle un échec est gardé : le clic suivant n'appelle pas Stripe. */
export const RECEIPT_FAILURE_CACHE_MS = 60 * 1000;

/** Liens gardés au plus : au-delà, les plus vieux partent. */
const RECEIPT_LINK_CACHE_MAX = 500;

const STRIPE_TIMEOUT_MS = 8_000;

export interface AccountReceipt {
  /** La référence opaque de l'achat (`rcpt_…`), pour GET /v1/account/receipt. */
  ref: string;
  /** ISO 8601, UTC. */
  paid_at: string | null;
  kind: 'pack' | 'subscription';
  /** La formule d'un abonnement (`pro` ou `editor`) ; null pour un pack, ou inconnue. */
  plan: 'pro' | 'editor' | null;
  rail: 'card' | 'usdc';
  credits: number | null;
  /** Le montant encaissé, en unités mineures de sa devise (400, `usd`), ou null s'il est inconnu. */
  amount: { minor: number; currency: string } | null;
  status: 'paid' | 'refunded' | 'disputed';
  key_prefix: string;
  /** Le chemin qui donne le reçu Stripe de cet achat (pack payé par carte), sinon null. */
  receipt: string | null;
  /** Le portail Stripe de l'abonnement, où vivent ses factures (abonnement par carte), sinon null. */
  invoices: string | null;
}

export interface AccountReceipts {
  receipts: AccountReceipt[];
}

/** Le chemin de la route qui donne le lien du reçu (sur l'hôte de l'API). */
export function receiptPathOf(ref: string): string {
  return `/v1/account/receipt?ref=${ref}`;
}

/**
 * Un reçu Stripe n'existe que pour un pack payé par carte dont la session est
 * connue. Un abonnement a ses factures dans le portail ; un paiement USDC n'a
 * pas de reçu de carte.
 */
export function hasCardReceipt(p: OwnedPurchase): boolean {
  return p.rail === 'card' && p.kind === 'pack' && !!p.stripe_session_id;
}

function statusOf(outcome: string): AccountReceipt['status'] {
  if (outcome === 'refunded') return 'refunded';
  if (outcome === 'disputed') return 'disputed';
  return 'paid';
}

/** La formule d'un abonnement, lue dans `bundle` (`pro`, ou `oem` pour l'offre éditeur). */
function planOf(p: OwnedPurchase): AccountReceipt['plan'] {
  if (p.kind !== 'subscription') return null;
  if (p.bundle === 'pro') return 'pro';
  if (p.bundle === 'oem' || p.bundle === 'editor') return 'editor';
  return null;
}

/** La liste des reçus d'une adresse. Aucun appel à Stripe. */
export function buildReceipts(emailNorm: string): AccountReceipts {
  return {
    receipts: listOwnedPurchases(emailNorm).map((p): AccountReceipt => ({
      ref: p.ref,
      paid_at: p.paid_at,
      kind: p.kind,
      plan: planOf(p),
      rail: p.rail,
      credits: p.credits,
      amount:
        p.amount_minor !== null && p.currency
          ? { minor: p.amount_minor, currency: p.currency.toLowerCase() }
          : null,
      status: statusOf(p.outcome),
      key_prefix: p.key_prefix,
      receipt: hasCardReceipt(p) ? receiptPathOf(p.ref) : null,
      invoices: p.rail === 'card' && p.kind === 'subscription' ? PRO_PORTAL_URL : null,
    })),
  };
}

// ─── Le lien du reçu, demandé à Stripe ───────────────────────────────────────

export type ReceiptLink = { kind: 'ok'; url: string } | { kind: 'unavailable' };

/** Va chercher le lien du reçu d'une session de paiement. Remplaçable par les tests. */
export type ReceiptUrlFetcher = (stripeSessionId: string) => Promise<string | null>;

let stripeClient: Stripe | null = null;

const fetchFromStripe: ReceiptUrlFetcher = async (stripeSessionId) => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key, { timeout: STRIPE_TIMEOUT_MS, maxNetworkRetries: 1 });
  const session = await stripeClient.checkout.sessions.retrieve(stripeSessionId, {
    expand: ['payment_intent.latest_charge'],
  });
  const intent = session.payment_intent;
  const charge = intent && typeof intent === 'object' ? intent.latest_charge : null;
  const url = charge && typeof charge === 'object' ? charge.receipt_url : null;
  return typeof url === 'string' ? url : null;
};

let fetchReceiptUrl: ReceiptUrlFetcher = fetchFromStripe;

/** Les liens obtenus, et les échecs récents (`url: null`), par achat. */
const linkCache = new Map<number, { url: string | null; at: number }>();
/** L'appel en cours pour un achat : deux clics simultanés le partagent. */
const inFlight = new Map<number, Promise<ReceiptLink>>();

function remember(id: number, url: string | null, now: number): void {
  // `delete` puis `set` : une entrée rafraîchie repasse en fin de Map, donc
  // n'est pas la première chassée (relecture, N4).
  linkCache.delete(id);
  linkCache.set(id, { url, at: now });
  if (linkCache.size <= RECEIPT_LINK_CACHE_MAX) return;
  // Une Map rend ses entrées dans l'ordre d'insertion : les premières sont les plus vieilles.
  for (const oldest of linkCache.keys()) {
    linkCache.delete(oldest);
    if (linkCache.size <= RECEIPT_LINK_CACHE_MAX) break;
  }
}

async function askStripe(p: OwnedPurchase, now: number): Promise<ReceiptLink> {
  let url: string | null;
  try {
    url = await fetchReceiptUrl(p.stripe_session_id as string);
  } catch (err) {
    const type = (err as { type?: unknown })?.type;
    console.warn(
      `[account-receipts] Stripe did not return the receipt of purchase ${p.id} (${typeof type === 'string' ? type : 'error'}).`,
    );
    remember(p.id, null, now);
    return { kind: 'unavailable' };
  }
  if (!url || !url.startsWith(RECEIPT_URL_PREFIX)) {
    console.warn(`[account-receipts] Stripe returned no receipt link for purchase ${p.id}.`);
    remember(p.id, null, now);
    return { kind: 'unavailable' };
  }
  remember(p.id, url, now);
  return { kind: 'ok', url };
}

/**
 * Le lien du reçu Stripe d'un achat déjà reconnu comme appartenant à la
 * session (`findOwnedPurchase`). « Indisponible » quand l'achat n'a pas de reçu
 * de carte, quand Stripe ne répond pas, ne donne rien, ou donne une adresse qui
 * n'est pas celle d'un reçu Stripe ; un échec est gardé une minute.
 *
 * Le journal ne garde que le numéro de la ligne (interne, jamais servi) et le
 * type d'erreur de Stripe : ni le lien, ni l'identifiant de session (qu'un
 * message d'erreur Stripe cite).
 */
export async function receiptLinkFor(p: OwnedPurchase, now = Date.now()): Promise<ReceiptLink> {
  if (!hasCardReceipt(p)) return { kind: 'unavailable' };
  const hit = linkCache.get(p.id);
  if (hit) {
    if (hit.url !== null && now - hit.at < RECEIPT_LINK_CACHE_MS)
      return { kind: 'ok', url: hit.url };
    if (hit.url === null && now - hit.at < RECEIPT_FAILURE_CACHE_MS) return { kind: 'unavailable' };
  }
  const pending = inFlight.get(p.id);
  if (pending) return pending;
  const call = askStripe(p, now).finally(() => inFlight.delete(p.id));
  inFlight.set(p.id, call);
  return call;
}

/** Pour les tests : remplace l'appel à Stripe (null remet le vrai) et vide les caches. */
export function setReceiptUrlFetcherForTests(fetcher: ReceiptUrlFetcher | null): void {
  fetchReceiptUrl = fetcher ?? fetchFromStripe;
  linkCache.clear();
  inFlight.clear();
}
