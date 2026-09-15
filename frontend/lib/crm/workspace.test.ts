import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactTable } from '@/components/crm/contact-table';
import { CrmToolbar } from '@/components/crm/crm-toolbar';
import { ClientsApp } from '@/components/crm/clients-app';
import { buildDossiers } from './client-dossiers';
import { mailFilters, type RowsInput } from './mail-rows';
import type { Contact, Situation } from './types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/crm/client-dossier-modal', () => ({ ClientDossierModal: () => null }));
afterEach(() => vi.restoreAllMocks());
vi.mock('@/components/crm/new-institution', () => ({ NewInstitutionForm: () => null }));

function institution(id: string): Contact {
  return {
    kind: 'institution',
    id,
    email: `${id}@alpha.example.net`,
    company: id,
    country: null,
    website: null,
    unread: true,
    draft: null,
    account: 'desk@example.com',
    institution: {
      org: id,
      category: 'registre',
      country: null,
      role: null,
      website: null,
      dossier: null,
    },
    messages: [
      {
        id: `mail-${id}`,
        direction: 'in',
        msg_date: '2026-09-10T12:00:00Z',
        subject: 'Question',
        snippet: 'Un échange fictif.',
        counterparty: `${id}@alpha.example.net`,
      },
    ],
  };
}
const needsReply: Situation = {
  ballInCourt: 'us',
  silenceDays: 1,
  followupDue: false,
  firstContactAt: null,
  hasEverReplied: true,
  messageCount: 1,
  nextAction: 'reply',
};
const waiting: Situation = { ...needsReply, ballInCourt: 'them', nextAction: 'wait' };
const alpha = institution('Alpha');
const beta = institution('Beta');
const client: Contact = {
  ...institution('Client'),
  kind: 'client',
  apiKey: {
    keyPrefix: 'ifk_fictif',
    paid: false,
    creditsTotal: null,
    creditsRemaining: null,
    monthlyLimit: 200,
    usedAllTime: 12,
    lastActiveMonth: '2026-09',
    createdAt: null,
    issuedByUs: false,
    isNew: false,
  },
  usage: { series: [], months: [], days: [], endpoints: [] },
};
const input: RowsInput = {
  contacts: [alpha, beta, client],
  situations: { Alpha: needsReply, Beta: waiting, Client: needsReply },
  snoozed: {},
};

describe('Files de travail du CRM', () => {
  it('compte dans la population choisie et garde une sortie vers tous ses contacts', () => {
    const html = renderToStaticMarkup(
      createElement(ContactTable, {
        input,
        selectedId: null,
        onSelect: () => {},
        initialSelection: { population: 'institution', work: 'reply' },
      }),
    );
    expect(html).toContain('À répondre</span><strong>1</strong>');
    expect(html).toContain('Tous les contacts</span><strong>2</strong>');
    expect(html).toContain('Actions pour Alpha');
    expect(html).not.toContain('Actions pour Beta');
    expect(html).not.toContain('Actions pour Client');
    expect(html).toContain('Retirer le filtre');
  });

  it('garde le brouillon sélectionné visible après le départ du dernier brouillon', () => {
    const html = renderToStaticMarkup(
      createElement(CrmToolbar, {
        filters: mailFilters(input),
        queueCounts: { all: 3, reply: 2, drafts: 0, followup: 0 },
        selection: { population: 'all', work: 'drafts' },
        onSelection: () => {},
        query: '',
        onQuery: () => {},
      }),
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Brouillons<\/span><strong>0<\/strong>/);
    expect(html).toContain('Tous les contacts');
  });

  it('offre une recherche nommée et des actions utilisables sans survol', () => {
    const html = renderToStaticMarkup(
      createElement(ContactTable, { input, selectedId: null, onSelect: () => {} }),
    );
    expect(html).toContain('aria-label="Rechercher un contact"');
    expect(html).toContain('aria-label="Actions pour Alpha"');
    expect(html).toContain('Marquer comme lu');
    expect(html).toContain('Rien à répondre');
  });
});

describe('Nombres des dossiers clients', () => {
  it.each(['fr', 'en', 'de'])('reste identique entre Node et Safari en %s', (locale) => {
    const dossiers = buildDossiers({
      now: new Date('2026-09-15T12:00:00Z'),
      keys: [
        {
          key_prefix: 'ifk_demo',
          email: 'contact@alpha.example.net',
          monthly_limit: 200,
          active: 1,
          created_at: '2026-09-01T10:00:00Z',
          used: 12345,
          used_prev: 0,
          used_all_time: 12345,
          last_active_month: '2026-09',
          credits_total: null,
          credits_remaining: null,
          paid: 0,
          series: [],
        },
      ],
      prospects: [],
      messages: [],
      profiles: {},
      monthsByKey: {},
      quotaWarnedByKey: {},
    });
    dossiers[0].requests = 12345;
    const nativeFormat = vi.spyOn(Number.prototype, 'toLocaleString');
    const render = () => renderToStaticMarkup(createElement(ClientsApp, { dossiers, locale }));
    nativeFormat.mockReturnValue('format-serveur');
    const html = render();
    nativeFormat.mockReturnValue('format-safari');
    expect(render()).toBe(html);
    expect(html).toContain(locale === 'en' ? '12,345' : '12 345');
    expect(nativeFormat).not.toHaveBeenCalled();
  });
});
