import { recordQuotaNotice, clearQuotaNotice } from './api-keys.js';
import { sendQuotaWarningEmail } from './email.js';

/**
 * Placeholders stored in `api_keys.email` when the buyer never gave an address
 * (x402 / Stripe / OEM anonymous paths). Mailing them would bounce.
 */
const PLACEHOLDER_CONTACTS = new Set(['credits-buyer', 'stripe-buyer', 'oem-subscriber']);

export type QuotaNoticeOutcome = 'sent' | 'already_notified' | 'no_contact' | 'send_failed';

function isReachable(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e.includes('@') && !PLACEHOLDER_CONTACTS.has(e);
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
}): Promise<QuotaNoticeOutcome> {
  if (!isReachable(p.email)) return 'no_contact';
  if (!recordQuotaNotice(p.keyHash, p.month)) return 'already_notified';

  const sent = await sendQuotaWarningEmail({
    to: p.email,
    used: p.used,
    limit: p.limit,
    month: p.month,
    keyPrefix: p.keyPrefix,
  });

  if (!sent) {
    clearQuotaNotice(p.keyHash, p.month);
    return 'send_failed';
  }
  return 'sent';
}
