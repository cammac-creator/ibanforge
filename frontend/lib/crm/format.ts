/**
 * Display formatting for stored mail dates.
 *
 * Lives in lib/crm next to types, quoted and situation because it is pure and
 * shared: the banner is a Server Component and the thread is a Client
 * Component, and a plain module can be imported by both without crossing any
 * boundary. Keeping it out of the components also keeps it testable.
 *
 * Never builds a Date, deliberately. Stored stamps look like
 * 'YYYY-MM-DDTHH:MM' and carry no timezone, so `new Date(...)` reads them as
 * local time: the thread is prerendered on the server then hydrated in the
 * browser, and a UTC server against a Europe/Zurich browser would produce two
 * different strings, which React reports as a hydration mismatch. Pure string
 * work gives the same answer in both places.
 *
 * msg_date is free text in the database (clipped to 40 characters server-side),
 * so anything that does not match falls back to the raw value rather than
 * disappearing or being truncated mid-token: slicing blindly would turn
 * 'Jan 5, 2026' into 'Jan 5, 202'.
 */

/** Leading 'YYYY-MM-DD', optionally followed by 'THH:MM' or ' HH:MM'. */
const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

interface Parts {
  day: string;
  month: string;
  hour?: string;
  minute?: string;
}

function parseStamp(raw: string): Parts | null {
  const m = STAMP.exec(raw);
  if (!m) return null;
  return { month: m[2], day: m[3], hour: m[4], minute: m[5] };
}

/**
 * Day and time for a message in the thread, e.g. '04/07 21:40', or '04/07'
 * when the stamp carries no time. Returns null for a missing date so the
 * caller can say so rather than render an empty slot; returns the raw string
 * unchanged when it does not match the expected shape.
 */
export function formatStamp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = parseStamp(raw);
  if (!p) return raw;
  return p.hour ? `${p.day}/${p.month} ${p.hour}:${p.minute}` : `${p.day}/${p.month}`;
}

/**
 * The stored day as 'YYYY-MM-DD', or null when the stamp does not carry one.
 *
 * Not a display format — the one thing in this file that is meant to be
 * COMPARED rather than read. Two stamps in this shape sort as strings exactly
 * as they sort in time, which is what lets the journal window a period and
 * shelve a day without ever building a Date (lib/crm/journal.ts), the same way
 * the admin endpoint's `since` cut compares msg_date as text.
 *
 * Null rather than the raw string, unlike the two formatters above: a caller
 * that cannot read a day needs to DROP the row, not print it. Handing back
 * something unparseable would put it in every window at once, since almost any
 * string compares greater than a date.
 */
export function isoDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = STAMP.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * The ISO day `delta` days away from an ISO day, e.g. the start of a window.
 *
 * UTC arithmetic on the parsed digits, the same idiom as dayLabel below and
 * for the same reason: this runs on a server and again in a browser two zones
 * away, and a local-time Date would put the boundary on different days on each
 * side of hydration. Returns null on anything that is not an ISO day.
 */
export function shiftDay(isoDayValue: string, delta: number): string | null {
  const m = STAMP.exec(isoDayValue);
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + delta * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Day alone, e.g. '04/07'. Used where the time would be noise, such as the
 * first-contact anchor in the situation banner. Same null and fallback
 * behaviour as formatStamp.
 */
export function formatDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = parseStamp(raw);
  if (!p) return raw;
  return `${p.day}/${p.month}`;
}

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/**
 * « aujourd’hui », « hier », or « lundi 17 août » — the shelf between two days
 * of a thread, with the year when it is not this one.
 *
 * String work against a day the PAGE decided, never `new Date()` or
 * `toLocaleDateString`: the thread is rendered on the server and hydrated in
 * a browser two time zones away, and the old version read the same stamp in
 * UTC on one branch and local time on the other, so an intercalary could sit
 * on a different day on each side. The weekday comes from UTC arithmetic on
 * the parsed digits, which is the same on both.
 */
export function dayLabel(raw: string | null | undefined, todayIso: string): string | null {
  if (!raw) return null;
  const m = STAMP.exec(raw);
  const t = STAMP.exec(todayIso);
  if (!m || !t) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [ty, tmo, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  const gap = Math.round((Date.UTC(ty, tmo - 1, td) - Date.UTC(y, mo - 1, d)) / 86_400_000);
  if (gap === 0) return 'aujourd’hui';
  if (gap === 1) return 'hier';
  const weekday = DAY_NAMES[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const month = MONTH_NAMES[mo - 1] ?? m[2];
  return `${weekday} ${d} ${month}${y !== ty ? ` ${y}` : ''}`;
}
