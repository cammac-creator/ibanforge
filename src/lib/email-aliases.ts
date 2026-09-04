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

/**
 * Undo « cette adresse EST ce client ».
 *
 * An alias had no way back since it was born, and the cost of a wrong one is
 * not one misfiled mail: the whole mailbox is re-ingested every night through
 * the alias map, so a wrong « ils ne font qu'un » pulls months of the alias
 * address's history into the canonical thread at the next sync (two of them
 * did exactly that on 2026-09-03, both accepted from the pre-selected
 * suggestion). Removing the alias gives those rows back: the inbound rows
 * filed under the canonical address that actually CAME FROM the alias address
 * — that is what `counterparty` records — return to the alias address's own
 * thread. Outbound rows stay where they were written: a mail we sent to the
 * canonical address is a fact about the canonical address, whatever the alias
 * list said at the time.
 */
export function removeAlias(
  aliasRaw: string,
): { ok: true; canonical: string; refiled: number } | { ok: false; reason: string } {
  ensureAliasTable();
  const alias = aliasRaw.trim().toLowerCase();
  const db = getStatsDB();
  const row = db.prepare('SELECT canonical FROM email_aliases WHERE alias = ?').get(alias) as
    { canonical: string } | undefined;
  if (!row) return { ok: false, reason: 'alias inconnu' };
  const refiled = db.transaction(() => {
    const { changes } = db
      .prepare(
        `UPDATE email_messages SET customer_email = ?
         WHERE customer_email = ? AND direction = 'in' AND lower(counterparty) = ?`,
      )
      .run(alias, row.canonical, alias);
    db.prepare('DELETE FROM email_aliases WHERE alias = ?').run(alias);
    return changes;
  })();
  return { ok: true, canonical: row.canonical, refiled };
}
