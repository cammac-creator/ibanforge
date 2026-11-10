/**
 * The name the owner's purchase alert may carry for a paying key.
 *
 * The alert used to say only "Clé : ifk_…" and the owner could not tell who had
 * paid (his ask of 10/11/2026). It now names the ORGANISATION behind the key,
 * and never the person:
 *
 *   1. the company of the prospect row whose contact address is the key's;
 *   2. else the company of the enrichment profile for that address;
 *   3. else the domain of the address, when it is the organisation's own
 *      (a public mailbox provider, a throwaway domain or one that cannot
 *      route names nobody);
 *   4. else nothing: the alert says so and links to the client record.
 *
 * 🚨 Why not the address or the buyer's name: the alert travels through
 * Telegram, which is not one of the sub-processors the Trust page declares,
 * and that page promises customers thirty days' notice before a new one
 * receives personal data. A company name or its domain is not personal data;
 * an e-mail address or a person's name is. Anything that looks like an address
 * is therefore refused here, whatever the tables hold.
 */

import { GENERIC_EMAIL_DOMAINS, getCompanyProfile } from './company-profiles.js';
import { getStatsDB } from './db.js';
import { emailDomain, isUnroutableEmail } from './disposable-domains.js';

/** Long enough for a company name, short enough for one Telegram line. */
export const OWNER_LABEL_MAX = 80;

/**
 * One line, no control characters, no address. Returns null when nothing
 * presentable is left.
 */
export function cleanOwnerLabel(raw: string | null | undefined): string | null {
  const flat = (raw ?? '')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat || flat.includes('@')) return null;
  return flat.length > OWNER_LABEL_MAX ? `${flat.slice(0, OWNER_LABEL_MAX - 1)}…` : flat;
}

/** The organisation behind a signup address, or null when none can be named. */
export function ownerLabelForEmail(email: string | null | undefined): string | null {
  const address = (email ?? '').trim().toLowerCase();
  if (!address.includes('@')) return null;
  try {
    const prospect = getStatsDB()
      .prepare(
        `SELECT company FROM prospects
          WHERE lower(contact_email) = ? AND company IS NOT NULL AND trim(company) <> ''
          LIMIT 1`,
      )
      .get(address) as { company: string } | undefined;
    const fromProspect = cleanOwnerLabel(prospect?.company);
    if (fromProspect) return fromProspect;

    const fromProfile = cleanOwnerLabel(getCompanyProfile(address)?.company);
    if (fromProfile) return fromProfile;
  } catch {
    // A missing table or a locked base must not cost the alert: fall through
    // to what the address alone says.
  }
  const domain = emailDomain(address);
  if (!domain || GENERIC_EMAIL_DOMAINS.has(domain) || isUnroutableEmail(address)) return null;
  return cleanOwnerLabel(domain);
}

/**
 * Same, from the key prefix the alert already carries. Never throws: it runs
 * in the Stripe webhook's response path, after the payment is recorded.
 */
export function ownerLabelForKeyPrefix(keyPrefix: string): string | null {
  try {
    const row = getStatsDB()
      .prepare('SELECT email FROM api_keys WHERE key_prefix = ? LIMIT 1')
      .get(keyPrefix) as { email: string } | undefined;
    return ownerLabelForEmail(row?.email);
  } catch {
    return null;
  }
}
