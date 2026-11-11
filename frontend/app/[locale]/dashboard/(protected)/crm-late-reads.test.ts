import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildInput, CrmPart } from '@/lib/crm/build-contacts';
import { lateReadsSummary } from '@/lib/crm/build-contacts';
import { LateReadsBanner, LateReadsPanel } from '@/components/crm/late-reads';
import ContactsPage from './contacts/page';
import CourrierPage from './courrier/page';
import ClientsPage from './clients/page';

/**
 * Relecture de la PR 617 (C24) : ce que les pages Contacts, Courrier et Clients
 * rendent quand une lecture du CRM a été coupée par le délai (C23). Une lecture
 * porteuse (clés, prospects, courrier) remplace la page par le panneau, pour ne
 * jamais montrer des comptes faux ; une lecture facultative est nommée par le
 * bandeau au-dessus de la page dessinée sans elle.
 *
 * La lecture du CRM est simulée (`fetchCrmData`), le reste est le vrai code :
 * `lateReadsSummary`, `crmSnapshot`, `buildContacts`, `buildDossiers`. Les
 * composants clients des pages ne sont pas rendus, seulement repérés.
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
vi.mock('@/components/crm/crm-app', () => ({ CrmApp: () => null }));
vi.mock('@/components/crm/alias-rules', () => ({ AliasRules: () => null }));
vi.mock('@/components/crm/no-reply-rules', () => ({ NoReplyRules: () => null }));
vi.mock('@/components/crm/freshness-badge', () => ({ FreshnessBadge: () => null }));
vi.mock('@/components/crm/journal-app', () => ({ JournalApp: () => null }));
vi.mock('@/components/crm/clients-app', () => ({ ClientsApp: () => null }));

function withLate(late: CrmPart[]): BuildInput {
  return {
    keys: [],
    prospects: [],
    messages: [],
    activityByKey: {},
    reads: {},
    months: [],
    late,
  };
}

/** Every element of the returned tree, components not rendered. */
function elements(node: ReactNode): ReactElement<{ children?: ReactNode }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [child, ...elements(child.props.children)];
  });
}

const PAGES = [
  { name: 'Contacts', render: () => ContactsPage(), optional: 'activity' as CrmPart },
  { name: 'Courrier', render: () => CourrierPage(), optional: 'activity' as CrmPart },
  {
    name: 'Clients',
    render: () => ClientsPage({ searchParams: Promise.resolve({}) }),
    optional: 'activation' as CrmPart,
  },
];

beforeEach(() => {
  crm.data = null;
});

describe.each(PAGES)('la page $name quand une lecture est en retard', ({ name, render, optional }) => {
  it.each(['keys', 'prospects', 'messages'] as CrmPart[])(
    'une lecture porteuse en retard (%s) : le panneau, à la place de la page',
    async (part) => {
      crm.data = withLate([part]);
      const page = await render();
      expect(page.type).toBe(LateReadsPanel);
      expect(page.props).toEqual({ summary: lateReadsSummary([part]), page: name });
      const html = renderToStaticMarkup(page);
      expect(html).toContain('Lecture trop lente');
      expect(html).toContain(lateReadsSummary([part])!.text);
      expect(elements(page).some((e) => e.type === LateReadsBanner)).toBe(false);
    },
  );

  it(`une lecture facultative en retard : la page, et le bandeau qui la nomme`, async () => {
    crm.data = withLate([optional]);
    const page = await render();
    expect(page.type).not.toBe(LateReadsPanel);
    const banners = elements(page).filter((e) => e.type === LateReadsBanner);
    expect(banners).toHaveLength(1);
    expect(banners[0].props).toEqual({ summary: lateReadsSummary([optional]) });
    expect(renderToStaticMarkup(banners[0])).toContain('La page s’affiche sans cette lecture');
  });

  it('aucune lecture en retard : ni panneau ni bandeau', async () => {
    crm.data = withLate([]);
    const page = await render();
    expect(page.type).not.toBe(LateReadsPanel);
    expect(elements(page).some((e) => e.type === LateReadsBanner || e.type === LateReadsPanel)).toBe(
      false,
    );
  });
});
