/**
 * Le rayon du radar de cohortes ne touche jamais une clé qui a acheté
 * (chantier « clé unique », lot B1, 25.09.2026 ; CGU §6(e) : la révocation ne
 * vise que les clés qui n'ont été ni réclamées ni créditées d'achats).
 *
 * La recharge d'une clé anonyme la fait déjà quitter le palier anonyme, seul
 * que le rayon touche. Ce fichier tient la ceinture : une lignée qui a UN achat
 * inscrit au registre, même en attente de règlement, n'est jamais coupée.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { generateApiKey } from './api-keys.js';
import { revokeForBurst, type BurstRevocationInput } from './key-revocations.js';
import { closeAll, getStatsDB } from './db.js';

afterAll(() => closeAll());

const RUN = Date.now();

function sqliteUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function input(k: { key_hash: string; key_prefix: string }): BurstRevocationInput {
  return {
    keyHash: k.key_hash,
    keyPrefix: k.key_prefix,
    originPrefix: null,
    episodeId: `ep-purchase-${RUN}`,
    anchor: `ua:purchase-${RUN}/1.0`,
    anchorShare: 1,
    anchorKeys: 1,
    burstFrom: sqliteUtc(RUN - 60_000),
    burstTo: sqliteUtc(RUN + 60_000),
    burstKeys: 1,
    windowMinutes: 0.5,
    distinctSources: 5,
  };
}

describe('le rayon et le registre des achats', () => {
  it('le rayon ne touche jamais une clé qui a acheté, même en attente de règlement', () => {
    // Une clé anonyme nue tombe : le rayon fonctionne.
    const plain = generateApiKey(null)!;
    expect(revokeForBurst(input(plain))).toBe(true);

    // La même clé, avec un achat USDC encore en attente au registre (la ligne
    // s'ouvre avant le règlement) : jamais coupée.
    const buyer = generateApiKey(null)!;
    getStatsDB()
      .prepare(
        `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix, credits)
         VALUES (?, 'usdc', 'pack', 'pending', ?, ?, ?, 1000)`,
      )
      .run(`x402:${RUN.toString(16)}purchase`, buyer.key_hash, buyer.key_hash, buyer.key_prefix);
    expect(revokeForBurst(input(buyer))).toBe(false);
    const row = getStatsDB()
      .prepare('SELECT active FROM api_keys WHERE key_hash = ?')
      .get(buyer.key_hash) as { active: number };
    expect(row.active).toBe(1);
  });
});
