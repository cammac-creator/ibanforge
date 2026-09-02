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

export type RelayOutcome = 'sent' | 'undeliverable' | 'refused' | 'unreachable' | 'unconfigured';

export interface RelayResult {
  outcome: RelayOutcome;
  status?: number;
  /** The relay's own error text, clipped. It quotes the recipient: never log or serve it. */
  detail?: string;
}

/**
 * What the SMTP server says when the ADDRESS is the problem, as the relay
 * quotes it ("send failed: {'x@y': (550, b'5.1.1 ... no such user')}"): a
 * 5xx recipient code, an enhanced status in the 5.1.x / 5.4.x address
 * classes, or the usual prose. No retry and no alert changes that outcome.
 * Everything else a non-2xx says is ours to fix: a wrong shared secret (401),
 * a relay mailbox left unconfigured (503), an SMTP upstream down (502 with a
 * connection error instead of a recipient code).
 */
const RECIPIENT_REFUSED =
  /recipient|\b55[0-3]\b|\b5\.1\.\d|\b5\.4\.\d|no such user|does not exist|unknown user|user unknown|unrouteable|domain not found|mailbox unavailable|invalid address|no mx\b/i;

export function classifyRelayRefusal(status: number, body: string): RelayOutcome {
  if (status === 502 && RECIPIENT_REFUSED.test(body)) return 'undeliverable';
  return 'refused';
}

export async function deliverViaRelay(mail: RelayMail): Promise<RelayResult> {
  const url = process.env.MAIL_RELAY_URL;
  const secret = process.env.MAIL_RELAY_SECRET;
  if (!url || !secret) {
    console.error('[mail] MAIL_RELAY_URL / MAIL_RELAY_SECRET not set — send skipped');
    return { outcome: 'unconfigured' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': secret },
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 500);
      const outcome = classifyRelayRefusal(res.status, detail);
      // The verdict is logged, never the relay's text: it quotes the address.
      console.error(
        outcome === 'undeliverable'
          ? `[mail] relay reports an undeliverable recipient: HTTP ${res.status}`
          : `[mail] relay refused the message: HTTP ${res.status}`,
      );
      return { outcome, status: res.status, detail };
    }
    return { outcome: 'sent', status: res.status };
  } catch (e) {
    console.error('[mail] relay unreachable', (e as Error).message);
    return { outcome: 'unreachable', detail: (e as Error).message };
  }
}

/** Boolean view for callers that only need "did it leave". */
export async function sendViaRelay(mail: RelayMail): Promise<boolean> {
  return (await deliverViaRelay(mail)).outcome === 'sent';
}
