/**
 * The health line of /status: is the API up, how long did /health take, which
 * version answered.
 *
 * /status is rendered on each visit (no build copy, see its page). A fetch kept
 * in Next's data cache would lie there: in a request render a stale entry is
 * served as is and refreshed in the background (willConsumerServerCache is
 * false for "request"), so the page would time a cache read, a near-zero
 * latency, and keep the last 200 on screen while the API is down, since only a
 * 200 enters the cache. So the round trip is made outside the data cache and
 * timed for real, and its reading is kept here, in the server's memory, for five
 * minutes: the API is asked at most once every five minutes per server process,
 * as when the page was regenerated every five minutes, and an outage shows up
 * at most five minutes after it starts.
 */

export interface HealthReading {
  healthy: boolean;
  /** Measured round trip to /health. null when no answer arrived. */
  latencyMs: number | null;
  version: string | null;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

interface ProbeOptions {
  fetcher?: Fetcher;
  now?: () => number;
  /** How long a reading is reused. */
  ttlMs?: number;
  /** Deadline of one round trip: past it the API is reported disrupted. */
  timeoutMs?: number;
}

const FIVE_MINUTES_MS = 300_000;
const DEADLINE_MS = 5_000;

export function createHealthProbe(url: string, options: ProbeOptions = {}): () => Promise<HealthReading> {
  const fetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? FIVE_MINUTES_MS;
  const timeoutMs = options.timeoutMs ?? DEADLINE_MS;

  let last: { at: number; reading: HealthReading } | null = null;
  let inFlight: Promise<HealthReading> | null = null;

  async function measure(): Promise<HealthReading> {
    const start = now();
    try {
      // no-store: outside the data cache, so this is a real round trip. The
      // abort only exists because nothing is cached here anyway.
      const res = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      const latencyMs = now() - start;
      if (!res.ok) return { healthy: false, latencyMs, version: null };
      const body = (await res.json()) as { version?: string };
      return { healthy: true, latencyMs, version: body.version ?? null };
    } catch {
      // Refused, unreachable or past the deadline: no answer, so no latency.
      return { healthy: false, latencyMs: null, version: null };
    }
  }

  return async function read(): Promise<HealthReading> {
    if (last && now() - last.at < ttlMs) return last.reading;
    if (!inFlight) {
      inFlight = measure()
        .then((reading) => {
          last = { at: now(), reading };
          return reading;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}
