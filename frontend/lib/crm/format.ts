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
