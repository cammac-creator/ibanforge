import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { closeAll, getStatsDB } from '../src/lib/db.js';

/**
 * Audit du 16/09/2026, constat 1 : la politique de confidentialité promet la
 * suppression sur demande, et le script d'oubli tenait sa liste de tables à la
 * main — huit tables portant une adresse lui avaient échappé. Ce test découvre
 * les colonnes d'adresse dans le schéma réel et exige que chaque table soit
 * soit couverte par le script, soit purgée par le temps avec son motif écrit
 * ici. Même patron que frontend/app/api/private-routes-auth.test.ts : découvert,
 * jamais recopié.
 */
const SCRIPT = readFileSync(resolve(__dirname, 'forget-customer.cjs'), 'utf8');

/** Tables purgées par ancienneté : le motif dit où et en combien de temps. */
const PURGED_BY_TIME: Record<string, string> = {
  verification_sends: 'purge après deux jours (src/lib/verification-sends.ts)',
  pending_verifications: 'supprimée à l’expiration du code (src/lib/verification.ts)',
  device_codes: 'TTL du device grant, purge datée (src/routes/device-grant.ts)',
  audit_jobs: 'expires_at, purge des travaux d’audit (src/lib/audit-jobs.ts)',
  account_login_codes:
    'code de connexion au compte, 15 minutes de vie, supprimé à l’expiration (purgeAccountTables, src/lib/account.ts)',
  account_sessions:
    'session de lecture du compte, 7 jours au plus, supprimée un jour après expiration ou révocation (purgeAccountTables, src/lib/account.ts)',
};

/** Colonnes qui portent un mot du lexique sans être une adresse. */
const NOT_AN_ADDRESS = new Set([
  'device_grant_daily.approved_email',
  'device_grant_daily.approved_anonymous',
]);

/** Tables d'adresses qui ne sont pas des personnes : le motif dit pourquoi. */
const NOT_PERSONAL: Record<string, string> = {
  no_reply_senders:
    'adresses d’expéditeurs automatiques (robots, no-reply), apprises pour ne pas y répondre ; aucun client',
};

const LEXIQUE = /(^|_)(email|e_mail|address|sender|contact|counterparty)(_|$)/i;

describe('forget-customer.cjs covers every table that stores an address', () => {
  afterAll(() => closeAll());

  it('every address-bearing table is either forgotten on request or purged by time', () => {
    const db = getStatsDB();
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((t) => t.name);
    const bearing: string[] = [];
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        type: string;
      }[];
      const hits = columns.filter(
        (c) =>
          LEXIQUE.test(c.name) && !/INT/i.test(c.type) && !NOT_AN_ADDRESS.has(`${table}.${c.name}`),
      );
      if (hits.length) bearing.push(table);
    }
    expect(bearing.length).toBeGreaterThan(5);
    const uncovered = bearing.filter(
      (table) =>
        !new RegExp(`FROM ${table}\\b`).test(SCRIPT) &&
        !(table in PURGED_BY_TIME) &&
        !(table in NOT_PERSONAL),
    );
    expect(uncovered, `tables à adresse ni oubliées ni purgées : ${uncovered.join(', ')}`).toEqual(
      [],
    );
  });

  it('the purge-by-time list names only tables that exist', () => {
    const db = getStatsDB();
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      ).map((t) => t.name),
    );
    for (const table of Object.keys(PURGED_BY_TIME)) expect(tables.has(table), table).toBe(true);
  });
});
