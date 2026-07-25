/**
 * Outbound mail transport.
 *
 * NOT SMTP. Railway blocks outbound SMTP ports below its Pro plan — measured
 * 2026-07-25 from inside this production container: 25, 465 and 587 all
 * ETIMEDOUT, to Infomaniak *and* to Gmail, while HTTPS/443 connected in 33ms.
 * Every `nodemailer` send this service ever attempted was therefore dead on
 * arrival, including the post-purchase key delivery.
 *
 * Mail now leaves over HTTPS through the relay on the tabornio VPS
 * (POST /api/relay/send), which has SMTP open and holds the @ibanforge.com
 * mailbox credentials. That keeps Infomaniak as the only email sub-processor,
 * exactly as the published DPA states.
 *
 * Fail-soft by contract: no configuration and no reachable relay both return
 * false. Callers treat mail as a safety net beside the success page and the
 * Telegram alert, never as the critical path.
 */

/** Hard ceiling on the wait. The Stripe webhook awaits delivery and Stripe gives up at ~10s. */
const RELAY_TIMEOUT_MS = 6_000;

export interface RelayMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function isRelayConfigured(): boolean {
  return Boolean(process.env.MAIL_RELAY_URL && process.env.MAIL_RELAY_SECRET);
}

export async function sendViaRelay(mail: RelayMail): Promise<boolean> {
  const url = process.env.MAIL_RELAY_URL;
  const secret = process.env.MAIL_RELAY_SECRET;
  if (!url || !secret) {
    console.error('[mail] MAIL_RELAY_URL / MAIL_RELAY_SECRET not set — send skipped');
    return false;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': secret },
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[mail] relay refused the message: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[mail] relay unreachable', (e as Error).message);
    return false;
  }
}
