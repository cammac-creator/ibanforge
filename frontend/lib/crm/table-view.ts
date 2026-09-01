import { isPressing, shortActionLabel } from './situation';
import { AGE_TODAY, MAIL_FILTER_KEYS, type MailFilterKey, type MailRow } from './mail-rows';
import type { Contact } from './types';

/**
 * Everything the contacts table needs that is NOT a rule: how the eleven filter
 * keys are laid out on the toolbar, and how a projected row reads in a narrow
 * column.
 *
 * Here rather than in the component because the vitest config covers `lib/` and
 * `app/` only — a mapping written inside a .tsx cannot be pinned, and the two
 * mappings below are exactly the kind that rot silently: a key added to
 * mail-rows.ts and forgotten by the toolbar simply stops being reachable, with
 * nothing on screen to say so.
 */

/**
 * The counted work tiles: what the day owes, as numbers big enough to read
 * across the room. They toggle, so at most one is pressed.
 */
export const WORK_KEYS: readonly MailFilterKey[] = ['reply', 'followup', 'drafts'];

/**
 * The segmented control: WHO, never what state they are in. Exactly one is
 * always pressed, 'all' being the resting position.
 *
 * `prospects` and not `prospect`: the population, everyone of that kind, not
 * the never-contacted queue. See the two neighbouring entries in mail-rows.ts.
 */
export const POPULATION_KEYS: readonly MailFilterKey[] = [
  'all',
  'clients',
  'prospects',
  'institution',
];

/**
 * The refining chips, quiet by design: they narrow whatever the segment and the
 * tile already selected. At most one is pressed.
 */
// 'closed' is a chip and not a work tile on purpose: the day's tiles count
// what is OWED, and a closed dossier is the one thing that no longer is. The
// chip is the retrieval path — narrow any population to the dossiers the
// terminal verdicts took out of the queues.
export const REFINE_KEYS: readonly MailFilterKey[] = ['new', 'paying', 'at-limit', 'dormant', 'prospect', 'closed'];

/**
 * The segment's own word for a key, where the filter's label was written for a
 * different place.
 *
 * One entry: "Correspondances" names the exchange, which is right above a list
 * of letters, and wrong inside a control whose other three buttons name people.
 */
const SEGMENT_LABEL: Partial<Record<MailFilterKey, string>> = {
  institution: 'Correspondants',
};

export function segmentLabel(key: MailFilterKey, filterLabel: string): string {
  return SEGMENT_LABEL[key] ?? filterLabel;
}

/**
 * The colour of a row's left rail, by kind.
 *
 * The kind is the one thing every row can say about itself: chips are
 * deliberately rare (business.ts), so an ordinary active client carries none
 * and would otherwise be an unlabelled line among two hundred. The three values
 * are the colours those chips already use for the same three kinds — the green
 * of `payant`, the violet of `prospect`, the sky of an institution's category —
 * so the rail and the chip never disagree on the same row.
 */
const KIND_RAIL: Record<Contact['kind'], string> = {
  client: '#22c55e',
  prospect: '#a78bfa',
  institution: '#38bdf8',
};

export function railColorOf(kind: Contact['kind']): string {
  return KIND_RAIL[kind];
}

/** French for a kind, for the screen-reader line the colour rail cannot speak. */
const KIND_WORD: Record<Contact['kind'], string> = {
  client: 'Client',
  prospect: 'Prospect',
  institution: 'Correspondant',
};

export function kindWord(kind: Contact['kind']): string {
  return KIND_WORD[kind];
}

export interface RowStatus {
  label: string;
  /** Something to do today — the column's accent colour, and nothing else. */
  pressing: boolean;
}

/**
 * The Statut cell: the contact's next action, short, in the vocabulary its kind
 * calls for.
 *
 * No taxonomy of its own. The state comes from `situationOf`, the words from
 * `shortActionLabel`, the accent from `isPressing`; this only handles the case
 * the five states do not cover — a contact the page built no situation for,
 * which is a programming error rather than data and must read as calm silence
 * instead of an invented verdict.
 */
export function rowStatus(row: Pick<MailRow, 'nextAction' | 'kind'>): RowStatus {
  if (!row.nextAction) return { label: '—', pressing: false };
  return {
    label: shortActionLabel(row.nextAction, row.kind),
    pressing: isPressing(row.nextAction),
  };
}

/**
 * The Attente cell: the same age the rows already carry, abbreviated so a
 * right-aligned tabular column stays a column.
 *
 * Presentational only, and beside `age` rather than instead of it: the long
 * form is what the row itself shows below `lg`, and a test pins it. Two shapes
 * need shortening — the empty string of a contact with no datable message, and
 * the one prose value, which is recognised through the exported constant rather
 * than re-spelt here.
 */
export function shortAge(age: string): string {
  if (!age) return '—';
  if (age === AGE_TODAY) return 'auj.';
  return age;
}

/**
 * Every key, once, in the group that draws it. Exported for the test that
 * proves the three groups partition the filters — the whole reason this file
 * sits under lib/.
 */
export const TOOLBAR_GROUPS: readonly (readonly MailFilterKey[])[] = [
  WORK_KEYS,
  POPULATION_KEYS,
  REFINE_KEYS,
];

export { MAIL_FILTER_KEYS };
