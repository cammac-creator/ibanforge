import type { Contact } from './types';

/**
 * Is this contact deliberately asleep until a date?
 *
 * The gesture it serves: somebody says "call me back in September". Before
 * this, there was nowhere to put that. The contact came back in the day's
 * queue ten days later like everyone else, was dismissed by hand, came back
 * ten days after that, and the only way to stop the cycle was to archive the
 * row, which throws away a live lead to silence a reminder.
 *
 * ## Why a date string comparison and not two Date objects
 *
 * `wake_up_at` is a calendar day, YYYY-MM-DD, and the question is "has that
 * day arrived where the operator is". Parsing it into a Date makes it midnight
 * UTC, which in Zurich is 02:00 local, so a contact due to wake on the 15th
 * would still read as asleep for the first two hours of the 15th, and the
 * server and the browser would disagree about it. Comparing the two strings
 * avoids the whole question: both sides are asked for the same calendar day in
 * the same zone, and lexical order on YYYY-MM-DD is chronological order.
 *
 * The caller supplies today's day, once, so the whole page shares one clock.
 */
export function isSnoozed(wakeUpAt: string | null | undefined, todayIso: string): boolean {
  if (!wakeUpAt) return false;
  // Strictly greater: on the wake-up day itself the contact is awake, which is
  // what "rappeler le 15" means to the person who wrote it.
  return wakeUpAt > todayIso;
}

/** The local calendar day, as YYYY-MM-DD. Read once, on the server. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * One entry per contact id, built by the page against a single clock and
 * handed down, exactly as the situations are and for the same reason: a
 * boolean computed on the server and recomputed in the browser is a hydration
 * mismatch the moment the two disagree about what day it is.
 */
export function snoozedMap(contacts: Contact[], now: Date): Record<string, boolean> {
  const today = localDay(now);
  const out: Record<string, boolean> = {};
  for (const c of contacts) {
    const wake = c.kind === 'prospect' ? c.sourcing.wakeUpAt : c.sourcing?.wakeUpAt;
    out[c.id] = isSnoozed(wake, today);
  }
  return out;
}

/**
 * How long a returned sleeper keeps its "réveillé" badge. Past this window the
 * flag goes quiet on its own: a row nobody acted on for two weeks has become
 * ordinary work again, and a badge that never expires stops meaning anything.
 */
export const WAKE_WINDOW_DAYS = 14;

/**
 * Recently woken: the wake date has arrived and is still inside the return
 * window. This is the other half of the snooze gesture — a contact put to
 * sleep with a date comes back, and without this flag it would come back
 * naked, indistinguishable from a row that was merely never dealt with.
 *
 * Same shape and same clock discipline as snoozedMap, and mutually exclusive
 * with it by construction: snoozed needs wakeUpAt > today, woke needs <= today.
 */
export function wokeMap(contacts: Contact[], now: Date): Record<string, boolean> {
  const today = localDay(now);
  const floor = new Date(now);
  floor.setDate(floor.getDate() - WAKE_WINDOW_DAYS);
  const floorDay = localDay(floor);
  const out: Record<string, boolean> = {};
  for (const c of contacts) {
    const wake = c.kind === 'prospect' ? c.sourcing.wakeUpAt : c.sourcing?.wakeUpAt;
    out[c.id] = !!wake && wake <= today && wake > floorDay;
  }
  return out;
}
