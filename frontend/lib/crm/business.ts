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

/** Same threshold as build-contacts' isPilot: the CRM's own pilot definition. */
const PILOT_LIMIT = 5000;

/** The chip for one status word — the Clients dossiers read the same table. */
export function chipForStatus(status: keyof typeof CHIP): BusinessChip {
  return CHIP[status];
}

export function chipOf(c: Contact): BusinessChip | null {
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
  later: 'Peut attendre',
};

export function replyGroupOf(unread: boolean, silenceDays: number | null): ReplyGroup {
  if (unread) return 'urgent';
  if (silenceDays !== null && silenceDays >= 7) return 'urgent';
  if (silenceDays !== null && silenceDays >= 3) return 'week';
  return 'later';
}
