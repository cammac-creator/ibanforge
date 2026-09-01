import { describe, expect, it } from 'vitest';
import { inClientFilter, matchesClientQuery, searchDossiers } from './client-search';
import type { ClientDossier } from './client-dossiers';
import type { ActivationClientRow } from './build-contacts';

/**
 * The lens and the État filter, checked apart from the page that draws them.
 * Both were inline in clients-app.tsx and therefore untested, which is how the
 * default view came to hide most of the base from the search (audit TABS-04).
 */

const activation = (status: ActivationClientRow['status']): ActivationClientRow => ({
  email: 'x@alpha.example.net',
  status,
  source: 'direct',
  credits_total: 0,
  credits_remaining: 0,
  packs: 0,
  first_call_at: null,
  calls_90d: 0,
});

/** Only the fields these two functions read; the rest of a dossier is noise here. */
function dossier(over: Partial<ClientDossier> & Pick<ClientDossier, 'id'>): ClientDossier {
  return {
    email: over.id,
    company: null,
    requests: 0,
    countries: [],
    keys: [],
    verdict: 'silent',
    activation: null,
    ...over,
  } as ClientDossier;
}

const caller = dossier({
  id: 'caller@alpha.example.net',
  requests: 40,
  company: 'Société Alpha',
  activation: activation('active'),
});
const silent = dossier({
  id: 'quiet@alpha.example.net',
  company: 'Société Beta',
  activation: activation('silent'),
});
const unjoined = dossier({ id: 'unjoined@alpha.example.net', verdict: 'dormant' });
const all = [caller, silent, unjoined];

describe('inClientFilter', () => {
  it('reads the API word for a state filter', () => {
    expect(inClientFilter(caller, 'active')).toBe(true);
    expect(inClientFilter(silent, 'active')).toBe(false);
    expect(inClientFilter(silent, 'silent')).toBe(true);
  });

  it('never selects a derived word under a state filter', () => {
    // Contacts cannot see this address, so counting it here would put the page
    // back to two answers for one word. Shown on its row, counted nowhere.
    expect(inClientFilter(unjoined, 'dormant')).toBe(false);
    expect(inClientFilter(unjoined, 'all')).toBe(true);
  });

  it('selects a precision on any row, derived or not', () => {
    const former = dossier({ id: 'old@alpha.example.net', verdict: 'former' });
    expect(inClientFilter(former, 'former')).toBe(true);
  });

  it('keeps « ont appelé » on the window counter', () => {
    expect(inClientFilter(caller, 'used')).toBe(true);
    expect(inClientFilter(silent, 'used')).toBe(false);
  });
});

describe('matchesClientQuery', () => {
  it('folds accents on both sides', () => {
    expect(matchesClientQuery(caller, 'societe')).toBe(true);
  });

  it('matches a country code exactly, not by prefix', () => {
    const d = dossier({ id: 'zz@alpha.example.net', countries: [{ code: 'CH', count: 3 }] });
    expect(matchesClientQuery(d, 'ch')).toBe(true);
    // Not a prefix search on the code: 'c' would otherwise select every
    // dossier serving Switzerland, Chile, China and Canada at once.
    expect(matchesClientQuery(d, 'c')).toBe(false);
  });
});

describe('searchDossiers', () => {
  it('finds a silent signup from the default view, and says it widened', () => {
    // The whole of TABS-04: the default filter is « ont appelé », and this
    // dossier has never called. It used to answer "aucun client ne correspond".
    const r = searchDossiers(all, 'used', 'quiet');
    expect(r.rows.map((d) => d.id)).toEqual(['quiet@alpha.example.net']);
    expect(r.widened).toBe(true);
  });

  it('does not widen when the filter already holds a match', () => {
    const r = searchDossiers(all, 'used', 'caller');
    expect(r.rows.map((d) => d.id)).toEqual(['caller@alpha.example.net']);
    expect(r.widened).toBe(false);
  });

  it('stays empty, and unwidened, when nothing matches anywhere', () => {
    const r = searchDossiers(all, 'used', 'zzzz');
    expect(r.rows).toEqual([]);
    expect(r.widened).toBe(false);
  });

  it('is the plain filter when there is no query', () => {
    const r = searchDossiers(all, 'used', '   ');
    expect(r.rows.map((d) => d.id)).toEqual(['caller@alpha.example.net']);
    expect(r.widened).toBe(false);
  });
});
