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

describe('détail privé des indicateurs', () => {
  it('vérifie le secret avant de lire ou de valider la sélection', async () => {
    vi.stubEnv('ADMIN_SECRET', 'secret-fictif');
    const refused: HeadersInit[] = [
      {},
      { 'X-Admin-Secret': 'incorrect' },
      { Authorization: 'Bearer secret-fictif' },
    ];
    for (const headers of refused) {
      const response = await app.request('/v1/admin/business-accounts?cohort=active_today', {
        headers,
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
    vi.stubEnv('ADMIN_SECRET', '');
    expect(
      (
        await app.request('/v1/admin/business-accounts?cohort=active_today', {
          headers: { 'X-Admin-Secret': 'secret-fictif' },
        })
      ).status,
    ).toBe(401);
  });
  it('refuse les sélections inconnues et les pages non bornées', async () => {
    vi.stubEnv('ADMIN_SECRET', 'secret-fictif');
    for (const query of [
      '',
      'cohort=all',
      'cohort=active_today&page=0',
      'cohort=active_today&page=-1',
      'cohort=active_today&page=1.5',
      'cohort=active_today&page=1e3',
      'cohort=active_today&page=1000000',
    ]) {
      expect(
        (
          await app.request('/v1/admin/business-accounts?' + query, {
            headers: { 'X-Admin-Secret': 'secret-fictif' },
          })
        ).status,
      ).toBe(400);
    }
  });
  it('sert uniquement le détail demandé sans cache partagé', async () => {
    vi.stubEnv('ADMIN_SECRET', 'secret-fictif');
    const response = await app.request('/v1/admin/business-accounts?cohort=active_week', {
      headers: { 'X-Admin-Secret': 'secret-fictif' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      version: 1,
      cohort: 'active_week',
      timezone: 'UTC',
      page_size: 50,
    });
  });
});
