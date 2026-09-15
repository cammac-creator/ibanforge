import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, READABLE_FORMATS, exportPaidState, restorePaidState } from './backup.js';
import { claimKey, generateApiKey } from './api-keys.js';
import { recordKeySettlement } from './key-settlements.js';
import { getStatsDB } from './db.js';

/**
 * Les colonnes voyagent seules, les TABLES non (spec 01 §4.13, cas 23 et
 * 23bis). Une restauration qui perdrait key_claims et key_settlements le
 * ferait en silence, le jour où l'on est déjà en train de réparer une panne.
 * Fixtures inventées : ce dépôt est public.
 */
const RUN = Date.now();

describe('sauvegarde du palier de clé', () => {
  it('23. un aller-retour conserve le palier, la preuve, la forme normalisée et les deux journaux', () => {
    const db = getStatsDB();
    const a = generateApiKey(null, undefined, undefined, false, { ipHash: `bk-${RUN}` })!;
    const c = generateApiKey(null, undefined, undefined, false, { ipHash: `bk-${RUN}` })!;
    claimKey(c.key_hash, 'email_code', { email: `bk-${RUN}@alpha.example.net` });
    recordKeySettlement({
      keyHash: a.key_hash,
      keyPrefix: a.key_prefix,
      paymentRef: `bk-ref-${RUN}`,
      route: 'POST /v1/iban/validate',
      quotedAmountUsd: 0.005,
    });
    const dump = exportPaidState('2026-09-15T12:00:00Z');
    expect(dump.format).toBe(BACKUP_FORMAT);
    expect(dump.key_claims!.some((r) => r.key_hash === c.key_hash)).toBe(true);
    expect(dump.key_settlements!.some((r) => r.key_hash === a.key_hash)).toBe(true);

    // Le volume est perdu, pour ces lignes-là.
    for (const h of [a.key_hash, c.key_hash]) {
      db.prepare('DELETE FROM api_keys WHERE key_hash = ?').run(h);
      db.prepare('DELETE FROM key_claims WHERE key_hash = ?').run(h);
      db.prepare('DELETE FROM key_settlements WHERE key_hash = ?').run(h);
    }
    const report = restorePaidState(dump);
    expect(report.keys_inserted).toBeGreaterThanOrEqual(2);
    expect(report.claims_inserted).toBeGreaterThanOrEqual(1);
    expect(report.settlements_inserted).toBeGreaterThanOrEqual(1);

    const back = db
      .prepare('SELECT tier, claimed_at, claim_method, email_norm FROM api_keys WHERE key_hash = ?')
      .get(c.key_hash) as {
      tier: string;
      claimed_at: string;
      claim_method: string;
      email_norm: string;
    };
    expect(back.tier).toBe('claimed');
    expect(back.claimed_at).not.toBeNull();
    expect(back.claim_method).toBe('email_code');
    expect(back.email_norm).toBe(`bk-${RUN}@alpha.example.net`);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM key_settlements WHERE key_hash = ?')
          .get(a.key_hash) as { n: number }
      ).n,
    ).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE key_hash = ? AND event = 'claim'")
          .get(c.key_hash) as { n: number }
      ).n,
    ).toBe(1);
  });

  it('23bis. un dump au format 1, écrit à la main, se restaure sans jeter', () => {
    expect(READABLE_FORMATS).toContain(1);
    const hash = `bk1-hash-${RUN}`;
    const old = {
      format: 1,
      taken_at: '2026-08-21T22:00:00Z',
      counts: { api_keys: 1, api_usage: 1 },
      api_keys: [
        {
          key_hash: hash,
          key_prefix: `ifk_bk1${String(RUN).slice(-5)}`,
          email: 'acme@example.com',
          monthly_limit: 200,
        },
      ],
      api_usage: [{ key_hash: hash, month: '2026-08', count: 3 }],
    };
    const report = restorePaidState(old);
    expect(report.keys_inserted).toBe(1);
    expect(report.usage_inserted).toBe(1);
    expect(report.claims_inserted).toBe(0);
    expect(report.settlements_inserted).toBe(0);
    // Une ligne ancienne prend le DEFAULT 'email', qui est vrai pour elle.
    const row = getStatsDB().prepare('SELECT tier FROM api_keys WHERE key_hash = ?').get(hash) as {
      tier: string;
    };
    expect(row.tier).toBe('email');
  });

  it("23ter. un aller-retour conserve le journal d'annulation du radar, et un dump au format 2 se restaure sans lui", () => {
    expect(READABLE_FORMATS).toContain(2);
    const db = getStatsDB();
    const hash = `bk3-hash-${RUN}`;
    const prefix = `ifk_bk3${String(RUN).slice(-5)}`;
    // Une ligne écrite comme le lot 6 l'écrit : bornes au format SQLite, ancien
    // solde consigné. Sans elle dans le dump, une clé coupée ne se rend plus.
    db.prepare(
      `INSERT INTO key_revocations
         (key_prefix, key_hash, reason, episode_id, anchor, anchor_share, anchor_keys,
          burst_from, burst_to, burst_keys, window_minutes, distinct_sources,
          prev_active, prev_monthly_limit, prev_units_used, prev_no_recredit)
       VALUES (?, ?, 'anon_burst', 'ep-test', 'ua:test-agent/1.0', 0.5, 8,
               '2026-09-15 10:00:00', '2026-09-15 10:00:30', 16, 0.5, 5, 1, 25, 3, 1)`,
    ).run(prefix, hash);

    const dump = exportPaidState('2026-09-15T12:00:00Z');
    expect(dump.format).toBe(3);
    const mine = dump.key_revocations!.filter((r) => r.key_hash === hash);
    expect(mine).toHaveLength(1);
    expect(dump.counts.key_revocations).toBeGreaterThanOrEqual(1);

    // Le journal est perdu, pour cette ligne-là ; le dump la rend, une seule fois.
    db.prepare('DELETE FROM key_revocations WHERE key_hash = ?').run(hash);
    const only = { ...dump, api_keys: [], api_usage: [], key_claims: [], key_settlements: [] };
    const report = restorePaidState({ ...only, key_revocations: mine });
    expect(report.revocations_inserted).toBe(1);
    const again = restorePaidState({ ...only, key_revocations: mine });
    expect(again.revocations_inserted).toBe(0);
    expect(again.revocations_skipped).toBe(1);
    const back = db
      .prepare('SELECT prev_monthly_limit, prev_units_used FROM key_revocations WHERE key_hash = ?')
      .all(hash) as Array<{ prev_monthly_limit: number; prev_units_used: number }>;
    expect(back).toEqual([{ prev_monthly_limit: 25, prev_units_used: 3 }]);

    // Un dump au format 2 (avant le lot 6) n'a pas ce journal : rien à remettre,
    // et ce n'est pas une erreur.
    const f2 = restorePaidState({
      format: 2,
      taken_at: '2026-09-15T00:00:00Z',
      counts: { api_keys: 0, api_usage: 0, key_claims: 0, key_settlements: 0 },
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
    });
    expect(f2.revocations_inserted).toBe(0);
    expect(f2.revocations_skipped).toBe(0);
  });
});
