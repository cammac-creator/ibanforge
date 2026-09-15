import { describe, expect, it } from 'vitest';
import { overviewHref, overviewView, OVERVIEW_VIEWS } from './workspace';

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
