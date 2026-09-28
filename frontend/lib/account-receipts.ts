/**
 * Les reçus de la page du compte (28.09.2026), lus comme le reste de la page :
 * fonctions pures, sans DOM, sans traduction et sans horloge (voir
 * `account-overview.ts`). Le composant ne fait que les appels et le rendu.
 *
 * Deux réponses de l'API :
 *  - `GET /v1/account/receipts` : la liste des achats payés par l'adresse ;
 *  - `GET /v1/account/receipt?ref=rcpt_…` : le lien du reçu Stripe d'UN achat,
 *    demandé au clic, parce que Stripe fait expirer ce lien 30 jours après
 *    l'avoir donné. La page ne le garde pas : elle y va.
 *
 * Tout ce qui vient de l'API est relu : un achat mal formé est ignoré, un lien
 * de reçu n'est suivi que s'il mène à la page des reçus de Stripe, en `https`,
 * le lien des factures seulement s'il mène au portail de Stripe, et le chemin
 * d'un reçu doit être exactement celui de la route du compte.
 */

import type { ApiReply } from './account-overview';
import { safeHttpsUrl } from './account-overview';
import { formatGrouped } from './format-grouped';

export interface ReceiptRow {
  /** La référence opaque de l'achat (`rcpt_…`), jamais un numéro. */
  ref: string;
  /** « 2026-09-23 » (UTC), ou null. */
  day: string | null;
  kind: 'pack' | 'subscription';
  /** La formule d'un abonnement ; null pour un pack, ou inconnue. */
  plan: 'pro' | 'editor' | null;
  rail: 'card' | 'usdc';
  credits: number | null;
  amount: { minor: number; currency: string } | null;
  status: 'paid' | 'refunded' | 'disputed';
  keyPrefix: string | null;
  /** Le chemin, sur l'hôte de l'API, qui donne le reçu Stripe ; null sans reçu de carte. */
  receiptPath: string | null;
  /** Le portail Stripe où vivent les factures d'un abonnement ; null sinon. */
  invoicesUrl: string | null;
}

export type ReceiptsOutcome =
  | { kind: 'ready'; rows: ReceiptRow[] }
  | { kind: 'session_ended' }
  | { kind: 'failed' };

export type ReceiptLinkOutcome =
  | { kind: 'ready'; url: string }
  | { kind: 'session_ended' }
  | { kind: 'failed' };

/** Le seul début d'adresse qu'un lien de reçu peut avoir (`RECEIPT_URL_PREFIX` de l'API). */
export const STRIPE_RECEIPT_PREFIX = 'https://pay.stripe.com/receipts/';

/** Le seul début d'adresse qu'un lien de factures peut avoir : le portail client de Stripe. */
export const STRIPE_PORTAL_PREFIX = 'https://billing.stripe.com/';

const REF = /^rcpt_[0-9a-f]{24}$/;
const RECEIPT_PATH = /^\/v1\/account\/receipt\?ref=rcpt_[0-9a-f]{24}$/;
const DAY = /^(\d{4}-\d{2}-\d{2})[T ]/;

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function wholeNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

function readAmount(raw: unknown): ReceiptRow['amount'] {
  const a = record(raw);
  const minor = a ? wholeNumber(a.minor) : null;
  const currency = a && typeof a.currency === 'string' && /^[a-z]{3,5}$/i.test(a.currency) ? a.currency : null;
  return minor !== null && currency ? { minor, currency: currency.toLowerCase() } : null;
}

/** Un achat de la liste, ou null s'il n'a pas la forme attendue. */
export function receiptRowFrom(raw: unknown): ReceiptRow | null {
  const r = record(raw);
  if (!r) return null;
  if (typeof r.ref !== 'string' || !REF.test(r.ref)) return null;
  if (r.kind !== 'pack' && r.kind !== 'subscription') return null;
  if (r.rail !== 'card' && r.rail !== 'usdc') return null;
  const status = r.status === 'refunded' || r.status === 'disputed' ? r.status : r.status === 'paid' ? 'paid' : null;
  if (!status) return null;
  const paidAt = typeof r.paid_at === 'string' ? DAY.exec(r.paid_at) : null;
  const receiptPath = typeof r.receipt === 'string' && RECEIPT_PATH.test(r.receipt) ? r.receipt : null;
  const invoicesUrl = safeHttpsUrl(r.invoices);
  return {
    ref: r.ref,
    day: paidAt ? paidAt[1] : null,
    kind: r.kind,
    plan: r.plan === 'pro' || r.plan === 'editor' ? r.plan : null,
    rail: r.rail,
    credits: wholeNumber(r.credits),
    amount: readAmount(r.amount),
    status,
    keyPrefix: typeof r.key_prefix === 'string' && /^ifk_[0-9a-f]{1,60}$/.test(r.key_prefix) ? r.key_prefix : null,
    receiptPath,
    invoicesUrl: invoicesUrl && invoicesUrl.startsWith(STRIPE_PORTAL_PREFIX) ? invoicesUrl : null,
  };
}

/** La réponse de `GET /v1/account/receipts`. */
export function readReceipts(reply: ApiReply): ReceiptsOutcome {
  if (reply.status === 401) return { kind: 'session_ended' };
  const body = record(reply.body);
  if (reply.status !== 200 || !body || !Array.isArray(body.receipts)) return { kind: 'failed' };
  const rows: ReceiptRow[] = [];
  for (const item of body.receipts) {
    const row = receiptRowFrom(item);
    if (row) rows.push(row);
  }
  return { kind: 'ready', rows };
}

/** La réponse de `GET /v1/account/receipt?ref=…` : un lien vers la page des reçus de Stripe, ou rien. */
export function readReceiptLink(reply: ApiReply): ReceiptLinkOutcome {
  if (reply.status === 401) return { kind: 'session_ended' };
  const body = record(reply.body);
  const url = reply.status === 200 && body ? safeHttpsUrl(body.url) : null;
  return url && url.startsWith(STRIPE_RECEIPT_PREFIX) ? { kind: 'ready', url } : { kind: 'failed' };
}

/**
 * Un montant en unités mineures, sans `Intl` (règle 8 d'AGENTS.md) :
 * 400 et « usd » donnent « 4.00 USD » en anglais, « 4,00 USD » en français et
 * en allemand. Deux décimales : les packs se paient en dollars.
 */
export function formatMinorAmount(amount: { minor: number; currency: string }, locale: string): string {
  return `${formatGrouped(amount.minor / 100, locale, 2)} ${amount.currency.toUpperCase()}`;
}
