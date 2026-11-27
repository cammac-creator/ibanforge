/**
 * Le 402 que reçoit réellement un abonné au plafond de son mois (chantier
 * « compte client et alertes », lot 1, 27.11.2026). Tout passe par `buildApp()`,
 * rail de paiement ARMÉ, comme `account.scope.test.ts` : le corps que le client
 * lit est assemblé par le middleware des clés, `enrich-402.ts` et l'annonce x402,
 * et un essai sur le seul middleware ne prouverait pas ce corps-là.
 *
 * Fixtures inventées (dépôt public) : alpha.example.net.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { resetDailyLedger } from '../lib/daily-ip-ledger.js';
import {
  PRO_MONTHLY_LIMIT,
  checkAndIncrementQuota,
  generateApiKey,
  generateOemKey,
  validateApiKey,
} from '../lib/api-keys.js';
import { FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
const originalEnv = { ...process.env };
let facilitator: Server;
let facilitatorUrl: string;

beforeAll(async () => {
  facilitator = createServer((req, res) => {
    if (req.url === '/supported') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => facilitator.listen(0, '127.0.0.1', resolve));
  facilitatorUrl = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => facilitator.close(() => resolve()));
  process.env = originalEnv;
});

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = facilitatorUrl;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
  resetDailyLedger();
});

const RUN = Date.now();
const VALID_IBAN = 'CH9300762011623852957';

interface Refusal {
  message: string;
  cause: { quota: { resets_at: string; resets: string } };
}

async function refused(raw: string): Promise<{ res: Response; text: string; body: Refusal }> {
  const res = await buildApp().request('https://api.ibanforge.com/v1/iban/validate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${raw}`,
      'x-real-ip': '198.51.100.91',
    },
    body: JSON.stringify({ iban: VALID_IBAN }),
  });
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Refusal };
}

describe('le 402 réel d’une clé au plafond de son mois', () => {
  it('un abonné Pro : jamais « free », la date de remise à zéro dans le corps ET dans l’en-tête', async () => {
    const email = `payer-${RUN}@alpha.example.net`;
    const made = generateOemKey(email, PRO_MONTHLY_LIMIT, `cs_402_${RUN}`, `sub_402_${RUN}`);
    const { keyHash } = validateApiKey(made.api_key!);
    checkAndIncrementQuota(keyHash, PRO_MONTHLY_LIMIT, PRO_MONTHLY_LIMIT);

    const { res, text, body } = await refused(made.api_key!);
    expect(res.status).toBe(402);
    expect(res.headers.get('X-Quota-Exhausted')).toBe('true');
    expect(body.message).toContain('The 10,000 requests of your Pro plan are used up');
    expect(body.message).toContain('HTTP 402');
    expect(body.cause.quota.resets_at).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(res.headers.get('X-Quota-Resets-At')).toBe(body.cause.quota.resets_at);
    expect(body.cause.quota.resets).toBe('1st of month');

    // Aucune phrase du palier gratuit, dans le corps ni dans les en-têtes.
    const everything = `${text}\n${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    for (const forbidden of [/free tier/i, /free requests/i, /until the 1st/i]) {
      expect(everything, String(forbidden)).not.toMatch(forbidden);
    }
    // Ce qui décrit CETTE clé ne dit pas « resets on the 1st » non plus.
    expect(body.message).not.toMatch(/resets on the 1st/i);
    expect(JSON.stringify(body.cause)).not.toMatch(/free/i);
  });

  it('une clé gratuite garde son texte, et reçoit la date elle aussi', async () => {
    const made = generateApiKey(`gratis-${RUN}@alpha.example.net`)!;
    const { keyHash } = validateApiKey(made.api_key);
    checkAndIncrementQuota(keyHash, FREE_TIER_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT);
    const { res, body } = await refused(made.api_key);
    expect(res.status).toBe(402);
    expect(body.message).toContain('Your free tier is exhausted');
    expect(res.headers.get('X-Quota-Resets-At')).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });
});
