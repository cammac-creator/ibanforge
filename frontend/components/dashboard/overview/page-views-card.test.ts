import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import fr from '@/messages/fr.json';
import { PageViewsCard } from '@/components/dashboard/overview/page-views-card';
import type { WebEventsSummary } from '@/lib/dashboard-overview';

vi.mock('next-intl/server', () => ({
  getTranslations: async () => createTranslator({ locale: 'fr', messages: fr, namespace: 'dashboard.overview' }),
}));

// Le bloc d’échec est un autre composant serveur asynchrone ; son contenu est testé ailleurs.
vi.mock('@/components/dashboard/overview/fetching', () => ({
  FetchFailed: ({ status }: { status: number }) => createElement('p', null, `Lecture impossible (${status})`),
}));

type Cell = { page: string; count: number };

function summary(cells: Cell[] | null): WebEventsSummary {
  return {
    days: 30,
    since: '2026-10-21 00:00:00',
    total: 0,
    by_name: [],
    by_page: [],
    by_referrer: [],
    by_day: [],
    ...(cells
      ? {
          page_views: {
            days: 30,
            since: '2026-10-21',
            total: cells.reduce((n, c) => n + c.count, 0),
            by_page: cells,
            by_page_day: [],
          },
        }
      : {}),
  } as WebEventsSummary;
}

const ok = (data: WebEventsSummary) => Promise.resolve({ ok: true, status: 200, data });
const failed = (status: number) => Promise.resolve({ ok: false, status, data: null });

async function render(week: ReturnType<typeof ok> | ReturnType<typeof failed>, month: typeof week) {
  return renderToStaticMarkup(await PageViewsCard({ weekPromise: week, monthPromise: month }));
}

/** Position of a page row: its label is written once, in the mono-spaced cell. */
const at = (html: string, page: string) => html.indexOf(`title="${page}">${page}</span>`);

describe('Carte des pages vues du tableau de bord', () => {
  it('affiche le titre, les totaux et la note, sans prétendre compter des personnes', async () => {
    const html = await render(
      ok(summary([{ page: '/pricing', count: 5 }])),
      ok(summary([{ page: '/pricing', count: 20 }, { page: '/docs/:slug', count: 4 }])),
    );
    expect(html).toContain('Pages vues');
    expect(html).toContain('Pages vues : 5 sur 7 jours, 24 sur 30');
    expect(html).toContain('Des affichages, pas des personnes');
    expect(html).toContain('7 j');
    expect(html).toContain('30 j');
  });

  it('met les trois pages qui comptent en tête, dans l’ordre, même plus petites que les autres', async () => {
    const month = summary([
      { page: '/blz/:code', count: 900 },
      { page: '/docs/:slug', count: 400 },
      { page: '/', count: 3 },
      { page: '/pricing', count: 2 },
      { page: '/iban-validation-api', count: 1 },
    ]);
    const html = await render(ok(month), ok(month));
    const api = at(html, '/iban-validation-api');
    const pricing = at(html, '/pricing');
    const home = at(html, '/');
    const blz = at(html, '/blz/:code');
    const docs = at(html, '/docs/:slug');
    expect(api).toBeGreaterThan(-1);
    expect(api).toBeLessThan(pricing);
    expect(pricing).toBeLessThan(home);
    expect(home).toBeLessThan(blz);
    // les autres pages suivent, la plus vue d’abord
    expect(blz).toBeLessThan(docs);
  });

  it('garde les trois pages en tête à zéro quand elles n’ont aucun affichage, et classe les autres à égalité par nom', async () => {
    const month = summary([
      { page: '/sk', count: 7 },
      { page: '/at', count: 7 },
    ]);
    const html = await render(ok(month), ok(month));
    expect(at(html, '/iban-validation-api')).toBeGreaterThan(-1);
    expect(at(html, '/pricing')).toBeGreaterThan(-1);
    expect(at(html, '/')).toBeGreaterThan(-1);
    expect(at(html, '/at')).toBeLessThan(at(html, '/sk'));
    expect(at(html, '/')).toBeLessThan(at(html, '/at'));
  });

  it('ne liste que douze autres pages', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ page: `/p${String(i).padStart(2, '0')}`, count: 100 - i }));
    const html = await render(ok(summary(many)), ok(summary(many)));
    expect(at(html, '/p11')).toBeGreaterThan(-1);
    expect(at(html, '/p12')).toBe(-1);
    // 3 pages en tête + 12 autres
    expect(html.match(/<li /g)).toHaveLength(15);
  });

  it('dit « aucun affichage » quand rien n’est mesuré, ou quand l’API est trop ancienne pour le compteur', async () => {
    for (const data of [summary([]), summary(null)]) {
      const html = await render(ok(data), ok(data));
      expect(html).toContain('Aucun affichage mesuré pour l’instant.');
      expect(html).not.toContain('<ul');
    }
  });

  it('dit que la lecture a échoué plutôt que d’afficher des zéros', async () => {
    const html = await render(failed(500), failed(500));
    expect(html).toContain('Lecture impossible (500)');
    expect(html).not.toContain('<ul');
  });

  it('remplace la colonne 7 jours par un tiret quand seule cette lecture a échoué', async () => {
    const month = summary([{ page: '/pricing', count: 20 }]);
    const html = await render(failed(0), ok(month));
    expect(html).toContain('>—</span>');
    expect(html).toContain('Pages vues : 0 sur 7 jours, 20 sur 30');
  });
});
