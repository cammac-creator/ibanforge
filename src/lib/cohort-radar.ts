/**
 * Cohort radar — pure logic.
 *
 * The CRM builds one dossier per address, so a burst of automated signups shows
 * up as N fake "customers" polluting every business reading. Regrouping them
 * under one synthetic contact was a manual gesture until now; this module is the
 * part that decides, from creation rows alone, WHICH signups form one cohort.
 *
 * Why the client library string is the anchor: signups are counted per network,
 * and a client presenting a fresh address for each signup makes every one of them
 * look like a first-time visitor. The library string it sends does not change
 * between those signups, so it links them back together.
 *
 * Why the decision is never taken on one address: a pseudonymous address is a
 * perfectly ordinary customer here (several paying ones use one). So a single
 * odd-looking address proves nothing — only a GROUP does: same client, same
 * short window, and a majority of addresses sharing the machine-made shape.
 */

/** A signup as recorded at creation time. */
export interface CreationRow {
  key_prefix: string | null;
  user_agent: string | null;
  email: string | null;
  created_at: string;
}

export interface CohortWindow {
  /** How far back to look, in hours. */
  hours: number;
  /** How many signups from one client in that window before it forms a cohort. */
  minKeys: number;
}

/**
 * Three nested windows rather than one threshold: a single "N per 15 minutes"
 * rule is blind to the slow variant (a signup every few minutes never trips it),
 * and a single weekly rule reacts far too late to a burst.
 */
export const COHORT_WINDOWS: CohortWindow[] = [
  { hours: 0.25, minKeys: 5 },
  { hours: 24, minKeys: 8 },
  { hours: 24 * 7, minKeys: 15 },
];

/** Share of a group's addresses that must look machine-made for it to qualify. */
export const MIN_MACHINE_SHAPE_RATIO = 0.6;

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * Does this local part look machine-made rather than chosen by a person?
 *
 * Deliberately conservative — it is only ever used to measure a PROPORTION
 * inside an already-grouped set, never to judge one address on its own:
 *  - a person's address almost always carries a digit, a dot, a dash or an
 *    underscore; a generated one here was pure lowercase letters;
 *  - human words alternate vowels and consonants. A long consonant run, or
 *    almost no vowels at all, is the signature of a random draw.
 */
export function looksMachineMade(localPart: string): boolean {
  const s = localPart.toLowerCase();
  if (s.length < 8) return false;
  if (!/^[a-z]+$/.test(s)) return false;

  let vowels = 0;
  let run = 0;
  let longestRun = 0;
  for (const ch of s) {
    if (VOWELS.has(ch)) {
      vowels++;
      run = 0;
    } else {
      run++;
      if (run > longestRun) longestRun = run;
    }
  }
  return longestRun >= 4 || vowels / s.length < 0.25;
}

export function localPartOf(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

export interface Cohort {
  /** The client library string shared by every signup in the cohort. */
  userAgent: string;
  keyPrefixes: string[];
  /** Which window triggered it, for the report. */
  windowHours: number;
  machineShapeRatio: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Find the cohorts among these creation rows.
 *
 * `now` is injected rather than read from the clock so the decision is
 * reproducible in tests and in a replay.
 *
 * Rows without a client library string are skipped entirely: with nothing to
 * link them, grouping them would mean grouping strangers together.
 */
/** SQLite datetime('now') writes "YYYY-MM-DD HH:MM:SS" in UTC; the space must
 *  become a T (and the zone be explicit) or Date reads it as local time and the
 *  window silently shifts by the machine's offset. Returns NaN on a bad value. */
function toMs(created_at: string): number {
  return new Date(`${created_at.replace(' ', 'T')}Z`).getTime();
}

/**
 * Does any SLIDING window of `hours` hold at least `minKeys` of these
 * timestamps? Returns the tightest matching window (they are tried narrowest
 * first, a tight burst being the stronger signal).
 *
 * Anchoring on the current tick instead — [now−15min, now] — would miss a
 * five-signup burst that finished twenty minutes before the hourly pass, and
 * that burst would then also fall under the wider thresholds. A slide over the
 * loaded history catches it whenever it happened.
 */
function burstWindow(sortedMs: number[], windows: CohortWindow[]): CohortWindow | null {
  for (const w of windows) {
    const span = w.hours * 60 * 60 * 1000;
    let lo = 0;
    for (let hi = 0; hi < sortedMs.length; hi++) {
      while (sortedMs[hi] - sortedMs[lo] > span) lo++;
      if (hi - lo + 1 >= w.minKeys) return w;
    }
  }
  return null;
}

export function findCohorts(rows: CreationRow[], now: Date, windows: CohortWindow[] = COHORT_WINDOWS): Cohort[] {
  const maxHours = Math.max(...windows.map((w) => w.hours));
  const since = now.getTime() - maxHours * 60 * 60 * 1000;

  const usable = rows.filter(
    (r): r is CreationRow & { user_agent: string; key_prefix: string; email: string } =>
      typeof r.user_agent === 'string' &&
      r.user_agent.length > 0 &&
      typeof r.key_prefix === 'string' &&
      r.key_prefix.length > 0 &&
      typeof r.email === 'string' &&
      r.email.includes('@') &&
      !Number.isNaN(toMs(r.created_at)) &&
      toMs(r.created_at) >= since,
  );

  const byClient = new Map<string, Array<(typeof usable)[number]>>();
  for (const row of usable) {
    const list = byClient.get(row.user_agent);
    if (list) list.push(row);
    else byClient.set(row.user_agent, [row]);
  }

  const found: Cohort[] = [];
  for (const [userAgent, group] of byClient) {
    // The whole group's shape decides IF this is a cohort: same client, a burst,
    // and a machine-made majority. The shared quality bar guards against a busy
    // but human client.
    const machine = group.filter((r) => looksMachineMade(localPartOf(r.email)));
    const ratio = machine.length / group.length;
    if (ratio < MIN_MACHINE_SHAPE_RATIO) continue;

    const window = burstWindow(
      group.map((r) => toMs(r.created_at)).sort((a, b) => a - b),
      windows,
    );
    if (!window) continue;

    // But only the machine-shaped addresses are actually regrouped: the human
    // minority inside a poisoned or shared-client batch keeps its own dossier
    // and its normal monthly quota. Precision over recall — missing part of a
    // burst is cheap, catching a real customer is not.
    const machineTimes = machine.map((r) => r.created_at).sort();
    found.push({
      userAgent,
      keyPrefixes: [...new Set(machine.map((r) => r.key_prefix))],
      windowHours: window.hours,
      machineShapeRatio: Math.round(ratio * 100) / 100,
      firstSeen: machineTimes[0],
      lastSeen: machineTimes[machineTimes.length - 1],
    });
  }

  return found.sort((a, b) => b.keyPrefixes.length - a.keyPrefixes.length);
}

/**
 * Address used for a cohort's single dossier. The `.invalid` top-level domain
 * can never resolve, so no automated mail can ever be sent to it — the cohort
 * stays visible in the CRM without becoming a mail target.
 */
export function cohortAddress(userAgent: string, day: string): string {
  const slug = userAgent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return `${slug || 'client'}-${day}@cohorte.invalid`;
}
