import {
  recordQuotaNotice,
  clearQuotaNotice,
  getKeyAgeHours,
  isNoRecredit,
  hasActiveSubscription,
  PRO_MONTHLY_LIMIT,
} from './api-keys.js';
import { sendCreditsWarningEmail, sendQuotaWarningEmail } from './email.js';
import { isUnroutableEmail } from './disposable-domains.js';
import { ensureTopupRef, keyHasPurchase } from './key-purchases.js';
import { getStatsDB } from './db.js';
import { ANONYMOUS_CONTACT, CREDITS_NOTICE_RATIO } from './tiers.js';

/**
 * Placeholders stored in `api_keys.email` when the buyer never gave an address
 * (x402 / Stripe / OEM anonymous paths). Mailing them would bounce.
 *
 * ANONYMOUS_CONTACT rejoint la liste avec le palier sans e-mail. C'est une
 * ceinture et un point d'ancrage nommé, pas une correction : la sentinelle n'a
 * pas d'arobase, donc `isReachable` rendait DÉJÀ false. Ce qui manquait était
 * un endroit où le cas porte son nom, pour qu'un test puisse le citer et qu'un
 * futur lecteur ne se demande pas si le palier anonyme a été oublié ici.
 */
const PLACEHOLDER_CONTACTS = new Set([
  'credits-buyer',
  'stripe-buyer',
  'oem-subscriber',
  ANONYMOUS_CONTACT,
]);

export type QuotaNoticeOutcome =
  | 'sent'
  | 'already_notified'
  | 'no_contact'
  | 'send_failed'
  | 'unroutable_contact'
  | 'flagged_cohort'
  | 'too_new';

/**
 * A key younger than this never gets automated mail. A signup wave with
 * invented addresses (reputable domain, nonexistent mailbox — the pattern no
 * disposable-domain list can catch) crosses the 80% threshold within minutes
 * of creation; a whole afternoon of warnings once bounced off such a wave.
 * A real developer who burns quota on day one loses only the mail, not the
 * signal: every authenticated response carries the X-Quota-* headers.
 */
export const MIN_KEY_AGE_HOURS = 24;

function isReachable(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e.includes('@') && !PLACEHOLDER_CONTACTS.has(e);
}

/** Une adresse à laquelle un mail de service peut partir (ni repère, ni vide). */
export function isReachableContact(email: string | null | undefined): email is string {
  return typeof email === 'string' && isReachable(email);
}

/**
 * Le contact de service d'une clé : son adresse quand elle est joignable, sinon
 * la dernière adresse qu'un PAYEUR a saisie pour elle CHEZ STRIPE (chantier
 * « clé unique », lot B1, ZG8). Cette adresse-là n'est jamais l'identité de la
 * clé : elle ne sert qu'à prévenir la personne qui a payé, par exemple pour un
 * pack rechargé sur une clé anonyme.
 *
 * Jamais l'adresse du corps d'un achat USDC (relecture de sécurité de la
 * PR 259, D6) : personne ne l'a vérifiée, et la retenir laissait le porteur
 * diriger nos mails (préfixe, solde, liens de recharge) vers n'importe qui.
 */
export function serviceContact(keyHash: string, keyEmail: string | undefined): string | null {
  if (isReachableContact(keyEmail)) return keyEmail;
  try {
    const row = getStatsDB()
      .prepare(
        `SELECT p.payer_email FROM key_purchases p
           JOIN api_keys k ON COALESCE(k.lineage_hash, k.key_hash) = p.lineage_hash
          WHERE k.key_hash = ? AND p.payer_email IS NOT NULL
            AND p.rail = 'card'
            AND p.outcome IN ('credited', 'minted', 'minted_fallback')
          ORDER BY p.id DESC LIMIT 1`,
      )
      .get(keyHash) as { payer_email: string } | undefined;
    return isReachableContact(row?.payer_email) ? row.payer_email : null;
  } catch {
    return null;
  }
}

