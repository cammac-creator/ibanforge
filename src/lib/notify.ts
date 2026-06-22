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
export async function notifyPurchaseTelegram(p: {
  amountUsd: number;
  bundle: string;
  credits: number;
  email: string | null;
  keyPrefix: string;
}): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error('[notify] TELEGRAM_BOT_TOKEN/CHAT_ID not set — purchase alert skipped');
    return false;
  }

  const text =
    `\u{1F4B0} IBANforge — nouvel achat Stripe\n` +
    `Montant : $${p.amountUsd} (pack ${p.bundle}, ${p.credits.toLocaleString('en-US')} crédits)\n` +
    `Client : ${p.email ?? '(email inconnu)'}\n` +
    `Clé : ${p.keyPrefix}…`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ibanforge-backend', // some WAFs 403 the default node/undici UA
      },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
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
