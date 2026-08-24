import { recordQuotaNotice, clearQuotaNotice, getKeyAgeHours, isNoRecredit } from './api-keys.js';
import { sendQuotaWarningEmail } from './email.js';
import { isUnroutableEmail } from './disposable-domains.js';

/**
 * Placeholders stored in `api_keys.email` when the buyer never gave an address
 * (x402 / Stripe / OEM anonymous paths). Mailing them would bounce.
 */
const PLACEHOLDER_CONTACTS = new Set(['credits-buyer', 'stripe-buyer', 'oem-subscriber']);

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
  // Disposable inboxes and unroutable TLDs: nobody reads them, every send
  // costs sender reputation. Checked before the once-per-month lock so the
  // lock is never burned on an address we would not have mailed anyway.
  if (isUnroutableEmail(p.email)) return 'unroutable_contact';
  // A key the cohort radar has flagged is a farm key: the address on it was
  // invented, and mailing it costs our sending reputation and buys nothing.
  // The domain filter above catches a cohort once it has been relabelled to
  // `@cohorte.invalid`; this catches one that has not been relabelled yet,
  // which is precisely the case the domain filter let through on 19/08.
  if (isNoRecredit(p.keyHash)) return 'flagged_cohort';
  const ageHours = getKeyAgeHours(p.keyHash);
  if (ageHours != null && ageHours < MIN_KEY_AGE_HOURS) return 'too_new';
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
