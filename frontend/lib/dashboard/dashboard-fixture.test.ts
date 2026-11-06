import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardFixture } from '../../tests/dashboard/fixture.mjs';

describe('API fictive isolée de la recette', () => {
  const token = 'jeton-fictif-de-recette';
  let fixture: ReturnType<typeof createDashboardFixture>, base: string;
  beforeEach(async () => {
    fixture = createDashboardFixture({ token, origin: 'http://localhost:12345' });
    await new Promise<void>(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    const address = fixture.server.address();
    if (!address || typeof address === 'string') throw new Error('Port local absent');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => { await fixture.close(); });
  const control = (body: Record<string, unknown>, secret = token) => fetch(base + '/__recipe', {
    method: 'POST', headers: { 'x-recipe-token': secret }, body: JSON.stringify(body),
  });
  const read = (route: string) => fetch(base + route, { headers: { 'x-admin-secret': token, authorization: `Bearer ${token}` } });

  it('ne livre aucune donnée privée sans le jeton temporaire', async () => {
    for (const route of ['/v1/admin/keys', '/stats', '/admin/revenue', '/__recipe']) {
      expect((await fetch(base + route)).status).toBe(403);
    }
    expect((await fetch(base + '/health')).status).toBe(200);
  });
  it('refuse toute méthode métier d’écriture, même authentifiée', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect((await fetch(base + '/v1/admin/email-messages', { method, headers: { 'x-admin-secret': token } })).status).toBe(405);
    }
  });
  it('respecte le jeton Bearer utilisé par le proxy du portefeuille', async () => {
    expect((await fetch(base + '/admin/revenue?balance_only=true', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(base + '/admin/revenue?balance_only=true', { headers: { 'x-admin-secret': token } })).status).toBe(403);
  });
  it('un jeton de commande erroné ne change pas le solde fictif', async () => {
    expect((await control({ wallet: 999 }, 'mauvais-jeton')).status).toBe(403);
    expect((await (await read('/admin/revenue?balance_only=true')).json()).balance_usdc).toBe(7.5);
  });
  it('distingue une panne du solde de celle de l’historique', async () => {
    await control({ wallet: 13.5, walletFailure: 'full' });
    expect((await read('/admin/revenue')).status).toBe(503);
    expect((await (await read('/admin/revenue?balance_only=true')).json()).balance_usdc).toBe(13.5);
    await control({ walletFailure: 'balance' });
    expect((await read('/admin/revenue?balance_only=true')).status).toBe(503);
    expect((await read('/admin/revenue')).status).toBe(200);
  });
  it('réinitialise les données et le journal entre les parcours', async () => {
    await control({ wallet: 99, business: 'unavailable' }); await read('/stats');
    const reset = await (await control({ reset: true })).json();
    expect(reset.requests).toEqual([]); expect(reset.wallet).toBe(7.5); expect(reset.business).toBe('normal');
  });
  it('une lecture retardée conserve sa valeur de départ', async () => {
    await control({ hold: 'balance' });
    const held = read('/admin/revenue?balance_only=true');
    await expect.poll(async () => (await (await control({})).json()).requests.length).toBe(1);
    await control({ wallet: 99, release: true });
    expect((await (await held).json()).balance_usdc).toBe(7.5);
    expect((await (await read('/admin/revenue?balance_only=true')).json()).balance_usdc).toBe(99);
  });
  it('refuse les commandes illisibles ou trop longues', async () => {
    for (const [body, code] of [['{', 400], ['x'.repeat(5000), 413]] as const) {
      expect((await fetch(base + '/__recipe', { method: 'POST', headers: { 'x-recipe-token': token }, body })).status).toBe(code);
    }
  });
  it('ne simule pas silencieusement une source non déclarée', async () => {
    const response = await read('/v1/admin/source-inconnue');
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:12345');
  });
});
