import type { Contact } from './types';

/**
 * The one word the list is allowed to say about a contact's business state,
 * and the rule for which word wins. Chips are deliberately rare: an ordinary
 * active free client carries none, or the colour would stop meaning anything
 * (the same reasoning that keeps `urgent` a property of the reply filter).
 *
 * The vocabulary is the API's activation vocabulary, never recomputed — the
 * paid state in particular comes from credits, because a buyer's monthly
 * `used` counter reads zero by construction and per-key readings once showed
 * a paying customer as "unused".
 */
export interface BusinessChip {
  label: string;
  color: string;
  bg: string;
}

const CHIP: Record<string, BusinessChip> = {
  paying: { label: 'payant', color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
  dormant: { label: 'endormi', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
  'at-limit': { label: 'à la limite', color: '#ef4444', bg: 'rgba(239,68,68,.12)' },
  pilot: { label: 'pilote', color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
  new: { label: 'nouveau', color: '#a78bfa', bg: 'rgba(167,139,250,.12)' },
  prospect: { label: 'prospect', color: '#a78bfa', bg: 'rgba(167,139,250,.10)' },
};

/**
 * The usual categories of an institutional correspondent, in the words the
 * dashboard speaks. The stored column is free TEXT (see InstitutionInfo), so
 * this is a naming table and never a whitelist: a category nobody foresaw
 * displays as itself rather than being swallowed.
 *
 * Exported because the "new correspondent" form offers exactly these values as
 * its shortcuts, and a second list there would drift from the one the chips
 * read the day a category is added.
 */
export const INSTITUTION_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'autorite', label: 'autorité' },
  { value: 'banque_centrale', label: 'banque centrale' },
  { value: 'reseau_paiement', label: 'réseau de paiement' },
  { value: 'registre', label: 'registre' },
  { value: 'fournisseur', label: 'fournisseur' },
  { value: 'autre', label: 'institution' },
];

/**
 * How wide a chip is allowed to be, in characters.
 *
 * The chip renders `shrink-0` beside the contact's name in a 296px column, so a
 * long category does not wrap or truncate: it pushes the name off the row. The
 * cap is on the free-text road only — every named category above is inside it.
 */
const CHIP_MAX = 16;

const INSTITUTION_COLOR = { color: '#38bdf8', bg: 'rgba(56,189,248,.12)' };

/**
 * The one word a correspondent's row carries: what kind of institution it is.
 *
 * Deliberately shaped as a BusinessChip and returned through chipOf rather than
 * drawn by its own component. The list and the contact header each render "the
 * chip" once, from one shape, so a correspondent looks like it belongs on the
 * same screen instead of introducing a second badge vocabulary. The colour is
 * the only thing that separates it from the commercial chips, which is the
 * distinction worth making at a glance.
 */
export function institutionChip(category: string): BusinessChip {
  const raw = (category ?? '').trim();
  const known = INSTITUTION_CATEGORIES.find((c) => c.value === raw.toLowerCase());
  if (known) return { label: known.label, ...INSTITUTION_COLOR };
  // Underscores are a storage convention, not a word: `reseau_paiement` typed
  // by hand under another name still reads as prose here.
  const shown = raw.replace(/_/g, ' ');
  const label = !shown
    ? 'institution'
    : shown.length > CHIP_MAX
      ? `${shown.slice(0, CHIP_MAX - 1)}…`
      : shown;
  return { label, ...INSTITUTION_COLOR };
}

/** Same threshold as build-contacts' isPilot: the CRM's own pilot definition. */
const PILOT_LIMIT = 5000;

/** The chip for one status word — the Clients dossiers read the same table. */
export function chipForStatus(status: keyof typeof CHIP): BusinessChip {
  return CHIP[status];
}

export function chipOf(c: Contact): BusinessChip | null {
  // First, ahead of every business word. What an authority IS outranks any
  // activation verdict that could somehow be attached to it, and build-contacts
  // attaches none by construction. Placed here rather than last so that a
  // stray join can never dress a supervisor as a paying customer.
  if (c.kind === 'institution') return institutionChip(c.institution.category);
  const b = c.business;
  if (b) {
    if (b.status === 'paying') return CHIP.paying;
    if (b.status === 'dormant') return CHIP.dormant;
    if (b.status === 'at-limit') return CHIP['at-limit'];
  }
  if (c.kind === 'client' && !c.apiKey.paid && (c.apiKey.monthlyLimit ?? 0) >= PILOT_LIMIT) {
    return CHIP.pilot;
  }
  if (b?.status === 'new') return CHIP.new;
  if (c.kind === 'prospect') return CHIP.prospect;
  return null;
}

/**
 * The three shelves of the reply queue. Unread outranks every silence for the
 * same reason the reply sort puts it first: a reply that landed this morning
 * has zero days of silence and is still the most urgent thing on the page.
 */
export type ReplyGroup = 'urgent' | 'week' | 'later';

export const REPLY_GROUP_LABEL: Record<ReplyGroup, string> = {
  urgent: 'Urgent — non lu ou plus de 7 j',
  week: 'Cette semaine',
  // Under « À répondre » nothing can wait by definition; the shelves are
  // age bands, and this one is the freshest. « Peut attendre » filed the
  // morning's mail, once read, as postponable.
  later: 'Arrivé ces deux derniers jours',
};

export function replyGroupOf(unread: boolean, silenceDays: number | null): ReplyGroup {
  if (unread) return 'urgent';
  if (silenceDays !== null && silenceDays >= 7) return 'urgent';
  if (silenceDays !== null && silenceDays >= 3) return 'week';
  return 'later';
}
