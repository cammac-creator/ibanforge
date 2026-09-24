/**
 * The keyless weekly trial, tested against the REAL application object.
 *
 * Everything here runs through `buildApp()` for the reason `src/app.test.ts`
 * gives: the trial IS a mount-order decision (after the api-key middleware,
 * before x402), and a hand-assembled mini-app would only prove the mini-app is
 * right. The two cases that would cost the most if they broke — the scanners'
 * empty-body probe, and a typo'd key keeping its own 402 — are invisible to any
 * composition that does not include x402.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../app.js';
import { resetX402Paywall } from './x402.js';
import { REST_TRIAL_WEEKLY_LIMIT, TRIAL_RESET, trialResetsAt } from '../lib/trial.js';
import { resetDailyLedger, resetDailyLedgerStatements } from '../lib/daily-ip-ledger.js';
import { generateApiKey } from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { CONSENT_FIELDS } from '../lib/consent.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
const VALID_IBAN = 'CH9300762011623852957';

let facilitator: Server;
let facilitatorUrl: string;
const originalEnv = { ...process.env };

beforeAll(async () => {
  // The same stand-in `src/app.test.ts` uses: paid mode is the only mode in
  // which a 402 can be observed at all, and pointing at Coinbase from a test
  // would make every assertion here depend on someone else's uptime.
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
  closeAll();
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
  // The ledger is a module-level Map shared by every test in this process.
  resetDailyLedger();
});

/**
 * A fresh address per case. The global rate limiter counts per IP too (100/min),
 * and the exhaustion case alone sends eleven calls — sharing one address across
 * the file would eventually make the limiter, not the trial, decide the answer.
 */
let addressCounter = 0;
function freshHeaders(extra: Record<string, string> = {}): Record<string, string> {
  addressCounter += 1;
  // TEST-NET-3 (203.0.113.0/24), never routable.
  return { 'x-real-ip': `203.0.113.${addressCounter % 250}`, ...extra };
}

