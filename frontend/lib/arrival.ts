/**
 * Where a visitor came from, captured on ARRIVAL and handed to the key request.
 *
 * ## Why this exists
 *
 * The attribution shipped on 06/08/2026 read `?src=` inside the POST handler,
 * which only works for a visitor who lands on a `?src=` URL and signs up
 * without navigating. Measured on 30/08: every external key had an empty
 * source. The capture moved to arrival time on 30/08 (sessionStorage), and on
 * 02/09 it grew from one campaign tag to what a decision actually needs: the
 * landing page, the referring site, and the utm_* triplet. None of it is
 * personal data: a path on our own site, a host name, campaign labels.
 *
 * ## sessionStorage, and not localStorage
 *
 * The right lifetime is the visit. localStorage would attribute a signup made
 * three weeks later to a link clicked once, which is worse than no attribution:
 * a wrong number is acted on, an absent one is questioned. The first arrival of
 * the session wins; a campaign link opened later in the same session only
 * refreshes the campaign fields. A browser that refuses storage falls back to
 * the live URL, which is the behaviour we had before.
 */

export interface Arrival {
  landing?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  src?: string;
}

export const ARRIVAL_STORAGE_KEY = 'ibf_arrival';
/** The key the 30/08 capture used; still read so a session that spans the deploy keeps its tag. */
const LEGACY_SRC_KEY = 'ibf_src';

/** The exact shapes the API accepts (src/lib/signup-attribution.ts), so nothing stored would be refused. */
const SRC_SHAPE = /^[a-z0-9_-]{1,40}$/;
const UTM_SHAPE = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
const LANDING_MAX = 120;
const HOST_MAX = 80;

export const OWN_HOSTS = ['ibanforge.com', 'www.ibanforge.com', 'localhost', '127.0.0.1'];

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/** Pure: derive the arrival from an href and a referrer string. */
export function arrivalFromLocation(href: string, referrer: string, ownHosts: string[] = OWN_HOSTS): Arrival {
  const out: Arrival = {};
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return out;
  }
  if (url.pathname) out.landing = url.pathname.slice(0, LANDING_MAX);
  const q = url.searchParams;
  const src = (q.get('src') ?? '').trim().toLowerCase();
  if (SRC_SHAPE.test(src)) out.src = src;
  for (const k of UTM_KEYS) {
    const v = (q.get(k) ?? '').trim().toLowerCase();
    if (UTM_SHAPE.test(v)) out[k] = v;
  }
  if (referrer) {
    try {
      const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
      if (host && !ownHosts.includes(host)) out.referrer = host.slice(0, HOST_MAX);
    } catch {
      // A referrer that is not a URL says nothing worth keeping.
    }
  }
  return out;
}

/** The part of an arrival the API stores as attribution (the campaign tag travels separately as `source`). */
export function attributionOf(a: Arrival): Omit<Arrival, 'src'> {
  const { landing, referrer, utm_source, utm_medium, utm_campaign } = a;
  return {
    ...(landing ? { landing } : {}),
    ...(referrer ? { referrer } : {}),
    ...(utm_source ? { utm_source } : {}),
    ...(utm_medium ? { utm_medium } : {}),
    ...(utm_campaign ? { utm_campaign } : {}),
  };
}

function liveArrival(): Arrival {
  return arrivalFromLocation(window.location.href, document.referrer);
}

/** Merge a later campaign link into the arrival of record: labels refresh, landing and referrer stay. */
export function mergeArrival(first: Arrival, later: Arrival): Arrival {
  const merged: Arrival = { ...first };
  if (later.src) merged.src = later.src;
  for (const k of UTM_KEYS) if (later[k]) merged[k] = later[k];
  return merged;
}

/** Call once on arrival: the only moment the referrer and the campaign query string are still there. */
export function rememberArrival(): void {
  if (typeof window === 'undefined') return;
  const live = liveArrival();
  try {
    const raw = window.sessionStorage.getItem(ARRIVAL_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Arrival) : null;
    const next = stored ? mergeArrival(stored, live) : live;
    if (!next.src) {
      const legacy = window.sessionStorage.getItem(LEGACY_SRC_KEY);
      if (legacy && SRC_SHAPE.test(legacy)) next.src = legacy;
    }
    window.sessionStorage.setItem(ARRIVAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode, storage disabled, quota: attribution is best-effort and
    // must never be the reason a key request fails.
  }
}

export function readArrival(): Arrival | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ARRIVAL_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Arrival;
  } catch {
    // fall through to the live URL
  }
  return liveArrival();
}
