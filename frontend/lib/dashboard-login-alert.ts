/**
 * Telling the owner about the dashboard's front door (audit of 10/11/2026,
 * WEB-01, lot C11).
 *
 * ## The channel
 *
 * The site has no alert channel of its own. The one that reaches the owner is
 * the API's Telegram bot (`notifyOps` in `src/lib/ops-alert.ts`), so the site
 * asks the API to send it, through `POST /v1/admin/dashboard-login-alert`, with
 * what it already holds: `API_URL` and its admin key (`siteAdminKey()`, the
 * site's scoped key since lot C08). No new variable, and the bot's token stays
 * out of the site's process.
 *
 * `notifyDashboardOwner` is the ONE place that makes that call. Its literal
 * path is in the site key's list of routes (`SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN`
 * in `src/lib/admin-auth.ts`), held against this code by
 * `src/lib/admin-auth.site.test.ts`.
 *
 * ## What never leaves
 *
 * Never the password, never the cookie, never the visitor's full address: the
 * alert carries an event, a UTC instant and, for a login, a masked hint of the
 * network (`networkHint`). The API refuses anything that is not masked, and
 * writes the time in Swiss time itself.
 */
import { siteAdminKey } from '@/lib/admin-key';

/** How long the call may run. It never holds the login: the caller does not await it. */
export const LOGIN_ALERT_TIMEOUT_MS = 10_000;

/** What `networkHint` says when the address cannot be read as an IP. */
export const UNKNOWN_NETWORK = 'inconnu';

export type DashboardLoginAlert =
  /** A successful login: when, and from which network (masked). */
  | { event: 'login_ok'; at: string; network: string }
  /** The global ceiling on wrong passwords tripped: one alert per episode. */
  | {
      event: 'global_cap';
      at: string;
      /** When the ceiling lifts by itself. */
      until: string;
      failures: number;
      /** Distinct client addresses behind those failures (a count, never a list). */
      addresses: number;
    };

function ipv4Octets(raw: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(raw);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(raw: string): number[] | null {
  let s = raw;
  // An embedded IPv4 tail (`::ffff:192.0.2.1`) becomes its two groups.
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const o = ipv4Octets(tail[2]);
    if (!o) return null;
    s = `${tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const given = head.length + rest.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return null;
  const groups = [...head, ...Array<string>(8 - given).fill('0'), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * A hint of the network an address belongs to, never the address itself.
 *
 * IPv4 keeps its first two octets (`198.51.x.x`); IPv6 keeps its first two
 * groups (`2001:db8::/32`, the size of a provider's allocation); an IPv4 mapped
 * into IPv6 (`::ffff:192.0.2.1`) is read as the IPv4 it carries, so its tail is
 * never taken for a prefix. Anything else, `unknown` included, answers
 * `inconnu`: an unreadable value is never passed on, since it might still be an
 * address in a shape this function does not know.
 */
export function networkHint(address: string): string {
  let raw = address.trim().toLowerCase();
  if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1);
  raw = raw.replace(/%[0-9a-z._-]+$/, ''); // an IPv6 zone index says nothing useful

  const v4 = ipv4Octets(raw);
  if (v4) return `${v4[0]}.${v4[1]}.x.x`;

  const g = ipv6Groups(raw);
  if (!g) return UNKNOWN_NETWORK;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 0xff}.x.x`;
  }
  return `${g[0].toString(16)}:${g[1].toString(16)}::/32`;
}

/**
 * Asks the API to alert the owner. Never throws and never rejects: an alert
 * that breaks the login it reports on is worse than no alert. Unconfigured
 * (`API_URL` or the admin key missing), it does nothing and the login works as
 * before. The logs name the event and the failure, never what was sent.
 *
 * Resolves to whether the API accepted the request (`true` does not mean
 * Telegram delivered it: the API answers `{ sent }` for that).
 */
export async function notifyDashboardOwner(alert: DashboardLoginAlert): Promise<boolean> {
  try {
    const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
    const secret = siteAdminKey();
    if (!apiUrl || !secret) {
      console.warn(`[login-alert] API_URL or the admin key not set: ${alert.event} alert skipped`);
      return false;
    }
    const res = await fetch(`${apiUrl}/v1/admin/dashboard-login-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
      body: JSON.stringify(alert),
      cache: 'no-store',
      signal: AbortSignal.timeout(LOGIN_ALERT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[login-alert] API answered ${res.status}: ${alert.event} alert not sent`);
      return false;
    }
    return true;
  } catch (e) {
    const kind = e instanceof Error ? e.name : 'unknown error';
    console.error(`[login-alert] ${kind}: ${alert.event} alert not sent`);
    return false;
  }
}
