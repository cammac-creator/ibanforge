/**
 * The third population of the CRM: institutional correspondents.
 *
 * Customers hold a key and prospects are being sold to; neither describes an
 * authority, a central bank, a payment network or a data supplier we WRITE to
 * — reuse permissions, regulatory questions. Their answers arrive from a shared
 * mailbox nobody had ever registered, so the reply to a permission request
 * landed in orphan_mail and waited there for a human to recognise the sender.
 *
 * This registry is the missing half of that recognition: it holds who the
 * address belongs to and which dossier it answers, and the VPS sync reads it at
 * each run to widen its known-address net — the same job the email-aliases list
 * does for a customer's second address.
 *
 * The threads themselves are NOT stored here: they already live in
 * email_messages, attached by lowercase address through `customer_email`.
 */
import { getStatsDB } from './db.js';

export interface InstitutionalContact {
  email: string;
  org: string;
  category: string;
  country: string | null;
  role: string | null;
  website: string | null;
  dossier: string | null;
  created_at: string;
}

export interface InstitutionalContactInput {
  email?: unknown;
  org?: unknown;
  category?: unknown;
  country?: unknown;
  role?: unknown;
  website?: unknown;
  dossier?: unknown;
}

/**
 * Created on demand like the alias table, not in db.ts: this is CRM furniture,
 * and the API must not carry a migration for a table only the admin side reads.
 */
export function ensureInstitutionalTable(): void {
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS institutional_contacts (
      email      TEXT PRIMARY KEY,
      org        TEXT NOT NULL,
      category   TEXT NOT NULL,
      country    TEXT,
      role       TEXT,
      website    TEXT,
      dossier    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const COLUMNS = 'email, org, category, country, role, website, dossier, created_at';

/**
 * Grouped by organisation, because that is how the operator looks for one: an
 * authority answers from several desks, and its addresses must read as a block
 * rather than scattered through the alphabet of the whole registry.
 */
export function listInstitutionalContacts(): InstitutionalContact[] {
  ensureInstitutionalTable();
  return getStatsDB()
    .prepare(`SELECT ${COLUMNS} FROM institutional_contacts ORDER BY org, email`)
    .all() as InstitutionalContact[];
}

/** Trim, drop to NULL when empty, then clip. */
function opt(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Register or update one correspondent, keyed by lowercase address so the row
 * matches `email_messages.customer_email` without a second normalisation step.
 *
 * `category` is free text on purpose — suggested values: autorite,
 * banque_centrale, reseau_paiement, registre, fournisseur, autre. A blocking
 * enum would mean an unforeseen kind of institution cannot be written down at
 * all, which is exactly how a correspondent stays invisible; the prospects'
 * `segment` column is free for the same reason.
 *
 * ⚠️ Optional fields are preserved, never cleared: a second write that carries
 * no country keeps the country already known (COALESCE below), because the
 * common re-write is a partial one — someone correcting the role has no reason
 * to re-type the website. The cost is that a field cannot be emptied through
 * this path; a wrong value is fixed by writing the right one.
 */
export function upsertInstitutionalContact(
  input: InstitutionalContactInput,
): { ok: true; email: string } | { ok: false; reason: string } {
  ensureInstitutionalTable();
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!email.includes('@')) return { ok: false, reason: 'adresse mail invalide' };
  const org = opt(input.org, 120);
  if (!org) return { ok: false, reason: "l'organisation est requise" };
  const category = opt(input.category, 40);
  if (!category) return { ok: false, reason: 'la catégorie est requise' };
  // Validated, never truncated: this column feeds the letter generator as a
  // stated fact. Silently slicing free text minted plausible-but-wrong codes
  // ("Suisse" → "SU", which is not Switzerland), served on the file header
  // and cited in outgoing institutional mail.
  const countryRaw = typeof input.country === 'string' ? input.country.trim() : '';
  if (countryRaw && !/^[a-z]{2}$/i.test(countryRaw)) {
    return { ok: false, reason: 'pays : code ISO à 2 lettres attendu (ex. CH), ou vide' };
  }
  const country = countryRaw.toUpperCase();

  getStatsDB()
    .prepare(
      `INSERT INTO institutional_contacts (email, org, category, country, role, website, dossier)
       VALUES (@email, @org, @category, @country, @role, @website, @dossier)
       ON CONFLICT(email) DO UPDATE SET
         org = excluded.org,
         category = excluded.category,
         country = COALESCE(excluded.country, country),
         role = COALESCE(excluded.role, role),
         website = COALESCE(excluded.website, website),
         dossier = COALESCE(excluded.dossier, dossier)`,
    )
    .run({
      email,
      org,
      category,
      country: country || null,
      role: opt(input.role, 120),
      website: opt(input.website, 200),
      dossier: opt(input.dossier, 500),
    });
  return { ok: true, email };
}

/** False when the address was not in the registry, so a caller can say so. */
export function deleteInstitutionalContact(emailRaw: string): boolean {
  ensureInstitutionalTable();
  const email = emailRaw.trim().toLowerCase();
  return getStatsDB().prepare('DELETE FROM institutional_contacts WHERE email = ?').run(email).changes > 0;
}
