import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminBusinessPulse } from './admin-business-pulse.js';
const app = new Hono().route('/', adminBusinessPulse);
afterEach(() => vi.unstubAllEnvs());
describe('agrégats de pilotage privés', () => {
  it('refuse toute lecture sans le secret admin et sans configuration', async () => {
    vi.stubEnv('ADMIN_SECRET', 'secret-fictif');
    const refused: HeadersInit[] = [
      {},
      { 'X-Admin-Secret': 'incorrect' },
      { Authorization: 'Bearer secret-fictif' },
    ];
    for (const headers of refused) {
      expect((await app.request('/v1/admin/business-pulse', { headers })).status).toBe(401);
    }
    vi.stubEnv('ADMIN_SECRET', '');
    expect(
      (
        await app.request('/v1/admin/business-pulse', {
          headers: { 'X-Admin-Secret': 'secret-fictif' },
        })
      ).status,
    ).toBe(401);
  });
  it('sert le contrat agrégé sans cache partagé', async () => {
    vi.stubEnv('ADMIN_SECRET', 'secret-fictif');
    const res = await app.request('/v1/admin/business-pulse', {
      headers: { 'X-Admin-Secret': 'secret-fictif' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({
      version: 1,
      timezone: 'UTC',
      basis: 'retained_accounts_and_purchases',
    });
  });
});
