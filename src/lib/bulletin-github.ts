/**
 * What went live during a week, for the Monday bulletin: the pull requests merged
 * into `main`, read from GitHub's public API.
 *
 * ## Why the pull list and not the search API
 *
 * GitHub's search API refuses unauthenticated calls coming from a datacenter (the
 * forum radar met a 403 on its very first tick on Railway, see
 * `forum-radar-server.ts`). The pull list of a public repository answers without a
 * token, within 60 calls per hour and per address. It is sorted by last update,
 * newest first: a pull request merged during the week was updated at its merge at
 * the earliest, so the reading stops at the first page that goes back past the
 * Monday. `merged_at` is set by GitHub even when the integrator merges locally and
 * pushes: the pull request is marked merged when its head reaches `main`.
 *
 * ## Why a cache, and why "unread"
 *
 * Those 60 calls per hour are shared by everything that leaves Railway's address
 * without a token. A successful reading is kept one hour per week, a failure ten
 * minutes, and two simultaneous readings of the same week wait for the same call.
 * A refusal, a cut, a timeout, an unreadable body, or a week too far back for the
 * page ceiling all answer `state: 'unread'`: never an empty list, which would say
 * "nothing went live" without having read it, and never a truncated one.
 *
 * The only token sent is the optional read-only `GITHUB_TOKEN` the forum radar
 * already reads, when it exists (5 000 calls an hour instead of 60 shared); never
 * the private overlay's token, and no address of anyone: the other identifying
 * header is a neutral `User-Agent`.
 */
import { sqliteUtc, type SwissWeek } from './swiss-week.js';

export const BULLETIN_REPO = 'cammac-creator/ibanforge';

const API = 'https://api.github.com';
const PER_PAGE = 100;
/** Five pages of a hundred: several months of this repository's pace. */
export const MERGED_PULLS_MAX_PAGES = 5;
const CALL_TIMEOUT_MS = 6_000;
/** The whole reading, every page included: the dashboard page waits for it. */
const TOTAL_BUDGET_MS = 12_000;
/** A reading is kept one hour: the brief's floor, and a complete week no longer changes. */
export const MERGED_PULLS_SUCCESS_TTL_MS = 60 * 60_000;
/** A failure is kept ten minutes, so a page reloaded in a loop does not spend the shared calls. */
export const MERGED_PULLS_FAILURE_TTL_MS = 10 * 60_000;
const MAX_CACHED_WEEKS = 16;
const TITLE_MAX = 200;

export interface MergedPull {
  number: number;
  title: string;
  /** UTC, `AAAA-MM-JJ HH:MM:SS`. */
  merged_at: string;
  url: string;
}

interface ReadBase {
  source: 'github';
  repo: string;
  /** When GitHub was read (or refused), UTC, `AAAA-MM-JJ HH:MM:SS`. */
  fetched_at: string;
}

export type MergedPullsRead =
  | (ReadBase & { state: 'read'; pulls: MergedPull[] })
  | (ReadBase & { state: 'unread'; reason: string });

interface CacheEntry {
  value: MergedPullsRead;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<MergedPullsRead>>();

/** Test hook: forget every cached reading and every reading in flight. */
export function resetMergedPullsCache(): void {
  cache.clear();
  inflight.clear();
}

interface PullItem {
  number: number;
  title: string;
  merged_at: string | null;
  updated_at: string;
  base: { ref: string };
}

/** The fields this module relies on, checked on every item: a malformed page is not read. */
function isPullItem(value: unknown): value is PullItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const base = v.base as Record<string, unknown> | null | undefined;
  return (
    Number.isInteger(v.number) &&
    typeof v.title === 'string' &&
    (v.merged_at === null || typeof v.merged_at === 'string') &&
    typeof v.updated_at === 'string' &&
    !!base &&
    typeof base === 'object' &&
    typeof base.ref === 'string'
  );
}

