/**
 * Owner notifications via the Tabornio Telegram bot.
 *
 * Used to alert Claude-Alain on Stripe credit-pack purchases. Best-effort:
 * NEVER throws and never blocks the webhook — a failed notification must not
 * 500 a payment webhook. Reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from env.
 *
 * NOTE: this reuses the shared Tabornio Telegram bot on purpose (the owner
 * asked for it). It is deliberately SEPARATE from any email/Resend setup —
 * IBANforge email must not go through openswissdata infrastructure.
 */
/**
 * How long the owner alert may hold the Stripe webhook's response.
 *
 * Exported so a test can assert the bound exists rather than trusting a
 * literal buried in a fetch call.
 */
export const NOTIFY_TIMEOUT_MS = 3_000;

export interface PurchaseAlert {
  amountUsd: number;
  bundle: string;
  credits: number;
  keyPrefix: string;
  /** Subscription (Editor/OEM or Pro) — recurring revenue, worded differently. */
  plan?: 'oem' | 'pro';
  monthlyLimit?: number;
  /**
   * Un pack arrivé sur une clé EXISTANTE par sa référence (lot B1, 25.09.2026) :
   * aucune clé frappée, la même clé rechargée.
   */
  recharge?: boolean;
  /**
   * Un abonnement posé sur une clé EXISTANTE par sa référence (lot B2,
   * 25.09.2026) : aucune clé frappée, la clé du client passe au Pro.
   */
  attached?: boolean;
  /**
   * The organisation behind the key, from `ownerLabelForKeyPrefix`: a company
   * name or its domain, never a person's name or an address (10/11/2026).
   */
  clientLabel?: string | null;
}

/** What the "Client" line says when no organisation can be named. */
export const UNNAMED_CLIENT = 'non identifié (adresse personnelle ou inconnue)';

/** Where the owner opens that client's record straight from the alert. */
export function clientRecordUrl(keyPrefix: string): string {
  return `https://ibanforge.com/dashboard/clients?open=${encodeURIComponent(keyPrefix)}`;
}

/**
 * The text of the alert, apart from its transport so a test can read it.
 *
 * 🚨 No customer address and no person's name in the message, on purpose:
 * Telegram is not one of the sub-processors declared on the Trust page, which
 * promises thirty days' notice before a new one receives personal data. The
 * "Client" line carries the organisation only (company name, else its domain),
 * and a label that looks like an address is dropped here whatever the caller
 * passed. The "Fiche" link opens that client's record in the dashboard, behind
 * the owner's session: it is keyed by the key prefix, which names nobody.
 */
export function purchaseAlertText(p: PurchaseAlert): string {
  const label = (p.clientLabel ?? '').replace(/\s+/g, ' ').trim();
  const client = label && !label.includes('@') ? label : UNNAMED_CLIENT;
  const head = p.plan
    ? `\u{1F389} IBANforge : ABONNEMENT ${p.plan === 'oem' ? 'Editor/OEM' : 'Pro'} (MRR !)` +
      `${p.attached ? ' sur une clé existante' : ''}`
    : p.recharge
      ? `\u{1F504} IBANforge : recharge Stripe (même clé)`
      : `\u{1F4B0} IBANforge : nouvel achat Stripe`;
  const amount = p.plan
    ? `Montant : $${p.amountUsd}/mois (${(p.monthlyLimit ?? 0).toLocaleString('en-US')} req/mois)`
    : p.recharge
      ? `Montant : $${p.amountUsd} (pack ${p.bundle}, +${p.credits.toLocaleString('en-US')} crédits)`
      : `Montant : $${p.amountUsd} (pack ${p.bundle}, ${p.credits.toLocaleString('en-US')} crédits)`;
  return (
    `${head}\n` +
    `Client : ${client}\n` +
    `${amount}\n` +
    `Clé : ${p.keyPrefix}…\n` +
    `Fiche : ${clientRecordUrl(p.keyPrefix)}`
  );
}

export async function notifyPurchaseTelegram(p: PurchaseAlert): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error('[notify] TELEGRAM_BOT_TOKEN/CHAT_ID not set — purchase alert skipped');
    return false;
  }

  const text = purchaseAlertText(p);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ibanforge-backend', // some WAFs 403 the default node/undici UA
      },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      // 🚨 This call sits INSIDE the Stripe webhook's response path, and Stripe
      // gives up on a webhook at ~10 s. Without a bound, undici's ~300 s
      // ceiling applies: Telegram hanging would push the webhook past Stripe's
      // patience, Stripe would retry, and the retry takes the idempotent path —
      // which mints nothing and therefore notifies nothing. The purchase alert
      // would be lost for good, because there is exactly one attempt by
      // construction. 3 s is far below Stripe's limit and far above a healthy
      // Telegram round trip; a notification is worth waiting three seconds for
      // and not one second more.
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[notify] telegram failed', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[notify] telegram error', (e as Error).message);
    return false;
  }
}
