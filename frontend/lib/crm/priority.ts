import type { Contact, Situation } from './types';

/**
 * In which order should the queue be worked?
 *
 * ## The problem this solves
 *
 * Measured on 27/07/2026: a large batch of follow-ups came due at once, weeks
 * of median silence, and nearly all of them had received exactly one mail. The
 * list ordered them by how long they had been silent, which is the least
 * informative signal available, and showed no reason for the order it had
 * chosen. At five to ten sends a day, the order in which that queue is attacked
 * is the most consequential decision of the week, and the tool was not helping
 * make it.
 *
 * ## The ladder
 *
 * Each rung is a claim about value that holds independently of the campaign:
 *
 *  0. someone wrote and is waiting. Nothing outranks answering a person.
 *  1. already a customer. Keeping one costs less than finding one.
 *  2. has replied at least once. A warm thread beats a cold address.
 *  3. 4. 5. sourcing confidence, high before medium before low.
 *  6. nothing known about them.
 *  7. deliberately put to sleep until a date (wired in a later lot).
 *
 * Within a rung the longest silence comes first, which is the old rule kept
 * where it is actually the right one: between two otherwise equal threads, the
 * one closest to being lost goes first.
 *
 * ## Why segment is NOT a rung, though the audit listed it
 *
 * The reply counts by segment on the real data are a handful at most, out of
 * a few dozen sends in all. Ranking on those numbers would harden a
 * difference that samples this small do not support: at a uniform 10 % reply
 * rate, a dozen sends come back with zero replies about once in four times.
 * The same caution is written into the audit and it would be incoherent to
 * encode the opposite here. Confidence earns its three rungs on a different basis: it
 * is the only field where the whole of the evidence and the whole of the
 * absence of evidence point the same way, so ordering by it costs nothing if
 * it turns out to be noise.
 */
export type PriorityKey =
  | 'answer'
  | 'client'
  | 'replied'
  | 'high'
  | 'medium'
  | 'low'
  | 'unknown'
  | 'snoozed';

export interface Priority {
  /** Lower sorts first. */
  rank: number;
  key: PriorityKey;
  /** Shown on the row, so the order never has to be taken on trust. */
  reason: string;
}

const LADDER: Record<PriorityKey, { rank: number; reason: string }> = {
  answer: { rank: 0, reason: 'il attend ta réponse' },
  client: { rank: 1, reason: 'déjà client' },
  replied: { rank: 2, reason: 'a déjà répondu' },
  high: { rank: 3, reason: 'confiance haute' },
  medium: { rank: 4, reason: 'confiance moyenne' },
  low: { rank: 5, reason: 'confiance faible' },
  unknown: { rank: 6, reason: 'non qualifié' },
  snoozed: { rank: 7, reason: 'en veille' },
};

const BY_CONFIDENCE: Record<string, PriorityKey> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/**
 * `snoozed` is passed in rather than derived from a date on purpose: this runs
 * in the list, which is server-rendered then hydrated, and any clock read on
 * both sides of that boundary is a mismatch waiting to happen. The page holds
 * the single clock and hands the answer down, exactly as it does for
 * situations.
 */
export function priorityOf(
  c: Contact,
  s: Situation | undefined,
  snoozed: boolean = false,
): Priority {
  const key = keyOf(c, s, snoozed);
  return { key, ...LADDER[key] };
}

function keyOf(c: Contact, s: Situation | undefined, snoozed: boolean): PriorityKey {
  // Sleeping beats every other consideration except an actual person waiting:
  // if they wrote while snoozed, the snooze has been overtaken by events.
  if (s?.ballInCourt === 'us') return 'answer';
  if (snoozed) return 'snoozed';
  // A paying customer, or a free key that is genuinely being used. An unused
  // free key is an address that once signed up, which is not a relationship.
  if (c.kind === 'client' && (c.apiKey.paid || c.apiKey.usedAllTime > 0)) return 'client';
  if (s?.hasEverReplied) return 'replied';
  const confidence = c.kind === 'prospect' ? c.sourcing.confidence : c.sourcing?.confidence;
  return (confidence && BY_CONFIDENCE[confidence]) || 'unknown';
}

/**
 * Sort comparator for a queue of contacts: by rung, then longest silence, then
 * id. The id tiebreak is what keeps the order identical on the server and in
 * the browser when two rows are otherwise equal, rather than following whatever
 * order the API happened to return.
 */
export function byPriority(
  a: { c: Contact; s: Situation | undefined; p: Priority },
  b: { c: Contact; s: Situation | undefined; p: Priority },
): number {
  if (a.p.rank !== b.p.rank) return a.p.rank - b.p.rank;
  const silence = (b.s?.silenceDays ?? 0) - (a.s?.silenceDays ?? 0);
  if (silence !== 0) return silence;
  return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
}

/**
 * Prospects we could actually write to today: an address to write to, not set
 * aside, and never yet written to. Rejected rows never reach here, since
 * buildContacts drops them.
 *
 * This exists because the "Prospects" card counts the whole list and therefore
 * reads as a reserve. Measured on 27/07/2026, it showed the full list while the
 * number of high confidence prospects left to write to had fallen to zero, the
 * last one having been rejected. A card that says "reserve" when the reserve is
 * empty is worse than no card.
 */
export function sendableStock(contacts: Contact[]): { total: number; byConfidence: Record<string, number> } {
  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0, unknown: 0 };
  let total = 0;
  for (const c of contacts) {
    if (c.kind !== 'prospect') continue;
    if (!c.email) continue;
    if (c.sourcing.status === 'archive') continue;
    if (c.messages.length > 0) continue;
    total += 1;
    const k = c.sourcing.confidence && BY_CONFIDENCE[c.sourcing.confidence] ? c.sourcing.confidence : 'unknown';
    byConfidence[k] = (byConfidence[k] ?? 0) + 1;
  }
  return { total, byConfidence };
}
