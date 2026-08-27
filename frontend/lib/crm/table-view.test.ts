import { describe, expect, it } from 'vitest';
import { MAIL_FILTER_KEYS, type MailFilterKey, type MailRow } from './mail-rows';
import {
  POPULATION_KEYS,
  REFINE_KEYS,
  TOOLBAR_GROUPS,
  WORK_KEYS,
  kindWord,
  railColorOf,
  rowStatus,
  segmentLabel,
  shortAge,
} from './table-view';

describe('the toolbar partitions the filters', () => {
  it('places every key in exactly one group', () => {
    // The failure this exists for is silent: a key added to FILTERS and
    // forgotten here is simply unreachable — no button draws it, and nothing on
    // screen says a filter went missing. Asserted in both directions, so an
    // invented key is caught as well as a forgotten one.
    const placed = TOOLBAR_GROUPS.flat();
    expect([...placed].sort()).toEqual([...MAIL_FILTER_KEYS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('keeps the never-contacted queue a chip and the population a segment', () => {
    // One letter apart, two different questions. Swapped, the segment would
    // hide every prospect already written to, which is most of them.
    expect(REFINE_KEYS).toContain('prospect');
    expect(POPULATION_KEYS).toContain('prospects');
    expect(POPULATION_KEYS).not.toContain('prospect');
    expect(REFINE_KEYS).not.toContain('prospects');
  });

  it('opens the segment on Tous and the tiles on the reply queue', () => {
    expect(POPULATION_KEYS[0]).toBe('all');
    expect(WORK_KEYS[0]).toBe('reply');
  });
});

describe('segmentLabel', () => {
  it('names people in the segment where the filter names the exchange', () => {
    expect(segmentLabel('institution', 'Correspondances')).toBe('Correspondants');
  });

  it('leaves every other key with the label the filter already carries', () => {
    expect(segmentLabel('clients', 'Clients')).toBe('Clients');
  });
});

describe('railColorOf', () => {
  it('gives the three kinds three colours, and the same one twice for one kind', () => {
    const colours = [railColorOf('client'), railColorOf('prospect'), railColorOf('institution')];
    expect(new Set(colours).size).toBe(3);
    expect(railColorOf('client')).toBe(colours[0]);
  });

  it('says the kind in words too, for what a colour cannot speak', () => {
    expect(kindWord('institution')).toBe('Correspondant');
  });
});

describe('rowStatus', () => {
  function row(over: Partial<Pick<MailRow, 'nextAction' | 'kind'>>): Pick<MailRow, 'nextAction' | 'kind'> {
    return { kind: 'client', nextAction: 'wait', ...over };
  }

  it('shortens the five states without renaming them', () => {
    expect(rowStatus(row({ nextAction: 'reply' })).label).toBe('À répondre');
    expect(rowStatus(row({ nextAction: 'followup' })).label).toBe('Relance due');
    expect(rowStatus(row({ nextAction: 'first_mail' })).label).toBe('Premier mail');
    expect(rowStatus(row({ nextAction: 'firm_offer' })).label).toBe('Offre ferme');
    expect(rowStatus(row({ nextAction: 'wait' })).label).toBe('En attente');
  });

  it('never instructs a commercial act on a correspondent', () => {
    // The two labels that are not merely off but wrong when said to somebody
    // about to write to a supervisor — the same pair the long table guards.
    expect(rowStatus(row({ kind: 'institution', nextAction: 'first_mail' })).label).toBe(
      'Demande à écrire',
    );
    expect(rowStatus(row({ kind: 'institution', nextAction: 'firm_offer' })).label).toBe(
      'En attente',
    );
  });

  it('accents what is due today and leaves the rest calm', () => {
    // Standing stock is not something that became due: a hundred cold prospects
    // painting the column amber would drown the threads actually waiting.
    expect(rowStatus(row({ nextAction: 'reply' })).pressing).toBe(true);
    expect(rowStatus(row({ nextAction: 'followup' })).pressing).toBe(true);
    expect(rowStatus(row({ nextAction: 'first_mail' })).pressing).toBe(false);
    expect(rowStatus(row({ nextAction: 'firm_offer' })).pressing).toBe(false);
    expect(rowStatus(row({ nextAction: 'wait' })).pressing).toBe(false);
  });

  it('reads as calm silence when the page built no situation', () => {
    expect(rowStatus(row({ nextAction: null }))).toEqual({ label: '—', pressing: false });
  });
});

describe('shortAge', () => {
  it('abbreviates the two shapes a number column cannot hold', () => {
    expect(shortAge('')).toBe('—');
    expect(shortAge('aujourd’hui')).toBe('auj.');
  });

  it('leaves a real duration exactly as the row states it', () => {
    expect(shortAge('12 j')).toBe('12 j');
    expect(shortAge('1 j')).toBe('1 j');
  });
});

/**
 * Guards the two lists against a key that exists nowhere. Written as a type
 * test as well as a value one: `satisfies` fails the build if a group ever
 * names something MailFilterKey does not.
 */
const _keys: readonly MailFilterKey[] = [...WORK_KEYS, ...POPULATION_KEYS, ...REFINE_KEYS];
void _keys;
