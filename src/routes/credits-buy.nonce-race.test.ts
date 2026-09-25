/**
 * D3 de la relecture de sécurité de la PR 259 : une ligne `failed` au registre
 * (aucun argent n'a bougé) ne doit jamais soustraire une clé anonyme au rayon
 * du radar de cohortes.
 *
 * Le scénario : UN paiement signé, envoyé en parallèle sous trois encodages de
 * l'en-tête (la référence de règlement est le condensé de l'en-tête, pas de
 * l'autorisation) sur trois clés anonymes. Toutes les requêtes vérifient avant
 * le premier règlement ; une seule se règle sur la chaîne, les deux autres
 * reçoivent un refus propre (`nonce_already_used`) et finissent `failed`. Le
 * faux facilitateur suit les nonces comme la chaîne.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { generateApiKey } from '../lib/api-keys.js';
import { revokeForBurst, type BurstRevocationInput } from '../lib/key-revocations.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  encodePayment,
  paymentFor,
  startFakeFacilitator,
  type FakeFacilitator,
} from '../test-support/fake-facilitator.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
const RUN = Date.now();
let facilitator: FakeFacilitator;
const originalEnv = { ...process.env };
let ip = 0;

beforeAll(async () => {
  facilitator = await startFakeFacilitator();
});

afterAll(async () => {
  await facilitator.close();
  process.env = originalEnv;
  closeAll();
});

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = facilitator.url;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  delete process.env.X402_SETTLE_TIMEOUT_MS;
  resetX402Paywall();
  facilitator.trackNonces = true;
  facilitator.verifyDelayMs = 30;
});

afterEach(() => resetX402Paywall());

async function send(path: string, headers: Record<string, string> = {}): Promise<Response> {
  ip += 1;
  return buildApp().request(`https://api.ibanforge.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-real-ip': `198.51.100.${(ip % 250) + 1}`,
      ...headers,
    },
    body: '{}',
  });
}

function sqliteUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function radius(k: { key_hash: string; key_prefix: string }): BurstRevocationInput {
  return {
    keyHash: k.key_hash,
    keyPrefix: k.key_prefix,
    originPrefix: null,
    episodeId: `ep-nonce-race-${RUN}`,
    anchor: `ua:nonce-race-${RUN}/1.0`,
    anchorShare: 1,
    anchorKeys: 1,
    burstFrom: sqliteUtc(RUN - 60_000),
    burstTo: sqliteUtc(RUN + 60_000),
    burstKeys: 1,
    windowMinutes: 0.5,
    distinctSources: 5,
  };
}

describe('D3 : un seul paiement ne soustrait aucune clé anonyme au rayon', () => {
  it('trois encodages en parallèle : un règlement, deux refus propres, et les perdants restent dans le rayon', async () => {
    const first = await send('/v1/credits/buy/1k');
    expect(first.status).toBe(402);
    const accepts = ((await first.json()) as { accepts: Array<Record<string, unknown>> })
      .accepts[0];
    const payment = paymentFor(accepts);
    const variants = [encodePayment(payment), encodePayment(payment, 1), encodePayment(payment, 2)];
    expect(new Set(variants).size).toBe(3);

    const keys = [generateApiKey(null)!, generateApiKey(null)!, generateApiKey(null)!];
    const control = generateApiKey(null)!;
    const answers = await Promise.all(
      keys.map((k, i) =>
        send('/v1/credits/buy/1k', {
          Authorization: `Bearer ${k.api_key}`,
          'payment-signature': variants[i],
        }),
      ),
    );
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses).toEqual([201, 402, 402]);
    expect(facilitator.settledNonces.size).toBe(1);

    const outcomes = keys.map(
      (k) =>
        (
          getStatsDB()
            .prepare('SELECT outcome FROM key_purchases WHERE key_hash = ?')
            .get(k.key_hash) as { outcome: string }
        ).outcome,
    );
    // Les perdants ont reçu un refus PROPRE (nonce déjà utilisé, rien de
    // diffusé) : ils finissent en échec, jamais en attente.
    expect(outcomes.filter((o) => o === 'credited')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'failed')).toHaveLength(2);

    // Le rayon coupe une clé anonyme sans achat...
    expect(revokeForBurst(radius(control))).toBe(true);
    // ...et aussi les perdants : une ligne `failed` n'est pas un achat.
    const losers = keys.filter((k, i) => outcomes[i] === 'failed');
    for (const k of losers) {
      const r = getStatsDB()
        .prepare('SELECT tier, active FROM api_keys WHERE key_hash = ?')
        .get(k.key_hash) as { tier: string; active: number };
      expect(r).toEqual({ tier: 'anonymous', active: 1 });
      expect(revokeForBurst(radius(k))).toBe(true);
    }
  });
});
