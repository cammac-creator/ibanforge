import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { MAX_ADDRESSES, __pendingForTests, __resetPageViewsForTests, flushViews, viewLimit, VIEWS_PER_WINDOW } from '@/lib/page-views';

/**
 * La route du site où le navigateur envoie ses visites : le signal ne quitte pas le site.
 * `fetch` est remplacé et ses appels sont la preuve : rien d'un visiteur ne part vers l'API.
 */
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
const VISITOR_IP = '198.51.100.77';
const outgoing: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  __resetPageViewsForTests();
  outgoing.length = 0;
  vi.stubEnv('API_URL', 'https://api.example.net');
  vi.stubEnv('SITE_ADMIN_TOKEN', 'site-key-for-tests');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    outgoing.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  });
});
afterEach(() => {
  __resetPageViewsForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest('http://site.test/api/pv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': BROWSER, 'X-Real-IP': VISITOR_IP, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}
const view = (page: string, locale = 'en') => ({ page, locale });

describe('POST /api/pv', () => {
  it('compte une visite par gabarit, répond 204 et n appelle pas l API sur le champ', async () => {
    expect((await post(view('/de/blz/37040044', 'de'))).status).toBe(204);
    expect((await post(view('/pricing'))).status).toBe(204);
    expect(__pendingForTests().cells.sort((a, b) => a.page.localeCompare(b.page))).toEqual([
      { page: '/blz/:code', locale: 'de', count: 1 },
      { page: '/pricing', locale: 'en', count: 1 },
    ]);
    expect(outgoing).toHaveLength(0);
  });

  it('range un chemin libre sous un gabarit ou sous autre, jamais tel quel', async () => {
    await post(view('/blz/37040044'));
    await post(view('/un/chemin/libre/IBAN'));
    const pages = __pendingForTests().cells.map((c) => c.page).sort();
    expect(pages).toEqual(['/blz/:code', 'autre']);
  });

  it('écarte DNT, GPC, un robot, un script et une requête sans agent : 204, rien de compté', async () => {
    const skipped: Record<string, string>[] = [
      { DNT: '1' },
      { 'Sec-GPC': '1' },
      { 'User-Agent': 'curl/8.4.0' },
      { 'User-Agent': 'Mozilla/5.0 (compatible; bingbot/2.0)' },
      { 'User-Agent': '' },
    ];
    for (const headers of skipped) {
      expect((await post(view('/pricing'), headers)).status, JSON.stringify(headers)).toBe(204);
    }
    expect(__pendingForTests().total).toBe(0);
  });

  it('refuse un corps mal formé en 400 et ne compte rien', async () => {
    expect((await post('pas du json')).status).toBe(400);
    expect((await post({ page: 'pricing', locale: 'en' })).status).toBe(400);
    expect((await post({ page: '/pricing', locale: 'es' })).status).toBe(400);
    expect((await post('x'.repeat(2000))).status).toBe(413);
    expect(__pendingForTests().total).toBe(0);
  });

  it('limite le débit par adresse', async () => {
    let last = 204;
    for (let i = 0; i < VIEWS_PER_WINDOW + 1; i++) last = (await post(view('/pricing'))).status;
    expect(last).toBe(429);
    expect(__pendingForTests().total).toBe(VIEWS_PER_WINDOW);
  });

  it('rien d identifiant ne part vers l API : ni adresse, ni agent, ni en-tête du visiteur', async () => {
    await post(view('/pricing'), {
      Referer: 'https://elsewhere.example/page',
      Cookie: 'a=b',
      'X-Forwarded-For': '203.0.113.99',
      'Accept-Language': 'fr-CH',
    });
    await flushViews();
    expect(outgoing).toHaveLength(1);
    const { url, init } = outgoing[0]!;
    const everything = JSON.stringify({ url, headers: init.headers, body: init.body });
    for (const secretOfVisitor of [VISITOR_IP, '203.0.113.99', BROWSER, 'Safari', 'elsewhere', 'a=b', 'fr-CH']) {
      expect(everything).not.toContain(secretOfVisitor);
    }
    expect(JSON.parse(String(init.body))).toEqual({ items: [{ page: '/pricing', locale: 'en', count: 1 }] });
  });

  it('ne journalise rien : aucune ligne de console pendant une visite et un envoi', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await post(view('/pricing'), { DNT: '1' });
    await post(view('/pricing'));
    await flushViews();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });

  it('table des adresses pleine : 204, rien de compté, la table ne grossit pas', async () => {
    for (let i = 0; i < MAX_ADDRESSES; i++) viewLimit(`forged-${i}`);
    const before = __pendingForTests().total;
    expect((await post(view('/pricing'), { 'X-Real-IP': 'brand-new-address' })).status).toBe(204);
    expect(__pendingForTests().total).toBe(before);
    // la même adresse nouvelle reste refusée : elle n'a pas été ajoutée à la table
    expect(viewLimit('brand-new-address')).toBe('full');
  });
});