/**
 * `no_recredit` lu comme le drapeau d'une FERME, seulement quand la lignée n'a
 * rien acheté (lot B1). Le drapeau veut aussi dire « accordé une fois contre un
 * paiement » ou « né sous bouclier » ; une clé qui a payé est joignable par
 * définition, et la faire taire serait taire le seul client qui paie.
 */
function isFarmFlagged(keyHash: string): boolean {
  if (!isNoRecredit(keyHash)) return false;
  try {
    return !keyHasPurchase(keyHash);
  } catch {
    return true;
  }
}

/**
 * Warn the key holder once, when their usage first crosses the notice
 * threshold. Called fire-and-forget from the api-key middleware, so it must
 * never throw and never block the response.
 *
 * The lock is claimed BEFORE sending (a client burning 190 calls in 12 minutes
 * would otherwise race and send a dozen mails) and released if the send fails,
 * so a transient SMTP outage does not silently burn the single warning that key
 * gets this month.
 */
export async function maybeSendQuotaWarning(p: {
  keyHash: string;
  email: string;
  keyPrefix: string;
  used: number;
  limit: number;
  month: string;
  /**
   * Le solde de crédits d'une clé mixte (lot B1) : le mail dit alors que les
   * crédits prennent le relais, au lieu de « calls stop until the 1st ».
   */
  creditsRemaining?: number;
}): Promise<QuotaNoticeOutcome> {
  if (!isReachable(p.email)) return 'no_contact';
  // Disposable inboxes and unroutable TLDs: nobody reads them, every send
  // costs sender reputation. Checked before the once-per-month lock so the
  // lock is never burned on an address we would not have mailed anyway.
  if (isUnroutableEmail(p.email)) return 'unroutable_contact';
  // A key the cohort radar has flagged is a farm key: the address on it was
  // invented, and mailing it costs our sending reputation and buys nothing.
  // The domain filter above catches a cohort once it has been relabelled to
  // `@cohorte.invalid`; this catches one that has not been relabelled yet,
  // which is precisely the case the domain filter let through on 19/08.
  // Depuis le lot B1 : sauf si la lignée a acheté (voir isFarmFlagged).
  if (isFarmFlagged(p.keyHash)) return 'flagged_cohort';
  const ageHours = getKeyAgeHours(p.keyHash);
  if (ageHours != null && ageHours < MIN_KEY_AGE_HOURS) return 'too_new';
  if (!recordQuotaNotice(p.keyHash, p.month)) return 'already_notified';

  const sent = await sendQuotaWarningEmail({
    to: p.email,
    used: p.used,
    limit: p.limit,
    month: p.month,
    keyPrefix: p.keyPrefix,
    creditsRemaining: p.creditsRemaining,
    // Les liens de CETTE clé : un pack acheté depuis ce mail la recharge.
    topupRef: ensureTopupRef(p.keyHash),
  });

  if (!sent) {
    clearQuotaNotice(p.keyHash, p.month);
    return 'send_failed';
  }
  return 'sent';
}

/**
 * Le pendant, pour un pack prépayé, de l'avertissement à 80 % : un seul e-mail
 * quand il ne reste plus que 10 % du pack.
 *
 * Pourquoi : l'avertissement mensuel ci-dessus ne couvre que les allocations
 * mensuelles (gratuit, Pro, éditeur). Le porteur d'un pack n'avait rien : le
 * premier signe de l'épuisement était un 402 en production, sur une clé qui
 * peut vivre dans le propre circuit de production d'un client.
 *
 * Un RATIO de ce que contenait le pack, comme le mensuel, pour valoir du pack
 * de 1 000 à celui de 25 000. Arrondi vers le bas : 10 % de 1 000 font 100. Le
 * ratio lui-même est CREDITS_NOTICE_RATIO dans tiers.ts, parce que le mail
 * d'achat l'annonce aussi.
 */

