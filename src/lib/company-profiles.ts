/**
 * Who our customers actually are: one row per signup address, carrying the
 * company, website and a one-sentence activity description ("what they do").
 *
 * The prospects table only knows people WE approached; customers who signed
 * up on their own had no profile anywhere, which is why half the Clients tab
 * showed a bare domain (ask of 19/08/2026). This table is the missing half:
 * filled by the enrichment radar (own-domain site probe, or the URL a polite
 * User-Agent advertises), seeded from the 19/08 activity audit, and joined
 * into the dossiers as a fallback behind the richer prospect rows.
 *
 * No profile reaches a prompt (13 November 2026). The validated descriptions
 * used to be appended, as background, to the prompts of the two draft
 * generators (prospecting mail, forum reply). The operator had that removed,
 * so that the DPA's sentence on customer data ("does not use Controller data
 * to ... build marketing profiles") holds to the letter. The table now serves
 * the operator's own view of his customers;
 * `draft-prompts-customer-free.test.ts` holds the prompts to that.
 */

import { getStatsDB } from './db.js';

/**
 * Where a profile comes from. `unspecified` (11 November 2026): posted to
 * POST /v1/admin/company-profiles without a known source. Its origin is
 * unknown, so it is never treated as validated: it stays "to validate" until a
 * person re-posts it as `manual`.
 */
export type ProfileSource = 'site' | 'ua' | 'audit' | 'manual' | 'unresolvable' | 'unspecified';

export interface CompanyProfile {
  email: string;
  company: string | null;
  website: string | null;
  country: string | null;
  what_they_do: string | null;
  source: ProfileSource;
  enriched_at: string;
}

let ensured = false;
function ensureTable(): void {
  if (ensured) return;
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS company_profiles (
      email         TEXT PRIMARY KEY,
      company       TEXT,
      website       TEXT,
      country       TEXT,
      what_they_do  TEXT,
      source        TEXT NOT NULL DEFAULT 'manual',
      enriched_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensured = true;
}

/** Upsert one profile. Empty strings are stored as NULL; the email is the key. */
export function upsertCompanyProfile(p: {
  email: string;
  company?: string | null;
  website?: string | null;
  country?: string | null;
  whatTheyDo?: string | null;
  source: ProfileSource;
}): void {
  ensureTable();
  const nn = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t ? t : null;
  };
  getStatsDB()
    .prepare(
      `INSERT INTO company_profiles (email, company, website, country, what_they_do, source, enriched_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         company = excluded.company, website = excluded.website, country = excluded.country,
         what_they_do = excluded.what_they_do, source = excluded.source, updated_at = excluded.updated_at`,
    )
    .run(
      p.email.toLowerCase(),
      nn(p.company),
      nn(p.website),
      nn(p.country),
      nn(p.whatTheyDo),
      p.source,
    );
}

export function getCompanyProfiles(): Record<string, CompanyProfile> {
  ensureTable();
  const rows = getStatsDB()
    .prepare(
      'SELECT email, company, website, country, what_they_do, source, enriched_at FROM company_profiles',
    )
    .all() as CompanyProfile[];
  return Object.fromEntries(rows.map((r) => [r.email, r]));
}

/** One profile by signup address, or null. The address is matched lowercased. */
export function getCompanyProfile(email: string): CompanyProfile | null {
  ensureTable();
  const row = getStatsDB()
    .prepare(
      'SELECT email, company, website, country, what_they_do, source, enriched_at FROM company_profiles WHERE email = ?',
    )
    .get(email.toLowerCase()) as CompanyProfile | undefined;
  return row ?? null;
}

/**
 * Signup domains that identify a person's inbox provider, never their
 * organisation — nothing there to probe.
 */
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'passinbox.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.co.uk',
  'qq.com',
  '163.com',
  '126.com',
  'foxmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'gmx.de',
  'gmx.ch',
  'gmx.net',
  'gmx.at',
  'web.de',
  'mail.ru',
  'yandex.ru',
  'yandex.com',
  'bluewin.ch',
  'tutanota.com',
  'tuta.io',
  'aol.com',
  'hey.com',
  'duck.com',
  'fastmail.com',
  'zoho.com',
  'mailbox.org',
  'posteo.de',
  'mailfence.com',
]);

/**
 * The website a polite client advertises inside its own User-Agent —
 * "AlphaCare/7.0.3 (+https://care.alpha.example.net)" names the company
 * behind a signup whose gmail address said nothing. The `+URL` convention
 * is the crawler-politeness idiom.
 */
export function uaWebsite(ua: string): string | null {
  const m = /\+(https?:\/\/[^\s;)]+)/.exec(ua);
  return m ? m[1].replace(/[.,]$/, '') : null;
}

/**
 * The profile sources a person has vouched for: typed by the operator
 * (`manual`) or written by the 19/08 activity audit (`audit`).
 *
 * `site` and `ua` are written by the enrichment radar from a page whose
 * address a stranger chose (the domain of a signup address, or a `+URL` in a
 * User-Agent), summarised by a model. That text stays in the table and on the
 * Clients tab, where a person can read it, flagged "to validate"; validating
 * it means re-posting the row as `manual` (POST /v1/admin/company-profiles).
 * Validated or not, no profile is handed to a model (see the file header).
 */
export const VALIDATED_PROFILE_SOURCES: readonly ProfileSource[] = ['manual', 'audit'];
