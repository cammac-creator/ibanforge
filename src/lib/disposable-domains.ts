/**
 * Contact addresses automated mail must never target.
 *
 * Two different failure modes hide behind "fake address", and they need
 * DIFFERENT guards — neither replaces the other:
 *
 *  - DISPOSABLE inboxes (tempmail.*, mailinator…): the inbox exists — a bot
 *    can even complete e-mail verification with it — but nobody will ever
 *    read our mail there. A domain list catches these.
 *  - INVENTED addresses (random-string@gmail.com): the domain is perfectly
 *    reputable, the mailbox does not exist, and every send bounces off the
 *    provider. No domain list can catch those — that is what the key-age
 *    guard in quota-notice is for. (Measured on a real signup wave: a whole
 *    afternoon of quota warnings bounced off invented gmail addresses, and a
 *    disposable list alone would have let nearly every signup of that wave
 *    through.)
 *
 * The list below is a curated starter, not an exhaustive database: public
 * lists run to thousands of domains and rot quickly. Extend it as abuse is
 * observed. Matching is by domain suffix, so mail.tempmail.example is caught
 * by its parent entry.
 */

/** Exact domains (and their subdomains) of known disposable-inbox services. */
const DISPOSABLE_DOMAINS = [
  '10minutemail.com',
  '33mail.com',
  'anonaddy.me',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'harakirimail.com',
  'inboxkitten.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mail-temp.com',
  'mintemail.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempmail.dev',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'tmpmail.net',
  'trash-mail.com',
  'trashmail.com',
  'yopmail.com',
  'yopmail.fr',
];

/**
 * Substrings that only ever appear in throwaway-mail branding. Kept short and
 * unmistakably mail-flavoured so a legitimate company domain cannot trip them
 * (the 2026-08-17 signup wave used tempmail.edu.ge — an .edu.ge suffix no
 * exact list would have carried).
 */
const DISPOSABLE_SUBSTRINGS = ['tempmail', 'temp-mail', 'tmpmail', 'trashmail', '10minutemail', 'guerrillamail', 'mailinator', 'yopmail', 'throwawaymail', 'fakeinbox', 'burnermail'];

/**
 * TLDs that can never resolve on the public internet (RFC 2606 / RFC 6761
 * reserved, plus common internal suffixes). Also what makes `…@cohorte.invalid`
 * a safe label for regrouped abuse cohorts: mail to it cannot even be attempted.
 */
const UNROUTABLE_TLDS = new Set(['invalid', 'test', 'example', 'localhost', 'local', 'internal']);

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/** True when the address points at a known disposable-inbox service. */
export function isDisposableDomain(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return true;
  return DISPOSABLE_SUBSTRINGS.some((s) => domain.includes(s));
}

/**
 * True when automated mail must not be attempted at all: disposable inbox,
 * or a TLD that cannot route (.invalid & co).
 */
export function isUnroutableEmail(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return true;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (UNROUTABLE_TLDS.has(tld)) return true;
  return isDisposableDomain(email);
}
