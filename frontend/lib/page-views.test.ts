import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLUSH_MS,
  MAX_PENDING,
  OTHER_PAGE,
  PAGE_TEMPLATES,
  VIEWS_PER_WINDOW,
  __pendingForTests,
  __resetPageViewsForTests,
  countView,
  flushViews,
  pageTemplate,
  parseView,
  shouldSkipView,
  MAX_ADDRESSES,
  viewLimit,
} from './page-views';

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

beforeEach(() => {
  __resetPageViewsForTests();
  vi.stubEnv('API_URL', 'https://api.example.net');
  vi.stubEnv('SITE_ADMIN_TOKEN', 'site-key-for-tests');
});
afterEach(() => {
  __resetPageViewsForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('la liste fermée des gabarits', () => {
  /** Les routes du site sur le disque : chaque `page.tsx` de app/[locale]. */
  function routes(dir: string, prefix = '', out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (!statSync(path).isDirectory()) {
        if (entry === 'page.tsx') out.push(prefix === '' ? '/' : prefix);
        continue;
      }
      // un dossier (groupe) ne compte pas dans l'adresse ; [...rest] est l'attrape-tout des 404
      if (entry.startsWith('(')) routes(path, prefix, out);
      else if (entry === '[...rest]') continue;
      else routes(path, `${prefix}/${entry.replace(/^\[(.+)\]$/, ':$1')}`, out);
    }
    return out;
  }

  it('nomme chaque page publique du site, et celles-là seulement', () => {
    const root = join(import.meta.dirname, '..', 'app', '[locale]');
    const shape = (p: string) => p.replace(/:[a-z]+/g, ':');
    // le tableau de bord et la page famille s'affichent sans la balise : jamais comptés
    const onDisk = routes(root)
      .filter((r) => !r.startsWith('/dashboard') && !r.startsWith('/famille'))
      .map(shape)
      .sort();
    expect(onDisk.length).toBeGreaterThan(40);
    expect([...PAGE_TEMPLATES].map(shape).sort()).toEqual(onDisk);
  });

  it('range un code de banque, un titre ou une année sous son gabarit, jamais tel quel', () => {
    expect(pageTemplate('/blz/37040044')).toBe('/blz/:code');
    expect(pageTemplate('/de/blz/37040044')).toBe('/blz/:code');
    expect(pageTemplate('/fr/at/12000')).toBe('/at/:code');
    expect(pageTemplate('/iid/00762')).toBe('/iid/:iid');
    expect(pageTemplate('/iban/DE')).toBe('/iban/:cc');
    expect(pageTemplate('/blog/un-titre-que-personne-n-a-liste')).toBe('/blog/:slug');
    expect(pageTemplate('/clearing-calendar/2027')).toBe('/clearing-calendar/:year');
    expect(pageTemplate('/')).toBe('/');
    expect(pageTemplate('/fr')).toBe('/');
    expect(pageTemplate('/de/')).toBe('/');
    expect(pageTemplate('/pricing')).toBe('/pricing');
    expect(pageTemplate('/fr/tools/qr-bill/')).toBe('/tools/qr-bill');
  });

  it('range tout le reste sous autre : chemin inconnu, profondeur en trop, requête, fragment', () => {
    for (const path of [
      '/unknown',
      '/pricing/extra',
      '/blz/37040044/x',
      '/pricing?ref=a@b.example',
      '/pricing#x',
      '//pricing',
      '/blz//x',
      '/dashboard',
      '/famille',
      '/x y',
    ]) {
      expect(pageTemplate(path), path).toBe(OTHER_PAGE);
    }
  });
});

describe('le corps du navigateur et les en-têtes', () => {
  it('lit le chemin et la langue seulement', () => {
    expect(parseView({ page: '/fr/blz/1', locale: 'fr', referrer: 'x.example', ip: '1.2.3.4' })).toEqual({
      page: '/blz/:code',
      locale: 'fr',
    });
    expect(parseView({ page: 'pricing', locale: 'en' })).toBeNull();
    expect(parseView({ page: '/pricing', locale: 'es' })).toBeNull();
    expect(parseView([])).toBeNull();
  });

  it('écarte DNT, GPC, un robot, un script et une requête sans agent', () => {
    const h = (o: Record<string, string>) => new Headers({ 'user-agent': BROWSER, ...o });
    expect(shouldSkipView(h({}))).toBe(false);
    expect(shouldSkipView(h({ DNT: '1' }))).toBe(true);
    expect(shouldSkipView(h({ 'Sec-GPC': '1' }))).toBe(true);
    for (const ua of ['curl/8.4.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'HeadlessChrome/123', 'IBANforge-outil/1.0', 'python-requests/2.31']) {
      expect(shouldSkipView(h({ 'user-agent': ua })), ua).toBe(true);
    }
    expect(shouldSkipView(new Headers())).toBe(true);
  });

  it('limite le débit par adresse, en mémoire', () => {
    for (let i = 0; i < VIEWS_PER_WINDOW; i++) expect(viewLimit('203.0.113.5', 1_000)).toBe('ok');
    expect(viewLimit('203.0.113.5', 1_000)).toBe('limited');
    expect(viewLimit('203.0.113.6', 1_000)).toBe('ok');
    expect(viewLimit('203.0.113.5', 1_000 + 11 * 60_000)).toBe('ok');
  });

  it('plafonne la table des adresses : purge les expirées, puis refuse la nouvelle sans agrandir', () => {
    // une adresse falsifiée par requête remplit la table
    for (let i = 0; i < MAX_ADDRESSES; i++) expect(viewLimit(`10.0.${Math.floor(i / 250)}.${i % 250}:${i}`, 1_000)).toBe('ok');
    // pleine d'adresses vivantes : la nouvelle est refusée, la table ne grossit pas
    expect(viewLimit('198.51.100.200', 2_000)).toBe('full');
    expect(viewLimit('198.51.100.201', 2_000)).toBe('full');
    // une adresse déjà connue garde son compte
    expect(viewLimit('10.0.0.0:0', 2_000)).toBe('ok');
    // dix minutes plus tard les entrées ont expiré : la purge fait de la place
    expect(viewLimit('198.51.100.200', 1_000 + 11 * 60_000)).toBe('ok');
  });
});

describe('le lot envoyé à l API', () => {
  it('part de serveur à serveur : la clé et le lot, rien d un visiteur', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    });
    countView({ page: '/pricing', locale: 'en' });
    countView({ page: '/pricing', locale: 'en' });
    countView({ page: '/blz/:code', locale: 'de' });
    expect(await flushViews()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.example.net/v1/admin/page-views');
    expect(calls[0]!.init.method).toBe('POST');
    // seuls ces deux en-têtes : aucun en-tête de visiteur recopié
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>).sort()).toEqual(['Content-Type', 'X-Admin-Secret']);
    const body = JSON.parse(String(calls[0]!.init.body)) as { items: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(['items']);
    expect(body.items.sort((a, b) => String(a.page).localeCompare(String(b.page)))).toEqual([
      { page: '/blz/:code', locale: 'de', count: 1 },
      { page: '/pricing', locale: 'en', count: 2 },
    ]);
    expect(__pendingForTests().total).toBe(0);
  });

  it('s envoie seul après le délai, une fois', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    countView({ page: '/', locale: 'fr' });
    countView({ page: '/', locale: 'fr' });
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FLUSH_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FLUSH_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('garde le lot en mémoire si l API ne répond pas, sans file sans fin', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('down');
    });
    countView({ page: '/pricing', locale: 'en' });
    expect(await flushViews()).toBe(false);
    expect(__pendingForTests().total).toBe(1);
    // au-delà du plafond, plus rien n'est gardé
    for (let i = 0; i < MAX_PENDING + 50; i++) countView({ page: '/pricing', locale: 'en' });
    expect(__pendingForTests().total).toBeLessThanOrEqual(MAX_PENDING);
    expect(await flushViews()).toBe(false);
    expect(__pendingForTests().total).toBeLessThanOrEqual(MAX_PENDING);
  });

  it('abandonne le lot quand il ne tiendrait plus sous le plafond', async () => {
    for (let i = 0; i < MAX_PENDING; i++) countView({ page: '/pricing', locale: 'en' });
    vi.stubGlobal('fetch', async () => {
      // pendant l'envoi, d'autres visites arrivent : le lot échoué ne tient plus
      for (let i = 0; i < 100; i++) countView({ page: '/', locale: 'en' });
      throw new Error('down');
    });
    expect(await flushViews()).toBe(false);
    expect(__pendingForTests().total).toBe(100);
  });

  it('n envoie rien sans clé ni adresse d API, et ne jette jamais', async () => {
    vi.stubEnv('SITE_ADMIN_TOKEN', '');
    vi.stubEnv('ADMIN_SECRET', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    countView({ page: '/', locale: 'en' });
    expect(await flushViews()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
