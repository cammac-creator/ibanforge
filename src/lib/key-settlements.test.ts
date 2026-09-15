import { describe, expect, it } from 'vitest';
import { generateApiKey, getKeyTier, rotateApiKey } from './api-keys.js';
import { CLAIM_MIN_PAID_USD } from './tiers.js';
import {
  claimIfPaidEnough,
  paidSoFarUsd,
  recordKeySettlement,
  settleAndMaybeClaim,
} from './key-settlements.js';
import { getStatsDB } from './db.js';

/** Fixtures inventées : ce dépôt est public. */
const RUN = Date.now();
let n = 0;

function anon() {
  const k = generateApiKey(null, undefined, undefined, false, {
    ipHash: `settle-${RUN}`,
    userAgent: 'demo-http-client/1.0',
  });
  if (!k) throw new Error('mint failed');
  return k;
}

function settle(keyHash: string, keyPrefix: string, usd: number): boolean {
  n += 1;
  return recordKeySettlement({
    keyHash,
    keyPrefix,
    paymentRef: `ref-${RUN}-${n}`,
    route: 'POST /v1/iban/validate',
    quotedAmountUsd: usd,
  });
}

describe('règlements et promotion par paiement', () => {
  it('deux règlements de 0,005 $ ne promeuvent pas ; le seuil promeut une fois ; au-delà rien ne rejoue', () => {
    const k = anon();
    settle(k.key_hash, k.key_prefix, 0.005);
    settle(k.key_hash, k.key_prefix, 0.005);
    expect(claimIfPaidEnough(k.key_hash, 'x402')).toBe(false);
    expect(getKeyTier(k.key_hash)!.tier).toBe('anonymous');
    settle(k.key_hash, k.key_prefix, CLAIM_MIN_PAID_USD);
    expect(paidSoFarUsd(k.key_hash)).toBeGreaterThanOrEqual(CLAIM_MIN_PAID_USD);
    expect(claimIfPaidEnough(k.key_hash, 'x402')).toBe(true);
    const row = getKeyTier(k.key_hash)!;
    expect(row.tier).toBe('paid');
    expect(row.claim_method).toBe('x402');
    // 200 UNE FOIS : la clé sort du reset mensuel.
    expect(row.no_recredit).toBe(1);
    expect(row.claimed_at).not.toBeNull();
    const at = row.claimed_at;
    settle(k.key_hash, k.key_prefix, 5);
    expect(claimIfPaidEnough(k.key_hash, 'x402')).toBe(false);
    expect(getKeyTier(k.key_hash)!.claimed_at).toBe(at);
  });

  it('le même payment_ref écrit deux fois n’ajoute qu’une ligne', () => {
    const k = anon();
    const ref = `ref-dup-${RUN}`;
    const first = recordKeySettlement({
      keyHash: k.key_hash,
      keyPrefix: k.key_prefix,
      paymentRef: ref,
      route: 'POST /v1/iban/validate',
      quotedAmountUsd: 0.005,
    });
    const second = recordKeySettlement({
      keyHash: k.key_hash,
      keyPrefix: k.key_prefix,
      paymentRef: ref,
      route: 'POST /v1/iban/validate',
      quotedAmountUsd: 0.005,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(paidSoFarUsd(k.key_hash)).toBeCloseTo(0.005, 6);
  });

  it('une cotation inconnue n’écrit AUCUNE ligne, jamais une ligne à zéro', () => {
    const k = anon();
    expect(
      recordKeySettlement({
        keyHash: k.key_hash,
        keyPrefix: k.key_prefix,
        paymentRef: `ref-zero-${RUN}`,
        route: 'POST /v1/iban/validate',
        quotedAmountUsd: 0,
      }),
    ).toBe(false);
    expect(paidSoFarUsd(k.key_hash)).toBe(0);
    // La référence reste libre : une écriture correcte ultérieure passe.
    expect(
      recordKeySettlement({
        keyHash: k.key_hash,
        keyPrefix: k.key_prefix,
        paymentRef: `ref-zero-${RUN}`,
        route: 'POST /v1/iban/validate',
        quotedAmountUsd: 0.005,
      }),
    ).toBe(true);
  });

  it('rejeu de la ferme, volet argent : 164 clés à 0,002 $ chacune, zéro promotion', () => {
    const keys = Array.from({ length: 164 }, () => anon());
    for (const k of keys) settle(k.key_hash, k.key_prefix, 0.002);
    for (const k of keys) expect(claimIfPaidEnough(k.key_hash, 'x402')).toBe(false);
    const promoted = (
      getStatsDB()
        .prepare(
          "SELECT COUNT(*) AS n FROM api_keys WHERE tier = 'paid' AND claimed_at IS NOT NULL AND key_prefix IN (" +
            keys.map(() => '?').join(',') +
            ')',
        )
        .get(...keys.map((k) => k.key_prefix)) as { n: number }
    ).n;
    expect(promoted).toBe(0);
  });

  it('l’écriture et la promotion tiennent dans une transaction, et la rotation garde le cumul', () => {
    const k = anon();
    const r = settleAndMaybeClaim({
      keyHash: k.key_hash,
      keyPrefix: k.key_prefix,
      paymentRef: `ref-tx-${RUN}`,
      route: 'POST /v1/iban/validate',
      quotedAmountUsd: CLAIM_MIN_PAID_USD,
      method: 'x402',
    });
    expect(r).toEqual({ recorded: true, claimed: true });
    // Une clé tournée emporte ses règlements : elle ne rachète pas la promotion.
    const k2 = anon();
    settle(k2.key_hash, k2.key_prefix, 0.5);
    const rotated = rotateApiKey(k2.api_key)!;
    expect(paidSoFarUsd(rotated.key_hash)).toBeCloseTo(0.5, 6);
    expect(paidSoFarUsd(k2.key_hash)).toBe(0);
  });
});
