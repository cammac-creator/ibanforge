/**
 * The impostor detector: a curated-map entry that serves the WRONG BIC for the
 * institution it names.
 *
 * ## Why the existing guard cannot see this
 *
 * `curated-map-consistency.ts` counts two things: BICs that are malformed (a
 * typo) and the SHARE of BICs the directory cannot describe (a coverage limit,
 * honestly disclosed by `bank_code_check.authoritative = false`). Neither can
 * see a BIC that is well-formed, of the right country, and simply not this
 * institution's. The data audit of 01/09/2026 found five of them, one of which
 * served a live Italian ABI under another bank's name entirely (DATA-01).
 *
 * ## The rule, and why it is a conjunction
 *
 * A hit requires BOTH halves:
 *
 *   1. the BIC the entry serves is absent from `bic_entries` (neither its
 *      BIC11 nor its BIC8), AND
 *   2. the institution the entry NAMES resolves in `bic_entries`, in the same
 *      country, under a DIFFERENT BIC8.
 *
 * Half 1 alone is the coverage limit the older guard already measures — 222 of
 * 24,083 entries on 01/09/2026, every one well-formed. Turning that into a
 * failure would be renaming a known, disclosed gap an error. Half 2 is what
 * makes a hit actionable: our own directory holds a describable BIC for the
 * very bank the entry names, so the entry is not describing an institution we
 * lack, it is pointing at the wrong code for one we hold.
 *
 * The detector uses no external memory: it confronts `src/db/bic_data.json`
 * with `data/bic.sqlite` and nothing else. That is what makes it safe to run
 * as a permanent test rather than as a one-off audit against a downloaded list.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

interface Entry {
  bic: string;
  bank_name?: string;
  city?: string;
}

export interface Impostor {
  /** The `CC:bankcode` key of the curated map. */
  key: string;
  /** The BIC the entry serves, which the directory cannot describe. */
  bic: string;
  /** The institution the entry names. */
  bank_name: string;
  /** BIC8s under which that institution DOES resolve in the directory. */
  resolvesAs: string[];
}

/**
 * Uppercase, punctuation to spaces, whitespace collapsed.
 *
 * Deliberately no stemming and no legal-form stripping: the comparison below
 * is a word-boundary PREFIX match, which already absorbs the one difference
 * that matters here — the directory writes the legal form ("BANCA SELLA -
 * S.P.A.") where the curated map writes the trading name ("Banca Sella").
 * Anything cleverer would start matching institutions that merely share a
 * first word, and this detector is only worth having if a hit is a defect.
 */
function norm(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function findImpostors(
  mapPath = 'src/db/bic_data.json',
  dbPath = 'data/bic.sqlite',
): Impostor[] {
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, Entry>;
  const db = new Database(dbPath, { readonly: true });

  const k11 = new Set<string>();
  const k8 = new Set<string>();
  /** country -> [normalized institution, bic8] — the haystack of half 2. */
  const byCountry = new Map<string, Array<[string, string]>>();

  for (const r of db
    .prepare('SELECT bic11, bic8, institution, country_code FROM bic_entries')
    .all() as Array<{ bic11: string; bic8: string; institution: string | null; country_code: string }>) {
    k11.add(r.bic11);
    k8.add(r.bic8);
    if (!r.institution) continue;
    let slot = byCountry.get(r.country_code);
    if (!slot) byCountry.set(r.country_code, (slot = []));
    slot.push([norm(r.institution), r.bic8]);
  }
  db.close();

  const impostors: Impostor[] = [];

  for (const [key, entry] of Object.entries(map)) {
    const cc = key.split(':')[0];
    if (!cc || !entry?.bic || !entry.bank_name) continue;

    const bic8 = entry.bic.slice(0, 8);
    const bic11 = entry.bic.length === 8 ? `${entry.bic}XXX` : entry.bic;

    // Half 1: the directory can describe it, so there is nothing to suspect.
    if (k11.has(bic11) || k8.has(bic8)) continue;

    // Half 2: does the named institution resolve under some OTHER BIC8?
    const wanted = norm(entry.bank_name);
    if (wanted === '') continue;
    const prefix = `${wanted} `;
    const resolvesAs = new Set<string>();
    for (const [institution, otherBic8] of byCountry.get(cc) ?? []) {
      if (otherBic8 === bic8) continue;
      if (institution === wanted || institution.startsWith(prefix)) resolvesAs.add(otherBic8);
    }

    if (resolvesAs.size > 0) {
      impostors.push({
        key,
        bic: entry.bic,
        bank_name: entry.bank_name,
        resolvesAs: [...resolvesAs].sort(),
      });
    }
  }

  return impostors.sort((a, b) => a.key.localeCompare(b.key));
}
