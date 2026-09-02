/**
 * Address aliases: "this address IS that customer".
 *
 * A customer writing from a second address used to be invisible (their reply
 * landed in orphan mail at best, nowhere at worst — how the third paying
 * customer's answer was lost). An alias must then be honoured EVERYWHERE the
 * question "have we talked to this person?" is answered, or it manufactures
 * the exact silent false negative it was built to kill: the VPS sync loads
 * this table to widen its known-address net and merge threads, and the write
 * endpoints below normalise as a safety net for any caller that forgot.
 */
import { getStatsDB } from './db.js';

export function ensureAliasTable(): void {
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS email_aliases (
      alias      TEXT PRIMARY KEY,
      canonical  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function listAliases(): Array<{ alias: string; canonical: string; created_at: string }> {
  ensureAliasTable();
  return getStatsDB()
    .prepare('SELECT alias, canonical, created_at FROM email_aliases ORDER BY created_at DESC')
    .all() as Array<{ alias: string; canonical: string; created_at: string }>;
}

export function loadAliasMap(): Map<string, string> {
  return new Map(listAliases().map((r) => [r.alias, r.canonical]));
}

export function toCanonical(email: string, map: Map<string, string>): string {
  const e = email.trim().toLowerCase();
  return map.get(e) ?? e;
}

/**
 * Register one alias. The canonical side is resolved first so chains never
 * form (a → b while b → c would make lookups order-dependent); aliasing an
 * address to itself, or an address that other aliases point AT, is refused.
 */
export function addAlias(
  aliasRaw: string,
  canonicalRaw: string,
): { ok: true } | { ok: false; reason: string } {
  ensureAliasTable();
  const alias = aliasRaw.trim().toLowerCase();
  const map = loadAliasMap();
  const canonical = toCanonical(canonicalRaw, map);
  if (!alias.includes('@') || !canonical.includes('@'))
    return { ok: false, reason: 'adresses invalides' };
  if (alias === canonical) return { ok: false, reason: 'alias identique au canonique' };
  const usedAsCanonical = listAliases().some((r) => r.canonical === alias);
  if (usedAsCanonical)
    return { ok: false, reason: `${alias} est déjà l'adresse canonique d'un autre alias` };
  getStatsDB()
    .prepare(
      `INSERT INTO email_aliases (alias, canonical) VALUES (?, ?)
       ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical`,
    )
    .run(alias, canonical);
  return { ok: true };
}
