import type { MessageRow } from './build-contacts';

/**
 * Daily send caps. Warn from SOFT, block at HARD. The distribution roadmap's
 * rule is five to ten mails a day, never fifty: past that the sending domain
 * pays for it, and the domain is the asset this CRM exists to protect.
 */
export const SOFT_CAP = 8;
export const HARD_CAP = 10;

/**
 * How many real mails went out today. Drafts never count: an unsent draft
 * costs the sending domain nothing, and the cap is about what left the door.
 *
 * The day is read off `today` in UTC and compared against the leading
 * YYYY-MM-DD of the stored stamp. That pairing is deliberate:
 *
 *  1. Every stamp this CRM writes itself is UTC. /api/crm/send and
 *     /api/crm/draft-message both store `new Date().toISOString().slice(0, 16)`,
 *     so a UTC day is the same day the stamp was written in.
 *  2. msg_date carries no timezone, so building a Date out of it would read it
 *     as local time, and a UTC server would then disagree with a Zurich
 *     browser about which day a late-evening mail belongs to. Pure string work
 *     on the date part gives one answer everywhere.
 *
 * `today` is an argument for the same reason situationOf takes one: the page
 * passes the single instant it already computes the situations against, so the
 * whole page is one snapshot rather than thirty clocks that could straddle
 * midnight, and the function stays deterministic under test.
 *
 * msg_date is free text, clipped to 40 characters server-side, so a stamp that
 * is not in the ISO shape simply fails the comparison. A stamp we cannot place
 * carries no day, and the overwhelming majority of unreadable ones are old, so
 * counting them as today would be wrong far more often than right.
 */
export function countSentToday(messages: MessageRow[], today: Date = new Date()): number {
  const day = today.toISOString().slice(0, 10);
  return messages.filter((m) => m.direction === 'out' && (m.msg_date ?? '').slice(0, 10) === day)
    .length;
}
