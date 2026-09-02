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
 */

import { getStatsDB } from './db.js';

export type ProfileSource = 'site' | 'ua' | 'audit' | 'manual' | 'unresolvable';

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
 * The real customer base as prompt context: every activity description we
 * hold for an address that owns an API key — the enriched profiles plus the
 * prospect rows of customers we also approached. Deduplicated, truncated,
 * capped. The CALLER's prompt must forbid naming any of them; this function
 * only states what the customer base does.
 */
export function customerContextLines(limit = 18): string[] {
  ensureTable();
  const db = getStatsDB();
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null): void => {
    const t = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (!t) return;
    const line = t.length > 170 ? `${t.slice(0, 167)}...` : t;
    const key = line.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(line);
  };
  const profiles = db
    .prepare(
      `SELECT what_they_do FROM company_profiles
       WHERE what_they_do IS NOT NULL AND TRIM(what_they_do) != '' AND source != 'unresolvable'
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{ what_they_do: string }>;
  for (const r of profiles) push(r.what_they_do);
  // Prospect descriptions count only when the address actually holds a key:
  // the context is "who USES the product", not "who we once approached".
  const prospectRows = db
    .prepare(
      `SELECT p.what_they_do FROM prospects p
       WHERE p.what_they_do IS NOT NULL AND TRIM(p.what_they_do) != ''
         AND p.contact_email IS NOT NULL
         AND EXISTS (SELECT 1 FROM api_keys k WHERE lower(k.email) = lower(p.contact_email))
       ORDER BY p.updated_at DESC`,
    )
    .all() as Array<{ what_they_do: string }>;
  for (const r of prospectRows) push(r.what_they_do);
  return out.slice(0, limit);
}

/**
 * The context block both draft generators append to their user prompt. Empty
 * string when nothing is known yet, so prompts stay clean on a fresh install.
 */
export function customerContextBlock(): string {
  const lines = customerContextLines();
  if (lines.length === 0) return '';
  return `\n\nWHO ACTUALLY USES THE PRODUCT (background context ONLY — never mention, name, quote or hint at any of these organisations in your output):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}
