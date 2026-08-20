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

export async function notifyPurchaseTelegram(p: {
  amountUsd: number;
  bundle: string;
  credits: number;
  keyPrefix: string;
  /** Editor/OEM subscription — recurring revenue, worded differently. */
  plan?: 'oem';
  monthlyLimit?: number;
}): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error('[notify] TELEGRAM_BOT_TOKEN/CHAT_ID not set — purchase alert skipped');
    return false;
  }

  // No customer email in the message, on purpose: Telegram is not one of the
  // processors declared in the privacy policy / DPA, so no personal data may
  // transit it. The key prefix + dashboard answer "who" in two taps.
  const text =
    p.plan === 'oem'
      ? `\u{1F389} IBANforge — ABONNEMENT Editor/OEM (MRR !)\n` +
        `Montant : $${p.amountUsd}/mois (${(p.monthlyLimit ?? 0).toLocaleString('en-US')} req/mois)\n` +
        `Clé : ${p.keyPrefix}…\n` +
        `Client : https://ibanforge.com/dashboard/clients`
      : `\u{1F4B0} IBANforge — nouvel achat Stripe\n` +
        `Montant : $${p.amountUsd} (pack ${p.bundle}, ${p.credits.toLocaleString('en-US')} crédits)\n` +
        `Clé : ${p.keyPrefix}…\n` +
        `Client : https://ibanforge.com/dashboard/clients`;

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
