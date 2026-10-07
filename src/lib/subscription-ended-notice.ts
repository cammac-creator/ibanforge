import { sendSubscriptionEndedEmail, type SubscriptionEndedEmailInput } from './email.js';
import { isAddressUnderStop } from './activation-nudge-server.js';

/**
 * Le mail de fin d'abonnement, tel que le webhook Stripe l'envoie.
 *
 * Décision de Claude-Alain du 07.10.2026 (point 8) : le STOP coupe tout sauf
 * les avis légaux et de sécurité. La fin d'un abonnement payé est un avis du
 * service (la clé reste active, voici ce qu'elle a désormais) : il part
 * TOUJOURS, STOP ou non. Ce que le STOP retire, c'est ce qui s'y vend : les
 * liens d'achat des packs et de Pro, et la phrase qui les accompagne.
 *
 * 🚨 Ce module lit la liste des STOP pour RETIRER DES OFFRES, jamais pour taire
 * un envoi : `src/lib/quota-notice.stop.test.ts` le tient par la structure.
 *
 * 🚨 `isAddressUnderStop` répond « sous STOP » quand la liste est illisible.
 * Ici, cela donne un avis sans offres, jamais un avis bloqué : le doute coûte
 * une vente possible, pas l'information due au client.
 */
export async function sendSubscriptionEndedNotice(
  p: Omit<SubscriptionEndedEmailInput, 'offers'> & { to: string },
): Promise<boolean> {
  return sendSubscriptionEndedEmail({ ...p, offers: !isAddressUnderStop(p.to) });
}
