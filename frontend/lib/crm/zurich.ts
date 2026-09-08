/**
 * UTC stamps shown as Swiss time, without Intl.
 *
 * ## Why this exists
 *
 * Every `msg_date` the CRM stores is UTC: the API records departures with
 * `utcnow()`, the IMAP sync files the mail's UTC date, and the scheduled sends
 * of 08/09/2026 carry the UTC minute the VPS will honour. The journal used to
 * print those digits as they were, so a draft scheduled for 10:22 Swiss time
 * read "08:22" — and at 09:50 looked overdue when nothing was due at all.
 *
 * ## Why not Intl
 *
 * `Intl.DateTimeFormat` in a client component is the one thing this codebase
 * has learnt never to do (a 500 on the home page, 05/09/2026). The Swiss rule
 * is small enough to write down: UTC+1, and UTC+2 between the last Sunday of
 * March at 01:00 UTC and the last Sunday of October at 01:00 UTC. Pure, the
 * same on the server and in the browser, testable.
 */

const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** Last Sunday of a month, as a UTC millisecond timestamp at 01:00 UTC. */
function lastSundayAtOne(year: number, month0: number): number {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0));
  const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month0, sunday, 1, 0, 0);
}

/** Offset of Europe/Zurich from UTC, in minutes, at a UTC instant. */
export function zurichOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const start = lastSundayAtOne(year, 2); // last Sunday of March, 01:00 UTC
  const end = lastSundayAtOne(year, 9); // last Sunday of October, 01:00 UTC
  return utcMs >= start && utcMs < end ? 120 : 60;
}

/**
 * A stored UTC stamp rewritten in Swiss time, same shape ('YYYY-MM-DDTHH:MM'
 * plus ':SS' when the input had seconds). Anything that is not a stamp comes
 * back untouched, so a caller can pass what it has.
 */
export function toZurich(raw: string): string {
  const m = STAMP.exec(raw);
  if (!m) return raw;
  const utcMs = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
  const local = new Date(utcMs + zurichOffsetMinutes(utcMs) * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  return m[6] !== undefined ? `${base}:${pad(local.getUTCSeconds())}` : base;
}
