/**
 * The name the owner's purchase alert may carry for a paying key.
 *
 * The alert used to say only "Clé : ifk_…" and the owner could not tell who had
 * paid (his ask of 10/11/2026). It now carries the COMPANY LABEL our own tables
 * hold for the key's address:
 *
 *   1. the company of the prospect row whose contact address is the key's;
 *   2. else the company of the enrichment profile for that address;
 *   3. else the domain of the address, unless it is a public mailbox provider,
 *      a throwaway domain or one that cannot route: those name nobody;
 *   4. else nothing: the alert says so and links to the client record.
 *
 * 🚨 What this does and does not hold. The alert travels through Telegram,
 * which is not one of the sub-processors the Trust page declares, and that
 * page promises customers thirty days' notice before a new one receives
 * personal data. So the key's address never leaves, nor a contact's name
 * (`prospects.contact_name` is never read here), and anything that looks like
 * an address is refused whatever the tables hold. A company label, though, is
 * free text: for a one-person business it can be that person's trading name,
 * and a domain can be a personal one. Nothing here can tell those apart. The
 * owner accepted that residue on 10/11/2026 (his choice "company name", over
 * "link only" and over declaring Telegram first); widening this to an address
 * or a contact name is a different decision, and a legal-text one.
 */

import { GENERIC_EMAIL_DOMAINS, getCompanyProfile } from './company-profiles.js';
import { getStatsDB } from './db.js';
import { emailDomain, isUnroutableEmail } from './disposable-domains.js';
import { PUBLIC_MAILBOX_DOMAINS } from './key-creation-guard.js';

/** Long enough for a company name, short enough for one Telegram line. */
export const OWNER_LABEL_MAX = 80;

/**
 * True when the domain is a mailbox provider's rather than its holder's. Two
 * lists exist in this codebase for two other purposes (what the enrichment
 * radar need not probe, what the key-creation guard counts per address); the
 * alert must not name any domain either of them knows.
 */
export function isPublicMailboxDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return GENERIC_EMAIL_DOMAINS.has(d) || PUBLIC_MAILBOX_DOMAINS.has(d);
}

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

/** The company label behind a signup address, or null when none can be given. */
export function ownerLabelForEmail(email: string | null | undefined): string | null {
  const address = (email ?? '').trim().toLowerCase();
  if (!address.includes('@')) return null;
  try {
    const prospect = getStatsDB()
      .prepare(
        `SELECT company FROM prospects
          WHERE lower(contact_email) = ? AND company IS NOT NULL AND trim(company) <> ''
          ORDER BY id
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
  if (!domain || isPublicMailboxDomain(domain) || isUnroutableEmail(address)) return null;
  return cleanOwnerLabel(domain);
}

/**
 * Same, from the key prefix the alert already carries. Never throws: it runs
 * in the Stripe webhook's response path, after the payment is recorded.
 *
 * `key_prefix` is unique only where db.ts could create its index, that is in
 * a base that held no duplicate at boot; otherwise it logs and goes on without.
 * Should two addresses share a prefix there, naming one of them would be a
 * guess: the alert then names nobody.
 */
export function ownerLabelForKeyPrefix(keyPrefix: string): string | null {
  try {
    const rows = getStatsDB()
      .prepare('SELECT DISTINCT lower(email) AS email FROM api_keys WHERE key_prefix = ? LIMIT 2')
      .all(keyPrefix) as Array<{ email: string }>;
    return rows.length === 1 ? ownerLabelForEmail(rows[0].email) : null;
  } catch {
    return null;
  }
}
