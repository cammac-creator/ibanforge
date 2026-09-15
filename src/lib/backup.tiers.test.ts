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
});
