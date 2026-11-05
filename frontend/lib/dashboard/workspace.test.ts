import { describe, expect, it } from 'vitest';
import {
  overviewHref,
  overviewView,
  OVERVIEW_VIEWS,
  workspaceCurrent,
  workspaceHref,
  WORKSPACE_DESTINATIONS,
} from './workspace';

describe('Navigation entre les vues du tableau de bord', () => {
  it.each(OVERVIEW_VIEWS)('ouvre la vue %s', (view) => {
    expect(overviewView(view)).toBe(view);
  });

  it.each([undefined, '', 'obsolete', ['service', 'revenue'], 30])(
    'ouvre le travail du jour avec une adresse ancienne ou invalide : %j',
    (value) => {
      expect(overviewView(value)).toBe('today');
    },
  );

  it('garde la langue et la période en changeant de vue', () => {
    expect(overviewHref('/fr/dashboard', 'growth', 90)).toBe('/fr/dashboard?view=growth&period=90');
    expect(overviewHref('/de/dashboard', 'revenue', 7)).toBe('/de/dashboard?view=revenue&period=7');
    expect(overviewHref('/dashboard', 'service', 30)).toBe('/dashboard?view=service&period=30');
  });

  it('ne transmet pas une période invalide aux liens de lecture', () => {
    expect(overviewHref('/fr/dashboard', 'today', 42)).toBe('/fr/dashboard?view=today&period=30');
  });
});

describe('Menu du poste de travail', () => {
  it.each(['/dashboard', '/fr/dashboard', '/de/dashboard/', '/en/dashboard'])(
    'distingue les vues à la même adresse %s',
    (path) => {
      expect(workspaceCurrent(path, 'growth')).toBe('growth');
      expect(workspaceCurrent(path, 'revenue')).toBe('revenue');
      expect(workspaceCurrent(path, 'obsolete')).toBe('today');
    },
  );

  it('ne confond pas les clients et les clients bots', () => {
    expect(workspaceCurrent('/fr/dashboard/clients', 'growth')).toBe('clients');
    expect(workspaceCurrent('/de/dashboard/clients-bot', 'today')).toBe('bots');
    expect(workspaceCurrent('/dashboard/contacts/exemple', null)).toBe('contacts');
  });

  it('conserve le contexte des vues et protège les liens des valeurs inconnues', () => {
    const growth = WORKSPACE_DESTINATIONS.find((item) => item.key === 'growth')!;
    const revenue = WORKSPACE_DESTINATIONS.find((item) => item.key === 'revenue')!;
    const mail = WORKSPACE_DESTINATIONS.find((item) => item.key === 'mail')!;
    expect(workspaceHref(growth, 90, 'journey')).toBe(
      '/dashboard?view=growth&period=90&audience=journey',
    );
    expect(workspaceHref(growth, NaN, 'inconnu&redirect=ailleurs')).toBe(
      '/dashboard?view=growth&period=30',
    );
    expect(workspaceHref(revenue, 7, 'journey')).toBe('/dashboard?view=revenue&period=7');
    expect(workspaceHref(mail, 90)).toBe('/dashboard/courrier');
  });
});