function unread(reason: string, at: number): MergedPullsRead {
  return {
    state: 'unread',
    source: 'github',
    repo: BULLETIN_REPO,
    reason,
    fetched_at: sqliteUtc(at),
  };
}

function failureReason(err: unknown): string {
  // `AbortSignal.timeout` rejects with a DOMException named TimeoutError.
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
}

async function readFromGitHub(week: SwissWeek, at: number): Promise<MergedPullsRead> {
  const pulls = new Map<number, MergedPull>();
  const deadline = performance.now() + TOTAL_BUDGET_MS;
  for (let page = 1; page <= MERGED_PULLS_MAX_PAGES; page++) {
    const url =
      `${API}/repos/${BULLETIN_REPO}/pulls?state=closed&sort=updated&direction=desc` +
      `&per_page=${PER_PAGE}&page=${page}`;
    const left = Math.floor(deadline - performance.now());
    if (left <= 0) return unread('timeout', at);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ibanforge-bulletin',
          'X-GitHub-Api-Version': '2022-11-28',
          // The optional read-only token the forum radar already reads: without it,
          // the 60 calls an hour are shared with that radar and with every service
          // behind the same Railway address.
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(Math.min(CALL_TIMEOUT_MS, left)),
      });
    } catch (err) {
      return unread(failureReason(err), at);
    }
    if (!res.ok) return unread(`http_${res.status}`, at);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return unread('invalid_body', at);
    }
    if (!Array.isArray(body) || !body.every(isPullItem)) return unread('invalid_body', at);

    let wentBackPastMonday = false;
    for (const item of body) {
      const updated = Date.parse(item.updated_at);
      if (!Number.isFinite(updated)) return unread('invalid_body', at);
      if (updated < week.startMs) wentBackPastMonday = true;
      if (item.base.ref !== 'main' || item.merged_at === null) continue;
      const merged = Date.parse(item.merged_at);
      if (!Number.isFinite(merged) || merged < week.startMs || merged >= week.endMs) continue;
      // The link is built here rather than taken from the answer: the page makes it
      // clickable, and it can only point at this repository.
      pulls.set(item.number, {
        number: item.number,
        title: item.title.slice(0, TITLE_MAX),
        merged_at: sqliteUtc(merged),
        url: `https://github.com/${BULLETIN_REPO}/pull/${item.number}`,
      });
    }
    // Sorted by update, newest first: once one item was last touched before the
    // Monday, none after it can have been merged during the week.
    if (wentBackPastMonday || body.length < PER_PAGE) {
      return {
        state: 'read',
        source: 'github',
        repo: BULLETIN_REPO,
        fetched_at: sqliteUtc(at),
        pulls: [...pulls.values()].sort(
          (a, b) => a.merged_at.localeCompare(b.merged_at) || a.number - b.number,
        ),
      };
    }
  }
  // The ceiling was reached before the list went back past the Monday: the week
  // is too far back to be read whole, and a partial list is not a fact.
  return unread('too_many_pages', at);
}

function remember(label: string, value: MergedPullsRead, at: number): void {
  const ttl = value.state === 'read' ? MERGED_PULLS_SUCCESS_TTL_MS : MERGED_PULLS_FAILURE_TTL_MS;
  cache.delete(label);
  cache.set(label, { value, expiresAt: at + ttl });
  while (cache.size > MAX_CACHED_WEEKS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * The pull requests merged into `main` during a Swiss week, from the cache when it
 * is fresh. Never throws: every failure is an `unread` answer with a short reason.
 */
export async function mergedPullsOfWeek(
  week: SwissWeek,
  now: number = Date.now(),
): Promise<MergedPullsRead> {
  const hit = cache.get(week.label);
  if (hit && hit.expiresAt > now) return hit.value;
  const running = inflight.get(week.label);
  if (running) return running;
  const reading = readFromGitHub(week, now)
    .catch(() => unread('network', now))
    .then((value) => {
      remember(week.label, value, now);
      return value;
    })
    .finally(() => {
      inflight.delete(week.label);
    });
  inflight.set(week.label, reading);
  return reading;
}
