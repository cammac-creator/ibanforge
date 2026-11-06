import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiKeys } from './api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
const EMAIL = 'contact@alpha.example.net';
const NOW = '2026-11-06T12:30:00.000Z';
const headers = { 'X-Admin-Secret': 'secret-fictif-pour-recette' };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubEnv('ADMIN_SECRET', headers['X-Admin-Secret']);
  const db = getStatsDB();
  db.exec('DELETE FROM request_log; DELETE FROM api_keys;');
  db.prepare('INSERT INTO api_keys(key_hash,key_prefix,email) VALUES (?,?,?)').run(
    'fictif',
    'ifk_fictif',
    EMAIL,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(closeAll);
function call(at: string, status = 200) {
  getStatsDB()
    .prepare(
      "INSERT INTO request_log(key_prefix,created_at,status,path,method) VALUES ('ifk_fictif',?,?,'/v1/iban/validate','POST')",
    )
    .run(at, status);
}
describe('Contrat des périodes servi au dashboard', () => {
  it('protège les deux lectures', async () => {
    for (const path of ['/v1/admin/client-hours', '/v1/admin/client-profiles'])
      expect((await apiKeys.request(path)).status).toBe(401);
  });
  it('sert les deux heures partielles, sans traces futures ni anciennes', async () => {
    call('2026-11-05T12:29:59.999Z');
    call('2026-11-05T12:30:00Z', 400);
    call('2026-11-06 00:00:00');
    call('2026-11-06T13:30:00+01:00');
    call('2026-11-06T12:30:00.001Z');
    call('illisible');
    const res = await apiKeys.request(`/v1/admin/client-hours?email=${EMAIL}`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      email: EMAIL,
      timezone: 'UTC',
      generated_at: NOW,
      window_start: '2026-11-05T12:30:00.000Z',
      hours: [
        { hour: '2026-11-05T12:00', count: 1, bad: 1 },
        { hour: '2026-11-06T00:00', count: 1, bad: 0 },
        { hour: '2026-11-06T12:00', count: 1, bad: 0 },
      ],
    });
  });
  it('publie la même horloge et les mêmes bornes que les profils', async () => {
    call('2026-10-07T23:59:59Z');
    call('2026-10-08T00:00:00Z');
    const res = await apiKeys.request('/v1/admin/client-profiles?days=30', { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as {
      generated_at: string;
      window_start: string;
      window_end: string;
      profiles: Record<string, { total: number }>;
    };
    expect(body.generated_at).toBe(NOW);
    expect(body.window_end).toBe(NOW);
    expect(body.window_start).toBe('2026-10-08T00:00:00.000Z');
    expect(body.profiles.ifk_fictif.total).toBe(1);
  });
});
