/**
 * L'avertissement des 10 % d'un pack, à travers le vrai middleware : un pack
 * est consommé appel après appel et l'e-mail doit partir exactement une fois,
 * sur l'appel qui franchit le seuil. L'expéditeur est remplacé par un
 * enregistreur ; tout le reste (débit, remboursement, verrou) est le chemin de
 * production.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; keyPrefix: string; remaining: number; total: number }>,
}));

vi.mock('../lib/email.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/email.js')>();
  return {
    ...mod,
    sendCreditsWarningEmail: vi.fn(
      async (p: { to: string; keyPrefix: string; remaining: number; total: number }) => {
        sent.push({ to: p.to, keyPrefix: p.keyPrefix, remaining: p.remaining, total: p.total });
        return true;
      },
    ),
  };
});

import { Hono } from 'hono';
import { apiKeyMiddleware } from './api-key.js';
import { ibanValidate } from '../routes/iban-validate.js';
import { generateCreditKey, validateApiKey } from '../lib/api-keys.js';
import { closeAll } from '../lib/db.js';
import type { HonoEnv } from '../types.js';

afterAll(() => {
  closeAll();
});

const RUN_ID = Date.now();
const GOOD = { iban: 'CH9300762011623852957' };

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.use('/v1/*', apiKeyMiddleware());
  app.route('/', ibanValidate);
  return app;
}

function call(app: Hono<HonoEnv>, key: string, body: unknown) {
  return app.request('/v1/iban/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

/** L'avertissement part sans être attendu : laisser à sa promesse le temps d'aboutir. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function sentTo(prefix: string) {
  return sent.filter((s) => s.keyPrefix === prefix);
}

describe('the pack warning, through the middleware', () => {
  it('leaves once, on the call that takes a 20-credit pack from 3 to 2', async () => {
    const app = makeApp();
    const k = generateCreditKey(`cn-mw-${RUN_ID}@alpha-corp.example.net`, 20);

    for (let i = 0; i < 17; i++) expect((await call(app, k.api_key, GOOD)).status).toBe(200);
    await settle();
    expect(sentTo(k.key_prefix)).toHaveLength(0);

    const crossing = await call(app, k.api_key, GOOD);
    expect(crossing.headers.get('x-credits-remaining')).toBe('2');
    await vi.waitFor(() => expect(sentTo(k.key_prefix)).toHaveLength(1));
    expect(sentTo(k.key_prefix)[0]).toMatchObject({ remaining: 2, total: 20 });

    await call(app, k.api_key, GOOD);
    await call(app, k.api_key, GOOD);
    await settle();
    expect(sentTo(k.key_prefix)).toHaveLength(1);
  });

  it('a call refunded on a 4xx at the threshold is not the crossing', async () => {
    const app = makeApp();
    const k = generateCreditKey(`cn-refund-${RUN_ID}@alpha-corp.example.net`, 20);

    for (let i = 0; i < 17; i++) await call(app, k.api_key, GOOD);
    const refused = await call(app, k.api_key, {});
    expect(refused.status).toBe(400);
    expect(refused.headers.get('x-credits-remaining')).toBe('3');
    await settle();
    expect(sentTo(k.key_prefix)).toHaveLength(0);

    await call(app, k.api_key, GOOD);
    await vi.waitFor(() => expect(sentTo(k.key_prefix)).toHaveLength(1));
  });

  it('a pack bought without an address is never mailed', async () => {
    const app = makeApp();
    const k = generateCreditKey(null, 20);
    expect(validateApiKey(k.api_key).email).not.toContain('@');

    for (let i = 0; i < 19; i++) await call(app, k.api_key, GOOD);
    await settle();
    expect(sentTo(k.key_prefix)).toHaveLength(0);
  });
});
