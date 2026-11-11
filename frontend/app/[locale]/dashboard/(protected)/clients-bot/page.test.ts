import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildInput, CrmPart } from '@/lib/crm/build-contacts';
import { lateReadsSummary } from '@/lib/crm/build-contacts';
import { LateReadsBanner, LateReadsPanel } from '@/components/crm/late-reads';
import ClientsBotPage from './page';

/**
 * Relecture de la PR 617 (C24) : la page Clients Bot lit les clés et les
 * prospects pour son pont vers l'onglet Clients (le nom de société d'un client
 * vient du prospect). Quand le délai coupe l'une de ces lectures, la page se
 * dessine quand même (le pont est un enrichissement), mais elle le dit, avec le
 * bandeau des autres pages du CRM, au lieu de montrer sans un mot des clients
 * sans nom de société.
 */
const crm = vi.hoisted(() => ({ data: null as unknown }));

vi.mock('@/lib/auth', () => ({ requireDashboardSession: async () => undefined }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'fr' }));
vi.mock('@/lib/crm/build-contacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crm/build-contacts')>()),
  fetchCrmData: async () => crm.data,
}));
vi.mock('@/lib/crm/client-dossiers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crm/client-dossiers')>()),
  fetchClientProfiles: async () => ({
    readable: true,
    profiles: {},
    monthsByKey: {},
    quotaWarnedByKey: {},
    generatedAt: '2026-11-11T09:00:00.000Z',
  }),
  fetchCompanyProfiles: async () => ({}),
}));
vi.mock('@/lib/crm/bot-dossiers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crm/bot-dossiers')>()),
  fetchBotProfiles: async () => ({}),
}));
vi.mock('@/components/crm/bots-app', () => ({ BotsApp: () => null }));

function crmWith(late: CrmPart[]): BuildInput {
  return {
    keys: [],
    prospects: [],
    messages: [],
    activityByKey: {},
    reads: {},
    months: [],
    ...(late.length > 0 ? { late } : {}),
  };
}

function elements(node: ReactNode): ReactElement<{ children?: ReactNode }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [child, ...elements(child.props.children)];
  });
}

beforeEach(() => {
  crm.data = null;
});

describe('la page Clients Bot quand une lecture du CRM est en retard', () => {
  it('les prospects coupés par le délai : la page se dessine, et le bandeau le dit', async () => {
    crm.data = crmWith(['prospects']);
    const page = await ClientsBotPage();
    expect(page.type).not.toBe(LateReadsPanel);
    const banners = elements(page).filter((e) => e.type === LateReadsBanner);
    expect(banners).toHaveLength(1);
    expect(banners[0].props).toEqual({ summary: lateReadsSummary(['prospects']) });
    const html = renderToStaticMarkup(banners[0]);
    expect(html).toContain('Les prospects n’ont pas répondu');
    expect(html).toContain('La page s’affiche sans cette lecture');
  });

  it('les clés coupées par le délai : le même bandeau, qui les nomme', async () => {
    crm.data = crmWith(['keys']);
    const banners = elements(await ClientsBotPage()).filter((e) => e.type === LateReadsBanner);
    expect(banners.map((b) => b.props)).toEqual([{ summary: lateReadsSummary(['keys']) }]);
  });

  it('aucune lecture en retard : pas de bandeau', async () => {
    crm.data = crmWith([]);
    const page = await ClientsBotPage();
    expect(elements(page).some((e) => e.type === LateReadsBanner)).toBe(false);
  });
});
