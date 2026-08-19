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
export function findCohorts(rows: CreationRow[], now: Date, windows: CohortWindow[] = COHORT_WINDOWS): Cohort[] {
  const usable = rows.filter(
    (r): r is CreationRow & { user_agent: string; key_prefix: string; email: string } =>
      typeof r.user_agent === 'string' &&
      r.user_agent.length > 0 &&
      typeof r.key_prefix === 'string' &&
      r.key_prefix.length > 0 &&
      typeof r.email === 'string' &&
      r.email.includes('@'),
  );

  const found = new Map<string, Cohort>();
  for (const window of windows) {
    const since = new Date(now.getTime() - window.hours * 60 * 60 * 1000);
    const byClient = new Map<string, Array<(typeof usable)[number]>>();
    for (const row of usable) {
      // SQLite datetime('now') writes "YYYY-MM-DD HH:MM:SS" in UTC; the space
      // has to become a T (and the zone be explicit) or Date parses it as local
      // time and the window silently shifts by the machine's offset.
      const at = new Date(`${row.created_at.replace(' ', 'T')}Z`);
      if (Number.isNaN(at.getTime()) || at < since) continue;
      const list = byClient.get(row.user_agent);
      if (list) list.push(row);
      else byClient.set(row.user_agent, [row]);
    }

    for (const [userAgent, group] of byClient) {
      if (group.length < window.minKeys) continue;
      const machineMade = group.filter((r) => looksMachineMade(localPartOf(r.email))).length;
      const ratio = machineMade / group.length;
      if (ratio < MIN_MACHINE_SHAPE_RATIO) continue;

      // A client can trip several windows at once; keep the widest match, which
      // carries the most keys.
      const existing = found.get(userAgent);
      if (existing && existing.keyPrefixes.length >= group.length) continue;
      const times = group.map((r) => r.created_at).sort();
      found.set(userAgent, {
        userAgent,
        keyPrefixes: [...new Set(group.map((r) => r.key_prefix))],
        windowHours: window.hours,
        machineShapeRatio: Math.round(ratio * 100) / 100,
        firstSeen: times[0],
        lastSeen: times[times.length - 1],
      });
    }
  }

  return [...found.values()].sort((a, b) => b.keyPrefixes.length - a.keyPrefixes.length);
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