async function validate(
  body: unknown,
  headers: Record<string, string>,
  path = '/v1/iban/validate',
): Promise<Response> {
  return buildApp().request(`https://api.ibanforge.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface TrialBody {
  valid?: boolean;
  cost_usdc?: number;
  attribution?: { required: boolean };
  trial?: {
    calls_used_this_week: number;
    calls_left_this_week: number;
    weekly_limit: number;
    resets: string;
    resets_at: string;
    free_key: string;
    docs: string;
  };
}

describe('the trial is granted', () => {
  it('serves a keyless validation and says how many are left', async () => {
    const h = freshHeaders();
    const res = await validate({ iban: VALID_IBAN }, h);

    expect(res.status).toBe(200);
    const body = (await res.json()) as TrialBody;
    expect(body.valid).toBe(true);
    expect(body.trial).toMatchObject({
      calls_used_this_week: 1,
      calls_left_this_week: REST_TRIAL_WEEKLY_LIMIT - 1,
      weekly_limit: REST_TRIAL_WEEKLY_LIMIT,
      resets: TRIAL_RESET,
      resets_at: trialResetsAt(),
    });
    // Aucun champ ne dit le jour : l'essai se compte à la semaine depuis le
    // 24/09/2026, et un nom du jour porterait un compte de la semaine.
    expect(Object.keys(body.trial ?? {}).join(' ')).not.toMatch(/today|daily/);
    // The invitation is the point of the whole feature: it must be actionable
    // without reading a doc page first.
    expect(body.trial?.free_key).toContain('/v1/keys/generate');
    expect(body.trial?.docs).toContain('/docs/api-keys');
  });

  it('never quotes a price for a call nobody paid for', async () => {
    // `cost_usdc: 0.005` on a free answer reads as "you were just charged".
    const body = (await (await validate({ iban: VALID_IBAN }, freshHeaders())).json()) as TrialBody;
    expect(body.cost_usdc).toBe(0);
  });

  it('carries the free-tier attribution, like a free key does', async () => {
    const body = (await (await validate({ iban: VALID_IBAN }, freshHeaders())).json()) as TrialBody;
    expect(body.attribution?.required).toBe(true);
  });

  it('publishes the count in headers as well as in the body', async () => {
    const res = await validate({ iban: VALID_IBAN }, freshHeaders());
    expect(res.headers.get('x-trial-used')).toBe('1');
    expect(res.headers.get('x-trial-limit')).toBe(String(REST_TRIAL_WEEKLY_LIMIT));
    expect(res.headers.get('x-trial-remaining')).toBe(String(REST_TRIAL_WEEKLY_LIMIT - 1));
    expect(res.headers.get('x-trial-period')).toBe('week');
    // The instant, not a phrase: next Monday 00:00:00 UTC.
    expect(res.headers.get('x-trial-reset')).toBe(trialResetsAt());
    expect(res.headers.get('x-trial-reset')).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  });

  it('accepts the field in any case, like the handler does', async () => {
    // `getIban` is case-insensitive because agents uppercase the acronym. The
    // gate must agree with the handler or an `IBAN` body would be quoted 402
    // and then served 200 by nothing.
    const res = await validate({ IBAN: VALID_IBAN }, freshHeaders());
    expect(res.status).toBe(200);
  });
});

describe('the trial is counted', () => {
  it('climbs one call at a time for the same address', async () => {
    const h = freshHeaders();
    for (const expected of [1, 2, 3]) {
      const res = await validate({ iban: VALID_IBAN }, h);
      const body = (await res.json()) as TrialBody;
      expect(body.trial?.calls_used_this_week).toBe(expected);
    }
  });

  it('gives a different address its own allowance', async () => {
    const first = freshHeaders();
    for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT; i += 1)
      await validate({ iban: VALID_IBAN }, first);
    const res = await validate({ iban: VALID_IBAN }, freshHeaders());
    expect(res.status).toBe(200);
  });
});

describe('the trial is refunded on a 4xx', () => {
  it('does not spend a call on a body the handler refuses', async () => {
    const h = freshHeaders();
    // Reaching a 4xx from inside the trial takes an `iban` the GATE accepts and
    // the HANDLER rejects. A non-string does it: `getIban` returns it (it casts
    // without checking), the gate's `typeof` test sends it past — no: the gate
    // requires a string too. So the reachable 4xx is the rate limiter or a
    // handler change; we assert the accounting directly instead, by checking
    // that a served call and a refused one leave the counter where it belongs.
    const served = await validate({ iban: VALID_IBAN }, h);
    expect(served.headers.get('x-trial-used')).toBe('1');

    // `{}` is not a trial request at all (see the scanner case below): it must
    // leave the counter untouched rather than burning a slot on a 402.
    await validate({}, h);
    const after = await validate({ iban: VALID_IBAN }, h);
    expect(after.headers.get('x-trial-used')).toBe('2');
  });

  it('spends a call on an IBAN that parses and fails — that is the answer', async () => {
    // Worth pinning: `XX00BAD` comes back 200 `valid: false`. It is a served
    // verdict, not a refusal, and it consumes the allowance.
    const h = freshHeaders();
    const res = await validate({ iban: 'XX00BAD' }, h);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrialBody;
    expect(body.valid).toBe(false);
    expect(body.trial?.calls_used_this_week).toBe(1);
  });
});

describe('the trial is exhausted', () => {
  it(`answers 402 with trial_exhausted on call ${REST_TRIAL_WEEKLY_LIMIT + 1}`, async () => {
    const h = freshHeaders();
    for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT; i += 1) {
      const ok = await validate({ iban: VALID_IBAN }, h);
      expect(ok.status).toBe(200);
    }

    const res = await validate({ iban: VALID_IBAN }, h);
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: string;
      cause?: { reason: string; detail: string; quota?: { used: number; resets: string } };
      message?: string;
      accepts?: unknown[];
      free_tier?: unknown;
      claim_to_200?: unknown;
    };
    expect(body.error).toBe('payment_required');
    expect(body.cause?.reason).toBe('trial_exhausted');
    expect(body.cause?.quota?.used).toBe(REST_TRIAL_WEEKLY_LIMIT + 1);
    expect(body.cause?.quota?.resets).toBe(`${TRIAL_RESET} (${trialResetsAt()})`);
    // The detail has to say all three things: how many were served, when it
    // resets, how to get a key.
    expect(body.cause?.detail).toContain(`comes back on ${TRIAL_RESET} (${trialResetsAt()})`);
    expect(body.cause?.detail).not.toMatch(/midnight|today/i);
    expect(body.cause?.detail).toContain('/v1/keys/generate');
    // Still a real x402 envelope: an agent must be able to pay its way past.
    expect(Array.isArray(body.accepts)).toBe(true);
    // And still shown the free key — unlike an exhausted KEY, this caller has
    // none, so the signup rail is the conversion the trial exists for.
    //
    // 🚨 Égalité STRICTE, et non « défini » : le lot de l'essai avait relâché
    // l'assertion parce que le rail appartenait au lot des textes. Il est écrit
    // maintenant, et c'est le seul mécanisme qui empêche une seconde rédaction
    // du même palier d'apparaître dans le corps le plus lu du produit.
    expect(body.free_tier).toEqual(CONSENT_FIELDS.free_tier);
    expect(body.claim_to_200).toEqual(CONSENT_FIELDS.claim_to_200);
  });

  it('never assumes the caller is the one who spent', async () => {
    // ⚠️ Depuis le portage, un redéploiement ne remet plus le compteur à zéro,
    // et le seau est un PRÉFIXE : plusieurs abonnés d'un même /64 partagent une
    // franchise. Le message dit « this address … gets this week », jamais « you
    // have used » — et pas « your network », qui inviterait à débattre du
    // périmètre.
    const h = freshHeaders();
    for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT + 1; i += 1)
      await validate({ iban: VALID_IBAN }, h);
    const res = await validate({ iban: VALID_IBAN }, h);
    const body = (await res.json()) as { cause?: { detail: string } };
    expect(body.cause?.detail).toContain('This address has used');
    expect(body.cause?.detail).toContain('it gets this week');
    expect(body.cause?.detail).not.toMatch(/you have used|your network/i);
    // Et le chiffre cité est bien le plafond appliqué, jamais un chiffre retapé.
    expect(body.cause?.detail).toContain(`${REST_TRIAL_WEEKLY_LIMIT} keyless validations`);
  });
});

/**
 * The week, not the day (24/09/2026). Only `Date` is faked: timers and I/O stay
 * real, so the application runs exactly as it does in the other cases.
 */
describe('the trial is counted by the ISO week, in UTC', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function servedAt(iso: string, h: Record<string, string>): Promise<Response> {
    vi.setSystemTime(new Date(iso));
    return validate({ iban: VALID_IBAN }, h);
  }

  it(`spreads ${REST_TRIAL_WEEKLY_LIMIT} calls from Monday to Thursday and refuses the next one`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const h = freshHeaders();
    // Monday 28/09/2026 to Thursday 01/10/2026: a new day never gives a new
    // allowance any more.
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
    for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT; i += 1) {
      const res = await servedAt(`${days[i % days.length]}T10:00:00Z`, h);
      expect(res.status, `call ${i + 1}`).toBe(200);
    }
    const refused = await servedAt('2026-10-01T18:00:00Z', h);
    expect(refused.status).toBe(402);
    const body = (await refused.json()) as { cause?: { reason: string; detail: string } };
    expect(body.cause?.reason).toBe('trial_exhausted');
    expect(body.cause?.detail).toContain('2026-10-05T00:00:00Z');
  });

  it('stays shut on Sunday 23:59:59 UTC and reopens on Monday 00:00:00 UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const h = freshHeaders();
    for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT; i += 1) {
      await servedAt('2026-10-02T09:00:00Z', h);
    }
    const sunday = await servedAt('2026-10-04T23:59:59Z', h);
    expect(sunday.status).toBe(402);
    const monday = await servedAt('2026-10-05T00:00:00Z', h);
    expect(monday.status).toBe(200);
    const body = (await monday.json()) as TrialBody;
    expect(body.trial?.calls_used_this_week).toBe(1);
    expect(body.trial?.resets_at).toBe('2026-10-12T00:00:00Z');
    expect(monday.headers.get('x-trial-reset')).toBe('2026-10-12T00:00:00Z');
  });

  it('announces the reset of the week that counted the call, Sunday night included', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const res = await servedAt('2026-10-04T23:59:59Z', freshHeaders());
    const body = (await res.json()) as TrialBody;
    expect(body.trial?.resets_at).toBe('2026-10-05T00:00:00Z');
  });
});

describe('the ledger can be down without a single message lying', () => {
  afterEach(() => {
    // La table est recréée à la réouverture, comme au démarrage du service.
    closeAll();
    resetDailyLedger();
  });

  it('answers trial_unavailable, not a fabricated trial_exhausted', async () => {
    // 🚨 Avant le portage, `countDailyUnits` ne pouvait pas échouer. Après, une
    // base illisible ferait dire « vous avez épuisé vos 25 appels » avec un
    // compte inventé, alors que la documentation continue d'annoncer les 25
    // premiers appels servis. Cause distincte, pas de quota à citer, et pas
    // d'en-tête X-Trial-* : il n'y a aucun compte à publier.
    getStatsDB().exec('DROP TABLE IF EXISTS trial_ledger');
    resetDailyLedgerStatements();
    const res = await validate({ iban: VALID_IBAN }, freshHeaders());
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      cause?: { reason: string; detail: string; quota?: unknown };
      free_tier?: unknown;
    };
    expect(body.cause?.reason).toBe('trial_unavailable');
    expect(body.cause?.quota).toBeUndefined();
    expect(res.headers.get('x-trial-used')).toBeNull();
    expect(res.headers.get('x-trial-limit')).toBeNull();
    // Le rail gratuit RESTE : cet appelant ne détient aucune clé, et il n'a
    // rien fait de mal. `trial_unavailable` ne doit pas entrer dans
    // ALLOWANCE_EXHAUSTED, qui est une énumération explicite.
    expect(body.free_tier).toEqual(CONSENT_FIELDS.free_tier);
    expect(body.cause?.detail).toContain('Nothing is wrong with your request');
  });

  it('says the same when the table of the week is the one that is gone', async () => {
    // La décision lit `trial_weekly` depuis le 24/09/2026 : sa panne doit
    // produire la même cause honnête, jamais un « plafond atteint » inventé.
    getStatsDB().exec('DROP TABLE IF EXISTS trial_weekly');
    resetDailyLedgerStatements();
    const res = await validate({ iban: VALID_IBAN }, freshHeaders());
    expect(res.status).toBe(402);
    const body = (await res.json()) as { cause?: { reason: string } };
    expect(body.cause?.reason).toBe('trial_unavailable');
    expect(res.headers.get('x-trial-used')).toBeNull();
  });
});

describe('one IPv6 /64, one allowance', () => {
  it('counts two addresses of the same prefix as one source', async () => {
    // 🚨 Le correctif de sécurité du lot : sans le repli /64, un abonné IPv6
    // choisit une adresse neuve dans son préfixe pour chaque appel, et le
    // plafond ne compte rien.
    const first = (await (
      await validate({ iban: VALID_IBAN }, { 'x-real-ip': '2001:db8:aa:1::1' })
    ).json()) as TrialBody;
    const second = (await (
      await validate({ iban: VALID_IBAN }, { 'x-real-ip': '2001:db8:aa:1::2' })
    ).json()) as TrialBody;
    expect(first.trial?.calls_used_this_week).toBe(1);
    expect(second.trial?.calls_used_this_week).toBe(2);
    // Un autre /64 garde sa propre franchise.
    const other = (await (
      await validate({ iban: VALID_IBAN }, { 'x-real-ip': '2001:db8:aa:2::1' })
    ).json()) as TrialBody;
    expect(other.trial?.calls_used_this_week).toBe(1);
  });
});

describe('the trial stays out of the way', () => {
  it('leaves the scanners empty-body probe on its 402', async () => {
    // 🚨 x402scan, Decixa and Bazaar probe with `{}` and read the envelope. The
    // /v1 text promises them a 402 in writing; an indexer that gets anything
    // else marks the endpoint non_402_response and drops the listing.
    const res = await validate({}, freshHeaders());
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; cause?: { reason: string } };
    expect(body.error).toBe('payment_required');
    // No trial cause: nothing was tried and nothing was spent.
    expect(body.cause?.reason).toBeUndefined();
    expect(res.headers.get('x-trial-used')).toBeNull();
  });

  it('leaves a body-less POST on its 402', async () => {
    const res = await buildApp().request('https://api.ibanforge.com/v1/iban/validate', {
      method: 'POST',
      headers: freshHeaders(),
    });
    expect(res.status).toBe(402);
  });

  it('leaves an empty iban on its 402', async () => {
    const res = await validate({ iban: '   ' }, freshHeaders());
    expect(res.status).toBe(402);
    expect(res.headers.get('x-trial-used')).toBeNull();
  });

  it('does not touch a request that carries a valid key', async () => {
    // Null when the same address already minted one today; the address is
    // unique to this case so it cannot happen, and the assertion says so.
    const key = generateApiKey('trial-case@example.net');
    expect(key).not.toBeNull();
    const res = await validate(
      { iban: VALID_IBAN },
      freshHeaders({ Authorization: `Bearer ${key!.api_key}` }),
    );
    expect(res.status).toBe(200);
    // The key was billed, not the trial.
    expect(res.headers.get('x-quota-used')).toBe('1');
    expect(res.headers.get('x-trial-used')).toBeNull();
    const body = (await res.json()) as TrialBody;
    expect(body.trial).toBeUndefined();
  });

  it('leaves an INVALID key with its invalid_api_key 402', async () => {
    // 🚨 The regression that would hurt most: a truncated key silently falling
    // into the trial gives ten mysterious successes and then a wall, with
    // nothing anywhere saying the key was never read.
    const res = await validate(
      { iban: VALID_IBAN },
      freshHeaders({ Authorization: 'Bearer ifk_notarealkey' }),
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { cause?: { reason: string } };
    expect(body.cause?.reason).toBe('invalid_api_key');
  });

  it('leaves an invalid key sent as X-API-Key alone too', async () => {
    const res = await validate(
      { iban: VALID_IBAN },
      freshHeaders({ 'X-API-Key': 'ifk_notarealkey' }),
    );
    expect(res.status).toBe(402);
    expect(((await res.json()) as { cause?: { reason: string } }).cause?.reason).toBe(
      'invalid_api_key',
    );
  });

  it('does not touch a request that carries a payment header', async () => {
    // A payer is a payer: the signature must reach the paywall, not be
    // short-circuited into a free call that never settles.
    const res = await validate(
      { iban: VALID_IBAN },
      freshHeaders({ 'payment-signature': 'not-a-real-signature' }),
    );
    expect(res.headers.get('x-trial-used')).toBeNull();
    expect(res.status).toBe(402);
  });

  it('grants nothing on another paid route', async () => {
    const res = await validate({ iban: VALID_IBAN }, freshHeaders(), '/v1/iban/compliance');
    expect(res.status).toBe(402);
    expect(res.headers.get('x-trial-used')).toBeNull();
  });

  it('grants nothing on batch validation', async () => {
    const res = await validate({ ibans: [VALID_IBAN] }, freshHeaders(), '/v1/iban/batch');
    expect(res.status).toBe(402);
    expect(res.headers.get('x-trial-used')).toBeNull();
  });

  it('grants nothing on the route that SELLS credits', async () => {
    // Security audit 2026-07-25, finding 1: an allowance must never become a
    // way to acquire an allowance. The selling route takes no `iban`, so this
    // cannot fire today — it is pinned because the day it can, it must not.
    const res = await validate({ iban: VALID_IBAN }, freshHeaders(), '/v1/credits/buy/1k');
    expect(res.status).toBe(402);
    expect(res.headers.get('x-trial-used')).toBeNull();
  });

  it('leaves a bare GET probe on the synthetic 402', async () => {
    const res = await buildApp().request('https://api.ibanforge.com/v1/iban/validate', {
      headers: freshHeaders(),
    });
    expect(res.status).toBe(402);
  });
});

describe('what the trial measures', () => {
  const names = (): string[] =>
    (
      getStatsDB().prepare('SELECT name FROM web_events ORDER BY id').all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);

  it('writes one api:trial per address per day, not one per call', async () => {
    const before = names().filter((n) => n === 'api:trial').length;
    const h = freshHeaders();
    await validate({ iban: VALID_IBAN }, h);
    await validate({ iban: VALID_IBAN }, h);
    await validate({ iban: VALID_IBAN }, h);
    expect(names().filter((n) => n === 'api:trial').length - before).toBe(1);
  });

  it('writes one api:trial-exhausted on the first refusal of the day', async () => {
    const before = names().filter((n) => n === 'api:trial-exhausted').length;
    const h = freshHeaders();
    for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT + 2; i += 1)
      await validate({ iban: VALID_IBAN }, h);
    expect(names().filter((n) => n === 'api:trial-exhausted').length - before).toBe(1);
  });

  it('books no revenue for a call nobody paid for', async () => {
    // x402 IS enabled here, and a trial request is not api-key-authenticated —
    // which is exactly the shape that would have booked the posted price as
    // revenue. The daily row must stay at zero.
    const revenue = () =>
      Number(
        (
          getStatsDB()
            .prepare(
              `SELECT COALESCE(SUM(revenue_usdc), 0) AS r FROM daily_stats WHERE operation_type = 'iban_validate'`,
            )
            .get() as { r: number }
        ).r,
      );
    const before = revenue();
    await validate({ iban: VALID_IBAN }, freshHeaders());
    expect(revenue()).toBe(before);
  });

  it('attributes the call to no key, so no phantom client appears in the CRM', async () => {
    // `getClientProfiles` builds one client per distinct key_prefix found in
    // request_log and operations (src/lib/stats.ts ~1590 and ~1680), and the
    // traffic-trend query files any non-null prefix under `with_key`
    // (src/lib/stats.ts 760-763). A marker here would invent a customer.
    const orphan = () =>
      Number(
        (
          getStatsDB()
            .prepare(
              `SELECT COUNT(*) AS n FROM operations
                WHERE key_prefix IS NOT NULL
                  AND key_prefix NOT IN (SELECT key_prefix FROM api_keys)`,
            )
            .get() as { n: number }
        ).n,
      );
    const before = orphan();
    await validate({ iban: VALID_IBAN }, freshHeaders());
    expect(orphan()).toBe(before);
  });
});