/**
 * Le verrou réutilise `quota_notices` plutôt qu'une table à lui, sous la clé
 * `credits-<cumul acheté>` dans la colonne où l'avertissement mensuel range
 * son mois. Deux conséquences, voulues : aucune migration de schéma ne voyage
 * avec ce changement, et tout lecteur qui prend `quota_notices` pour des mois
 * doit écarter les lignes à ce préfixe (la liste des profils de l'admin le
 * fait, voir `quota_warned_by_key`).
 *
 * Depuis le lot B1, `credits_total` est le CUMUL acheté sur la clé. Pour une
 * clé jamais rechargée il vaut la taille du pack : le verrou d'aujourd'hui,
 * sans second mail pour un pack déjà averti. Chaque recharge change le cumul,
 * donc ouvre un verrou neuf : l'alerte se réarme d'elle-même.
 */
export const CREDITS_NOTICE_LOCK_PREFIX = 'credits-';

export function creditsNoticeLock(total: number): string {
  return `${CREDITS_NOTICE_LOCK_PREFIX}${total}`;
}

/** Le solde auquel ou sous lequel l'avertissement est dû. 0 pour un pack inconnu ou vide. */
export function creditsNoticeThreshold(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(total * CREDITS_NOTICE_RATIO);
}

/**
 * Vrai pour le seul appel qui fait passer le solde d'au-dessus du seuil à ce
 * seuil ou en dessous. Mesuré sur le solde APRÈS un éventuel remboursement :
 * un appel rendu sur un 4xx (avant === après) ne peut jamais être celui qui a
 * franchi. Un seuil à 0 ne déclenche jamais : l'épuisement complet, c'est le
 * travail du 402, pas de cet e-mail.
 */
export function crossesCreditsNotice(before: number, after: number, total: number): boolean {
  const threshold = creditsNoticeThreshold(total);
  if (threshold <= 0) return false;
  return before > threshold && after <= threshold;
}

export type CreditsNoticeOutcome = Exclude<QuotaNoticeOutcome, 'too_new'>;

/**
 * Prévient le porteur d'un pack, une fois par pack. Même contrat que
 * maybeSendQuotaWarning : appelé sans attendre depuis le middleware des clés,
 * ne lève jamais, prend le verrou avant l'envoi et le rend si l'envoi échoue.
 *
 * Une garde n'est volontairement PAS reprise : le délai de 24 heures. Il existe
 * parce qu'une vague d'inscriptions aux adresses inventées franchit 80 % d'une
 * allocation GRATUITE en quelques minutes. Un pack est payé, et l'adresse qu'il
 * porte est celle de l'acheteur ; celui qui consomme 90 % d'un pack le premier
 * jour est justement celui qui a le plus besoin d'être prévenu avant le 402.
 */
export async function maybeSendCreditsWarning(p: {
  keyHash: string;
  email: string;
  keyPrefix: string;
  remaining: number;
  /** Le cumul acheté sur la clé : le verrou. */
  total: number;
  /**
   * Le solde juste après la dernière recharge : l'assiette du seuil et le
   * « sur N » du mail. Absent = le cumul, comme avant le lot B1.
   */
  base?: number;
}): Promise<CreditsNoticeOutcome> {
  // L'adresse de la clé, ou celle de la personne qui a payé pour elle (ZG8).
  const to = serviceContact(p.keyHash, p.email);
  if (!to) return 'no_contact';
  if (isUnroutableEmail(to)) return 'unroutable_contact';
  if (isFarmFlagged(p.keyHash)) return 'flagged_cohort';
  const lock = creditsNoticeLock(p.total);
  if (!recordQuotaNotice(p.keyHash, lock)) return 'already_notified';

  const sent = await sendCreditsWarningEmail({
    to,
    keyPrefix: p.keyPrefix,
    remaining: p.remaining,
    total: p.base ?? p.total,
    proMonthlyLimit: PRO_MONTHLY_LIMIT,
    topupRef: ensureTopupRef(p.keyHash),
    // Lot B2 : Pro se pose sur cette clé ; jamais proposé à une clé qui porte
    // déjà un abonnement vivant.
    offerPro: !hasActiveSubscription(p.keyHash),
  });

  if (!sent) {
    clearQuotaNotice(p.keyHash, lock);
    return 'send_failed';
  }
  return 'sent';
}
