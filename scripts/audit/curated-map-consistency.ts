/**
 * Confront the curated bank-code map with everything else we already hold.
 *
 * The July audit recommended confronting the ~70 countries never checked
 * against an authority, and noted the cheap half "coûte zéro source nouvelle
 * et touche TOUS les clients". This is that half: no download, no licence
 * question, only our own files disagreeing with each other.
 *
 * ## What the two checks are actually worth
 *
 * UNDESCRIBABLE (the signal). The map names a BIC that no `bic_entries` row
 * covers, so `bank_name` and `city` come back null and the caller receives a
 * bare code. Measured 23/08/2026: 215 of 24,069, and 205 of those carry no
 * bank name in the map either.
 *
 * ⚠️ This is a COVERAGE limit, not a data error, and the difference decides
 * what to do about it. Every one of the 215 is a well-formed BIC with a real
 * ISO country at positions 5-6 — none is a typo. Our directory holds ~121k of
 * a much larger universe, so "absent from bic_entries" says nothing about
 * whether the BIC exists. The response already discloses this: for these
 * countries `bank_code_check.authoritative` is false and `register` says in
 * full that the map is "assembled from BIC directories, not a national
 * bank-code register". The contract is honest; this number is the size of what
 * it is being honest about.
 *
 * COUNTRY MISMATCH (noisy, indicative only). Characters 5-6 of the BIC name a
 * different country than the key. Reported because a sudden jump would be
 * worth looking at — never as an error count.
 *
 * 🚨 Do NOT read these as defects. Verified 23/08: `FR:11668 ->
 * BERLMCMCXXX` is Edmond de Rothschild MONACO, and Monaco issues FR IBANs;
 * `SK:2010 -> FIOBCZPPXXX` is Fio banka's Slovak branch on its Czech head
 * office BIC; `LT:30021 -> NORWNOK1XXX` is Bank Norwegian, resolved with name
 * and city. Foreign branches and shared IBAN spaces make this check
 * structurally noisy, and an early version of this file called all 187 hits
 * errors.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

interface Entry { bic: string; bank_name?: string; city?: string }

export interface MapAudit {
  total: number;
  countries: number;
  /** BIC the directory cannot describe at all. */
  undescribable: number;
  /** Of those, the ones with no bank name in the map either: a bare code. */
  bare: number;
  /** Well-formed check: none expected, a hit would be a genuine typo. */
  malformed: number;
  /** Indicative only — see the header. */
  countryMismatch: number;
  byCountry: Array<{ cc: string; total: number; undescribable: number }>;
}

/** Countries that legitimately share a BIC country with their IBAN space. */
const SHARED_BIC_COUNTRY: Record<string, string[]> = {
  LI: ['LI', 'CH'],
  CH: ['CH', 'LI'],
  // Monaco issues FR IBANs; its banks carry MC BICs.
  FR: ['FR', 'MC'],
  MC: ['MC', 'FR'],
};

export function auditCuratedMap(
  mapPath = 'src/db/bic_data.json',
  dbPath = 'data/bic.sqlite',
): MapAudit {
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, Entry>;
  const db = new Database(dbPath, { readonly: true });
  const k11 = new Set<string>();
  const k8 = new Set<string>();
  for (const r of db.prepare('SELECT bic11, bic8 FROM bic_entries').all() as Array<{
    bic11: string;
    bic8: string;
  }>) {
    k11.add(r.bic11);
    k8.add(r.bic8);
  }
  db.close();

  const per = new Map<string, { total: number; undescribable: number }>();
  let undescribable = 0;
  let bare = 0;
  let malformed = 0;
  let countryMismatch = 0;

  for (const [key, e] of Object.entries(map)) {
    const [cc] = key.split(':');
    if (!cc || !e?.bic) continue;
    if (!per.has(cc)) per.set(cc, { total: 0, undescribable: 0 });
    const slot = per.get(cc)!;
    slot.total++;

    const bic8 = e.bic.slice(0, 8);
    if (!/^[A-Z]{6}[A-Z0-9]{2}$/.test(bic8)) malformed++;

    const allowed = SHARED_BIC_COUNTRY[cc] ?? [cc];
    if (!allowed.includes(bic8.slice(4, 6))) countryMismatch++;

    const bic11 = e.bic.length === 8 ? `${e.bic}XXX` : e.bic;
    if (!k11.has(bic11) && !k8.has(bic8)) {
      undescribable++;
      slot.undescribable++;
      if (!e.bank_name) bare++;
    }
  }

  return {
    total: Object.keys(map).length,
    countries: per.size,
    undescribable,
    bare,
    malformed,
    countryMismatch,
    byCountry: [...per.entries()]
      .map(([cc, v]) => ({ cc, ...v }))
      .filter((r) => r.undescribable > 0)
      .sort((a, b) => b.undescribable - a.undescribable),
  };
}

if (process.argv[1]?.endsWith('curated-map-consistency.ts')) {
  const a = auditCuratedMap();
  console.log(`carte curee                       : ${a.total} codes, ${a.countries} pays`);
  console.log(`BIC que l'annuaire ne decrit pas  : ${a.undescribable}`);
  console.log(`  dont code NU (sans nom)         : ${a.bare}`);
  console.log(`BIC mal formes                    : ${a.malformed}  (attendu : 0)`);
  console.log(`pays du BIC different (indicatif) : ${a.countryMismatch}  <- succursales et Monaco, PAS des erreurs`);
  console.log('\npays  codes  nonDecrits');
  for (const r of a.byCountry) {
    console.log(`${r.cc.padEnd(5)} ${String(r.total).padStart(5)} ${String(r.undescribable).padStart(11)}`);
  }
}
